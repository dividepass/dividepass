// ============================================================================
// WEBHOOK DA PULSE CODING
// ============================================================================
//
// A Pulse chama esta URL depois de cada pedido. É o caminho mais rápido para
// a entrega: o cliente pagou, a Pulse processou, e o webhook traz a entrega.
//
// SEGURANÇA
// ----------
//   - `verify_jwt = false` (no config.toml): quem chama é o servidor da
//     Pulse, sem sessão e sem JWT.
//   - POR ISSO a assinatura é obrigatória: o header `X-Pulse-Signature` tem
//     que ser "sha256=" + HMAC-SHA256 do CORPO CRU, usando a PULSE_API_KEY
//     como segredo. O corpo é lido como TEXTO (nunca `req.json()`) porque
//     qualquer reserialização muda os bytes e quebra a assinatura.
//
// O QUE CHEGA
// -----------
//   { "event": "order.completed", ... } — o corpo exato depende da Pulse, por
//   isso o código aceita o pedido no nível raiz, em `order` ou em `data`.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pulseConfereAssinatura } from "../_shared/pulse.ts";
import {
  atualizarPedidoComResposta,
  aplicarEntrega,
  dataValidade,
  registrarEvento,
} from "../_shared/pulse-orders.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Procura um campo no corpo em três níveis: raiz, `order` e `data`. */
function buscar(corpo: any, campo: string): any {
  if (!corpo) return undefined;
  if (corpo[campo] !== undefined) return corpo[campo];
  if (corpo.order && corpo.order[campo] !== undefined) return corpo.order[campo];
  if (corpo.data && corpo.data[campo] !== undefined) return corpo.data[campo];
  if (corpo.order && corpo.order.data && corpo.order.data[campo] !== undefined) {
    return corpo.order.data[campo];
  }
  return undefined;
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    // ── Assinatura: valida ANTES de qualquer leitura do corpo ────────────
    const assinatura = req.headers.get("X-Pulse-Signature") ?? req.headers.get("x-pulse-signature");
    const corpoCru = await req.text();

    if (!assinatura) {
      console.warn("[pulse-webhook] requisição sem X-Pulse-Signature — recusada.");
      return json({ ok: false, erro: "Assinatura ausente." }, 401);
    }

    let valida = false;
    try {
      valida = await pulseConfereAssinatura(corpoCru, assinatura);
    } catch (e: any) {
      console.error("[pulse-webhook] erro ao conferir a assinatura:", e?.message ?? e);
    }

    if (!valida) {
      console.warn("[pulse-webhook] assinatura inválida — recusada.");
      return json({ ok: false, erro: "Assinatura inválida." }, 401);
    }

    let corpo: any = {};
    try {
      corpo = corpoCru ? JSON.parse(corpoCru) : {};
    } catch {
      return json({ ok: false, erro: "Corpo não é JSON válido." }, 400);
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

      const evento = String(buscar(corpo, "event") ?? corpo.evento ?? corpo.type ?? "").toLowerCase();
      const externalId = buscar(corpo, "external_id") ?? buscar(corpo, "externalId") ?? null;
      const pulseOrderId = buscar(corpo, "order_id") ?? buscar(corpo, "id") ?? null;
      const status = String(buscar(corpo, "status") ?? "").toLowerCase();
      const entrega = buscar(corpo, "delivery") ?? null;

      console.log(`[pulse-webhook] evento=${evento || "(sem evento)"} status=${status || "-"} external_id=${externalId ?? "-"}`);

      // ── Acha o pedido local ─────────────────────────────────────────────
      let pedido: any = null;
      if (externalId) {
        const r = await supabaseAdmin
          .from("pulse_pedidos")
          .select("*")
          .eq("external_id", String(externalId))
          .maybeSingle();
        pedido = r.data ?? null;
      }
      if (!pedido && pulseOrderId) {
        const r = await supabaseAdmin
          .from("pulse_pedidos")
          .select("*")
          .eq("pulse_order_id", String(pulseOrderId))
          .maybeSingle();
        pedido = r.data ?? null;
      }

      if (!pedido) {
        // Pedido que não é nosso (ou webhook de teste): acknowledge sem
        // inventar registro. O polling do cron cobre o que sobrar.
        console.warn("[pulse-webhook] pedido não encontrado localmente — ignorado.");
        return json({ ok: true, encontrado: false });
      }

      // ── Grava o que a Pulse mandou ──────────────────────────────────────
      const resposta = {
        status: status || evento.replace("order.", ""),
        delivery: entrega,
        order_id: pulseOrderId,
      };

      const atualizado = await atualizarPedidoComResposta(supabaseAdmin, pedido, resposta);

      await registrarEvento(supabaseAdmin, {
        pedido_id: pedido.id,
        package_id: pedido.package_id,
        group_id: pedido.group_id,
        user_id: pedido.user_id,
        tipo: `webhook_${evento || "desconhecido"}`,
        mensagem: `Webhook ${evento || "(sem evento)"} recebido da Pulse.`,
        detalhes: { status, tem_entrega: !!entrega },
      });

      // ── Entrega ─────────────────────────────────────────────────────────
      if (entrega && atualizado.status === "entregue") {
        let pacote: any = null;
        if (pedido.package_id) {
          const { data } = await supabaseAdmin
            .from("pulse_pacotes")
            .select("title, duration_days")
            .eq("package_id", pedido.package_id)
            .maybeSingle();
          pacote = data ?? null;
        }

        const aplicacao = await aplicarEntrega(supabaseAdmin, {
          group_id: pedido.group_id,
          user_id: pedido.user_id,
          entrega,
          pedido: atualizado,
          package_id: pedido.package_id,
          package_title: pacote?.title ?? null,
          expira_em: dataValidade(Number(pacote?.duration_days ?? 30)),
        });

        await registrarEvento(supabaseAdmin, {
          pedido_id: pedido.id,
          package_id: pedido.package_id,
          group_id: pedido.group_id,
          user_id: pedido.user_id,
          tipo: "entrega_aplicada",
          mensagem: `Entrega do pedido ${pedido.external_id} aplicada via webhook.`,
          detalhes: { tipo: aplicacao.tipo, linhas: aplicacao.linhas },
        });
      }

      // ── Erro definitivo → avisa o admin ─────────────────────────────────
      const statusFinal = String(atualizado.status ?? "");
      if (["erro", "devolvido", "cancelado"].includes(statusFinal)) {
        await supabaseAdmin.from("platform_events").insert({
          event_type: "pulse",
          title: "Pedido da Pulse terminou com erro",
          message:
            `O pedido ${pedido.external_id} (${pedido.package_id}) terminou como "${statusFinal}". ` +
            `Motivo: ${pedido.ultimo_erro ?? "não informado"}.`,
          metadata: {
            pedido_id: pedido.id,
            external_id: pedido.external_id,
            package_id: pedido.package_id,
            status: statusFinal,
          },
          created_by: null,
        });
      }

      return json({ ok: true, encontrado: true, pedido_id: pedido.id, status: atualizado.status });
    } catch (e: any) {
      console.error("[pulse-webhook] erro:", e?.message ?? e);
      return json({ ok: false, erro: String(e?.message ?? e) }, 500);
    }
  },
};
