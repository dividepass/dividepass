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

async function logCharge(supabaseAdmin: any, log: {
  charge_id?: string; reference_code: string; admin_id?: string;
  action: string; amount?: number; payment_method?: string; status?: string;
  gateway_transaction_id?: string; gateway_response?: any; metadata?: any;
}) {
  try {
    await supabaseAdmin.from("custom_charge_logs").insert({
      charge_id: log.charge_id || null,
      reference_code: log.reference_code,
      admin_id: log.admin_id || null,
      action: log.action,
      amount: log.amount || null,
      payment_method: log.payment_method || null,
      status: log.status || null,
      gateway_transaction_id: log.gateway_transaction_id || null,
      gateway_response: log.gateway_response ? JSON.stringify(log.gateway_response).substring(0, 2000) : null,
      metadata: log.metadata || null,
    });
  } catch (e) { console.error("logCharge error:", e); }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { reference_code } = body;

    if (!reference_code) {
      return Response.json({ error: "reference_code required" }, { status: 400, headers: corsHeaders });
    }

    const { data: charge, error: chargeErr } = await supabaseAdmin
      .from("custom_charges")
      .select("*")
      .eq("reference_code", reference_code)
      .maybeSingle();

    if (chargeErr || !charge) {
      return Response.json({ error: "Cobrança não encontrada" }, { status: 404, headers: corsHeaders });
    }

    if (charge.status === "paid") {
      return Response.json({ confirmed: true, status: "paid", amount: charge.amount, description: charge.description }, { headers: corsHeaders });
    }

    if (charge.status === "expired" || (charge.expires_at && new Date(charge.expires_at) < new Date())) {
      await supabaseAdmin.from("custom_charges").update({ status: "expired" }).eq("id", charge.id);
      await logCharge(supabaseAdmin, {
        charge_id: charge.id, reference_code, action: "expired",
        amount: charge.amount, payment_method: charge.payment_method,
        gateway_transaction_id: charge.gateway_transaction_id,
        metadata: { reason: charge.expires_at ? "expired_at" : "manual_check" },
      });
      return Response.json({ confirmed: false, status: "expired" }, { headers: corsHeaders });
    }

    if (!charge.gateway_transaction_id) {
      return Response.json({ confirmed: false, status: "pending", amount: charge.amount, description: charge.description }, { headers: corsHeaders });
    }

    // Check IOPay
    const { data: settingsRows } = await supabaseAdmin.from("app_settings").select("key, value").in("key", [
      "iopay_env", "iopay_email", "iopay_secret", "iopay_seller_id",
    ]);
    const settings: Record<string, string> = {};
    (settingsRows || []).forEach((r: any) => { settings[r.key] = r.value; });

    const baseUrl = getBaseUrl(settings);
    const token = await getToken(settings);

    const txResp = await fetch(`${baseUrl}v1/transaction/get/${charge.gateway_transaction_id}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const txRaw = await txResp.json();
    const txData = extractResponseData(txRaw);

    const status = String(txData?.status || txRaw?.status || "unknown").toLowerCase().trim();

    await logCharge(supabaseAdmin, {
      charge_id: charge.id, reference_code, action: "status_check",
      amount: charge.amount, payment_method: charge.payment_method,
      status, gateway_transaction_id: charge.gateway_transaction_id,
      gateway_response: txRaw,
      metadata: { iopay_status: status },
    });

    if (isApproved(status)) {
      await supabaseAdmin.from("custom_charges").update({
        status: "paid",
        paid_at: new Date().toISOString(),
        paid_amount: charge.amount,
      }).eq("id", charge.id);

      await logCharge(supabaseAdmin, {
        charge_id: charge.id, reference_code, action: "paid",
        amount: charge.amount, payment_method: charge.payment_method,
        status: "paid", gateway_transaction_id: charge.gateway_transaction_id,
        gateway_response: txRaw,
      });

      supabaseAdmin.from("payments").insert({
        user_id: charge.created_by,
        amount: charge.amount,
        method: "pix",
        status: "paid",
        payment_type: "custom",
        group_id: null,
        transaction_code: charge.gateway_transaction_id,
        gateway: "iopay",
        notes: `Cobrança personalizada: ${charge.description}`,
      }).then(({ error }: any) => { if (error) console.error("payments error:", error); });

      supabaseAdmin.from("platform_events").insert({
        event_type: "payment",
        title: "Cobrança personalizada paga",
        message: `R$ ${charge.amount.toFixed(2)} — ${charge.description}`,
        metadata: JSON.stringify({ charge_id: charge.id, reference_code, amount: charge.amount }),
        created_by: charge.created_by,
      }).then(({ error }: any) => { if (error) console.error("event error:", error); });

      return Response.json({ confirmed: true, status: "paid", amount: charge.amount, description: charge.description }, { headers: corsHeaders });
    }

    return Response.json({ confirmed: false, status, amount: charge.amount, description: charge.description }, { headers: corsHeaders });

  } catch (e: any) {
    console.error("check-custom-charge error:", e);
    return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
  }
});
