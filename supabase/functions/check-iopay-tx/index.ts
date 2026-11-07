import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewaySettings } from "../create-payment/handlers/settings.ts";
import { notifyAdminPayment } from "../_shared/admin-payment-email.ts";
// A confirmação compartilhada é a ÚNICA implementação de "o que fazer quando o
// gateway aprova". O polling delegou para ela (ver `confirmIOPayment`).
import { confirmPayment } from "../confirm-payment/index.ts";
// A IO Pay devolve `payment_method` como OBJETO (o cartão inteiro ou o BR
// Code). Gravar esse objeto cru em `payment_attempts.payment_method` cria
// linhas de 480–540 caracteres; o job de reconciliacao lia essa linha e
// repassava o valor para `user_subscriptions.payment_method` (VARCHAR(50)),
// que estourava — a liberacao do grupo falhava depois do dinheiro cair.
// Aqui o metodo e sempre normalizado antes de gravar.
import { normalizarMetodoPagamento } from "../_shared/metodo-pagamento.ts";

/** Obtém official_price e paid_amount (após cupom) para rastrear economia de assinatura. */
async function getSavingsData(
  supabaseAdmin: any,
  group_id: string,
  gateway_payment_id: string,
  defaultAmount: number,
): Promise<{ official_price: number | null; paid_amount: number }> {
  try {
    // Buscar preço oficial via service do grupo
    const { data: group } = await supabaseAdmin
      .from("groups")
      .select("service_id")
      .eq("id", group_id)
      .maybeSingle();

    let officialPrice: number | null = null;
    if (group?.service_id) {
      const { data: service } = await supabaseAdmin
        .from("streaming_services")
        .select("official_price")
        .eq("id", group.service_id)
        .maybeSingle();
      officialPrice = service?.official_price ? Number(service.official_price) : null;
    }

    // Buscar valor pago (pode ser menor se cupom foi usado).
    //
    // `payment_attempts` nao tem a coluna `final_amount`: asking por ela fazia
    // o select falhar e o valor pago cair no default. E `.maybeSingle()`
    // abortava quando ja existiam varias linhas para o mesmo transaction_id
    // (o proprio polling criava uma linha a cada round).
    let paidAmount = defaultAmount;
    try {
      const { data: attemptRows } = await supabaseAdmin
        .from("payment_attempts")
        .select("coupon_id, original_amount, discount_amount")
        .eq("gateway_transaction_id", gateway_payment_id)
        .order("created_at", { ascending: true })
        .limit(1);

      const attempt = (attemptRows && attemptRows[0]) || null;
      if (attempt?.original_amount != null && attempt?.discount_amount != null) {
        paidAmount = Number(attempt.original_amount) - Number(attempt.discount_amount);
      }
    } catch (_) {
      // payment_attempts pode não existir — usar amount padrão
    }

    return { official_price: officialPrice, paid_amount: paidAmount };
  } catch (e) {
    console.warn("[getSavingsData] erro:", e);
    return { official_price: null, paid_amount: defaultAmount };
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IOPAY_PROD = "https://api.iopay.com.br/api/";
const IOPAY_SANDBOX = "https://sandbox.api.iopay.com.br/api/";

async function getToken(settings: Record<string, string>): Promise<string> {
  const baseUrl = settings.iopay_env === "sandbox" ? IOPAY_SANDBOX : IOPAY_PROD;
  const email = settings.iopay_email || "";
  const secret = settings.iopay_secret || "";
  const sellerId = settings.iopay_seller_id || "";
  const url = `${baseUrl}auth/login?email=${encodeURIComponent(email)}&secret=${encodeURIComponent(secret)}&io_seller_id=${encodeURIComponent(sellerId)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, secret, io_seller_id: sellerId }),
  });
  const data = await resp.json();
  console.log(`[check-iopay-tx] AUTH [${resp.status}]:`, JSON.stringify(data).substring(0, 300));
  if (!resp.ok || !data.access_token) throw new Error("Auth failed: " + JSON.stringify(data));
  return data.access_token;
}

function isApproved(status: string): boolean {
  const s = (status || "").toLowerCase();
  if (["succeeded", "approved", "paid", "authorized", "captured", "completed", "done", "success", "settled", "confirmed"].includes(s)) return true;
  if (["failed", "cancelled", "canceled", "rejected", "refunded", "error", "denied", "expired", "chargeback", "voided", "refused"].includes(s)) return false;
  return false;
}

function calculateNextChargeDate(cycle: string, customDays?: number | null, customMonths?: number | null): Date {
  const d = new Date();
  if (cycle === "days" && customDays) {
    d.setDate(d.getDate() + customDays);
  } else if (cycle === "quarterly") {
    d.setMonth(d.getMonth() + 3);
  } else if (cycle === "semiannual") {
    d.setMonth(d.getMonth() + 6);
  } else if (cycle === "annual") {
    d.setFullYear(d.getFullYear() + 1);
  } else if (cycle === "custom") {
    d.setMonth(d.getMonth() + (customMonths || 1));
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}

/**
 * Confirmação do pagamento — DELEGA para a confirmação compartilhada.
 *
 * POR QUE MUDOU
 * -------------
 * Esta função era uma CÓPIA de ~450 linhas da confirmação que o webhook usa
 * (`confirm-payment/index.ts`). Duas cópias da mesma regra é a receita do
 * "paguei e não entrei no grupo": o polling confirmava de um jeito (sem
 * e-mail para o cliente, sem `billing_cycles`, sem faturas vencidas
 * quitadas) e o webhook de outro (com tudo).
 *
 * No caso real de 01/11/2026 a Fran pagou R$ 59,40 no grupo "Netflix C/
 * Anúncio" (PIX), o gateway aprovou, e a pessoa ficou fora do grupo sem
 * nenhum e-mail da DividePass — o polling e o webhook nunca chegaram a uma
 * versão única do "o que fazer quando o pagamento foi aprovado".
 *
 * Agora existe UM lugar só que decide isso: `confirmPayment`. O polling, o
 * webhook do gateway, a confirmação manual do admin e o job de reconciliação
 * passam todos por ele — mesmo comportamento, mesmos e-mails, mesmos eventos.
 *
 * A ÚNICA parte que continua aqui é a FATURA, que não existe na confirmação
 * compartilhada (é um pagamento avulso, não uma assinatura).
 */
async function confirmIOPayment(
  supabaseAdmin: any,
  group_id: string,
  user_id: string,
  payment_type: "entrance" | "subscription" | "combined" | "invoice",
  amount: number,
  gateway_payment_id: string,
  billingCycleHint?: string | null,
  customCycleDays?: string | null,
  customCycleMonths?: string | null,
  paymentMethod?: string | null,
  cardLast4?: string | null,
  cardBrand?: string | null,
  cardId?: string | null,
  invoiceId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  // ── FATURA ────────────────────────────────────────────────────────────────
  if (payment_type === "invoice") {
    try {
      if (invoiceId) {
        await supabaseAdmin.from("invoices").update({
          status: "paid",
          paid_at: new Date().toISOString(),
          gateway_transaction_id: gateway_payment_id,
        }).eq("id", invoiceId);
      } else {
        const { data: invToUpdate } = await supabaseAdmin
          .from("invoices")
          .select("id")
          .eq("user_id", user_id)
          .eq("group_id", group_id)
          .eq("status", "pending")
          .order("due_date", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (invToUpdate) {
          await supabaseAdmin.from("invoices").update({
            status: "paid",
            paid_at: new Date().toISOString(),
            gateway_transaction_id: gateway_payment_id,
          }).eq("id", invToUpdate.id);
        }
      }

      supabaseAdmin.from("payments").insert({
        user_id,
        amount,
        method: paymentMethod || "pix",
        status: "paid",
        payment_type: "invoice",
        group_id,
        transaction_code: gateway_payment_id,
        gateway: "iopay",
        notes: "Fatura via PIX",
      }).then(({ error }: any) => {
        if (error) console.error("[confirmIOPayment] payments error:", error);
      });

      console.log(`[confirmIOPayment] DONE invoice`);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: "invoice update error: " + e.message };
    }
  }

  // ── ADESÃO / ASSINATURA ───────────────────────────────────────────────────
  //
  // `confirmPayment` já faz: assinatura ativa, fatura vencida quitada,
  // vínculo no grupo, linha em `payments`, `billing_cycles`, eventos no
  // painel, e os DOIS e-mails do cliente ("recebemos seu pagamento" e "você
  // entrou no grupo").
  const result = await confirmPayment({
    gateway: "iopay",
    group_id,
    user_id,
    payment_type,
    amount,
    status: "approved",
    gateway_payment_id,
    payment_method: paymentMethod || "pix",
    billing_cycle: billingCycleHint || null,
    custom_cycle_days: customCycleDays || null,
    custom_cycle_months: customCycleMonths || null,
  });

  if (!result?.success) {
    console.error(
      `[confirmIOPayment] confirmPayment falhou (${payment_type}): ${result?.error}`,
    );
  }

  return { success: !!result?.success, error: result?.error };
}

// ── Helper: registrar uso de cupom APÓS confirmação de pagamento ──────────────
async function registerCouponUsage(
  supabaseAdmin: any,
  gateway_payment_id: string,
  user_id: string,
  payment_type: string,
): Promise<void> {
  try {
    // Buscar coupon_id salvo em payment_attempts no momento da criação da transação
    //
    // `final_amount` nao existe em `payment_attempts` (o select falhava e o
    // cupom nunca era registrado) e `.maybeSingle()` abortava quando havia
    // mais de uma tentativa com o mesmo transaction_id.
    const { data: attemptRows } = await supabaseAdmin
      .from("payment_attempts")
      .select("coupon_id, discount_amount, original_amount")
      .eq("gateway_transaction_id", gateway_payment_id)
      .order("created_at", { ascending: true })
      .limit(1);

    const attempt = (attemptRows && attemptRows[0]) || null;

    if (!attempt?.coupon_id) return;

    const { data: existingUseRows } = await supabaseAdmin
      .from("coupon_uses")
      .select("id")
      .eq("coupon_id", attempt.coupon_id)
      .eq("user_id", user_id)
      .limit(1);

    const existingUse = (existingUseRows && existingUseRows[0]) || null;

    if (existingUse) {
      console.log(`[registerCouponUsage] coupon_id=${attempt.coupon_id} já registrado para user=${user_id}`);
      return;
    }

    await supabaseAdmin.from("coupon_uses").insert({
      coupon_id: attempt.coupon_id,
      user_id,
      payment_type,
      original_amount: Number(attempt.original_amount || 0),
      discount_amount: Number(attempt.discount_amount || 0),
      final_amount: Number(attempt.final_amount || 0),
      group_id: null,
    });

    const { data: current } = await supabaseAdmin
      .from("coupons")
      .select("used_count")
      .eq("id", attempt.coupon_id)
      .single();

    if (current != null) {
      await supabaseAdmin
        .from("coupons")
        .update({ used_count: (current.used_count || 0) + 1 })
        .eq("id", attempt.coupon_id);
    }

    // Atualizar campaign_rewards se cupom for de campanha
    const { data: coupon } = await supabaseAdmin
      .from("coupons")
      .select("description")
      .eq("id", attempt.coupon_id)
      .maybeSingle();

    if (coupon?.description?.startsWith("campaign:")) {
      const campaignCode = coupon.description.replace("campaign:", "").trim();
      await supabaseAdmin
        .from("campaign_rewards")
        .update({ status: "used" })
        .eq("campaign", campaignCode)
        .eq("user_id", user_id)
        .eq("status", "available");
    }

    console.log(`[registerCouponUsage] cupom=${attempt.coupon_id} usado por user=${user_id} no ${payment_type}`);
  } catch (e) {
    console.error("[registerCouponUsage] erro:", e);
  }
}

async function resolvePaymentType(
  supabaseAdmin: any,
  bodyPaymentType: string | undefined,
  group_id: string,
  user_id: string,
  memberPaymentStatus: string | undefined,
): Promise<"entrance" | "subscription" | "combined" | "invoice"> {
  if (bodyPaymentType === "entrance" || bodyPaymentType === "subscription" || bodyPaymentType === "combined" || bodyPaymentType === "invoice") {
    return bodyPaymentType;
  }
  if (memberPaymentStatus === "entrance_paid" || memberPaymentStatus === "first_attempt" || memberPaymentStatus === "awaiting_subscription") {
    return "subscription";
  }
  const { data: sub } = await supabaseAdmin
    .from("user_subscriptions").select("id")
    .eq("group_id", group_id).eq("user_id", user_id).maybeSingle();
  if (sub) return "subscription";
  return "entrance";
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      console.log(`[check-iopay-tx] STEP 1: Loading gateway settings...`);
      const settings = await getGatewaySettings();
      console.log(`[check-iopay-tx] STEP 1 OK: iopay_env=${settings.iopay_env} has_email=${!!settings.iopay_email} has_secret=${!!settings.iopay_secret} has_seller=${!!settings.iopay_seller_id}`);

      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      console.log(`[check-iopay-tx] STEP 1b: SUPABASE_URL=${supabaseUrl ? "set" : "EMPTY"} SERVICE_ROLE_KEY=${supabaseServiceKey ? "set" : "EMPTY"}`);

      // ---------------------------------------------------------------------
      // AUTENTICACAO (S12) — PRIMEIRO, antes de qualquer validacao de payload
      // ---------------------------------------------------------------------
      // Esta function consulta o status de uma transacao no gateway IO Pay e
      // pode voidar transacoes (action=cancel). Sem JWT, qualquer um com um
      // transaction_id ou reference_code via a situacao financeira de outra
      // pessoa. O cancelamento continua exigindo, alem disso, que o chamador
      // seja o dono do pagamento (checado mais abaixo).
      // ---------------------------------------------------------------------
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
      const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

      if (!jwt) {
        return new Response(JSON.stringify({ error: "Não autenticado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const authClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user: caller } } = await authClient.auth.getUser(jwt);
      if (!caller) {
        return new Response(JSON.stringify({ error: "Token inválido" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const { transaction_id, action, group_id, user_id, payment_type: bodyPaymentType, billing_cycle: bodyBillingCycle, custom_cycle_days: bodyCustomDays, custom_cycle_months: bodyCustomMonths } = body;
      console.log(`[check-iopay-tx] STEP 2: REQUEST tx=${transaction_id} action=${action} group=${group_id} user=${user_id} type=${bodyPaymentType} cycle=${bodyBillingCycle}`);

      if (!transaction_id) {
        console.error(`[check-iopay-tx] STEP 2 FAIL: no transaction_id`);
        return new Response(JSON.stringify({ error: "transaction_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const baseUrl = settings.iopay_env === "sandbox" ? IOPAY_SANDBOX : IOPAY_PROD;
      console.log(`[check-iopay-tx] STEP 3: Getting IOPay token from ${baseUrl}...`);

      let token: string;
      try {
        token = await getToken(settings);
        console.log(`[check-iopay-tx] STEP 3 OK: token length=${token.length}`);
      } catch (authErr: any) {
        console.error(`[check-iopay-tx] STEP 3 FAIL: Auth error:`, authErr.message);
        return Response.json({
          transaction_id, status: "auth_error", confirmed: false,
          error: "IOPay auth failed: " + authErr.message,
          amount: 0, payment_method: "unknown",
        }, { headers: corsHeaders });
      }

      if (action === "cancel") {
        // -----------------------------------------------------------------
        // AUTENTICACAO DO CANCELAMENTO (S12 / B12)
        // -----------------------------------------------------------------
        // O cancelamento faz VOID de uma transacao no gateway IO Pay e marca
        // o pagamento do par grupo/usuario como expirado. Sem esta checagem,
        // qualquer pessoa com um transaction_id podia estornar a transacao de
        // outra pessoa.
        // O token ja foi validado no topo da function (caller). Aqui so
        // conferimos que quem pede o cancelamento e o dono do pagamento.
        // -----------------------------------------------------------------
        const cancelAdmin = authClient;
        const cancelCaller = caller;

        // O cancelamento so pode ser pedido por quem e o dono do pagamento.
        if (user_id && user_id !== cancelCaller.id) {
          return new Response(JSON.stringify({ error: "Sem permissão para cancelar este pagamento" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await fetch(`${baseUrl}v1/transaction/void/${transaction_id}`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (group_id && user_id) {
          await cancelAdmin.from("group_members").update({ payment_status: "expired" }).eq("group_id", group_id).eq("user_id", user_id);
        }
        return Response.json({ cancelled: true }, { headers: corsHeaders });
      }

      // Fetch IOPay transaction status
      const txUrl = `${baseUrl}v1/transaction/get/${transaction_id}`;
      console.log(`[check-iopay-tx] STEP 4: GET ${txUrl}`);
      const txResp = await fetch(txUrl, {
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      });
      console.log(`[check-iopay-tx] STEP 4: HTTP status=${txResp.status}`);
      const txRaw = await txResp.json();
      console.log(`[check-iopay-tx] STEP 4 RAW:`, JSON.stringify(txRaw).substring(0, 1200));

      // Parse IOPay response - handle ALL possible formats
      let status = "unknown";
      let pollAmount = 0;
      let payment_method = "unknown";
      let pix_copy_paste = null;
      let pix_qrcode_url = null;
      let iopayCustomerId: string | null = null;
      let iopayReferenceId: string | null = null;
      let iopayCardId: string | null = null;
      let iopayCardLast4: string | null = null;
      let iopayCardBrand: string | null = null;

      if (txRaw) {
        // Try all known response structures
        const src = txRaw.success && typeof txRaw.success === "object" ? txRaw.success
          : txRaw.data && typeof txRaw.data === "object" ? txRaw.data
          : txRaw.result && typeof txRaw.result === "object" ? txRaw.result
          : txRaw.transaction && typeof txRaw.transaction === "object" ? txRaw.transaction
          : txRaw;

        status = src?.status || txRaw.status || txRaw.success?.status || txRaw.data?.status || "unknown";
        if (typeof status === "number") status = String(status);
        status = String(status).toLowerCase().trim();

        // Amount: IOPay returns as STRING in reais (e.g., "1.00" = R$1.00)
        const rawAmount = src?.amount ?? txRaw.amount ?? txRaw.success?.amount ?? txRaw.data?.amount ?? 0;
        let numAmount: number;
        if (typeof rawAmount === "string") {
          numAmount = parseFloat(rawAmount) || 0;
        } else if (typeof rawAmount === "number") {
          numAmount = rawAmount;
        } else {
          numAmount = 0;
        }
        pollAmount = numAmount > 100 ? numAmount / 100 : numAmount;

        // IDs for verification
        iopayCustomerId = src?.customer || txRaw.customer || txRaw.success?.customer || null;
        iopayReferenceId = src?.reference_id || txRaw.reference_id || txRaw.success?.reference_id || null;

        // A IO Pay devolve `payment_method` como OBJETO (cartao inteiro / BR
        // Code). Normaliza para o metodo curto: o que for gravado aqui no
        // `payment_attempts` e depois lido pelo job de reconciliacao.
        payment_method = normalizarMetodoPagamento(
          src?.payment_method || txRaw.payment_method || txRaw.success?.payment_method || "card",
        );
        pix_copy_paste = src?.pix_copy_paste || src?.copy_paste || src?.pix_payload || src?.pix_code || txRaw.pix_copy_paste || null;
        pix_qrcode_url = src?.pix_qrcode_url || txRaw.pix_qrcode_url || null;

        // Card info from IOPay response
        const cardInfo = src?.card || txRaw.card || txRaw.success?.card || null;
        if (cardInfo) {
          iopayCardId = cardInfo.id_card || cardInfo.id || null;
          iopayCardLast4 = cardInfo.last4_digits || cardInfo.last4 || cardInfo.number_last4 || null;
          iopayCardBrand = cardInfo.card_brand || cardInfo.brand || cardInfo.brand_name || null;
        }
      }

      console.log(`[check-iopay-tx] PARSED status=${status} amount=${pollAmount} method=${payment_method} customer=${iopayCustomerId} ref=${iopayReferenceId} card=${iopayCardId}/${iopayCardLast4}/${iopayCardBrand}`);

      // ── STEP 5: Verify by IDs (customer + reference), NOT by amount ──
      if (!group_id || !user_id) {
        return Response.json({
          transaction_id, status, confirmed: false,
          amount: pollAmount, payment_method,
          pix_copy_paste, pix_qrcode_url,
        }, { headers: corsHeaders });
      }

      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      // Fetch user's stored IOPay customer ID
      const { data: userData } = await supabaseAdmin
        .from("users").select("customer_id_iopay").eq("id", user_id).maybeSingle();
      const storedCustomerId = userData?.customer_id_iopay || null;

      // Verify customer ID matches
      if (iopayCustomerId && storedCustomerId && iopayCustomerId !== storedCustomerId) {
        console.error(`[check-iopay-tx] CUSTOMER MISMATCH: iopay=${iopayCustomerId} stored=${storedCustomerId}`);
        return Response.json({
          transaction_id, status, confirmed: false,
          error: "Customer ID mismatch",
          amount: pollAmount, payment_method,
        }, { headers: corsHeaders });
      }
      console.log(`[check-iopay-tx] STEP 5a: customer_id OK (iopay=${iopayCustomerId} stored=${storedCustomerId})`);

      // Verify reference_id matches expected format: {group_id}:{user_id}:{payment_type} or invoice:{invoice_id}
      const expectedRefPrefix = `${group_id}:${user_id}`;
      const isInvoiceRef = iopayReferenceId?.startsWith("invoice:");
      if (iopayReferenceId && !iopayReferenceId.startsWith(expectedRefPrefix) && !isInvoiceRef) {
        console.error(`[check-iopay-tx] REFERENCE MISMATCH: ref=${iopayReferenceId} expected_prefix=${expectedRefPrefix}`);
        return Response.json({
          transaction_id, status, confirmed: false,
          error: "Reference ID mismatch",
          amount: pollAmount, payment_method,
        }, { headers: corsHeaders });
      }
      console.log(`[check-iopay-tx] STEP 5b: reference_id OK (ref=${iopayReferenceId})`);

      // Log to payment_attempts
      //
      // ATUALIZA a tentativa existente em vez de inserir uma linha nova a cada
      // polling. A duplicidade era a causa raiz do webhook quebrado: o
      // `iopay-webhook` lia `payment_attempts` por `gateway_transaction_id`
      // com `.maybeSingle()`, que falha com 2+ linhas — o webhook respondia
      // 200 SEM confirmar nada, e so o "Verificar no Gateway" manual
      // resolvia. Nao reproduzir essas duplicatas.
      //
      // Alvo: a linha MAIS ANTIGA (a de criacao), que e a que carrega
      // `external_reference` e `coupon_id`. Se o polling mexesse na mais
      // nova, o cupom nunca seria encontrado.
      if (pollAmount > 0) {
        try {
          const { data: existingAttempts } = await supabaseAdmin
            .from("payment_attempts")
            .select("id")
            .eq("gateway_transaction_id", transaction_id)
            .order("created_at", { ascending: true })
            .limit(1);

          const existingAttempt = (existingAttempts && existingAttempts[0]) || null;

          if (existingAttempt) {
            await supabaseAdmin
              .from("payment_attempts")
              .update({
                status: `polled_${status}`,
                gateway_response: { status, raw_status: txRaw.status },
              })
              .eq("id", existingAttempt.id);
          } else {
            await supabaseAdmin.from("payment_attempts").insert({
              user_id, group_id, gateway: "iopay", payment_method,
              payment_type: bodyPaymentType || "unknown",
              amount: pollAmount, status: `polled_${status}`,
              gateway_transaction_id: transaction_id,
              gateway_response: { status, raw_status: txRaw.status },
            });
          }
        } catch (e) { console.error("[check-iopay-tx] payment_attempts error:", e); }
      }

      // Check DB directly: is it already confirmed?
      const { data: sub } = await supabaseAdmin
        .from("user_subscriptions")
        .select("id, status, billing_cycle, custom_cycle_days, custom_cycle_months, amount, next_charge_at, expires_at")
        .eq("group_id", group_id)
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: member } = await supabaseAdmin
        .from("group_members")
        .select("payment_status")
        .eq("group_id", group_id)
        .eq("user_id", user_id)
        .maybeSingle();

      const paymentType = await resolvePaymentType(supabaseAdmin, bodyPaymentType, group_id, user_id, member?.payment_status);
      console.log(`[check-iopay-tx] STEP 6: resolved_type=${paymentType} sub_status=${sub?.status} member_payment=${member?.payment_status}`);

      // ── O PAGAMENTO JÁ FOI APLICADO? ────────────────────────────────────
      //
      // A pergunta certa é "ESSA transação já foi registrada em `payments`",
      // e NÃO "o vínculo do membro parece ativo".
      //
      // O checkout cria o vínculo em `group_members` com
      // `payment_status = 'active'` ANTES do pagamento (é assim que o grupo
      // reserva a vaga). Então olhar só o vínculo dava "já confirmado" para
      // um pagamento que NUNCA foi aplicado.
      //
      // Não é teoria: em 01/11/2026 a Fran pagou R$ 59,40 no grupo "Netflix
      // C/ Anúncio", o gateway aprovou e o polling respondeu
      // `confirmed: true` sem liberar nada — o front mostrou a tela de
      // "pagamento aprovado" e a pessoa ficou fora do grupo, sem e-mail.
      //
      // E o efeito era o pior dos dois: o polling parava de tentar. Agora,
      // quando a confirmação falha, o próximo round do polling TENTA DE
      // NOVO (a cada 10s, por 10 minutos).
      let paymentAlreadyApplied = false;
      try {
        const { data: paidRows } = await supabaseAdmin
          .from("payments")
          .select("id, payment_type")
          .eq("transaction_code", transaction_id)
          .eq("status", "paid")
          .limit(5);

        const paidTypes = (paidRows || []).map((p: any) => p.payment_type);
        paymentAlreadyApplied =
          paymentType === "combined"
            ? paidTypes.includes("entrance") && paidTypes.includes("subscription")
            : paidTypes.includes(paymentType);

        console.log(
          `[check-iopay-tx] PAGAMENTO JÁ APLICADO? tx=${transaction_id} ` +
          `tipos_pagos=[${paidTypes.join(",")}] tipo=${paymentType} -> ${paymentAlreadyApplied}`,
        );
      } catch (paymentsErr: any) {
        console.error("[check-iopay-tx] falha ao ler payments:", paymentsErr);
      }

      if (paymentAlreadyApplied) {
        return Response.json({
          transaction_id, status, confirmed: true,
          amount: pollAmount, payment_method,
          pix_copy_paste, pix_qrcode_url,
        }, { headers: corsHeaders });
      }

      // Check if invoice is already paid
      if (isInvoiceRef) {
        const invoiceIdFromRef = iopayReferenceId?.replace("invoice:", "");
        const { data: inv } = await supabaseAdmin.from("invoices").select("status").eq("id", invoiceIdFromRef).maybeSingle();
        if (inv?.status === "paid") {
          console.log(`[check-iopay-tx] INVOICE ALREADY PAID: ${invoiceIdFromRef}`);
          return Response.json({
            transaction_id, status, confirmed: true,
            amount: pollAmount, payment_method,
            pix_copy_paste, pix_qrcode_url,
          }, { headers: corsHeaders });
        }
      }

      // Use amount from DB if IOPay didn't return it
      if (pollAmount <= 0 && sub?.amount) {
        pollAmount = sub.amount;
      }
      if (pollAmount <= 0) {
        const { data: grpFallback } = await supabaseAdmin
          .from("groups").select("price_per_slot, entrance_fee").eq("id", group_id).maybeSingle();
        pollAmount = paymentType === "entrance"
          ? Number(grpFallback?.entrance_fee || 0)
          : Number(grpFallback?.price_per_slot || 0);
      }
      if (pollAmount <= 0) {
        pollAmount = 1.00;
      }

      console.log(`[check-iopay-tx] STEP 7: isApproved("${status}") = ${isApproved(status)}`);

      // IOPay says approved → confirm in DB (with retry)
      if (isApproved(status)) {
        console.log(`[check-iopay-tx] IOPAY APPROVED → CONFIRMING: type=${paymentType} status=${status}`);
        const cycleHint = bodyBillingCycle || sub?.billing_cycle || null;
        const daysHint = bodyCustomDays || sub?.custom_cycle_days || null;
        const monthsHint = bodyCustomMonths || sub?.custom_cycle_months || null;

        let result = await confirmIOPayment(
          supabaseAdmin, group_id, user_id, paymentType, pollAmount, transaction_id,
          cycleHint, daysHint, monthsHint, payment_method || null, iopayCardLast4, iopayCardBrand, iopayCardId,
          isInvoiceRef ? iopayReferenceId?.replace("invoice:", "") : null,
        );

        // Retry once on failure
        if (!result.success) {
          console.log(`[check-iopay-tx] RETRY after confirm error: ${result.error}`);
          await new Promise(r => setTimeout(r, 1000));
          result = await confirmIOPayment(
            supabaseAdmin, group_id, user_id, paymentType, pollAmount, transaction_id,
            cycleHint, daysHint, monthsHint, payment_method || null, iopayCardLast4, iopayCardBrand, iopayCardId,
            isInvoiceRef ? iopayReferenceId?.replace("invoice:", "") : null,
          );
        }

        if (result.success) {
          console.log(`[check-iopay-tx] CONFIRMED OK`);

          // Aviso para o administrador: grupo, pessoa, valor, tipo e data/hora.
          // Vai depois do retry para não duplicar, e nunca derruba a
          // confirmação (falha de e-mail fica so no log).
          await notifyAdminPayment(supabaseAdmin, {
            groupId: group_id,
            userId: user_id,
            amount: pollAmount,
            paymentType,
            gateway: "iopay",
            transactionId: transaction_id,
            paymentMethod: payment_method || null,
          });

          return Response.json({
            transaction_id, status, confirmed: true,
            amount: pollAmount, payment_method,
            pix_copy_paste, pix_qrcode_url,
          }, { headers: corsHeaders });
        } else {
          console.error(`[check-iopay-tx] CONFIRM FAILED after retry: ${result.error}`);
          return Response.json({
            transaction_id, status, confirmed: false, confirm_error: result.error,
            amount: pollAmount, payment_method,
          }, { headers: corsHeaders });
        }
      }

      // Not approved yet
      console.log(`[check-iopay-tx] NOT APPROVED: status=${status}`);
      return Response.json({
        transaction_id, status, confirmed: false,
        amount: pollAmount, payment_method,
        pix_copy_paste, pix_qrcode_url,
      }, { headers: corsHeaders });

    } catch (error: any) {
      console.error("[check-iopay-tx] FATAL ERROR:", error?.message, error?.stack);
      return new Response(
        JSON.stringify({ error: error.message, step: "fatal", confirmed: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};