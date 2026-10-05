import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/send-notification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IOPAY_PROD = "https://api.iopay.com.br/api/";
const IOPAY_SANDBOX = "https://sandbox.api.iopay.com.br/api/";

const APPROVED_STATUSES = ["succeeded", "approved", "paid", "authorized", "captured", "completed", "done", "success", "settled", "confirmed"];

function extractResponseData(data: any): any {
  if (data && typeof data === "object" && data.success && typeof data.success === "object") {
    return data.success;
  }
  if (data && typeof data === "object" && data.data && typeof data.data === "object") {
    return data.data;
  }
  return data;
}

function extractId(data: any): string | null {
  if (!data) return null;
  const candidates = [
    data.id, data.Id, data._id,
    data.transaction_id, data.txId, data.tx_id,
    data.data?.id, data.data?.transaction_id, data.data?.txId,
    data.success?.id, data.success?.transaction_id, data.success?.txId,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== "") return String(c);
  }
  return deepScanId(data);
}

function deepScanId(obj: any, depth = 0): string | null {
  if (!obj || typeof obj !== "object" || depth > 5) return null;
  const candidates = ["id", "Id", "ID", "_id", "transaction_id", "txId", "tx_id", "payment_id"];
  for (const key of candidates) {
    if (obj[key] != null && String(obj[key]).trim() !== "" && String(obj[key]).length >= 3) {
      return String(obj[key]);
    }
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const found = deepScanId(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractStatus(data: any): string {
  const extracted = extractResponseData(data);
  if (extracted?.status) return String(extracted.status).toLowerCase();
  if (typeof extracted === "object") {
    for (const val of Object.values(extracted)) {
      if (typeof val === "string" && APPROVED_STATUSES.includes(val.toLowerCase())) return val.toLowerCase();
    }
  }
  return "unknown";
}

async function getDefaultCard(customerId: string, settings: Record<string, string>): Promise<{ id_card: string | null; last4: string | null; brand: string | null }> {
  try {
    const baseUrl = settings.iopay_env === "sandbox" ? IOPAY_SANDBOX : IOPAY_PROD;
    const cardResp = await fetch(`${baseUrl}v1/card/authentication`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: settings.iopay_email, secret: settings.iopay_secret, io_seller_id: settings.iopay_seller_id }),
    });
    const cardAuth = await cardResp.json();
    if (!cardResp.ok || !cardAuth.access_token) return { id_card: null, last4: null, brand: null };
    const cardToken = cardAuth.access_token;

    const resp = await fetch(`${baseUrl}v1/card/list/${customerId}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${cardToken}`, "Content-Type": "application/json" },
    });
    const raw = await resp.text();
    let data: any;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    let cards: any[] = [];
    if (Array.isArray(data)) cards = data;
    else if (Array.isArray(data?.items)) cards = data.items;
    else if (Array.isArray(data?.cards)) cards = data.cards;
    else if (data?.success && typeof data.success === "object") {
      if (Array.isArray(data.success)) cards = data.success;
      else if (Array.isArray(data.success?.items)) cards = data.success.items;
    }

    const defaultCard = cards.find((c: any) => c.is_default) || cards[0];
    if (!defaultCard) return { id_card: null, last4: null, brand: null };

    return {
      id_card: defaultCard.id_card || defaultCard.id || null,
      last4: defaultCard.last4_digits || defaultCard.last4 || null,
      brand: defaultCard.card_brand || defaultCard.brand || null,
    };
  } catch (e) {
    console.error("getDefaultCard error:", e);
    return { id_card: null, last4: null, brand: null };
  }
}

function calculateNextChargeDate(billingCycle: string, customCycleMonths?: number | null, customCycleDays?: number | null): Date {
  if (billingCycle === "days" && customCycleDays) {
    const next = new Date();
    next.setDate(next.getDate() + customCycleDays);
    return next;
  }
  const months = billingCycle === "quarterly" ? 3
    : billingCycle === "semiannual" ? 6
    : billingCycle === "annual" ? 12
    : billingCycle === "custom" ? (customCycleMonths || 1)
    : 1;
  const next = new Date();
  next.setMonth(next.getMonth() + months);
  return next;
}

async function getIOPayToken(settings: Record<string, string>): Promise<string> {
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
  if (!resp.ok || !data.access_token) throw new Error("IOPay auth failed: " + JSON.stringify(data));
  return data.access_token;
}

async function createIOPayTransaction(
  customerId: string,
  cardId: string,
  amount: number,
  description: string,
  referenceId: string,
  settings: Record<string, string>,
): Promise<{ success: boolean; transactionId?: string; status?: string; error?: string; raw?: any }> {
  const token = await getIOPayToken(settings);
  const baseUrl = settings.iopay_env === "sandbox" ? IOPAY_SANDBOX : IOPAY_PROD;

  const txBody = {
    amount: Math.round(amount * 100),
    currency: "BRL",
    description,
    statement_descriptor: "DIVIDEPASS",
    io_seller_id: settings.iopay_seller_id,
    payment_type: "credit",
    reference_id: referenceId,
    capture: true,
    installment_plan: { number_installments: 1 },
    payment_method: "credit_card",
    id_card: cardId,
  };

  const resp = await fetch(`${baseUrl}v1/transaction/new/${customerId}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(txBody),
  });

  const rawText = await resp.text();
  let data: any;
  try { data = JSON.parse(rawText); } catch { data = { raw: rawText }; }

  console.log(`IOPay billing tx [${resp.status}]:`, rawText.substring(0, 500));

  if (!resp.ok) {
    return { success: false, error: data.message || data.error || JSON.stringify(data) };
  }

  const txId = extractId(data);
  const status = extractStatus(data);

  if (!txId) {
    console.error("No transaction ID found in IOPay response:", JSON.stringify(data).substring(0, 500));
    return { success: false, error: "No transaction ID in response", raw: data };
  }

  return { success: true, transactionId: txId, status, raw: data };
}

async function checkTransactionStatus(
  txId: string,
  settings: Record<string, string>,
): Promise<{ status: string; raw: any }> {
  const token = await getIOPayToken(settings);
  const baseUrl = settings.iopay_env === "sandbox" ? IOPAY_SANDBOX : IOPAY_PROD;
  const resp = await fetch(`${baseUrl}v1/transaction/get/${txId}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const rawText = await resp.text();
  let data: any;
  try { data = JSON.parse(rawText); } catch { data = { raw: rawText }; }

  console.log(`IOPay GET transaction/${txId} [${resp.status}]:`, rawText.substring(0, 500));

  const status = extractStatus(data);
  const extracted = extractResponseData(data);

  return { status, raw: extracted || data };
}

async function logBillingAction(
  supabaseAdmin: any,
  subscriptionId: string,
  userId: string,
  groupId: string,
  action: string,
  details: any,
) {
  try {
    await supabaseAdmin.from("billing_logs").insert({
      subscription_id: subscriptionId,
      user_id: userId,
      group_id: groupId,
      action,
      details,
    });
  } catch (e) {
    console.error("billing_logs insert error:", e);
  }
}

async function handleFailedCharge(
  supabaseAdmin: any,
  sub: any,
  billingCycleId: string,
  settings: Record<string, string>,
  errorMsg: string,
  gatewayTxId: string | null,
  gatewayResponse: any,
) {
  const newRetryCount = (sub.retry_count || 0) + 1;
  const ownerId = sub.group?.owner_id || null;
  const groupName = sub.group?.name || sub.group_id;
  const userName = sub.user?.name || sub.user?.email || sub.user_id;

  await supabaseAdmin
    .from("billing_cycles")
    .update({
      status: "failed",
      gateway_transaction_id: gatewayTxId,
      gateway_response: gatewayResponse,
      error_message: errorMsg,
      attempted_at: new Date().toISOString(),
    })
    .eq("id", billingCycleId);

  if (newRetryCount >= 3) {
    await supabaseAdmin
      .from("user_subscriptions")
      .update({
        retry_count: newRetryCount,
        billing_status: "cancelled",
        status: "cancelled",
        last_charge_at: new Date().toISOString(),
      })
      .eq("id", sub.id);

    await supabaseAdmin
      .from("group_members")
      .update({ status: "inactive", payment_status: "cancelled", left_at: new Date().toISOString() })
      .eq("group_id", sub.group_id)
      .eq("user_id", sub.user_id);

    try {
      const { data: credentials } = await supabaseAdmin
        .from("group_credentials")
        .select("id, login_password")
        .eq("group_id", sub.group_id)
        .single();
      if (credentials?.login_password) {
        const newPassword = Math.random().toString(36).substring(2, 10);
        await supabaseAdmin.from("group_credentials").update({ login_password: newPassword }).eq("id", credentials.id);
      }
    } catch (e) { console.error("Credential reset error:", e); }

    await logBillingAction(supabaseAdmin, sub.id, sub.user_id, sub.group_id, "subscription_cancelled", {
      billing_cycle_id: billingCycleId,
      retry_count: newRetryCount,
      error_message: errorMsg,
    });

    await dispatchNotification(supabaseAdmin, {
      title: "Assinatura cancelada por falha",
      message: `A assinatura do grupo "${groupName}" foi cancelada após ${newRetryCount} tentativas sem sucesso.`,
      event_type: "subscription_cancelled",
      metadata: { user_id: sub.user_id, group_id: sub.group_id, retry_count: newRetryCount, error_message: errorMsg },
      audience: { type: "users", user_ids: [sub.user_id, ownerId].filter(Boolean) },
      channels: ["in_app", "push"],
      url: `/dashboard/groups/${sub.group_id}`,
    }).catch((e) => console.error("push notification error (failed cancel):", e));

    console.log(`X Subscription ${sub.id} CANCELLED after ${newRetryCount} failures`);

  } else {
    const retryDays = newRetryCount === 1 ? 1 : 2;
    const nextRetry = new Date();
    nextRetry.setDate(nextRetry.getDate() + retryDays);

    await supabaseAdmin
      .from("user_subscriptions")
      .update({
        retry_count: newRetryCount,
        billing_status: "retrying",
        last_charge_at: new Date().toISOString(),
        next_charge_at: nextRetry.toISOString(),
      })
      .eq("id", sub.id);

    await supabaseAdmin
      .from("billing_cycles")
      .update({ next_retry_at: nextRetry.toISOString() })
      .eq("id", billingCycleId);

    await logBillingAction(supabaseAdmin, sub.id, sub.user_id, sub.group_id, "retry_scheduled", {
      billing_cycle_id: billingCycleId,
      retry_number: newRetryCount,
      next_retry_at: nextRetry.toISOString(),
      error_message: errorMsg,
    });

    await dispatchNotification(supabaseAdmin, {
      title: "Falha na cobrança",
      message: `Não foi possível renovar a assinatura do grupo "${groupName}". Nova tentativa em ${retryDays} dia(s).`,
      event_type: "subscription_payment_failed",
      metadata: { user_id: sub.user_id, group_id: sub.group_id, retry_count: newRetryCount, next_retry_at: nextRetry.toISOString(), error_message: errorMsg },
      audience: { type: "users", user_ids: [sub.user_id, ownerId].filter(Boolean) },
      channels: ["in_app", "push"],
      url: `/dashboard/groups/${sub.group_id}`,
    }).catch((e) => console.error("push notification error (failed retry):", e));

    console.log(`! Subscription ${sub.id} retry ${newRetryCount}/3 scheduled for ${nextRetry.toISOString()}`);
  }
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || "";

    if (authHeader === `Bearer ${serviceRoleKey}`) {
      // acesso interno legítimo
    } else {
      // O cron envia o segredo guardado em app_settings, não um JWT. O gateway
      // rejeita tokens que não são JWT, então a validação real acontece aqui.
      const { data: secretRows } = await createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        serviceRoleKey,
      ).from("app_settings").select("value").in("key", [
        "recurring_billing_cron_secret",
        "billing_cron_secret",
      ]);

      const accepted = [
        Deno.env.get("BILLING_CRON_SECRET") || "",
        ...(secretRows || []).map((r: any) => r.value || ""),
      ].filter(Boolean);

      const provided = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
      if (!provided || !accepted.includes(provided)) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    try {
      console.log("=== process-recurring-billing START ===");

      const { data: settingsRows } = await supabaseAdmin
        .from("app_settings")
        .select("key, value");

      const settings: Record<string, string> = {};
      (settingsRows || []).forEach((s: any) => { settings[s.key] = s.value; });

      const iopayConfigured = !!(settings.iopay_secret && settings.iopay_email && settings.iopay_seller_id);
      if (!iopayConfigured) {
        console.warn("IOPay credentials not configured — IOPay subscriptions will be skipped");
      }

      const nowStr = new Date().toISOString();

      const { data: subscriptions, error: fetchError } = await supabaseAdmin
        .from("user_subscriptions")
        .select(`
          id, user_id, group_id, service_id, amount, billing_cycle,
          custom_cycle_months, custom_cycle_days, gateway, card_id, card_last4, card_brand,
          next_charge_at, retry_count, billing_status, status,
          user:users!user_subscriptions_user_id_fkey (id, name, email, customer_id_iopay),
          group:groups!user_subscriptions_group_id_fkey (id, name, owner_id, is_official),
          service:streaming_services!user_subscriptions_service_id_fkey (id, name)
        `)
        .lte("next_charge_at", nowStr)
        .eq("status", "active")
        .neq("billing_status", "cancelled")
        .lt("retry_count", 3);

      if (fetchError) {
        console.error("Fetch subscriptions error:", fetchError);
        throw fetchError;
      }

      console.log(`Found ${subscriptions?.length || 0} subscriptions to charge`);

      const results = {
        processed: 0,
        approved: 0,
        failed: 0,
        cancelled: 0,
        skipped: 0,
        errors: [] as string[],
      };

      for (const sub of (subscriptions || [])) {
        try {
          results.processed++;
          const user = sub.user as any;
          const group = sub.group as any;
          const service = sub.service as any;

          if (sub.gateway === "mercadopago") {
            console.log(`Skipping sub ${sub.id}: Mercado Pago handles its own recurring billing`);
            results.skipped++;
            continue;
          }

          if (!iopayConfigured) {
            console.log(`Skipping sub ${sub.id}: IOPay not configured`);
            results.skipped++;
            continue;
          }

          const customerId = user?.customer_id_iopay;

          if (!customerId) {
            console.log(`Skipping sub ${sub.id}: missing customer_id_iopay`);
            results.skipped++;
            continue;
          }

          let cardId = sub.card_id;

          if (!cardId) {
            console.log(`Sub ${sub.id} has no card_id, fetching default from IOPay...`);
            const defaultCard = await getDefaultCard(customerId, settings);
            if (!defaultCard.id_card) {
              console.log(`Skipping sub ${sub.id}: no cards found in IOPay for customer ${customerId}`);
              results.skipped++;
              continue;
            }
            cardId = defaultCard.id_card;
            await supabaseAdmin
              .from("user_subscriptions")
              .update({
                card_id: defaultCard.id_card,
                card_last4: defaultCard.last4,
                card_brand: defaultCard.brand,
              })
              .eq("id", sub.id);
            console.log(`Sub ${sub.id}: auto-assigned card ${defaultCard.id_card} (${defaultCard.last4} ${defaultCard.brand})`);
          }

          console.log(`Processing sub ${sub.id} for ${user.name} (${user.email}) | amount: ${sub.amount} | cycle: ${sub.billing_cycle}`);

          const { data: billingCycle, error: bcError } = await supabaseAdmin
            .from("billing_cycles")
            .insert({
              subscription_id: sub.id,
              user_id: sub.user_id,
              group_id: sub.group_id,
              amount: sub.amount,
              charge_date: new Date().toISOString().split("T")[0],
              status: "processing",
              gateway: sub.gateway || "iopay",
              attempt_number: (sub.retry_count || 0) + 1,
            })
            .select()
            .single();

          if (bcError) {
            console.error(`billing_cycles error for sub ${sub.id}:`, bcError);
            results.errors.push(`billing_cycles error: ${bcError.message}`);
            results.processed--;
            continue;
          }

          await logBillingAction(supabaseAdmin, sub.id, sub.user_id, sub.group_id, "charge_attempt", {
            billing_cycle_id: billingCycle.id,
            attempt: (sub.retry_count || 0) + 1,
            amount: sub.amount,
          });

          const txResult = await createIOPayTransaction(
            customerId,
            cardId,
            sub.amount,
            `${service?.name || "Assinatura"} - ${group?.name || ""}`.substring(0, 60),
            `billing:${sub.id}:${billingCycle.id}`,
            settings,
          );

          console.log(`Tx result for sub ${sub.id}:`, JSON.stringify(txResult).substring(0, 500));

          if (txResult.success && txResult.transactionId) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            const txStatus = await checkTransactionStatus(txResult.transactionId, settings);
            console.log(`Tx ${txResult.transactionId} status: ${txStatus.status} (raw: ${JSON.stringify(txStatus.raw).substring(0, 300)})`);

            if (APPROVED_STATUSES.includes(txStatus.status)) {
              const nextChargeDate = calculateNextChargeDate(sub.billing_cycle, sub.custom_cycle_months, sub.custom_cycle_days);

              await supabaseAdmin
                .from("billing_cycles")
                .update({
                  status: "approved",
                  gateway_transaction_id: txResult.transactionId,
                  gateway_response: txStatus.raw,
                  completed_at: new Date().toISOString(),
                })
                .eq("id", billingCycle.id);

              await supabaseAdmin
                .from("user_subscriptions")
                .update({
                  retry_count: 0,
                  billing_status: "active",
                  last_charge_at: new Date().toISOString(),
                  next_charge_at: nextChargeDate.toISOString(),
                  gateway_subscription_id: txResult.transactionId,
                  gateway_status: txStatus.status,
                })
                .eq("id", sub.id);

              await supabaseAdmin.from("invoices").insert({
                user_id: sub.user_id,
                group_id: sub.group_id,
                amount: sub.amount,
                due_date: nextChargeDate.toISOString().split("T")[0],
                status: "paid",
                paid_at: new Date().toISOString(),
              });

              await supabaseAdmin.from("payments").insert({
                user_id: sub.user_id,
                amount: sub.amount,
                method: "credit_card",
                status: "paid",
                payment_type: "subscription",
                group_id: sub.group_id,
                transaction_code: txResult.transactionId,
                gateway: sub.gateway || "iopay",
                notes: `Cobranca recorrente - tentativa ${(sub.retry_count || 0) + 1}`,
              });

              try {
                if (!group.is_official) {
                  console.log(`Skipping wallet credit: group ${sub.group_id} is not official`);
                } else {
                  const { data: stg } = await supabaseAdmin
                    .from("app_settings")
                    .select("key, value")
                    .in("key", ["gateway_fee_percent", "platform_fee_percent"]);
                  const stgMap: Record<string, string> = {};
                  (stg || []).forEach((s: any) => { stgMap[s.key] = s.value; });
                  const fee = parseFloat(stgMap.gateway_fee_percent || "4.98") + parseFloat(stgMap.platform_fee_percent || "3.95");
                  const net = sub.amount - (sub.amount * fee / 100);
                  await supabaseAdmin.rpc("credit_wallet", {
                    p_user_id: group.owner_id, p_amount: net,
                    p_description: `Assinatura recorrente - ${service?.name || ""}`,
                    p_reference_type: "payment", p_reference_id: txResult.transactionId,
                    p_group_id: sub.group_id,
                  });
                }
              } catch (e) { console.error("Wallet credit error:", e); }

              await logBillingAction(supabaseAdmin, sub.id, sub.user_id, sub.group_id, "charge_success", {
                billing_cycle_id: billingCycle.id,
                transaction_id: txResult.transactionId,
                amount: sub.amount,
                next_charge_at: nextChargeDate.toISOString(),
              });

              await dispatchNotification(supabaseAdmin, {
                title: "Assinatura renovada",
                message: `A assinatura de ${user?.name || user?.email || 'usuário'} no grupo "${group?.name || sub.group_id}" foi renovada com sucesso.`,
                event_type: "subscription_renewed",
                metadata: { user_id: sub.user_id, group_id: sub.group_id, amount: sub.amount, transaction_id: txResult.transactionId },
                audience: { type: "users", user_ids: [sub.user_id, group?.owner_id].filter(Boolean) },
                channels: ["in_app", "push"],
                url: `/dashboard/groups/${sub.group_id}`,
              }).catch((e) => console.error("push notification error (renewal success):", e));

              results.approved++;
              console.log(`OK sub ${sub.id} approved | next_charge: ${nextChargeDate.toISOString()}`);

            } else {
              console.log(`Sub ${sub.id} tx status "${txStatus.status}" not in APPROVED_STATUSES, marking as failed`);
              await handleFailedCharge(supabaseAdmin, sub, billingCycle.id, settings,
                `Status: ${txStatus.status}`, txResult.transactionId, txStatus.raw);
              results.failed++;
            }
          } else {
            console.log(`Sub ${sub.id} tx creation failed:`, txResult.error);
            await handleFailedCharge(supabaseAdmin, sub, billingCycle.id, settings,
              txResult.error || "Unknown error", null, txResult.raw);
            results.failed++;
          }
        } catch (subError: any) {
          console.error(`Error processing sub ${sub.id}:`, subError);
          results.errors.push(`Sub ${sub.id}: ${subError.message}`);
        }
      }

      console.log("=== process-recurring-billing DONE ===", JSON.stringify(results));

      return Response.json({
        success: true,
        ...results,
        timestamp: new Date().toISOString(),
      }, { headers: corsHeaders });

    } catch (error: any) {
      console.error("process-recurring-billing error:", error);
      return Response.json(
        { error: error.message },
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
