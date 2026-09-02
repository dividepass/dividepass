import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IOPAY_PROD = "https://api.iopay.com.br/api/";
const IOPAY_SANDBOX = "https://sandbox.api.iopay.com.br/api/";

function getBaseUrl(settings: Record<string, string>): string {
  return settings.iopay_env === "sandbox" ? IOPAY_SANDBOX : IOPAY_PROD;
}

async function getToken(settings: Record<string, string>): Promise<string> {
  const baseUrl = getBaseUrl(settings);
  const resp = await fetch(`${baseUrl}auth/login?email=${encodeURIComponent(settings.iopay_email || "")}&secret=${encodeURIComponent(settings.iopay_secret || "")}&io_seller_id=${encodeURIComponent(settings.iopay_seller_id || "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: settings.iopay_email, secret: settings.iopay_secret, io_seller_id: settings.iopay_seller_id }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error("IOPay auth failed");
  return data.access_token;
}

function extractResponseData(data: any): any {
  if (data?.success && typeof data.success === "object") return data.success;
  if (data?.data && typeof data.data === "object") return data.data;
  return data;
}

function isApproved(status: string): boolean {
  const s = (status || "").toLowerCase();
  if (["succeeded", "approved", "paid", "authorized", "captured", "completed", "done", "success", "settled", "confirmed"].includes(s)) return true;
  if (["failed", "cancelled", "canceled", "rejected", "voided", "expired", "error", "denied", "refused", "chargeback"].includes(s)) return false;
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

async function getSettings(supabaseAdmin: any): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from("app_settings").select("key, value").in("key", [
    "iopay_env", "iopay_email", "iopay_secret", "iopay_seller_id",
  ]);
  const settings: Record<string, string> = {};
  (data || []).forEach((row: any) => { settings[row.key] = row.value; });
  return settings;
}

async function confirmIOPayment(
  supabaseAdmin: any,
  group_id: string,
  user_id: string,
  payment_type: "entrance" | "subscription" | "invoice",
  amount: number,
  gateway_payment_id: string,
): Promise<{ success: boolean; error?: string }> {
  const now = new Date().toISOString();

  if (payment_type === "invoice") {
    try {
      const { data: invToUpdate } = await supabaseAdmin.from("invoices")
        .select("id").eq("user_id", user_id).eq("group_id", group_id).eq("status", "pending")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (invToUpdate) {
        await supabaseAdmin.from("invoices").update({
          status: "paid", paid_at: now, gateway_transaction_id: gateway_payment_id,
        }).eq("id", invToUpdate.id);
      }
    } catch (e: any) {
      return { success: false, error: "invoice error: " + e.message };
    }
  }

  if (payment_type === "entrance") {
    try {
      const { data: existingMember } = await supabaseAdmin
        .from("group_members").select("id")
        .eq("group_id", group_id).eq("user_id", user_id).maybeSingle();

      if (existingMember) {
        const { error } = await supabaseAdmin
          .from("group_members")
          .update({
            status: "active",
            payment_status: "entrance_paid",
            entrance_paid_at: now,
            entrance_payment_id: gateway_payment_id,
            subscription_deadline: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
          })
          .eq("group_id", group_id).eq("user_id", user_id);
        if (error) return { success: false, error: "group_members update failed: " + error.message };
      } else {
        const { error: upsertErr } = await supabaseAdmin
          .from("group_members")
          .upsert({
            group_id, user_id,
            status: "active",
            payment_status: "entrance_paid",
            entrance_paid_at: now,
            entrance_payment_id: gateway_payment_id,
            subscription_deadline: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
            joined_at: now,
          }, { onConflict: "group_id, user_id" });
        if (upsertErr) return { success: false, error: "group_members upsert failed: " + upsertErr.message };
      }
    } catch (e: any) {
      return { success: false, error: "group_members error: " + e.message };
    }

    supabaseAdmin.from("payments").insert({
      user_id, amount, method: "pix", status: "paid", payment_type: "entrance",
      group_id, transaction_code: gateway_payment_id, gateway: "iopay", notes: "Taxa de adesão (force-confirm)",
    }).then(({ error }: any) => { if (error) console.error("[force-confirm] payments error:", error); });

    return { success: true };
  }

  if (payment_type === "subscription") {
    // Update or create user_subscriptions
    try {
      const { data: subInfo } = await supabaseAdmin
        .from("user_subscriptions")
        .select("id, billing_cycle, custom_cycle_months, custom_cycle_days")
        .eq("group_id", group_id).eq("user_id", user_id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      const cycle = subInfo?.billing_cycle || "monthly";
      const days = subInfo?.custom_cycle_days || null;
      const months = subInfo?.custom_cycle_months || null;
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
            last_charge_at: now,
          })
          .eq("id", subInfo.id);
        if (subErr) return { success: false, error: "subscription update failed: " + subErr.message };
      } else {
        const { data: grp } = await supabaseAdmin.from("groups").select("service_id").eq("id", group_id).maybeSingle();
        const { error: insErr } = await supabaseAdmin.from("user_subscriptions").insert({
          user_id, group_id, service_id: grp?.service_id,
          billing_cycle: cycle, amount,
          status: "active", gateway: "iopay", gateway_subscription_id: gateway_payment_id,
          next_charge_at: nextChargeAt.toISOString(),
          billing_status: "active", retry_count: 0, last_charge_at: now,
          started_at: now, custom_cycle_days: days, custom_cycle_months: months,
        });
        if (insErr) return { success: false, error: "subscription insert failed: " + insErr.message };
      }
    } catch (e: any) {
      return { success: false, error: "subscription error: " + e.message };
    }

    // group_members: select-then-update-or-upsert — CRITICAL
    try {
      const { data: existingMember, error: selErr } = await supabaseAdmin
        .from("group_members").select("id")
        .eq("group_id", group_id).eq("user_id", user_id).maybeSingle();

      if (selErr) console.error("[force-confirm] group_members select error:", selErr);

      if (existingMember) {
        const { error } = await supabaseAdmin
          .from("group_members")
          .update({
            status: "active",
            payment_status: "active",
            joined_at: now,
          })
          .eq("group_id", group_id).eq("user_id", user_id);
        if (error) return { success: false, error: "group_members update failed: " + error.message };
      } else {
        const { error: upsertErr } = await supabaseAdmin
          .from("group_members")
          .upsert({
            group_id, user_id,
            status: "active",
            payment_status: "active",
            joined_at: now,
          }, { onConflict: "group_id, user_id" });
        if (upsertErr) return { success: false, error: "group_members upsert failed: " + upsertErr.message };
      }
    } catch (e: any) {
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
          const cycle = subInfo?.billing_cycle || "monthly";
          const days = subInfo?.custom_cycle_days || null;
          const months = subInfo?.custom_cycle_months || null;
          const nextChargeAt = calculateNextChargeDate(cycle, days, months);
          await supabaseAdmin.from("billing_cycles").insert({
            subscription_id: sub.id, user_id, group_id, amount,
            charge_date: nextChargeAt.toISOString().split("T")[0],
            status: "pending", attempt_number: 0,
          });
        }
      }
    } catch (e) { console.error("[force-confirm] billing_cycles error:", e); }

    // Payment record
    supabaseAdmin.from("payments").insert({
      user_id, amount, method: "pix", status: "paid", payment_type: "subscription",
      group_id, transaction_code: gateway_payment_id, gateway: "iopay", notes: "Assinatura (force-confirm)",
    }).then(({ error }: any) => { if (error) console.error("[force-confirm] payments error:", error); });

    // Platform events + member joined — fire-and-forget AFTER group_members confirmed
    Promise.all([
      supabaseAdmin.from("users").select("name").eq("id", user_id).maybeSingle(),
      supabaseAdmin.from("groups").select("name").eq("id", group_id).maybeSingle(),
    ]).then(([{ data: usr }, { data: grp }]) => {
      const userName = usr?.name || "Usuário";
      const groupName = grp?.name || group_id;
      supabaseAdmin.from("platform_events").insert({
        event_type: "payment",
        title: "Pagamento confirmado (forçado)",
        message: `${userName} confirmou pagamento de R$ ${amount.toFixed(2)} no grupo "${groupName}".`,
        metadata: JSON.stringify({ user_id, group_id, amount, payment_type, gateway: "iopay", transaction_id: gateway_payment_id, forced: true }),
        created_by: user_id,
      }).then(({ error }: any) => { if (error) console.error("[force-confirm] payment event error:", error); });

      supabaseAdmin.from("platform_events").insert({
        event_type: "member_joined",
        title: "Membro ingressou no grupo",
        message: `${userName} ingressou no grupo "${groupName}".`,
        metadata: JSON.stringify({ user_id, group_id, amount, gateway: "iopay", forced: true }),
        created_by: user_id,
      }).then(({ error }: any) => { if (error) console.error("[force-confirm] member_joined event error:", error); });
    }).catch(e => console.error("[force-confirm] event name lookup error:", e));

    return { success: true };
  }

  return { success: false, error: "Tipo de pagamento desconhecido: " + payment_type };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: userData } = await supabaseAdmin.from("users").select("role").eq("id", user.id).maybeSingle();
    if (userData?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Sem permissão" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { transaction_id, payment_id, group_id, user_id, payment_type } = body;

    let txId = transaction_id;
    let targetUserId = user_id;
    let targetGroupId = group_id;
    let targetPaymentType = payment_type;
    let targetAmount = 0;

    if (payment_id && !txId) {
      const { data: payment } = await supabaseAdmin
        .from("payments").select("*").eq("id", payment_id).maybeSingle();
      if (payment) {
        txId = payment.transaction_code;
        targetUserId = payment.user_id;
        targetGroupId = payment.group_id;
        targetPaymentType = payment.payment_type;
        targetAmount = payment.amount;
      }
    }

    if (!txId && payment_id) {
      const { data: attempt } = await supabaseAdmin
        .from("payment_attempts").select("*").eq("id", payment_id).maybeSingle();
      if (attempt) {
        txId = attempt.gateway_transaction_id || attempt.external_reference;
        targetUserId = attempt.user_id;
        targetGroupId = attempt.group_id;
        targetPaymentType = attempt.payment_type;
        targetAmount = attempt.amount;
      }
    }

    if (!txId) {
      return new Response(JSON.stringify({ error: "Transaction ID não encontrado." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const settings = await getSettings(supabaseAdmin);
    if (!settings.iopay_secret || !settings.iopay_email || !settings.iopay_seller_id) {
      return new Response(JSON.stringify({ error: "Credenciais IOPAY não configuradas" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = await getToken(settings);
    const baseUrl = getBaseUrl(settings);

    const txResp = await fetch(`${baseUrl}v1/transaction/get/${txId}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const txRaw = await txResp.json();
    const txData = extractResponseData(txRaw);
    const status = String(txData?.status || txRaw?.status || "unknown").toLowerCase().trim();

    if (!isApproved(status)) {
      return new Response(JSON.stringify({
        confirmed: false,
        iopay_status: status,
        error: `Pagamento não aprovado no gateway (${status || 'unknown'}).`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!targetUserId || !targetGroupId) {
      const refId = txData?.reference_id || txRaw?.reference_id || "";
      if (refId.includes(":")) {
        const parts = refId.split(":");
        if (parts.length >= 2) {
          targetGroupId = targetGroupId || parts[0];
          targetUserId = targetUserId || parts[1];
          targetPaymentType = targetPaymentType || parts[2] || "subscription";
        }
      }
    }

    if (!targetUserId || !targetGroupId) {
      return new Response(JSON.stringify({
        error: "Não foi possível determinar user_id e group_id.",
        iopay_status: status,
        iopay_response: txRaw,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!targetAmount) {
      const rawAmount = txData?.amount ?? txRaw?.amount ?? 0;
      targetAmount = typeof rawAmount === "string" ? parseFloat(rawAmount) || 0 : rawAmount;
      if (targetAmount > 100) targetAmount = targetAmount / 100;
    }

    const result = {
      transaction_id: txId,
      iopay_status: status,
      is_approved: isApproved(status),
      user_id: targetUserId,
      group_id: targetGroupId,
      payment_type: targetPaymentType,
      amount: targetAmount,
      confirmed: false,
      error: null as string | null,
    };

    let confirmResult = await confirmIOPayment(supabaseAdmin, targetGroupId, targetUserId, targetPaymentType, targetAmount, txId);
    if (!confirmResult.success) {
      await new Promise(r => setTimeout(r, 1000));
      confirmResult = await confirmIOPayment(supabaseAdmin, targetGroupId, targetUserId, targetPaymentType, targetAmount, txId);
    }
    result.confirmed = confirmResult.success;
    result.error = confirmResult.error || null;

    return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("force-confirm-payment error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
