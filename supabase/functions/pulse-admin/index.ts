// ============================================================================
// PULSE CODING — PAINEL DO ADMIN
// ============================================================================
//
// Ponte entre o painel do DividePass e a API de revenda da Pulse.
//
// SEGURANÇA
// ----------
//   - Só admin entra: o JWT é conferido e o papel `role = 'admin'` é lido do
//     banco (public.users) — não do token.
//   - A chave da Pulse fica no ambiente (`PULSE_API_KEY`). Esta função NUNCA
//     a devolve, nem em caso de erro.
//   - Ações que gastam saldo (create_order) só existem com `dry_run: true`
//     aqui: a compra real acontece exclusivamente pelo `confirm-payment`.
//
// AÇÕES
// ------
//   ping       → testa a conexão
//   balance    → saldo disponível na Pulse
//   sync       → importa/atualiza o catálogo (aceita dry_run)
//   packages   → espelho local do catálogo (view pulse_painel)
//   orders     → pedidos (locais; opcionalmente também os da Pulse)
//   order      → detalhe de um pedido local
//   remap      → aponta um grupo para outro package_id
//   dry_run    → simula uma compra (não cobra, não cria pedido)
//   reprocess  → tenta concluir um pedido pendente
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PulseError,
  pulseCreateOrder,
  pulseGetBalance,
  pulseListOrders,
  pulsePing,
} from "../_shared/pulse.ts";
import { importarCatalogoPulse } from "../_shared/pulse-import.ts";
import { MARKUP_PADRAO } from "../_shared/pulse-catalog.ts";
import { reprocessarPedido } from "../_shared/pulse-orders.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

      // ── Autenticação de admin ────────────────────────────────────────────
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Não autenticado." }, 401);

      const jwt = authHeader.replace("Bearer ", "");
      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(jwt);
      if (authError || !authData?.user) return json({ error: "Token inválido." }, 401);

      const { data: profile } = await supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", authData.user.id)
        .maybeSingle();

      const isAdmin =
        profile?.role === "admin" || authData.user.app_metadata?.role === "admin";
      if (!isAdmin) return json({ error: "Acesso restrito ao administrador." }, 403);

      const body = await req.json().catch(() => ({}));
      const action = String(body.action ?? "");

      switch (action) {
        // ── Teste de conexão ───────────────────────────────────────────────
        case "ping": {
          try {
            const resultado = await pulsePing();
            return json({ ok: true, resultado });
          } catch (e: any) {
            return json({ ok: false, error: String(e?.message ?? e) }, 200);
          }
        }

        // ── Saldo ──────────────────────────────────────────────────────────
        case "balance": {
          try {
            const saldo = await pulseGetBalance();
            return json({ ok: true, saldo });
          } catch (e: any) {
            const codigo = e instanceof PulseError ? e.code : "desconhecido";
            return json({ ok: false, erro: String(e?.message ?? e), codigo }, 200);
          }
        }

        // ── Sincronizar o catálogo ─────────────────────────────────────────
        case "sync": {
          try {
            const relatorio = await importarCatalogoPulse(supabaseAdmin, {
              markup: body.markup != null ? Number(body.markup) : MARKUP_PADRAO,
              adminUserId: authData.user.id,
              dryRun: !!body.dry_run,
            });
            return json({ ok: true, relatorio, dry_run: !!body.dry_run });
          } catch (e: any) {
            return json({ ok: false, erro: String(e?.message ?? e) }, 200);
          }
        }

        // ── Espelho local do catálogo ──────────────────────────────────────
        case "packages": {
          const { data, error } = await supabaseAdmin
            .from("pulse_painel")
            .select("*")
            .order("category", { ascending: true })
            .order("title", { ascending: true });

          if (error) return json({ ok: false, erro: error.message }, 200);
          return json({ ok: true, pacotes: data ?? [] });
        }

        // ── Pedidos ────────────────────────────────────────────────────────
        case "orders": {
          const { data, error } = await supabaseAdmin
            .from("pulse_pedidos")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(Number(body.limit ?? 100));

          if (error) return json({ ok: false, erro: error.message }, 200);

          // A lista da Pulse é complementar (o espelho local é a verdade).
          let pedidosPulse: unknown[] = [];
          let erroPulse: string | null = null;
          if (body.incluir_pulse) {
            try {
              const r = await pulseListOrders({ limit: Number(body.limit ?? 50) });
              pedidosPulse = r.orders;
            } catch (e: any) {
              erroPulse = String(e?.message ?? e);
            }
          }

          return json({ ok: true, pedidos: data ?? [], pedidos_pulse: pedidosPulse, erro_pulse: erroPulse });
        }

        // ── Detalhe de um pedido ───────────────────────────────────────────
        case "order": {
          const id = String(body.id ?? "");
          if (!id) return json({ ok: false, erro: "Informe o id do pedido." }, 400);

          const { data: pedido, error } = await supabaseAdmin
            .from("pulse_pedidos")
            .select("*")
            .eq("id", id)
            .maybeSingle();

          if (error) return json({ ok: false, erro: error.message }, 200);
          if (!pedido) return json({ ok: false, erro: "Pedido não encontrado." }, 404);

          const { data: eventos } = await supabaseAdmin
            .from("pulse_eventos")
            .select("*")
            .eq("pedido_id", id)
            .order("created_at", { ascending: false });

          const { data: entrega } = await supabaseAdmin
            .from("pulse_entregas")
            .select("*")
            .eq("pedido_id", id);

          return json({ ok: true, pedido, eventos: eventos ?? [], entregas: entrega ?? [] });
        }

        // ── Remapear grupo → pacote ────────────────────────────────────────
        case "remap": {
          const groupId = String(body.group_id ?? "");
          const packageId = String(body.package_id ?? "");
          if (!groupId || !packageId) {
            return json({ ok: false, erro: "Informe group_id e package_id." }, 400);
          }

          const { data: pacote } = await supabaseAdmin
            .from("pulse_pacotes")
            .select("*")
            .eq("package_id", packageId)
            .maybeSingle();

          if (!pacote) {
            return json({ ok: false, erro: "package_id não existe no espelho local. Rode a sincronização." }, 400);
          }

          const { data: mapeamento } = await supabaseAdmin
            .from("pulse_mapeamentos")
            .select("*")
            .eq("group_id", groupId)
            .maybeSingle();

          const dados = {
            group_id: groupId,
            package_id: packageId,
            status: "ativo",
            custo: pacote.price ?? null,
            preco_venda: pacote.sale_price ?? null,
            margem:
              pacote.sale_price != null && pacote.price != null
                ? Math.round((Number(pacote.sale_price) - Number(pacote.price)) * 100) / 100
                : null,
            observacao: body.observacao ?? null,
            mapeado_por: authData.user.email ?? authData.user.id,
            updated_at: new Date().toISOString(),
          };

          if (mapeamento) {
            await supabaseAdmin.from("pulse_mapeamentos").update(dados).eq("id", mapeamento.id);
          } else {
            await supabaseAdmin.from("pulse_mapeamentos").insert(dados);
          }

          await supabaseAdmin
            .from("pulse_pacotes")
            .update({ group_id: groupId, updated_at: new Date().toISOString() })
            .eq("package_id", packageId);

          // O grupo volta para a vitrine se o pacote estiver vendável.
          const vendavel = pacote.orderable_via_api !== false && pacote.available !== false;
          await supabaseAdmin
            .from("groups")
            .update({
              status: vendavel ? "open" : "closed",
              visibility: vendavel ? "public" : "private",
              price_per_slot: pacote.sale_price ?? pacote.original_price ?? 0,
            })
            .eq("id", groupId);

          return json({ ok: true, grupo_id: groupId, package_id: packageId });
        }

        // ── Simulação de compra (NUNCA cobra) ───────────────────────────────
        case "dry_run": {
          const packageId = String(body.package_id ?? "");
          if (!packageId) return json({ ok: false, erro: "Informe o package_id." }, 400);

          try {
            const resposta = await pulseCreateOrder({
              package_id: packageId,
              external_id: `DRY${Date.now().toString(36).toUpperCase().slice(-6)}`,
              dry_run: true,
            });
            return json({ ok: true, dry_run: true, resposta });
          } catch (e: any) {
            const codigo = e instanceof PulseError ? e.code : "desconhecido";
            return json(
              {
                ok: false,
                dry_run: true,
                erro: String(e?.message ?? e),
                codigo,
                detalhes: e instanceof PulseError ? e.details : null,
              },
              200,
            );
          }
        }

        // ── Reprocessar um pedido pendente ─────────────────────────────────
        case "reprocess": {
          const id = String(body.id ?? "");
          if (!id) return json({ ok: false, erro: "Informe o id do pedido." }, 400);

          const { data: pedido } = await supabaseAdmin
            .from("pulse_pedidos")
            .select("*")
            .eq("id", id)
            .maybeSingle();

          if (!pedido) return json({ ok: false, erro: "Pedido não encontrado." }, 404);

          const r = await reprocessarPedido(supabaseAdmin, pedido, { origem: "admin" });
          return json({ ok: r.ok, resultado: r });
        }

        default:
          return json({ erro: `Ação desconhecida: "${action}".` }, 400);
      }
    } catch (e: any) {
      console.error("[pulse-admin] erro:", e?.message ?? e);
      return json({ erro: String(e?.message ?? e) }, 500);
    }
  },
};
