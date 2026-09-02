import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewaySettings } from "../create-payment/handlers/settings.ts";

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

    // Buscar valor pago (pode ser menor se cupom foi usado)
    let paidAmount = defaultAmount;
    try {
      const { data: attempt } = await supabaseAdmin
        .from("payment_attempts")
        .select("coupon_id, original_amount, discount_amount, final_amount")
        .eq("gateway_transaction_id", gateway_payment_id)
        .maybeSingle();

      if (attempt?.final_amount != null) {
        paidAmount = Number(attempt.final_amount);
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

async function confirmIOPayment(
  supabaseAdmin: any,
  group_id: string,
  user_id: string,
  payment_type: "entrance" | "subscription" | "combined" | "invoice",
  amount: number,
  gateway_payment_id: string,
  billingCycleHint?: string | null,
  customCycleDays?: number | null,
  customCycleMonths?: number | null,
  paymentMethod?: string | null,
  cardLast4?: string | null,
  cardBrand?: string | null,
  cardId?: string | null,
  invoiceId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  console.log(`[confirmIOPayment] START type=${payment_type} user=${user_id} group=${group_id} amount=${amount} cycle=${billingCycleHint}`);

  if (payment_type === "invoice") {
    try {
      if (invoiceId) {
        await supabaseAdmin.from("invoices").update({
          status: "paid",
          paid_at: new Date().toISOString(),
          gateway_transaction_id: gateway_payment_id,
        }).eq("id", invoiceId);
      } else {
        const { data: invToUpdate } = await supabaseAdmin.from("invoices")
          .select("id").eq("user_id", user_id).eq("group_id", group_id).eq("status", "pending")
          .order("due_date", { ascending: true }).limit(1).maybeSingle();
        if (invToUpdate) {
          await supabaseAdmin.from("invoices").update({
            status: "paid",
            paid_at: new Date().toISOString(),
            gateway_transaction_id: gateway_payment_id,
          }).eq("id", invToUpdate.id);
        }
      }

    supabaseAdmin.from("payments").insert({
      user_id, amount, method: paymentMethod || "pix", status: "paid",
      payment_type: "invoice", group_id, transaction_code: gateway_payment_id,
      gateway: "iopay", notes: "Fatura via PIX",
    }).then(({ error }: any) => { if (error) console.error("[confirmIOPayment] payments error:", error); });

      console.log(`[confirmIOPayment] DONE invoice`);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: "invoice update error: " + e.message };
    }
  }

  if (payment_type === "entrance") {
    try {
      const { error } = await supabaseAdmin
        .from("group_members")
        .update({
          status: "active",
          payment_status: "entrance_paid",
          entrance_paid_at: new Date().toISOString(),
          entrance_payment_id: gateway_payment_id,
          gateway_payment_id,
          subscription_deadline: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        })
        .eq("group_id", group_id)
        .eq("user_id", user_id);
      if (error) {
        console.error("[confirmIOPayment] group_members update error:", error);
        const { error: upsertErr } = await supabaseAdmin
          .from("group_members")
          .upsert({
            group_id, user_id,
            status: "active",
            payment_status: "entrance_paid",
            entrance_paid_at: new Date().toISOString(),
            entrance_payment_id: gateway_payment_id,
            gateway_payment_id,
            subscription_deadline: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
          }, { onConflict: "group_id, user_id" });
        if (upsertErr) {
          return { success: false, error: "group_members failed: " + upsertErr.message };
        }
      }
    } catch (e: any) {
      return { success: false, error: "group_members error: " + e.message };
    }

    supabaseAdmin.from("payments").insert({
      user_id, amount, method: paymentMethod || "credit_card", status: "paid",
      payment_type: "entrance", group_id, transaction_code: gateway_payment_id,
      gateway: "iopay", notes: "Taxa de adesão",
    }).then(({ error }: any) => { if (error) console.error("[confirmIOPayment] payments error:", error); });

    await registerCouponUsage(supabaseAdmin, gateway_payment_id, user_id, "entrance");

    console.log(`[confirmIOPayment] DONE entrance`);
    return { success: true };
  }

  if (payment_type === "combined") {
    // Combined: entrance + first subscription in one payment
    try {
      const { data: group } = await supabaseAdmin
        .from("groups")
        .select("entrance_fee, price_per_slot, service_id, name, owner_id, billing_cycle, is_official")
        .eq("id", group_id)
        .single();

      const entranceAmount = group?.entrance_fee || 0;
      const subscriptionAmount = group?.price_per_slot || 0;
      const cycle = billingCycleHint || group?.billing_cycle || "monthly";
      const days = customCycleDays || null;
      const months = customCycleMonths || null;

      // 1. Mark entrance as paid
      await supabaseAdmin
        .from("group_members")
        .upsert({
          group_id, user_id,
          status: "active",
          payment_status: "entrance_paid",
          entrance_paid_at: new Date().toISOString(),
          entrance_payment_id: gateway_payment_id,
          gateway_payment_id,
        }, { onConflict: "group_id, user_id" });

      // 2. Record entrance payment
      await supabaseAdmin.from("payments").insert({
        user_id, amount: entranceAmount, method: paymentMethod || "pix", status: "paid",
        payment_type: "entrance", group_id, transaction_code: gateway_payment_id,
        gateway: "iopay", notes: "Taxa de adesão (pagamento combinado)",
      });

      // 3. Create/update subscription with ONLY monthly amount
      const nextChargeAt = calculateNextChargeDate(cycle, days, months);

      const { data: subInfo } = await supabaseAdmin
        .from("user_subscriptions")
        .select("id")
        .eq("group_id", group_id).eq("user_id", user_id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (subInfo?.id) {
        await supabaseAdmin
          .from("user_subscriptions")
          .update({
            status: "active",
            gateway_status: "authorized",
            gateway_subscription_id: gateway_payment_id,
            next_charge_at: nextChargeAt.toISOString(),
            billing_status: "active",
            retry_count: 0,
            last_charge_at: new Date().toISOString(),
            billing_cycle: cycle,
            payment_method: paymentMethod || null,
            custom_cycle_days: days,
            custom_cycle_months: months,
            amount: subscriptionAmount,
            ...(cardId ? { card_id: cardId } : {}),
            ...(cardLast4 ? { card_last4: cardLast4 } : {}),
            ...(cardBrand ? { card_brand: cardBrand } : {}),
          })
          .eq("id", subInfo.id);
      } else {
        await supabaseAdmin.from("user_subscriptions").insert({
          user_id, group_id, service_id: group?.service_id,
          billing_cycle: cycle, amount: subscriptionAmount,
          status: "active", gateway: "iopay", gateway_subscription_id: gateway_payment_id,
          payment_method: paymentMethod || null,
          next_charge_at: nextChargeAt.toISOString(),
          billing_status: "active", retry_count: 0, last_charge_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          custom_cycle_days: days,
          custom_cycle_months: months,
          ...(cardId ? { card_id: cardId } : {}),
          ...(cardLast4 ? { card_last4: cardLast4 } : {}),
          ...(cardBrand ? { card_brand: cardBrand } : {}),
        });
      }

      // 4. Update member to active
      await supabaseAdmin
        .from("group_members")
        .upsert({
          group_id, user_id,
          status: "active",
          payment_status: "active",
          joined_at: new Date().toISOString(),
        }, { onConflict: "group_id, user_id" });

      // 5. Record subscription payment
      await supabaseAdmin.from("payments").insert({
        user_id, amount: subscriptionAmount, method: paymentMethod || "subscription", status: "paid",
        payment_type: "subscription", group_id, transaction_code: gateway_payment_id,
        gateway: "iopay", notes: "1ª mensalidade (pagamento combinado)",
      });

      await registerCouponUsage(supabaseAdmin, gateway_payment_id, user_id, "combined");

      console.log(`[confirmIOPayment] DONE combined`);
      return { success: true };
    } catch (e: any) {
      console.error("[confirmIOPayment] combined error:", e);
      return { success: false, error: "combined error: " + e.message };
    }
  }

  // SUBSCRIPTION
  try {
    const { data: subInfo } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id, billing_cycle, custom_cycle_months, custom_cycle_days, payment_method, card_id, card_last4, card_brand")
      .eq("group_id", group_id)
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const cycle = billingCycleHint || subInfo?.billing_cycle || "monthly";
    const days = customCycleDays || subInfo?.custom_cycle_days || null;
    const months = customCycleMonths || subInfo?.custom_cycle_months || null;
    const nextChargeAt = calculateNextChargeDate(cycle, days, months);

    if (subInfo?.id) {
      const { error: subErr } = await supabaseAdmin
        .from("user_subscriptions")
        .update({
          status: "active",
          gateway_status: "authorized",
          gateway_subscription_id: gateway_payment_id,
          next_charge_at: nextChargeAt.toISOString(),
          billing_status: "active",
          retry_count: 0,
          last_charge_at: new Date().toISOString(),
          billing_cycle: cycle,
          payment_method: paymentMethod || subInfo?.payment_method || null,
          custom_cycle_days: days,
          custom_cycle_months: months,
          ...(cardId ? { card_id: cardId } : {}),
          ...(cardLast4 ? { card_last4: cardLast4 } : {}),
          ...(cardBrand ? { card_brand: cardBrand } : {}),
        })
        .eq("id", subInfo.id);
      if (subErr) {
        console.error("[confirmIOPayment] subscription update error:", subErr);
        return { success: false, error: "subscription update failed: " + subErr.message };
      }
      console.log(`[confirmIOPayment] subscription updated: id=${subInfo.id} cycle=${cycle} next=${nextChargeAt.toISOString()}`);
    } else {
      console.error("[confirmIOPayment] No subscription found! Creating fallback...");
      const { data: grp } = await supabaseAdmin.from("groups").select("service_id").eq("id", group_id).maybeSingle();
      const { error: insErr } = await supabaseAdmin.from("user_subscriptions").insert({
        user_id, group_id, service_id: grp?.service_id,
        billing_cycle: cycle, amount,
        status: "active", gateway: "iopay", gateway_subscription_id: gateway_payment_id,
        payment_method: paymentMethod || null,
        next_charge_at: nextChargeAt.toISOString(),
        billing_status: "active", retry_count: 0, last_charge_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        custom_cycle_days: days,
        custom_cycle_months: months,
        ...(cardId ? { card_id: cardId } : {}),
        ...(cardLast4 ? { card_last4: cardLast4 } : {}),
        ...(cardBrand ? { card_brand: cardBrand } : {}),
      });
      if (insErr) {
        console.error("[confirmIOPayment] subscription insert error:", insErr);
        return { success: false, error: "subscription insert failed: " + insErr.message };
      }
    }
  } catch (e: any) {
    console.error("[confirmIOPayment] subscription error:", e);
    return { success: false, error: "subscription error: " + e.message };
  }

  // group_members: update existing row, or upsert if missing — CRITICAL
  try {
    const { data: existingMember, error: selErr } = await supabaseAdmin
      .from("group_members")
      .select("id")
      .eq("group_id", group_id)
      .eq("user_id", user_id)
      .maybeSingle();

    if (selErr) {
      console.error("[confirmIOPayment] group_members select error:", selErr);
    }

    if (existingMember) {
      const { error } = await supabaseAdmin
        .from("group_members")
        .update({
          status: "active",
          payment_status: "active",
          joined_at: new Date().toISOString(),
        })
        .eq("group_id", group_id)
        .eq("user_id", user_id);
      if (error) {
        console.error("[confirmIOPayment] group_members update error:", error);
        return { success: false, error: "group_members update failed: " + error.message };
      }
      console.log("[confirmIOPayment] group_members updated OK");
    } else {
      const { error: upsertErr } = await supabaseAdmin
        .from("group_members")
        .upsert({
          group_id, user_id,
          status: "active",
          payment_status: "active",
          joined_at: new Date().toISOString(),
        }, { onConflict: "group_id, user_id" });
      if (upsertErr) {
        console.error("[confirmIOPayment] group_members upsert error:", upsertErr);
        return { success: false, error: "group_members upsert failed: " + upsertErr.message };
      }
      console.log("[confirmIOPayment] group_members upsert OK");
    }
  } catch (e: any) {
    console.error("[confirmIOPayment] group_members exception:", e);
    return { success: false, error: "group_members exception: " + e.message };
  }

  // billing_cycles
  try {
    const { data: sub } = await supabaseAdmin
      .from("user_subscriptions").select("id")
      .eq("group_id", group_id).eq("user_id", user_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (sub?.id) {
      const { data: existing } = await supabaseAdmin
        .from("billing_cycles").select("id")
        .eq("subscription_id", sub.id).eq("status", "pending").maybeSingle();
      if (!existing) {
        const { error: bcErr } = await supabaseAdmin.from("billing_cycles").insert({
          subscription_id: sub.id, user_id, group_id, amount,
          charge_date: nextChargeAt.toISOString().split("T")[0],
          status: "pending", attempt_number: 0,
        });
        if (bcErr) console.error("[confirmIOPayment] billing_cycles error:", bcErr);
      }
    }
  } catch (e) { console.error("[confirmIOPayment] billing_cycles exception:", e); }

  // Fire-and-forget: payments (with savings tracking), events
  const savingsData = await getSavingsData(supabaseAdmin, group_id, gateway_payment_id, amount);
  supabaseAdmin.from("payments").insert({
    user_id, amount,
    official_price: savingsData.official_price,
    paid_amount: savingsData.paid_amount,
    method: "credit_card", status: "paid",
    payment_type: "subscription", group_id, transaction_code: gateway_payment_id,
    gateway: "iopay", notes: "Assinatura",
  }).then(({ error }: any) => { if (error) console.error("[confirmIOPayment] payments error:", error); });

  // Fetch user and group names for the event message
  Promise.all([
    supabaseAdmin.from("users").select("name").eq("id", user_id).maybeSingle(),
    supabaseAdmin.from("groups").select("name").eq("id", group_id).maybeSingle(),
  ]).then(([{ data: usr }, { data: grp }]) => {
    const userName = usr?.name || "Usuário";
    const groupName = grp?.name || "Grupo";
    supabaseAdmin.from("platform_events").insert({
      event_type: "payment", title: "Pagamento confirmado",
      message: `${userName} confirmou pagamento de R$ ${amount.toFixed(2)} no grupo "${groupName}".`,
      metadata: JSON.stringify({ user_id, group_id, amount, payment_type, gateway: "iopay", transaction_id: gateway_payment_id, user_name: usr?.name, group_name: grp?.name }),
      created_by: user_id,
    }).then(({ error }: any) => { if (error) console.error("[confirmIOPayment] event error:", error); });
  }).catch(e => {
    console.error("[confirmIOPayment] event name lookup error:", e);
    supabaseAdmin.from("platform_events").insert({
      event_type: "payment", title: "Pagamento confirmado",
      message: `Pagamento de R$ ${amount.toFixed(2)} confirmado.`,
      metadata: JSON.stringify({ user_id, group_id, amount, payment_type, gateway: "iopay", transaction_id: gateway_payment_id }),
      created_by: user_id,
    }).then(({ error }: any) => { if (error) console.error("[confirmIOPayment] event fallback error:", error); });
  });

  // Member joined event (fire-and-forget)
  Promise.all([
    supabaseAdmin.from("groups").select("name").eq("id", group_id).maybeSingle(),
    supabaseAdmin.from("users").select("name").eq("id", user_id).maybeSingle(),
  ]).then(([{ data: grp }, { data: usr }]) => {
    supabaseAdmin.from("platform_events").insert({
      event_type: "member_joined",
      title: "Membro ingressou no grupo",
      message: `${usr?.name || user_id} ingressou no grupo "${grp?.name || group_id}".`,
      metadata: JSON.stringify({ user_id, group_id, amount, gateway: "iopay" }),
      created_by: user_id,
    }).then(({ error }: any) => { if (error) console.error("[confirmIOPayment] member_joined event error:", error); });
  }).catch(e => console.error("[confirmIOPayment] member_joined lookup error:", e));

  // Registrar cupom APÓS pagamento confirmado
  await registerCouponUsage(supabaseAdmin, gateway_payment_id, user_id, "subscription");

  console.log(`[confirmIOPayment] DONE subscription`);
  return { success: true };
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
    const { data: attempt } = await supabaseAdmin
      .from("payment_attempts")
      .select("coupon_id, discount_amount, original_amount, final_amount")
      .eq("gateway_transaction_id", gateway_payment_id)
      .maybeSingle();

    if (!attempt?.coupon_id) return;

    const { data: existingUse } = await supabaseAdmin
      .from("coupon_uses")
      .select("id")
      .eq("coupon_id", attempt.coupon_id)
      .eq("user_id", user_id)
      .maybeSingle();

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
        await fetch(`${baseUrl}v1/transaction/void/${transaction_id}`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (group_id && user_id) {
          const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
          await supabaseAdmin.from("group_members").update({ payment_status: "expired" }).eq("group_id", group_id).eq("user_id", user_id);
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

        payment_method = src?.payment_method || txRaw.payment_method || txRaw.success?.payment_method || "card";
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
      if (pollAmount > 0) {
        try {
          await supabaseAdmin.from("payment_attempts").insert({
            user_id, group_id, gateway: "iopay", payment_method,
            payment_type: bodyPaymentType || "unknown",
            amount: pollAmount, status: `polled_${status}`,
            gateway_transaction_id: transaction_id,
            gateway_response: { status, raw_status: txRaw.status },
          });
        } catch (e) { console.error("[check-iopay-tx] payment_attempts error:", e); }
      }

      // Check DB directly: is it already confirmed?
      const { data: sub } = await supabaseAdmin
        .from("user_subscriptions")
        .select("id, status, billing_cycle, custom_cycle_days, custom_cycle_months, amount")
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

      // Already confirmed in DB?
      // For subscription: only consider active if the SUBSCRIPTION itself is active, not just the entrance
      // For entrance: check if entrance is already paid
      let alreadyConfirmedInDB = false;
      if (paymentType === "subscription") {
        alreadyConfirmedInDB = sub?.status === "active" && member?.payment_status === "active";
      } else if (paymentType === "entrance") {
        alreadyConfirmedInDB = member?.payment_status === "entrance_paid" || member?.payment_status === "active";
      } else {
        alreadyConfirmedInDB = sub?.status === "active" || member?.payment_status === "active";
      }
      if (alreadyConfirmedInDB) {
        console.log(`[check-iopay-tx] ALREADY CONFIRMED: sub=${sub?.status} member=${member?.payment_status}`);
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
