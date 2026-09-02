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

async function getAuthToken(settings: Record<string, string>): Promise<string> {
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

async function getCardToken(settings: Record<string, string>): Promise<string> {
  const baseUrl = getBaseUrl(settings);
  const resp = await fetch(`${baseUrl}v1/card/authentication`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: settings.iopay_email, secret: settings.iopay_secret, io_seller_id: settings.iopay_seller_id }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error("IOPay card auth failed: " + JSON.stringify(data));
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

async function getOrCreateCustomer(token: string, settings: Record<string, string>, supabaseAdmin: any): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", "iopay_generic_customer_id").maybeSingle();
  if (existing?.value) return existing.value;

  const baseUrl = getBaseUrl(settings);
  const custResp = await fetch(`${baseUrl}v1/customer/new`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      first_name: "DividePass",
      email: "cobranca@dividepass.com",
      phone: "",
      address: { street: "Rua Sistema", number: "0", neighborhood: "Centro", city: "Sao Paulo", state: "SP", zipcode: "01000000", country: "BR" },
    }),
  });
  const custRaw = await custResp.text();
  let custData: any;
  try { custData = JSON.parse(custRaw); } catch { custData = { raw: custRaw }; }
  const extracted = extractResponseData(custData);
  const customerId = extracted?.id || extracted?.customer_id || custData?.id || custData?.customer_id || custData?.data?.id;
  if (!customerId) throw new Error("Failed to create IOPay customer: " + JSON.stringify(custData).substring(0, 200));
  await supabaseAdmin.from("app_settings").upsert({ key: "iopay_generic_customer_id", value: customerId });
  return customerId;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { reference_code, payment_method, card_number, card_holder_name, card_exp_month, card_exp_year, card_cvv } = body;

    if (!reference_code) {
      return new Response(JSON.stringify({ error: "reference_code obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!payment_method || !["pix", "card"].includes(payment_method)) {
      return new Response(JSON.stringify({ error: "payment_method inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (payment_method === "card" && (!card_number || !card_holder_name || !card_exp_month || !card_exp_year || !card_cvv)) {
      return new Response(JSON.stringify({ error: "Dados do cartão incompletos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Look up charge
    const { data: charge, error: chargeErr } = await supabaseAdmin
      .from("custom_charges").select("*").eq("reference_code", reference_code).maybeSingle();
    if (chargeErr || !charge) {
      return new Response(JSON.stringify({ error: "Cobrança não encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (charge.status === "paid") {
      return new Response(JSON.stringify({ success: true, confirmed: true, message: "Já pago" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (charge.status === "expired") {
      return new Response(JSON.stringify({ error: "Cobrança expirada" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (charge.gateway_transaction_id) {
      return new Response(JSON.stringify({ error: "Pagamento já iniciado. Use a página de status." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const settings = await getSettings(supabaseAdmin);
    if (!settings.iopay_secret || !settings.iopay_email || !settings.iopay_seller_id) {
      return new Response(JSON.stringify({ error: "Credenciais IOPAY não configuradas" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = await getAuthToken(settings);
    const customerId = await getOrCreateCustomer(token, settings, supabaseAdmin);
    const baseUrl = getBaseUrl(settings);

    if (payment_method === "pix") {
      const txResp = await fetch(`${baseUrl}v1/transaction/new/${customerId}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Math.round(Number(charge.amount) * 100),
          currency: "BRL",
          description: (charge.description || "Cobrança").substring(0, 50),
          statement_descriptor: "DIVIDEPASS",
          io_seller_id: settings.iopay_seller_id,
          payment_type: "pix",
          reference_id: `custom:${reference_code}`,
          payment_method: "pix",
        }),
      });

      const rawText = await txResp.text();
      let txRaw: any;
      try { txRaw = JSON.parse(rawText); } catch { txRaw = { raw: rawText }; }

      const txData = extractResponseData(txRaw);
      const txId = extractId(txData) || extractId(txRaw);

      if (!txId) {
        return new Response(JSON.stringify({ error: "Transação criada mas sem ID. Resposta: " + JSON.stringify(txRaw).substring(0, 200) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let pixCopyPaste = extractPixCopyPaste(txData) || extractPixCopyPaste(txRaw);
      let pixQrUrl = txData?.pix_qrcode_url || txRaw?.pix_qrcode_url || txData?.qrcode_link || txRaw?.qrcode_link || null;
      let pixQrBase64 = txData?.pix_qrcode || txRaw?.pix_qrcode || null;

      // Fetch details if missing
      if (!pixCopyPaste || !pixQrUrl) {
        try {
          const detailResp = await fetch(`${baseUrl}v1/transaction/get/${txId}`, { headers: { "Authorization": `Bearer ${token}` } });
          const detailText = await detailResp.text();
          let detailRaw: any;
          try { detailRaw = JSON.parse(detailText); } catch { detailRaw = { raw: detailText }; }
          const detailData = extractResponseData(detailRaw);
          pixCopyPaste = extractPixCopyPaste(detailData) || extractPixCopyPaste(detailRaw) || pixCopyPaste;
          pixQrUrl = detailData?.pix_qrcode_url || detailRaw?.pix_qrcode_url || detailData?.qrcode_link || detailRaw?.qrcode_link || pixQrUrl;
        } catch (e) { console.error("Details fetch error:", e); }
      }

      if (pixQrUrl && !pixQrBase64) {
        pixQrBase64 = await fetchPixQrCode(pixQrUrl);
      }

      await supabaseAdmin.from("custom_charges").update({
        payment_method: "pix",
        gateway_transaction_id: txId,
        pix_copy_paste: pixCopyPaste || null,
        pix_qrcode_url: pixQrUrl || null,
        pix_qrcode_base64: pixQrBase64 || null,
      }).eq("id", charge.id);

      return new Response(JSON.stringify({
        success: true,
        charge_id: charge.id,
        reference_code,
        transaction_id: txId,
        amount: charge.amount,
        description: charge.description,
        pix_copy_paste: pixCopyPaste,
        pix_qrcode_url: pixQrUrl,
        pix_qrcode: pixQrBase64,
        status: txData?.status || "pending",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Card payment
    const cardToken = await getCardToken(settings);

    // Tokenize card
    const year2 = card_exp_year.length === 4 ? card_exp_year.slice(-2) : card_exp_year;
    const month2 = card_exp_month.padStart(2, "0");

    const tokResp = await fetch(`${baseUrl}v1/card/tokenize/token`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${cardToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        card_number: card_number.replace(/\s/g, ""),
        holder_name: card_holder_name,
        expiration_month: month2,
        expiration_year: year2,
        security_code: card_cvv,
      }),
    });
    const tokRaw = await tokResp.text();
    let tokData: any;
    try { tokData = JSON.parse(tokRaw); } catch { tokData = { raw: tokRaw }; }
    const tokExtracted = extractResponseData(tokData);
    const cardTokenId = tokExtracted?.token || tokExtracted?.id || tokData?.token || tokData?.id;
    if (!tokResp.ok || !cardTokenId) {
      return new Response(JSON.stringify({ error: "Tokenização falhou: " + (typeof tokData === "string" ? tokData : JSON.stringify(tokData.message || tokData.error || tokData)).substring(0, 200) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Associate card with customer
    const assocResp = await fetch(`${baseUrl}v1/card/associate_token_with_customer`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${cardToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id_customer: customerId, token: cardTokenId }),
    });
    const assocRaw = await assocResp.text();
    let assocData: any;
    try { assocData = JSON.parse(assocRaw); } catch { assocData = { raw: assocRaw }; }
    const assocExtracted = extractResponseData(assocData);
    const idCard = assocExtracted?.id_card || assocExtracted?.id || assocData?.id_card || assocData?.id;
    if (!assocResp.ok || !idCard) {
      return new Response(JSON.stringify({ error: "Falha ao associar cartão: " + JSON.stringify(assocData).substring(0, 200) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Create card transaction
    const txResp = await fetch(`${baseUrl}v1/transaction/new/${customerId}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(Number(charge.amount) * 100),
        currency: "BRL",
        description: (charge.description || "Cobrança").substring(0, 50),
        statement_descriptor: "DIVIDEPASS",
        io_seller_id: settings.iopay_seller_id,
        reference_id: `custom:${reference_code}`,
        payment_method: "credit_card",
        id_card: idCard,
      }),
    });

    const txRawText = await txResp.text();
    let txRaw: any;
    try { txRaw = JSON.parse(txRawText); } catch { txRaw = { raw: txRawText }; }

    const txData = extractResponseData(txRaw);
    const txId = extractId(txData) || extractId(txRaw);

    if (!txId) {
      return new Response(JSON.stringify({ error: "Transação cartão criada mas sem ID. Resposta: " + JSON.stringify(txRaw).substring(0, 200) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const txStatus = String(txData?.status || txRaw?.status || "pending").toLowerCase().trim();

    await supabaseAdmin.from("custom_charges").update({
      payment_method: "card",
      gateway_transaction_id: txId,
    }).eq("id", charge.id);

    return new Response(JSON.stringify({
      success: true,
      charge_id: charge.id,
      reference_code,
      transaction_id: txId,
      amount: charge.amount,
      description: charge.description,
      status: txStatus,
      card_last4: card_number.replace(/\s/g, "").slice(-4),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("pay-custom-charge error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
