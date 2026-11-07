/**
 * RECONCILIAÇÃO DE PAGAMENTOS — "paguei e não entrei no grupo"
 * =========================================================
 *
 * O PROBLEMA
 * -----------
 * Um pagamento aprovado no gateway só vira acesso ao grupo se ALGUÉM rodar a
 * confirmação. Até 01/11/2026 existiam exatamente dois caminhos automáticos:
 *
 *   1) o webhook do gateway (IO Pay precisa entregar o `notification_url`);
 *   2) o polling do navegador (só funciona com a ABA ABERTA).
 *
 * O caso real: a Fran pagou R$ 59,40 no grupo "Netflix C/ Anúncio" (PIX),
 * foi para o aplicativo do banco pagar, e a confirmação nunca rodou. O
 * gateway aprovou, o painel marcou a tentativa como "Aprovado" e a pessoa ficou
 * fora do grupo — sem evento, sem e-mail e sem ninguém saber. Só o suporte
 * atendente entrou em contato.
 *
 * Por que o polling não salvou: quem paga no PIX sai do navegador (vai pagar
 * no app do banco) e fecha a aba. E o webhook não pode ser a única rede de
 * proteção.
 *
 * O QUE ESTE JOB FAZ
 * -------------------
 * A cada rodada ele caça os pagamentos que o gateway APROVOU mas que nunca
 * viraram acesso:
 *
 *   - acha as tentativas de pagamento (payment_attempts) do gateway que ainda
 *     NÃO têm uma linha paga em `payments`;
 *   - pergunta à IO Pay o status real de cada uma;
 *   - as que estão aprovadas passam pela confirmação compartilhada
 *     (`confirmPayment`) — que libera o grupo, cria a assinatura, registra o
 *     pagamento, cria o ciclo de cobrança e MANDA OS E-MAILS;
 *   - as que o gateway recusou são marcadas como recusadas (e param de
 *     aparecer como pendentes para sempre).
 *
 * É a garantia de que "pagou" sempre vira "entrou no grupo" — mesmo que o
 * webhook não chegue, mesmo que a pessoa tenha fechado a aba.
 *
 * AUTORIZAÇÃO
 * -----------
 * Roda com `verify_jwt = false` (o cron manda um segredo, não um JWT). Sem a
 * checagem abaixo, viraria um endpoint PÚBLICO que libera grupo de graça.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { confirmPayment } from "../confirm-payment/index.ts";
import { getGatewaySettings } from "../create-payment/handlers/settings.ts";
// `payment_attempts.payment_method` guardava o OBJETO do gateway (cartao
// inteiro / BR Code, 480–540 chars). Repassar isso cru para o
// `confirm-payment` estourava `user_subscriptions.payment_method` (VARCHAR(50))
// e a liberacao falhava depois do dinheiro cair. Normaliza sempre.
import { metodoPagamentoSeguro } from "../_shared/metodo-pagamento.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Idade mínima da tentativa antes de ir ao gateway (deixa o polling vivo agir). */
const MIN_AGE_MINUTES = 5;
/** Quantas tentativas a cada rodada (protege o gateway de rajada). */
const MAX_PER_RUN = 40;

const APPROVED = new Set([
  "succeeded", "approved", "paid", "authorized", "captured",
  "completed", "done", "success", "settled", "confirmed",
]);
const REJECTED = new Set([
  "failed", "cancelled", "canceled", "rejected", "refunded",
  "error", "denied", "expired", "chargeback", "voided", "refused",
]);

/** A IO Pay responde em vários formatos: {"success":{...}}, {"data":{...}}… */
function extractResponseData(payload: any): any {
  if (!payload || typeof payload !== "object") return null;
  for (const candidate of [payload.success, payload.data, payload.result, payload.transaction]) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  }
  return payload;
}

function statusAprovado(status: string): boolean {
  return APPROVED.has(String(status || "").toLowerCase().trim());
}

function statusRecusado(status: string): boolean {
  return REJECTED.has(String(status || "").toLowerCase().trim());
}

/** Autentica na IO Pay (o token pode vir em `success`, `data` ou na raiz). */
async function tokenIOPay(settings: Record<string, string>): Promise<string> {
  const env = settings.iopay_env || "production";
  const base = env === "sandbox"
    ? "https://sandbox.api.iopay.com.br/api/"
    : "https://api.iopay.com.br/api/";

  const { iopay_email, iopay_secret, iopay_seller_id } = settings;
  const url =
    `${base}auth/login?email=${encodeURIComponent(iopay_email || "")}` +
    `&secret=${encodeURIComponent(iopay_secret || "")}` +
    `&io_seller_id=${encodeURIComponent(iopay_seller_id || "")}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: iopay_email,
      secret: iopay_secret,
      io_seller_id: iopay_seller_id,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  const token =
    data?.success?.access_token || data?.data?.access_token || data?.access_token || "";
  if (!token) throw new Error("IOPay auth falhou: " + JSON.stringify(data).slice(0, 200));
  return token;
}

/** Lê a transação na IO Pay. */
async function lerTransacao(base: string, token: string, txId: string): Promise<any> {
  const resp = await fetch(`${base}v1/transaction/get/${txId}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!resp.ok) return null;
  return extractResponseData(await resp.json().catch(() => null));
}

/** O tipo de pagamento vem da referência `grupo:usuario:tipo`. */
function tipoDaReferencia(referenceId: string | null): "entrance" | "subscription" | "combined" | null {
  const parts = String(referenceId || "").split(":");
  if (parts.length < 3) return null;
  const tipo = parts[2];
  if (tipo === "entrance" || tipo === "subscription" || tipo === "combined") return tipo;
  return "subscription";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Autorização (mesmo padrão dos outros jobs) ────────────────────────────
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || "";
  const authHeader = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let authorized = authHeader === serviceRoleKey && serviceRoleKey !== "";

  if (!authorized && authHeader) {
    const { data: secretRows } = await createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceRoleKey,
    ).from("app_settings").select("value").in("key", [
      "recurring_billing_cron_secret",
      "billing_cron_secret",
      "subscription_status_cron_secret",
      "reconcile_payments_cron_secret",
    ]);

    const accepted = [
      Deno.env.get("BILLING_CRON_SECRET") || "",
      ...(secretRows || []).map((r: any) => r.value || ""),
    ].filter(Boolean);

    authorized = accepted.includes(authHeader);
  }

  if (!authorized) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    serviceRoleKey,
  );

  const resumo = {
    examinadas: 0,
    aprovadas_no_gateway: 0,
    confirmadas: 0,
    falharam: 0,
    recusadas: 0,
    ja_aplicadas: 0,
    orfas_ignoradas: 0,
    detalhes: [] as any[],
  };

  try {
    const settings = await getGatewaySettings();
    if (!settings.iopay_secret || !settings.iopay_email || !settings.iopay_seller_id) {
      return new Response(
        JSON.stringify({ error: "Credenciais IOPAY não configuradas" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const env = settings.iopay_env || "production";
    const base = env === "sandbox"
      ? "https://sandbox.api.iopay.com.br/api/"
      : "https://api.iopay.com.br/api/";
    const token = await tokenIOPay(settings);

    // ── 1) Candidatas: tentativas que ainda não viraram pagamento ──────────
    const corte = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000).toISOString();

    const { data: tentativas, error: tentErr } = await supabaseAdmin
      .from("payment_attempts")
      .select(
        "id, user_id, group_id, gateway, gateway_transaction_id, amount, status, payment_type, external_reference, created_at",
      )
      .eq("gateway", "iopay")
      .not("gateway_transaction_id", "is", null)
      .lt("created_at", corte)
      .order("created_at", { ascending: true })
      .limit(300);

    if (tentErr) throw new Error("payment_attempts: " + tentErr.message);

    const candidatas = (tentativas || []).filter((t: any) => {
      // Recusadas no gateway não voltam. Órfãs (grupo que não existe mais)
      // também não: já foram marcadas e não geram evento.
      const s = String(t.status || "").toLowerCase();
      if (s.includes("rejected") || s.includes("failed") || s.includes("cancelled")) return false;
      if (s.includes("orphaned")) return false;
      return true;
    });

    if (candidatas.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, ...resumo, mensagem: "nenhuma tentativa pendente" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 2) Quais já têm pagamento aplicado? ────────────────────────────────
    const txIds = [...new Set(candidatas.map((t: any) => t.gateway_transaction_id))];
    const { data: pagos } = await supabaseAdmin
      .from("payments")
      .select("transaction_code, payment_type, status")
      .in("transaction_code", txIds)
      .eq("status", "paid");

    const pagosPorTx = new Map<string, string[]>();
    for (const p of pagos || []) {
      const lista = pagosPorTx.get(p.transaction_code) || [];
      lista.push(p.payment_type);
      pagosPorTx.set(p.transaction_code, lista);
    }

    const pendentes = candidatas.filter((t: any) => {
      const tipos = pagosPorTx.get(t.gateway_transaction_id) || [];
      if (tipos.length === 0) return true;
      // Combinado: as duas partes precisam estar pagas.
      const tipo = tipoDaReferencia(t.external_reference) || t.payment_type;
      if (tipo === "combined") return !(tipos.includes("entrance") && tipos.includes("subscription"));
      return !tipos.includes(tipo);
    });

    resumo.examinadas = pendentes.length;
    resumo.ja_aplicadas = candidatas.length - pendentes.length;

    // ── 2b) Tentativas ÓRFÃS: o grupo não existe (ou ficou sem serviço) ──────
    //
    // São tentativas antigas/quebradas apontando para um grupo que não existe
    // mais. Sem este filtro o job chamava a confirmação, ela reprovava
    // (`service_id` NOT NULL) e o painel enchia de "Pagamento aprovado sem
    // liberação" — mais de 100 eventos por hora, sem nenhum cliente real
    // envolvido. Aqui elas são marcadas e ignoradas, sem evento.
    const idsGrupos = [...new Set(pendentes.map((t: any) => t.group_id).filter(Boolean))];
    const { data: gruposExistentes } = idsGrupos.length
      ? await supabaseAdmin.from("groups").select("id, service_id").in("id", idsGrupos)
      : { data: [] as any[] };

    const gruposOk = new Set(
      (gruposExistentes || [])
        .filter((g: any) => g.id && g.service_id)
        .map((g: any) => g.id),
    );

    const orfas = pendentes.filter((t: any) => !gruposOk.has(t.group_id));
    if (orfas.length > 0) {
      await supabaseAdmin
        .from("payment_attempts")
        .update({ status: "reconciled_orphaned", updated_at: new Date().toISOString() })
        .in("id", orfas.map((t: any) => t.id));
      resumo.orfas_ignoradas = orfas.length;
      console.log(
        `[reconcile-payments] ${orfas.length} tentativa(s) orfa(s) (grupo inexistente ou sem service_id) — ignoradas`,
      );
    }

    const pendentesValidas = pendentes.filter((t: any) => gruposOk.has(t.group_id));
    resumo.examinadas = pendentesValidas.length;

    // ── 3) Pergunta ao gateway e confirma o que estiver aprovado ────────────
    for (const tentativa of pendentesValidas.slice(0, MAX_PER_RUN)) {
      const txId = tentativa.gateway_transaction_id;
      const registro: any = {
        transaction_id: txId,
        user_id: tentativa.user_id,
        group_id: tentativa.group_id,
        status_tentativa: tentativa.status,
      };

      let tx: any = null;
      try {
        tx = await lerTransacao(base, token, txId);
      } catch (e: any) {
        registro.erro_leitura = e?.message || String(e);
      }

      const status = String(tx?.status || "").toLowerCase().trim();
      registro.status_gateway = status || "desconhecido";

      if (statusRecusado(status)) {
        await supabaseAdmin
          .from("payment_attempts")
          .update({ status: `reconciled_${status}`, updated_at: new Date().toISOString() })
          .eq("id", tentativa.id);
        resumo.recusadas++;
        resumo.detalhes.push(registro);
        continue;
      }

      if (!statusAprovado(status)) {
        // Ainda pendente no gateway: nada a fazer agora.
        registro.observacao = "pendente no gateway";
        resumo.detalhes.push(registro);
        continue;
      }

      resumo.aprovadas_no_gateway++;

      // ── 4) Confirma (libera o grupo, cria a assinatura, manda os e-mails) ──
      //
      // A REFERÊNCIA do gateway é a fonte da verdade do "quem pagou o quê":
      // ela é montada na criação do pagamento (`grupo:usuario:tipo`). A linha
      // de `payment_attempts` é um espelho e pode estar divergente — se
      // divergir, a referência ganha (e a divergência fica no log).
      const referencia = tx?.reference_id || tentativa.external_reference || "";
      const partes = String(referencia).split(":");
      const grupoRef = partes[0];
      const userRef = partes[1];
      const tipo = tipoDaReferencia(referencia) || tentativa.payment_type || "subscription";

      const groupId = grupoRef || tentativa.group_id;
      const userId = userRef || tentativa.user_id;

      if (
        (grupoRef && tentativa.group_id && grupoRef !== tentativa.group_id) ||
        (userRef && tentativa.user_id && userRef !== tentativa.user_id)
      ) {
        console.warn(
          `[reconcile-payments] divergência entre a referência e a tentativa ` +
          `(tx=${txId}): ref=${grupoRef}:${userRef} tentativa=${tentativa.group_id}:${tentativa.user_id} ` +
          `— seguindo a referência do gateway`,
        );
      }

      const amountBruto = Number(tx?.amount ?? tentativa.amount ?? 0);
      const amount = amountBruto > 100 ? amountBruto / 100 : amountBruto;

      if (!groupId || !userId) {
        registro.erro = "não foi possível determinar grupo/usuário";
        resumo.falharam++;
        resumo.detalhes.push(registro);
        continue;
      }

      try {
        const resultado = await confirmPayment({
          gateway: "iopay",
          group_id: groupId,
          user_id: userId,
          payment_type: tipo as "entrance" | "subscription" | "combined",
          amount,
          status: "approved",
          gateway_payment_id: txId,
          payment_method: metodoPagamentoSeguro(
            tx?.payment_method || tentativa.payment_method || "pix",
          ),
        });

        if (resultado?.success) {
          resumo.confirmadas++;
          registro.confirmada = true;

          await supabaseAdmin.from("platform_events").insert({
            event_type: "payment",
            title: "Pagamento reconciliado",
            message:
              `${tentativa.user_id} tinha pago R$ ${amount.toFixed(2)} no grupo ${groupId} ` +
              `e o acesso ainda não tinha sido liberado. A reconciliação liberou.`,
            metadata: JSON.stringify({
              user_id: userId,
              group_id: groupId,
              amount,
              payment_type: tipo,
              gateway: "iopay",
              transaction_id: txId,
              reconciled: true,
            }),
            created_by: userId,
          });
        } else {
          registro.confirmada = false;
          registro.erro = resultado?.error || "confirmação sem detalhe";
          resumo.falharam++;
        }
      } catch (e: any) {
        registro.confirmada = false;
        registro.erro = e?.message || String(e);
        resumo.falharam++;
      }

      resumo.detalhes.push(registro);
    }

    console.log("[reconcile-payments]", JSON.stringify({ ...resumo, detalhes: undefined }));

    return new Response(
      JSON.stringify({ ok: true, ...resumo }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[reconcile-payments] erro:", error);
    return new Response(
      JSON.stringify({ error: error?.message || String(error), ...resumo }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
