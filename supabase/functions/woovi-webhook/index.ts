// ============================================================================
// Webhook da Woovi.
//
// A Woovi entrega este corpo direto (sem envelope):
//   { "event": "OPENPIX:CHARGE_COMPLETED", "charge": { ... } }
//   { "event": "PIX_AUTOMATIC_COBR_COMPLETED", "cobr": { ... }, ... }
//
// A documentação diz: "Any 2xx within the delivery timeout closes the delivery;
// anything else is retried." — então devolvemos 2xx rápido, e 500 só quando
// falhou algo que ainda vale a pena repetir.
//
// EVENTOS TRATADOS
// ----------------
//   OPENPIX:CHARGE_COMPLETED          → cobrança avulsa paga (adesão, fatura,
//                                        a parte "combined" da assinatura)
//   OPENPIX:CHARGE_EXPIRED            → cobrança avulsa expirou
//   PIX_AUTOMATIC_APPROVED            → pagador AUTORIZOU o mandato
//   PIX_AUTOMATIC_REJECTED            → pagador RECUSOU o mandato
//   PIX_AUTOMATIC_COBR_CREATED        → Woovi gerou a cobrança do ciclo
//   PIX_AUTOMATIC_COBR_COMPLETED      → pagamento da recorrência CONFIRMADO
//   PIX_AUTOMATIC_COBR_REJECTED       → recusado na 1ª tentativa
//   PIX_AUTOMATIC_COBR_TRY_REJECTED   → recusado na retentativa
//
// POR QUE A RECORRÊNCIA NÃO PASSA PELO CRON
// ------------------------------------------
// Com Pix Automático a Woovi COBRA SOZINHA no dia do vencimento. O cron
// `process-recurring-billing` pula as assinaturas `gateway = 'woovi'` (igual
// faz com o Mercado Pago) e este webhook é quem recebe a confirmação.
//
// A regra de confirmação mora em `_shared/woovi-confirm.ts` — compartilhada
// com o polling (`check-woovi-tx`), que pode confirmar o mesmo pagamento
// quando o webhook atrasa.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseCorrelationId } from "../_shared/woovi.ts";
import {
  confirmWooviCharge,
  confirmWooviInstallment,
  findWooviSubscription,
} from "../_shared/woovi-confirm.ts";
import { dispatchNotification } from "../_shared/send-notification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function handleChargeExpired(supabaseAdmin: any, body: any) {
  const charge = body?.charge || {};
  const correlation = parseCorrelationId(charge.correlationID);
  if (!correlation) return;

  console.log(`[woovi-webhook] CHARGE_EXPIRED id=${charge.identifier}`);

  await supabaseAdmin
    .from("payment_attempts")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("gateway_transaction_id", charge.identifier)
    .in("status", ["created", "pending"]);

  // A assinatura que dependia dessa cobrança não pode ficar "pending" para
  // sempre: sem pagamento, sem vaga.
  await supabaseAdmin
    .from("group_members")
    .update({ payment_status: "expired" })
    .eq("group_id", correlation.groupId)
    .eq("user_id", correlation.userId);
}

async function handleMandateApproved(supabaseAdmin: any, body: any) {
  const sub = await findWooviSubscription(supabaseAdmin, body);
  if (!sub) {
    console.log("[woovi-webhook] PIX_AUTOMATIC_APPROVED sem assinatura correspondente");
    return;
  }

  console.log(`[woovi-webhook] PIX_AUTOMATIC_APPROVED sub=${sub.id}`);

  await supabaseAdmin
    .from("user_subscriptions")
    .update({ woovi_recurrence_status: "APPROVED" })
    .eq("id", sub.id);
}

async function handleMandateRejected(supabaseAdmin: any, body: any) {
  const sub = await findWooviSubscription(supabaseAdmin, body);
  if (!sub) {
    console.log("[woovi-webhook] PIX_AUTOMATIC_REJECTED sem assinatura correspondente");
    return;
  }

  console.log(`[woovi-webhook] PIX_AUTOMATIC_REJECTED sub=${sub.id}`);

  await supabaseAdmin
    .from("user_subscriptions")
    .update({ woovi_recurrence_status: "REJECTED", billing_status: "cancelled" })
    .eq("id", sub.id);

  await notifyUser(
    supabaseAdmin,
    sub,
    "Autorização de cobrança automática recusada",
    "O Pagamento Automático não foi autorizado. A sua assinatura continua válida, mas as próximas renovações precisarão de pagamento manual.",
    "subscription_renewal_failed",
  );
}

async function handleCobrCreated(supabaseAdmin: any, body: any) {
  const sub = await findWooviSubscription(supabaseAdmin, body);
  if (!sub) return;

  const value = Number((body?.value || body?.cobr?.value || 0) / 100);
  const chargeDate = body?.dateGenerateCharge || new Date().toISOString();

  console.log(`[woovi-webhook] PIX_AUTOMATIC_COBR_CREATED sub=${sub.id} valor=${value}`);

  // A fila de cobrança do ciclo: é o que o painel do admin usa para mostrar
  // "quem está vencendo".
  const { data: pending } = await supabaseAdmin
    .from("billing_cycles")
    .select("id")
    .eq("subscription_id", sub.id)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (pending && pending.length > 0) {
    await supabaseAdmin
      .from("billing_cycles")
      .update({
        status: "processing",
        gateway: "woovi",
        gateway_transaction_id: body?.cobr?.identifierId || null,
        charge_date: String(chargeDate).split("T")[0],
        updated_at: new Date().toISOString(),
      })
      .eq("id", pending[0].id);
  }
}

async function handleCobrRejected(supabaseAdmin: any, body: any) {
  const sub = await findWooviSubscription(supabaseAdmin, body);
  if (!sub) return;

  const rejectCode = body?.cobr?.rejectCode || body?.rejectCode || null;
  const installmentId = body?.cobr?.identifierId || null;

  console.log(
    `[woovi-webhook] PIX_AUTOMATIC_COBR_REJECTED sub=${sub.id} codigo=${rejectCode}`,
  );

  // Marca o ciclo como falhado (é o que o painel do admin mostra).
  const { data: pending } = await supabaseAdmin
    .from("billing_cycles")
    .select("id")
    .eq("subscription_id", sub.id)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (pending && pending.length > 0) {
    await supabaseAdmin
      .from("billing_cycles")
      .update({
        status: "failed",
        gateway: "woovi",
        gateway_transaction_id: installmentId,
        error_code: rejectCode,
        error_message: "Pagamento Automático recusado pelo banco do pagador",
        updated_at: new Date().toISOString(),
      })
      .eq("id", pending[0].id);
  }

  // A Woovi tem política de retentativa própria (THREE_RETRIES_7_DAYS), então
  // aqui só registramos a tentativa — NÃO cancelamos a assinatura.
  const retryCount = Number(sub.retry_count || 0) + 1;
  await supabaseAdmin
    .from("user_subscriptions")
    .update({ retry_count: retryCount, billing_status: "retrying" })
    .eq("id", sub.id);

  await notifyUser(
    supabaseAdmin,
    sub,
    "Pagamento automático não aprovado",
    "A cobrança automática do seu ciclo não foi aprovada pelo seu banco. Verifique o Pix Automático no aplicativo do banco ou pague a mensalidade manualmente.",
    "subscription_renewal_failed",
  );
}

async function notifyUser(
  supabaseAdmin: any,
  sub: { user_id: string; group_id: string },
  title: string,
  message: string,
  eventType: string,
) {
  try {
    const { data: group } = await supabaseAdmin
      .from("groups")
      .select("name, owner_id")
      .eq("id", sub.group_id)
      .maybeSingle();

    const recipients = [sub.user_id, group?.owner_id]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);

    await dispatchNotification(supabaseAdmin, {
      title,
      message,
      event_type: eventType,
      metadata: { user_id: sub.user_id, group_id: sub.group_id, gateway: "woovi" },
      audience: { type: "users", user_ids: recipients },
      channels: ["in_app", "push"],
      url: `/dashboard/groups/${sub.group_id}`,
    }).catch((e) => console.error("[woovi-webhook] notificação falhou:", e));
  } catch (e) {
    console.error("[woovi-webhook] notifyUser erro:", e);
  }
}

// ============================================================================
// ENTRADA
// ============================================================================

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "corpo do webhook não é JSON válido" }, 400);
    }

    const event = String(body?.event || "");
    console.log(`[woovi-webhook] evento recebido: ${event}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    try {
      switch (event) {
        case "OPENPIX:CHARGE_COMPLETED": {
          const res = await confirmWooviCharge(supabaseAdmin, body);
          if (!res.ok) throw new Error(res.error || "falha ao confirmar cobrança");
          break;
        }

        case "OPENPIX:CHARGE_EXPIRED":
          await handleChargeExpired(supabaseAdmin, body);
          break;

        case "PIX_AUTOMATIC_APPROVED":
          await handleMandateApproved(supabaseAdmin, body);
          break;

        case "PIX_AUTOMATIC_REJECTED":
          await handleMandateRejected(supabaseAdmin, body);
          break;

        case "PIX_AUTOMATIC_COBR_CREATED":
          await handleCobrCreated(supabaseAdmin, body);
          break;

        case "PIX_AUTOMATIC_COBR_COMPLETED": {
          const res = await confirmWooviInstallment(supabaseAdmin, body);
          if (!res.ok) throw new Error(res.error || "falha ao confirmar parcela");
          break;
        }

        case "PIX_AUTOMATIC_COBR_REJECTED":
        case "PIX_AUTOMATIC_COBR_TRY_REJECTED":
          await handleCobrRejected(supabaseAdmin, body);
          break;

        default:
          // Evento que não tratamos (ex.: OPENPIX:CHARGE_CREATED, TED, disputes).
          // Respondemos 2xx para a Woovi não ficar reenviando.
          console.log(`[woovi-webhook] evento não tratado: ${event}`);
          break;
      }

      return json({ ok: true });
    } catch (e: any) {
      console.error(`[woovi-webhook] erro processando ${event}:`, e);
      // 500 → a Woovi reenvia. Vale a pena para evento de pagamento: perder
      // a confirmação significa "cliente pagou e não entrou no grupo".
      return json({ ok: false, error: e?.message || "erro interno" }, 500);
    }
  },
};
