// ============================================================================
// Confirmação de pagamentos Woovi — compartilhada entre o webhook e o polling.
//
// POR QUE UM MÓDULO SÓ
// -------------------
// O webhook (`woovi-webhook`) e o polling do navegador (`check-woovi-tx`)
// podem confirmar o MESMO pagamento: o webhook chega sozinho, mas se ele
// atrasar ou não estiver registrado na Woovi, o polling (que roda a cada 10s
// enquanto a aba do checkout está aberta) confirma no lugar.
//
// Se cada um tivesse sua própria cópia da regra, elas iam divergir — e a
// divergência apareceria como "cliente pagou e não entrou no grupo". Por isso
// os dois importam daqui.
//
// A confirmação em si (liberar grupo, e-mail, cupom, fatura) continua sendo
// a COMPARTILHADA `confirmPayment`, a mesma que o IoPay e o Mercado Pago
// usam. Aqui só mora o que é específico da Woovi: discovering o artefato
// (cobrança avulsa x mandate), achar a assinatura e escolher o id certo.
// ============================================================================

import { parseCorrelationId, fromCents } from "./woovi.ts";
import { confirmPayment } from "../confirm-payment/index.ts";

export type WooviSubRow = {
  id: string;
  user_id: string;
  group_id: string;
  status: string;
  amount: number;
  billing_cycle: string | null;
  custom_cycle_days: number | null;
  custom_cycle_months: number | null;
  retry_count: number | null;
  gateway: string | null;
  woovi_subscription_id: string | null;
  woovi_recurrence_status: string | null;
};

const SUB_COLUMNS =
  "id, user_id, group_id, status, amount, billing_cycle, custom_cycle_days, custom_cycle_months, retry_count, gateway, woovi_subscription_id, woovi_recurrence_status";

/**
 * Acha a assinatura Woovi pelo id do mandate e, na falta, pelo correlationID.
 *
 * O `correlationID` que colocamos na assinatura é
 * `{group_id}:{user_id}:{type}:rec` — ele volta em TODOS os eventos do
 * mandate e das suas parcelas, então é a rede de segurança quando o
 * `paymentSubscriptionGlobalID` não bate.
 */
export async function findWooviSubscription(
  supabaseAdmin: any,
  body: any,
): Promise<WooviSubRow | null> {
  const globalID = body?.paymentSubscriptionGlobalID || body?.globalID || null;

  if (globalID) {
    const { data } = await supabaseAdmin
      .from("user_subscriptions")
      .select(SUB_COLUMNS)
      .eq("woovi_subscription_id", globalID)
      .maybeSingle();
    if (data) return data as WooviSubRow;
  }

  const correlation = parseCorrelationId(body?.correlationID);
  if (correlation) {
    const { data } = await supabaseAdmin
      .from("user_subscriptions")
      .select(SUB_COLUMNS)
      .eq("user_id", correlation.userId)
      .eq("group_id", correlation.groupId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as WooviSubRow;
  }

  return null;
}

/**
 * Devolve `gateway_subscription_id` para o id do MANDATE.
 *
 * O `confirmPayment` sobrescreve `gateway_subscription_id` com o id do
 * pagamento que acabou de ser confirmado. Na Woovi, porém, o id que importa
 * é o do mandate — é ele que a Woovi continua usando nas renovações e é por
 * ele que os webhooks das parcelas encontram a assinatura.
 */
export async function restoreMandatePointer(
  supabaseAdmin: any,
  userId: string,
  groupId: string,
  fallbackId: string,
) {
  const { data } = await supabaseAdmin
    .from("user_subscriptions")
    .select("id, woovi_subscription_id")
    .eq("user_id", userId)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return;
  if (data.woovi_subscription_id && data.woovi_subscription_id !== fallbackId) {
    await supabaseAdmin
      .from("user_subscriptions")
      .update({ gateway_subscription_id: data.woovi_subscription_id })
      .eq("id", data.id);
  }
}

/**
 * Confirma uma COBRANÇA AVULSA paga (`OPENPIX:CHARGE_COMPLETED`).
 *
 * Cobre os três tipos: `invoice` (fatura, que não existe na confirmação
 * compartilhada), `entrance` (taxa de adesão) e `combined` (adesão + 1ª
 * mensalidade na mesma transação).
 */
export async function confirmWooviCharge(
  supabaseAdmin: any,
  body: any,
): Promise<{ ok: boolean; error?: string; userId?: string; groupId?: string; amount?: number }> {
  const charge = body?.charge || {};
  const correlation = parseCorrelationId(charge.correlationID);

  if (!correlation) {
    console.log(`[woovi] charge ${charge.identifier} sem correlationID nosso — ignorado`);
    return { ok: true };
  }

  // A tentativa de pagamento tem o valor EXATO cobrado (cupom aplicado) e o
  // tipo real do fluxo. O correlationID só dá o par grupo/usuário.
  const { data: attemptRows } = await supabaseAdmin
    .from("payment_attempts")
    .select("user_id, group_id, payment_type, amount, original_amount")
    .eq("gateway_transaction_id", charge.identifier)
    .order("created_at", { ascending: true })
    .limit(1);
  const attempt = (attemptRows && attemptRows[0]) || null;

  const userId = attempt?.user_id || correlation.userId;
  const groupId = attempt?.group_id || correlation.groupId;
  const paymentType = attempt?.payment_type || correlation.type;
  const amount = attempt?.amount != null ? Number(attempt.amount) : fromCents(charge.value || 0);

  console.log(
    `[woovi] CHARGE_COMPLETED id=${charge.identifier} type=${paymentType} user=${userId} group=${groupId} amount=${amount}`,
  );

  // ── FATURA: pagamento avulso, fora da confirmação compartilhada ─────────
  if (paymentType === "invoice") {
    const { data: invoices } = await supabaseAdmin
      .from("invoices")
      .select("id")
      .eq("gateway_transaction_id", charge.identifier)
      .eq("status", "pending")
      .limit(1);

    const invoice = (invoices && invoices[0]) || null;
    if (invoice) {
      await supabaseAdmin
        .from("invoices")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", invoice.id);
    }

    await supabaseAdmin.from("payments").insert({
      user_id: userId,
      amount,
      method: "pix",
      status: "paid",
      payment_type: "invoice",
      group_id: groupId,
      transaction_code: charge.identifier,
      gateway: "woovi",
      notes: "Fatura via PIX (Woovi)",
    });

    console.log(`[woovi] fatura ${invoice?.id || "?"} quitada`);
    return { ok: true, userId, groupId, amount };
  }

  // ── ADESÃO / ASSINATURA / COMBINADO: confirmação compartilhada ──────────
  const result = await confirmPayment({
    gateway: "woovi",
    group_id: groupId,
    user_id: userId,
    payment_type: paymentType as "entrance" | "subscription" | "combined",
    amount,
    status: "approved",
    gateway_payment_id: charge.identifier,
    payment_method: "pix",
  });

  if (!result?.success) {
    return { ok: false, error: result?.error || "confirmPayment falhou" };
  }

  await restoreMandatePointer(supabaseAdmin, userId, groupId, charge.identifier);
  return { ok: true, userId, groupId, amount };
}

/**
 * Confirma uma PARCELA do Pix Automático paga
 * (`PIX_AUTOMATIC_COBR_COMPLETED`).
 *
 * O `id` usado na confirmação é sempre o da PARCELA (`cobr.identifierId`),
 * exceto no PRIMEIRO pagamento do fluxo `subscription` (Jornada 3), em que a
 * parcela É o pagamento inicial e precisa usar o id do mandate — é com ele
 * que o `payment_attempts` foi gravado e que o cupom é localizado.
 *
 * Usar o id da parcela nas renovações é o que mantém a trava de
 * idempotência do `confirmPayment` funcionando: cada parcela tem um id
 * próprio, então a 2ª, 3ª, 4ª renovações não são confundidas com a 1ª.
 */
export async function confirmWooviInstallment(
  supabaseAdmin: any,
  body: any,
): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const sub = await findWooviSubscription(supabaseAdmin, body);
  if (!sub) {
    console.log("[woovi] COBR_COMPLETED sem assinatura correspondente");
    return { ok: true };
  }

  const installmentId = body?.cobr?.identifierId || null;
  const value = fromCents(body?.value || body?.cobr?.value || 0);
  const installmentNumber = Number(body?.installmentNumber || 0);

  // A assinatura que ainda NÃO está ativa está esperando o PRIMEIRO
  // pagamento.
  const isInitial = sub.status !== "active";
  const gatewayPaymentId = isInitial
    ? sub.woovi_subscription_id || body?.paymentSubscriptionGlobalID || installmentId
    : installmentId || body?.paymentSubscriptionGlobalID;

  console.log(
    `[woovi] COBR_COMPLETED sub=${sub.id} parcela=${installmentNumber} ` +
      `inicial=${isInitial} tx=${gatewayPaymentId} valor=${value}`,
  );

  if (!gatewayPaymentId) {
    return { ok: false, error: "Parcela concluída sem identificador para confirmação" };
  }

  const result = await confirmPayment({
    gateway: "woovi",
    group_id: sub.group_id,
    user_id: sub.user_id,
    payment_type: "subscription",
    amount: value || Number(sub.amount || 0),
    status: "approved",
    gateway_payment_id: gatewayPaymentId,
    payment_method: "pix",
    billing_cycle: sub.billing_cycle,
    custom_cycle_days: sub.custom_cycle_days,
    custom_cycle_months: sub.custom_cycle_months,
  });

  if (!result?.success) {
    return { ok: false, error: result?.error || "confirmPayment falhou" };
  }

  // Mantém o ponteiro para o mandate (o `confirmPayment` sobrescreveu com o
  // id da parcela).
  if (sub.woovi_subscription_id) {
    await supabaseAdmin
      .from("user_subscriptions")
      .update({ gateway_subscription_id: sub.woovi_subscription_id })
      .eq("id", sub.id);
  }

  await supabaseAdmin
    .from("user_subscriptions")
    .update({ woovi_recurrence_status: "APPROVED" })
    .eq("id", sub.id);

  return { ok: true, already: !!result.already_confirmed };
}
