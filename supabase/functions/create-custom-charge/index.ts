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
  if (!resp.ok || !data.access_token) throw new Error("IOPay auth failed: " + JSON.stringify(data));
  return data.access_token;
}

function extractResponseData(data: any): any {
  if (data?.success && typeof data.success === "object") return data.success;
  if (data?.data && typeof data.data === "object") return data.data;
  return data;
}

function extractPixCopyPaste(data: any): string | null {
  if (!data) return null;
  const candidates = [
    data.pix_copy_paste, data.copy_paste, data.pix_payload, data.payload, data.pix_code,
    data.payment_method?.qr_code?.emv, data.payment_method?.pix_copy_paste,
  ];
  for (const c of candidates) {
    if (c && typeof c === "string" && c.length > 20) return c;
  }
  if (data.qr_code && typeof data.qr_code === "object") {
    const emv = data.qr_code.emv || data.qr_code.copy_paste || data.qr_code.text;
    if (emv && typeof emv === "string" && emv.length > 20) return emv;
  }
  return null;
}

function extractId(data: any): string | null {
  if (!data) return null;
  const candidates = [data.id, data.transaction_id, data._id];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== "") return String(c);
  }
  return null;
}

async function fetchPixQrCode(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    const blob = await resp.arrayBuffer();
    const bytes = new Uint8Array(blob);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch { return null; }
}

async function getSettings(supabaseAdmin: any): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from("app_settings").select("key, value").in("key", [
    "iopay_env", "iopay_email", "iopay_secret", "iopay_seller_id",
  ]);
  const settings: Record<string, string> = {};
  (data || []).forEach((row: any) => { settings[row.key] = row.value; });
  return settings;
}

function generateRefCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 10; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

async function logCharge(supabaseAdmin: any, log: {
  charge_id?: string; reference_code: string; admin_id?: string;
  action: string; amount?: number; payment_method?: string; status?: string;
  gateway_transaction_id?: string; gateway_response?: any; ip_address?: string;
  user_agent?: string; metadata?: any;
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
      ip_address: log.ip_address || null,
      user_agent: log.user_agent || null,
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
    const { amount, description, payment_method, admin_id } = body;
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
    const ua = req.headers.get("user-agent") || "";

    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "Valor inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!payment_method || !["pix", "link"].includes(payment_method)) {
      return new Response(JSON.stringify({ error: "Método de pagamento inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!description) {
      return new Response(JSON.stringify({ error: "Descrição é obrigatória" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const refCode = generateRefCode();

    if (payment_method === "link") {
      const { data: charge, error } = await supabaseAdmin.from("custom_charges").insert({
        reference_code: refCode,
        amount: Number(amount),
        description,
        payment_method: "link",
        status: "pending",
        created_by: admin_id || null,
      }).select().single();

      if (error) throw error;

      await logCharge(supabaseAdmin, {
        charge_id: charge.id, reference_code: refCode, admin_id,
        action: "link_generated", amount: Number(amount), payment_method: "link",
        status: "pending", ip_address: ip, user_agent: ua,
        metadata: { description, checkout_url: `https://www.dividepass.com/checkout-link/${refCode}` },
      });

      return new Response(JSON.stringify({
        success: true,
        reference_code: refCode,
        checkout_url: `https://www.dividepass.com/checkout-link/${refCode}`,
        charge_id: charge.id,
        amount: Number(amount),
        description,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // PIX: create IOPay transaction
    const settings = await getSettings(supabaseAdmin);
    if (!settings.iopay_secret || !settings.iopay_email || !settings.iopay_seller_id) {
      return new Response(JSON.stringify({ error: "Credenciais IOPAY não configuradas" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: charge, error: chargeErr } = await supabaseAdmin.from("custom_charges").insert({
      reference_code: refCode,
      amount: Number(amount),
      description,
      payment_method: "pix",
      status: "pending",
      created_by: admin_id || null,
    }).select().single();

    if (chargeErr) throw chargeErr;

    await logCharge(supabaseAdmin, {
      charge_id: charge.id, reference_code: refCode, admin_id,
      action: "created", amount: Number(amount), payment_method: "pix",
      status: "pending", ip_address: ip, user_agent: ua,
      metadata: { description },
    });

    const baseUrl = getBaseUrl(settings);
    const token = await getToken(settings);

    // IOPay requires a customer ID for transaction creation.
    // Custom charges don't belong to a specific user, so we create/reuse a generic customer.
    let customerId: string | null = null;

    // Check if we already have a generic customer stored in app_settings
    const { data: existingSetting } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "iopay_generic_customer_id").maybeSingle();
    customerId = existingSetting?.value || null;

    if (!customerId) {
      const custResp = await fetch(`${baseUrl}v1/customer/new`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: "DividePass",
          email: "cobranca@dividepass.com",
          phone: "",
          address: {
            street: "Rua Sistema",
            number: "0",
            neighborhood: "Centro",
            city: "Sao Paulo",
            state: "SP",
            zipcode: "01000000",
            country: "BR",
          },
        }),
      });
      const custRaw = await custResp.text();
      let custData: any;
      try { custData = JSON.parse(custRaw); } catch { custData = { raw: custRaw }; }
      console.log("IOPay generic customer creation:", JSON.stringify(custData).substring(0, 500));

      // Extract customer ID from response
      const extracted = extractResponseData(custData);
      customerId = extracted?.id || extracted?.customer_id || custData?.id || custData?.customer_id || custData?.data?.id || null;

      if (!customerId) {
        console.error("IOPay generic customer failed:", JSON.stringify(custData).substring(0, 500));
        return new Response(JSON.stringify({ error: "Erro ao criar cliente IOPay para cobrança: " + JSON.stringify(custData).substring(0, 200) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Store for future use
      await supabaseAdmin.from("app_settings").upsert({ key: "iopay_generic_customer_id", value: customerId });
    }

    const txResp = await fetch(`${baseUrl}v1/transaction/new/${customerId}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(Number(amount) * 100),
        currency: "BRL",
        description: description.substring(0, 50),
        statement_descriptor: "DIVIDEPASS",
        io_seller_id: settings.iopay_seller_id,
        payment_type: "pix",
        reference_id: `custom:${refCode}`,
        payment_method: "pix",
      }),
    });

    const rawText = await txResp.text();
    let txRaw: any;
    try { txRaw = JSON.parse(rawText); } catch { txRaw = { raw: rawText }; }
    console.log("IOPay custom charge response:", JSON.stringify(txRaw).substring(0, 2000));

    const txData = extractResponseData(txRaw);
    const txId = extractId(txData) || extractId(txRaw);

    if (!txId) {
      console.error("IOPay no ID found. Raw:", JSON.stringify(txRaw).substring(0, 1000));
      await logCharge(supabaseAdmin, {
        charge_id: charge.id, reference_code: refCode, admin_id,
        action: "payment_error", amount: Number(amount), payment_method: "pix",
        status: "error", ip_address: ip, user_agent: ua,
        gateway_response: txRaw, metadata: { error: "No transaction ID returned" },
      });
      return new Response(JSON.stringify({ error: "Transação criada mas sem ID. Resposta: " + JSON.stringify(txRaw).substring(0, 200) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let pixCopyPaste = extractPixCopyPaste(txData) || extractPixCopyPaste(txRaw);
    let pixQrUrl = txData?.pix_qrcode_url || txRaw?.pix_qrcode_url || txData?.qrcode_link || txRaw?.qrcode_link || null;
    let pixQrBase64 = txData?.pix_qrcode || txRaw?.pix_qrcode || null;

    if (!pixCopyPaste || !pixQrUrl) {
      try {
        const detailResp = await fetch(`${baseUrl}v1/transaction/get/${txId}`, {
          headers: { "Authorization": `Bearer ${token}` },
        });
        const detailText = await detailResp.text();
        let detailRaw: any;
        try { detailRaw = JSON.parse(detailText); } catch { detailRaw = { raw: detailText }; }
        const detailData = extractResponseData(detailRaw);
        pixCopyPaste = extractPixCopyPaste(detailData) || extractPixCopyPaste(detailRaw) || pixCopyPaste;
        pixQrUrl = detailData?.pix_qrcode_url || detailRaw?.pix_qrcode_url || detailData?.qrcode_link || detailRaw?.qrcode_link || pixQrUrl;
        console.log("IOPay details:", JSON.stringify(detailData).substring(0, 1000));
      } catch (e) { console.error("Details fetch error:", e); }
    }

    if (pixQrUrl && !pixQrBase64) {
      pixQrBase64 = await fetchPixQrCode(pixQrUrl);
    }

    await supabaseAdmin.from("custom_charges").update({
      gateway_transaction_id: txId,
      pix_copy_paste: pixCopyPaste || null,
      pix_qrcode_url: pixQrUrl || null,
      pix_qrcode_base64: pixQrBase64 || null,
    }).eq("id", charge.id);

    await logCharge(supabaseAdmin, {
      charge_id: charge.id, reference_code: refCode, admin_id,
      action: "pix_generated", amount: Number(amount), payment_method: "pix",
      status: txData?.status || "pending", gateway_transaction_id: txId,
      gateway_response: txRaw, ip_address: ip, user_agent: ua,
      metadata: { description, has_pix_copy_paste: !!pixCopyPaste, has_qr_code: !!pixQrBase64 },
    });

    return new Response(JSON.stringify({
      success: true,
      charge_id: charge.id,
      reference_code: refCode,
      transaction_id: txId,
      amount: Number(amount),
      description,
      pix_copy_paste: pixCopyPaste,
      pix_qrcode_url: pixQrUrl,
      pix_qrcode: pixQrBase64,
      status: txData?.status || "pending",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("create-custom-charge error:", e);
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      const body = await req.clone().json().catch(() => ({}));
      await logCharge(supabaseAdmin, {
        reference_code: body?.reference_code || "unknown",
        admin_id: body?.admin_id,
        action: "payment_error",
        amount: body?.amount,
        payment_method: body?.payment_method,
        status: "error",
        ip_address: req.headers.get("x-forwarded-for") || "",
        user_agent: req.headers.get("user-agent") || "",
        metadata: { error: e.message },
      });
    } catch (_) {}
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
