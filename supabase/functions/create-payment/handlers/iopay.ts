// IOPay handler for create-payment
// PIX: transaction → pix_qrcode_url + pix_copy_paste
// Card: check existing card → tokenize if needed → charge with id_card

import { getGatewaySettings } from "./settings.ts";
import { getInitialPaymentStatus } from "./status-helpers.ts";

interface HandlerContext {
  supabaseAdmin: any;
  supabaseUrl: string;
  group_id: string;
  user_id: string;
  billing_cycle: string;
  months: number;
  reason: string;
  referral_code: string | null;
  payment_type: string;
  corsHeaders: Record<string, string>;
  body: any;
}

const IOPAY_PROD = "https://api.iopay.com.br/api/";
const IOPAY_SANDBOX = "https://sandbox.api.iopay.com.br/api/";

let cachedBaseUrl: string | null = null;
let cachedToken: string | null = null;
let cachedTokenExpires = 0;
let cachedCardToken: string | null = null;
let cachedCardTokenExpires = 0;

function getBaseUrl(settings: Record<string, string>): string {
  if (cachedBaseUrl) return cachedBaseUrl;
  cachedBaseUrl = settings.iopay_env === "sandbox" ? IOPAY_SANDBOX : IOPAY_PROD;
  return cachedBaseUrl!;
}

async function getToken(settings: Record<string, string>): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedTokenExpires > now) return cachedToken;

  const baseUrl = getBaseUrl(settings);
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
  if (!resp.ok || !data.access_token) {
    throw new Error(JSON.stringify(data));
  }

  cachedToken = data.access_token;
  cachedTokenExpires = now + ((data.expires_in || 3600) * 1000) - 30000;
  return cachedToken!;
}

async function getCardToken(settings: Record<string, string>): Promise<string> {
  const now = Date.now();
  if (cachedCardToken && cachedCardTokenExpires > now) return cachedCardToken;

  const baseUrl = getBaseUrl(settings);
  const email = settings.iopay_email || "";
  const secret = settings.iopay_secret || "";
  const sellerId = settings.iopay_seller_id || "";

  const resp = await fetch(`${baseUrl}v1/card/authentication`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, secret, io_seller_id: sellerId }),
  });

  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error("Card auth failed: " + JSON.stringify(data));
  }

  cachedCardToken = data.access_token;
  cachedCardTokenExpires = now + ((data.expires_in || 3600) * 1000) - 30000;
  return cachedCardToken!;
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

function extractResponseData(resp: any, data: any): any {
  if (data && typeof data === "object" && data.success && typeof data.success === "object") {
    return data.success;
  }
  if (data && typeof data === "object" && data.data && typeof data.data === "object") {
    return data.data;
  }
  return data;
}

function extractPixCopyPaste(data: any): string | null {
  if (!data) return null;

  const candidates = [
    data.pix_copy_paste,
    data.copy_paste,
    data.pix_payload,
    data.payload,
    data.pix_code,
    data.payment_method?.qr_code?.emv,
    data.payment_method?.pix_copy_paste,
    data.payment_method?.copy_paste,
  ];

  for (const c of candidates) {
    if (c && typeof c === "string" && c.length > 20) {
      console.log("extractPixCopyPaste found:", c.substring(0, 80));
      return c;
    }
  }

  if (data.qr_code && typeof data.qr_code === "string" && data.qr_code.length > 20) {
    return data.qr_code;
  }
  if (data.qr_code && typeof data.qr_code === "object") {
    const emv = data.qr_code.emv || data.qr_code.copy_paste || data.qr_code.text || data.qr_code.payload;
    if (emv && typeof emv === "string" && emv.length > 20) return emv;
  }

  return null;
}

function extractId(data: any): string | null {
  if (!data) return null;
  const candidates = [
    data.id, data.Id, data._id,
    data.transaction_id, data.txId, data.tx_id,
    data.customer_id, data.id_card,
    data.data?.id, data.data?.transaction_id, data.data?.txId,
    data.success?.id, data.success?.transaction_id, data.success?.txId,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== "") return String(c);
  }
  return deepScanId(data);
}

async function apiRequest(
  method: string,
  path: string,
  body: any,
  token: string,
  settings: Record<string, string>,
): Promise<any> {
  const baseUrl = getBaseUrl(settings);

  const resp = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const rawText = await resp.text();
  let data: any;
  try { data = JSON.parse(rawText); } catch { data = { raw: rawText }; }

  console.log(`IOPay ${method} ${path} [${resp.status}] FULL RESPONSE:`, JSON.stringify(data).substring(0, 2000));

  const extracted = extractResponseData(resp, data);
  console.log("IOPay extracted:", JSON.stringify(extracted).substring(0, 500));
  const idFromRaw = extractId(data);
  const idFromExtracted = extractId(extracted);
  const finalId = idFromRaw || idFromExtracted;
  console.log("IOPay ID extraction:", { idFromRaw, idFromExtracted, finalId });

  return { ...extracted, _txId: finalId, _raw: data, _httpStatus: resp.status };
}

async function fetchPixQrCode(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    const blob = await resp.arrayBuffer();
    const bytes = new Uint8Array(blob);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch (e) {
    console.error("Failed to fetch PIX QR code:", e);
    return null;
  }
}

async function listCards(customerId: string, settings: Record<string, string>): Promise<any[]> {
  try {
    const cardToken = await getCardToken(settings);
    const baseUrl = getBaseUrl(settings);
    const resp = await fetch(`${baseUrl}v1/card/list_by_customer/${customerId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${cardToken}`,
        "Content-Type": "application/json",
      },
    });
    const raw = await resp.text();
    let data: any;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    console.log("IOPay list cards response:", raw.substring(0, 500));

    const extracted = extractResponseData(resp, data);
    if (Array.isArray(extracted)) return extracted;
    if (Array.isArray(extracted?.cards)) return extracted.cards;
    if (Array.isArray(data?.cards)) return data.cards;
    if (Array.isArray(data)) return data;
    return [];
  } catch (e) {
    console.error("IOPay list cards error:", e);
    return [];
  }
}

async function tokenizeCard(
  cardData: { card_number: string; holder_name: string; exp_month: string; exp_year: string; cvv: string },
  settings: Record<string, string>,
): Promise<string> {
  const cardToken = await getCardToken(settings);
  const baseUrl = getBaseUrl(settings);

  const year2 = cardData.exp_year.length === 4 ? cardData.exp_year.slice(-2) : cardData.exp_year;
  const month2 = cardData.exp_month.padStart(2, "0");

  const resp = await fetch(`${baseUrl}v1/card/tokenize/token`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cardToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      card_number: cardData.card_number,
      holder_name: cardData.holder_name,
      expiration_month: month2,
      expiration_year: year2,
      security_code: cardData.cvv,
    }),
  });

  const raw = await resp.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { data = { raw }; }

  console.log("IOPay tokenize response:", raw.substring(0, 500));

  const extracted = extractResponseData(resp, data);
  const tokenId = extracted?.token || extracted?.id || data?.token || data?.id;
  if (!resp.ok || !tokenId) {
    throw new Error("Tokenize failed: " + (typeof data === "string" ? data : JSON.stringify(data.message || data.error || data)));
  }
  return tokenId;
}

async function associateCard(customerId: string, token: string, settings: Record<string, string>): Promise<string> {
  const cardToken = await getCardToken(settings);
  const baseUrl = getBaseUrl(settings);

  const resp = await fetch(`${baseUrl}v1/card/associate_token_with_customer`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cardToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id_customer: customerId, token }),
  });

  const raw = await resp.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { data = { raw }; }

  console.log("IOPay associate response:", raw.substring(0, 500));

  const extracted = extractResponseData(resp, data);
  const cardId = extracted?.id_card || extracted?.id || data?.id_card || data?.id;
  if (!resp.ok || !cardId) {
    throw new Error("Associate failed: " + (typeof data === "string" ? data : JSON.stringify(data)));
  }
  return cardId;
}

async function setDefaultCard(customerId: string, cardId: string, settings: Record<string, string>): Promise<void> {
  const cardToken = await getCardToken(settings);
  const baseUrl = getBaseUrl(settings);

  await fetch(`${baseUrl}v1/card/set_default/${customerId}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cardToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id_card: cardId }),
  });
}

async function getTransactionDetails(txId: string, settings: Record<string, string>): Promise<any> {
  try {
    const token = await getToken(settings);
    const baseUrl = getBaseUrl(settings);
    const resp = await fetch(`${baseUrl}v1/transaction/get/${txId}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const raw = await resp.text();
    console.log(`IOPay GET transaction/${txId} [${resp.status}] FULL:`, raw.substring(0, 3000));
    let data: any;
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    const extracted = extractResponseData(resp, data);
    return { ...extracted, _raw: data };
  } catch (e) {
    console.error("Failed to fetch transaction details:", e);
    return null;
  }
}

function deepSearchPixCopyPaste(obj: any, depth = 0): string | null {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  const pixFields = [
    "pix_copy_paste", "copy_paste", "pix_payload", "payload", "pix_code", "code",
    "copia_e_cola", "copiaECola", "pixCopyPaste", "copyPaste", "pixPayload",
    "emv_merchant_account_info", "qr_code_copy_paste", "copy_paste_code",
    "pix_string", "pixString", "boleto_pix", "qr_code_text", "qrCodeText",
  ];
  for (const key of pixFields) {
    if (obj[key] && typeof obj[key] === "string" && obj[key].length > 20) {
      console.log(`deepSearch found pix_copy_paste in key "${key}":`, obj[key].substring(0, 80));
      return obj[key];
    }
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const found = deepSearchPixCopyPaste(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function resolveCard(
  customerId: string,
  cardData: { card_number: string; holder_name: string; exp_month: string; exp_year: string; cvv: string } | null,
  supabaseAdmin: any,
  user_id: string,
  settings: Record<string, string>,
): Promise<string> {
  const existingCards = await listCards(customerId, settings);
  if (existingCards.length > 0) {
    const defaultCard = existingCards.find((c: any) => c.is_default || c.default) || existingCards[0];
    const existingId = defaultCard?.id_card || defaultCard?.id;
    if (existingId) {
      console.log("IOPay reusing existing card:", existingId);
      return existingId;
    }
  }

  if (!cardData) {
    throw new Error("Nenhum cartão salvo. Informe os dados do cartão.");
  }

  console.log("IOPay tokenizing new card...");
  const token = await tokenizeCard(cardData, settings);
  const cardId = await associateCard(customerId, token, settings);
  await setDefaultCard(customerId, cardId, settings);
  console.log("IOPay new card tokenized and associated:", cardId);

  return cardId;
}

export default async function handleIOPay(req: Request, ctx: HandlerContext) {
  const { supabaseAdmin, supabaseUrl, group_id, user_id, billing_cycle, months, reason, referral_code, payment_type, corsHeaders, body: reqBody, coupon_id, discount_amount, final_amount } = ctx;
  const settings = await getGatewaySettings();

  if (!settings.iopay_secret || !settings.iopay_email || !settings.iopay_seller_id) {
    return new Response(
      JSON.stringify({ error: "Credenciais IOPAY não configuradas. Configure no Admin → Configurações." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: group, error: groupError } = await supabaseAdmin
    .from("groups")
    .select("*, service:service_id(*)")
    .eq("id", group_id)
    .single();

  if (groupError || !group) {
    return new Response(JSON.stringify({ error: "Grupo não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const body = reqBody || {};
  const type = payment_type || "subscription";
  const cycle = billing_cycle || group.billing_cycle || "monthly";
  const isCombined = type === "combined";
  const { card_number, card_holder_name, card_exp_month, card_exp_year, card_cvv, payment_method, id_card: selectedCardId } = body;
  const isPix = payment_method === "pix";

  const { data: userProfile } = await supabaseAdmin
    .from("users")
    .select("customer_id_iopay, name, email, phone")
    .eq("id", user_id)
    .maybeSingle();

  let customerId = userProfile?.customer_id_iopay;

  if (!customerId) {
    try {
      const token = await getToken(settings);
      const resp = await fetch(`${getBaseUrl(settings)}v1/customer/new`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          first_name: userProfile?.name || "Cliente",
          email: userProfile?.email || "",
          phone: userProfile?.phone || "",
        }),
      });
      const rawData = await resp.json();
      console.log("IOPay customer creation response:", JSON.stringify(rawData).substring(0, 500));

      const extracted = extractResponseData(resp, rawData);
      customerId = extractId(extracted) || extractId(rawData);

      if (!customerId) {
        customerId = rawData.id || rawData.Id || rawData.customer_id;
      }

      if (customerId) {
        await supabaseAdmin.from("users").update({ customer_id_iopay: customerId }).eq("id", user_id);
      } else {
        throw new Error("Cliente criado sem ID. Resposta: " + JSON.stringify(rawData).substring(0, 200));
      }
    } catch (err: any) {
      console.error("IOPay customer error:", err.message);
      return new Response(JSON.stringify({ error: "Erro ao criar cliente: " + err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  const entranceAmount = Number(group.entrance_fee || 0);
  const subscriptionAmountBase = Number(group.price_per_slot || 0);
  const subMonths = months ? Number(months) : (cycle === "quarterly" ? 3 : cycle === "semiannual" ? 6 : cycle === "annual" ? 12 : cycle === "custom" ? (Number(body.custom_cycle_months) || 1) : 1);
  const subDays = cycle === "days" ? (Number(body.custom_cycle_days) || 1) : 0;
  const subscriptionAmount = subDays > 0 ? subscriptionAmountBase : subscriptionAmountBase * subMonths;
  const totalCombinedAmount = entranceAmount + subscriptionAmount;

  const logAttempt = async (status: string, txId: string | null, response: any, errorMsg?: string) => {
    try {
      let baseAmt: number;
      if (type === "entrance") baseAmt = entranceAmount;
      else if (type === "combined") baseAmt = totalCombinedAmount;
      else baseAmt = subscriptionAmount;
      const finalAmt = (coupon_id && final_amount != null) ? Number(final_amount) : baseAmt;
      const discountAmt = (coupon_id && discount_amount != null) ? Number(discount_amount) : 0;
      await supabaseAdmin.from("payment_attempts").insert({
        user_id, group_id, gateway: "iopay", payment_method: isPix ? "pix" : "card",
        payment_type: type, amount: finalAmt, original_amount: baseAmt, discount_amount: discountAmt,
        coupon_id: coupon_id || null,
        status, gateway_transaction_id: txId, external_reference: externalReference,
        gateway_response: response || {}, error_message: errorMsg || null,
        pix_copy_paste: response?.pix_copy_paste || null, pix_qrcode_url: response?.pix_qrcode_url || null,
      });
    } catch (e) { console.error("payment_attempts insert error:", e); }
  };

  let idCard: string | null = null;
  if (!isPix) {
    if (selectedCardId) {
      idCard = selectedCardId;
      console.log("IOPay using selected card:", idCard);
    } else if (!card_number || !card_holder_name || !card_exp_month || !card_exp_year || !card_cvv) {
      const existingCards = await listCards(customerId, settings);
      if (existingCards.length === 0) {
        return new Response(JSON.stringify({ error: "Dados do cartão incompletos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else {
      let year4 = card_exp_year;
      if (year4.length === 2) year4 = "20" + year4;
      try {
        idCard = await resolveCard(customerId, {
          card_number: card_number.replace(/\s/g, ""),
          holder_name: card_holder_name,
          exp_month: card_exp_month,
          exp_year: year4,
          cvv: card_cvv,
        }, supabaseAdmin, user_id, settings);
      } catch (err: any) {
        console.error("IOPay card flow error:", err.message);
        return new Response(JSON.stringify({ error: "Erro ao processar cartão: " + err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (!idCard) {
      const existingCards = await listCards(customerId, settings);
      if (existingCards.length > 0) {
        const defaultCard = existingCards.find((c: any) => c.is_default || c.default) || existingCards[0];
        idCard = defaultCard?.id_card || defaultCard?.id;
      }
    }
  }

  const externalReference = `${group_id}:${user_id}:${type}`;

  if (type === "invoice") {
    const invoiceId = body.invoice_id;
    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "invoice_id é obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: invoice, error: invErr } = await supabaseAdmin
      .from("invoices").select("*").eq("id", invoiceId).eq("user_id", user_id).single();
    if (invErr || !invoice) {
      return new Response(JSON.stringify({ error: "Fatura não encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (invoice.status === "paid") {
      return new Response(JSON.stringify({ error: "Fatura já foi paga" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const webhookUrl = `${supabaseUrl}/functions/v1/iopay-webhook`;
    const pixBody: any = {
      amount: Math.round(Number(invoice.amount) * 100),
      currency: "BRL",
      description: `Fatura #${invoiceId.slice(0, 8).toUpperCase()}`.substring(0, 50),
      statement_descriptor: "DIVIDEPASS",
      io_seller_id: settings.iopay_seller_id,
      payment_type: "pix",
      reference_id: `invoice:${invoiceId}`,
      payment_method: "pix",
      notification_url: webhookUrl,
    };

    try {
      const token = await getToken(settings);
      const txData = await apiRequest("POST", `v1/transaction/new/${customerId}`, pixBody, token, settings);
      const txId = txData._txId || extractId(txData);

      if (!txId) {
        return new Response(JSON.stringify({ error: "Transação PIX criada mas sem ID." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      await supabaseAdmin.from("invoices").update({
        gateway_transaction_id: txId,
        payment_method: "pix",
      }).eq("id", invoiceId);

      await logAttempt("created", txId, { status: txData.status, payment_method: "pix" });

      return Response.json({
        success: true,
        gateway: "iopay",
        transaction_id: txId,
        status: txData.status || "pending",
        pix_copy_paste: txData.pix_copy_paste || txData.pix?.copy_paste || txData.qr_code?.copy_paste || null,
        pix_qrcode_url: txData.pix_qrcode_url || txData.pix?.qr_code_url || txData.qr_code?.url || null,
        pix_qrcode: txData.pix_qrcode || txData.pix?.qr_code || txData.qr_code?.base64 || null,
        amount: Number(invoice.amount),
        needs_polling: true,
      }, { headers: corsHeaders });

    } catch (e: any) {
      console.error("IOPay PIX invoice error:", e);
      return Response.json({ error: e.message || "Erro ao criar transação PIX" }, { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  if (type === "entrance" || type === "combined") {
    const chargedAmount = isCombined ? totalCombinedAmount : entranceAmount;
    if (entranceAmount <= 0 && !isCombined) {
      return new Response(JSON.stringify({ error: "Este grupo não possui taxa de adesão" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const initialStatus = await getInitialPaymentStatus(supabaseAdmin, group_id, user_id, true);

    const webhookUrl = `${supabaseUrl}/functions/v1/iopay-webhook`;
    const txBody: any = {
      amount: Math.round(chargedAmount * 100),
      currency: "BRL",
      description: isCombined ? `Adesão + 1ª Mensalidade - ${group.name}`.substring(0, 50) : `Taxa de Adesão - ${group.name}`.substring(0, 50),
      statement_descriptor: "DIVIDEPASS",
      io_seller_id: settings.iopay_seller_id,
      payment_type: isPix ? "pix" : "credit",
      reference_id: externalReference,
    };

    if (isPix) {
      txBody.notification_url = webhookUrl;
    }

    if (!isPix) {
      txBody.capture = true;
      txBody.installment_plan = { number_installments: 1 };
      txBody.payment_method = "credit_card";
      if (idCard) txBody.id_card = idCard;
    }

    try {
      const token = await getToken(settings);
      const txData = await apiRequest("POST", `v1/transaction/new/${customerId}`, txBody, token, settings);
      const txId = txData._txId || extractId(txData);

      if (!txId) {
        console.error("IOPay no transaction ID in response:", JSON.stringify(txData).substring(0, 500));
        return new Response(JSON.stringify({ error: "Transação criada mas sem ID de retorno. Verifique seu pagamento." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!isPix) {
        await supabaseAdmin.from("group_members").upsert({
          group_id, user_id, status: "active", payment_status: isCombined ? "awaiting_subscription" : "active",
        }, { onConflict: "group_id, user_id" });
      }

      const txStatus = txData.status || "pending";
      await logAttempt("created", txId, { status: txStatus, payment_method: isPix ? "pix" : "card" });

      let pixCopyPaste = null;
      let pixQrUrl = null;
      let pixQrBase64 = null;

      if (isPix) {
        pixCopyPaste = extractPixCopyPaste(txData);
        pixQrUrl = txData.pix_qrcode_url || txData.qrcode_link || null;
        pixQrBase64 = txData.pix_qrcode || null;

        console.log("PIX entrance initial:", { copyPaste: pixCopyPaste ? pixCopyPaste.substring(0, 80) + "..." : "NULL" });

        const details = await getTransactionDetails(txId, settings);
        if (details) {
          const dCopyPaste = extractPixCopyPaste(details);
          if (dCopyPaste) pixCopyPaste = dCopyPaste;
          pixQrUrl = details.pix_qrcode_url || details.qrcode_link || pixQrUrl;
        }

        if (pixQrUrl && !pixQrBase64) {
          pixQrBase64 = await fetchPixQrCode(pixQrUrl);
        }
      }

      // Cupom registrado via webhook (confirmPayment) após confirmação do pagamento PIX

      return Response.json({
        transaction_id: txId,
        payment_type: type,
        gateway: "iopay",
        payment_method: isPix ? "pix" : "card",
        pix_qrcode: pixQrBase64,
        pix_qrcode_url: pixQrUrl,
        pix_copy_paste: pixCopyPaste,
        status: isPix ? txStatus : "processing",
        needs_polling: !isPix,
        total_amount: isCombined ? totalCombinedAmount : undefined,
        entrance_amount: isCombined ? entranceAmount : undefined,
        subscription_amount: isCombined ? subscriptionAmount : undefined,
        raw: { created: txData },
      }, { headers: corsHeaders });
    } catch (err: any) {
      console.error("IOPay entrance error:", err.message);
      await logAttempt("error", null, {}, err.message).catch(() => {});
      return new Response(JSON.stringify({ error: "Erro ao criar pagamento: " + err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

  } else {
    const { data: member } = await supabaseAdmin
      .from("group_members")
      .select("payment_status, subscription_deadline")
      .eq("group_id", group_id).eq("user_id", user_id).maybeSingle();

    // Para combined, não precisa verificar entrance_fee pois é pago junto
    if (!isCombined) {
      if (member?.payment_status === "expired") {
        return new Response(JSON.stringify({ error: "Prazo expirou. Entre novamente no grupo." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (group.has_entrance_fee && member?.payment_status !== "entrance_paid" && member?.payment_status !== "awaiting_subscription") {
        return new Response(JSON.stringify({ error: "Taxa de entrada ainda não foi paga." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (member?.subscription_deadline && new Date(member.subscription_deadline) < new Date()) {
        await supabaseAdmin.from("group_members").update({ payment_status: "expired", status: "cancelled", left_at: new Date().toISOString() }).eq("group_id", group_id).eq("user_id", user_id);
        return new Response(JSON.stringify({ error: "Prazo de 12h expirou." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (isPix) {
      const monthlyPrice = Number(group.price_per_slot || 0);
      const subMonths = months ? Number(months) : (cycle === "quarterly" ? 3 : cycle === "semiannual" ? 6 : cycle === "annual" ? 12 : cycle === "custom" ? (Number(body.custom_cycle_months) || 1) : 1);
      const subDays = cycle === "days" ? (Number(body.custom_cycle_days) || 1) : 0;
      const subscriptionAmount = subDays > 0 ? monthlyPrice : monthlyPrice * subMonths;
      const chargedSubscriptionAmount = (coupon_id && final_amount != null && discount_amount != null)
        ? Number(final_amount)
        : subscriptionAmount;

      // Check if coupon is recurring to determine the stored subscription amount
      // Non-recurring coupons: charge full price on future cycles (amount = subscriptionAmount)
      // Recurring coupons: keep discounted price on future cycles (amount = chargedSubscriptionAmount)
      let subscriptionStoredAmount = chargedSubscriptionAmount;
      let subscriptionDiscountAmount = (coupon_id && discount_amount != null) ? Number(discount_amount) : 0;
      let subscriptionCouponId = coupon_id || null;
      if (coupon_id && !subscriptionDiscountAmount) subscriptionDiscountAmount = subscriptionAmount - chargedSubscriptionAmount;
      if (coupon_id) {
        try {
          const { data: couponData } = await supabaseAdmin.from("coupons").select("recurring").eq("id", coupon_id).maybeSingle();
          if (couponData && !couponData.recurring) {
            // Non-recurring: future cycles pay full price
            subscriptionStoredAmount = subscriptionAmount;
            subscriptionDiscountAmount = 0;
            subscriptionCouponId = null;
            console.log("PIX coupon NOT recurring — future cycles will charge full amount:", subscriptionAmount);
          } else {
            console.log("PIX coupon IS recurring — future cycles will charge discounted amount:", chargedSubscriptionAmount);
          }
        } catch (e) { console.error("Coupon recurring check error:", e); }
      }

      console.log("PIX subscription:", { monthlyPrice, subMonths, subDays, subscriptionAmount, chargedSubscriptionAmount, subscriptionStoredAmount, cycle, isCombined });

      const webhookUrl = `${supabaseUrl}/functions/v1/iopay-webhook`;
      const pixBody: any = {
        amount: Math.round(chargedSubscriptionAmount * 100),
        currency: "BRL",
        description: (reason || "Assinatura").substring(0, 50),
        statement_descriptor: "DIVIDEPASS",
        io_seller_id: settings.iopay_seller_id,
        payment_type: "pix",
        reference_id: externalReference,
        payment_method: "pix",
        notification_url: webhookUrl,
      };

      try {
        const token = await getToken(settings);
        const txData = await apiRequest("POST", `v1/transaction/new/${customerId}`, pixBody, token, settings);
        const txId = txData._txId || extractId(txData);

        if (!txId) {
          return new Response(JSON.stringify({ error: "Transação PIX criada mas sem ID." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const cycleDays = subDays;
        const cycleMonths = subMonths;
        const nextChargeAt = new Date();
        if (cycleDays > 0) {
          nextChargeAt.setDate(nextChargeAt.getDate() + cycleDays);
        } else {
          nextChargeAt.setMonth(nextChargeAt.getMonth() + cycleMonths);
        }

        await supabaseAdmin.from("user_subscriptions").upsert({
          user_id, group_id, service_id: group.service_id, billing_cycle: cycle, amount: subscriptionStoredAmount,
          original_amount: subscriptionAmount,
          discount_amount: subscriptionDiscountAmount,
          coupon_id: subscriptionCouponId,
          status: "pending", gateway: "iopay", payment_method: isPix ? "pix" : "credit_card", gateway_subscription_id: txId, external_reference: externalReference, started_at: new Date().toISOString(),
          custom_cycle_months: cycle === "custom" ? Number(body.custom_cycle_months) || null : null,
          custom_cycle_days: cycle === "days" ? Number(body.custom_cycle_days) || null : null,
          custom_cycle_label: body.custom_cycle_label || null,
          next_charge_at: nextChargeAt.toISOString(),
          billing_status: "active",
        }, { onConflict: "user_id, group_id" });

        // Cupom registrado via webhook (confirmPayment) após confirmação do pagamento PIX

        await supabaseAdmin.from("invoices").insert({
          user_id, group_id, amount: chargedSubscriptionAmount,
          due_date: nextChargeAt.toISOString().split("T")[0],
          status: "pending", payment_method: "pix",
        });

        await logAttempt("created", txId, { status: txData.status, payment_method: "pix" });

        let pixCopyPaste = extractPixCopyPaste(txData);
        let pixQrUrl = txData.pix_qrcode_url || txData.qrcode_link || null;
        let pixQrBase64 = txData.pix_qrcode || null;

        console.log("PIX sub initial:", { copyPaste: pixCopyPaste ? pixCopyPaste.substring(0, 80) + "..." : "NULL", qrUrl: pixQrUrl || "NULL" });

        const details = await getTransactionDetails(txId, settings);
        if (details) {
          const dCopyPaste = extractPixCopyPaste(details);
          if (dCopyPaste) pixCopyPaste = dCopyPaste;
          pixQrUrl = details.pix_qrcode_url || details.qrcode_link || pixQrUrl;
          console.log("PIX sub details:", { copyPaste: pixCopyPaste ? pixCopyPaste.substring(0, 80) + "..." : "NULL" });
        }

        if (pixQrUrl && !pixQrBase64) {
          pixQrBase64 = await fetchPixQrCode(pixQrUrl);
        }

        return Response.json({
          success: true,
          gateway: "iopay",
          transaction_id: txId,
          status: txData.status || "pending",
          pix_copy_paste: pixCopyPaste,
          pix_qrcode_url: pixQrUrl,
          pix_qrcode: pixQrBase64,
          amount: chargedSubscriptionAmount,
          needs_polling: true,
          payment_type: type,
          total_amount: isCombined ? totalCombinedAmount : undefined,
          entrance_amount: isCombined ? entranceAmount : undefined,
          subscription_amount: isCombined ? subscriptionAmount : undefined,
        }, { headers: corsHeaders });

      } catch (e: any) {
        console.error("IOPay PIX subscription error:", e);
        return Response.json({ error: e.message || "Erro ao criar transação PIX" }, { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const monthlyPrice = Number(group.price_per_slot || 0);
    const subMonths = months ? Number(months) : (cycle === "quarterly" ? 3 : cycle === "semiannual" ? 6 : cycle === "annual" ? 12 : cycle === "custom" ? (Number(body.custom_cycle_months) || 1) : 1);
    const subDays = cycle === "days" ? (Number(body.custom_cycle_days) || 1) : 0;
    const subscriptionAmount = subDays > 0 ? monthlyPrice : monthlyPrice * subMonths;
    const chargedSubscriptionAmount = (coupon_id && final_amount != null && discount_amount != null)
      ? Number(final_amount)
      : subscriptionAmount;

    // Check if coupon is recurring (same logic as PIX path)
    let cardSubscriptionStoredAmount = chargedSubscriptionAmount;
    let cardSubscriptionDiscountAmount = (coupon_id && discount_amount != null) ? Number(discount_amount) : 0;
    let cardSubscriptionCouponId = coupon_id || null;
    if (coupon_id && !cardSubscriptionDiscountAmount) cardSubscriptionDiscountAmount = subscriptionAmount - chargedSubscriptionAmount;
    if (coupon_id) {
      try {
        const { data: couponData } = await supabaseAdmin.from("coupons").select("recurring").eq("id", coupon_id).maybeSingle();
        if (couponData && !couponData.recurring) {
          cardSubscriptionStoredAmount = subscriptionAmount;
          cardSubscriptionDiscountAmount = 0;
          cardSubscriptionCouponId = null;
          console.log("Card coupon NOT recurring — future cycles will charge full amount:", subscriptionAmount);
        }
      } catch (e) { console.error("Card coupon recurring check error:", e); }
    }

    const txBody: any = {
      amount: Math.round(isCombined ? totalCombinedAmount * 100 : chargedSubscriptionAmount * 100),
      currency: "BRL",
      description: isCombined ? `Adesão + 1ª Mensalidade - ${group.name}`.substring(0, 50) : (reason || "Assinatura").substring(0, 50),
      statement_descriptor: "DIVIDEPASS",
      io_seller_id: settings.iopay_seller_id,
      payment_type: "credit",
      reference_id: externalReference,
      capture: true,
      installment_plan: { number_installments: 1 },
      payment_method: "credit_card",
    };

    if (idCard) txBody.id_card = idCard;

    try {
      const token = await getToken(settings);
      const txData = await apiRequest("POST", `v1/transaction/new/${customerId}`, txBody, token, settings);
      const txId = txData._txId || extractId(txData);

      if (!txId) {
        console.error("IOPay no transaction ID in response:", JSON.stringify(txData).substring(0, 500));
        return new Response(JSON.stringify({ error: "Transação criada mas sem ID de retorno. Verifique seu pagamento." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Calcular next_charge_at baseado no ciclo
      const cycleDays = cycle === "days" ? (Number(body.custom_cycle_days) || 1) : 0;
      const cycleMonths = cycle === "quarterly" ? 3 : cycle === "semiannual" ? 6 : cycle === "annual" ? 12 : cycle === "custom" ? (Number(body.custom_cycle_months) || 1) : 1;
      const nextChargeAt = new Date();
      if (cycleDays > 0) {
        nextChargeAt.setDate(nextChargeAt.getDate() + cycleDays);
      } else {
        nextChargeAt.setMonth(nextChargeAt.getMonth() + cycleMonths);
      }

      // Buscar last4 e brand do cartao para salvar
      let cardLast4: string | null = null;
      let cardBrand: string | null = null;
      if (idCard) {
        try {
          const existingCards = await listCards(customerId, settings);
          const matched = existingCards.find((c: any) => (c.id_card || c.id) === idCard);
          if (matched) {
            cardLast4 = matched.last4_digits || matched.last4 || null;
            cardBrand = matched.card_brand || matched.brand || null;
          }
        } catch (e) { console.error("Card info fetch error:", e); }
      }

      await supabaseAdmin.from("user_subscriptions").upsert({
        user_id, group_id, service_id: group.service_id, billing_cycle: cycle, amount: cardSubscriptionStoredAmount,
        original_amount: subscriptionAmount,
        discount_amount: cardSubscriptionDiscountAmount,
        coupon_id: cardSubscriptionCouponId,
        status: "pending", gateway: "iopay", payment_method: isPix ? "pix" : "credit_card", gateway_subscription_id: txId, external_reference: externalReference, started_at: new Date().toISOString(),
        custom_cycle_months: cycle === "custom" ? Number(body.custom_cycle_months) || null : null,
        custom_cycle_days: cycle === "days" ? Number(body.custom_cycle_days) || null : null,
        custom_cycle_label: body.custom_cycle_label || null,
        card_id: idCard || null,
        card_last4: cardLast4,
        card_brand: cardBrand,
        next_charge_at: nextChargeAt.toISOString(),
        billing_status: "active",
      }, { onConflict: "user_id, group_id" });

      // Cupom registrado via polling (confirmIOPayment em check-iopay-tx) após confirmação do pagamento cartão

      try {
        await supabaseAdmin.from("group_members").upsert({
          group_id, user_id, status: "active", payment_status: "active",
        }, { onConflict: "group_id, user_id" });
      } catch (gmErr) {
        console.error("[create-payment] Card sub group_members upsert error:", gmErr);
      }

      // Criar invoice para proximo vencimento
      try {
        await supabaseAdmin.from("invoices").insert({
          user_id, group_id, amount: chargedSubscriptionAmount,
          due_date: nextChargeAt.toISOString().split("T")[0],
          status: "pending",
        });
      } catch (e) { console.error("Invoice create error:", e); }

      const txStatus = txData.status || "pending";
      await logAttempt("created", txId, { status: txStatus, payment_method: "card" });

      if (referral_code) {
        try {
          const { data: referrer } = await supabaseAdmin.from("user_referral_codes").select("user_id").eq("referral_code", referral_code).maybeSingle();
          if (referrer && referrer.user_id !== user_id) {
            const existing = await supabaseAdmin.from("referrals").select("id").eq("invitee_id", user_id).eq("referral_code", referral_code).maybeSingle();
            if (!existing.data) {
              await supabaseAdmin.from("referrals").insert({ referrer_id: referrer.user_id, invitee_id: user_id, referral_code, group_id, status: "pending", points: 10 });
            }
          }
        } catch (e) { console.error("Referral error:", e); }
      }

      return Response.json({
        transaction_id: txId,
        payment_type: type,
        gateway: "iopay",
        payment_method: "card",
        status: "processing",
        needs_polling: true,
        total_amount: isCombined ? totalCombinedAmount : undefined,
        entrance_amount: isCombined ? entranceAmount : undefined,
        subscription_amount: isCombined ? subscriptionAmount : undefined,
        raw: { created: txData },
      }, { headers: corsHeaders });
    } catch (err: any) {
      console.error("IOPay subscription error:", err.message);
      await logAttempt("error", null, {}, err.message).catch(() => {});
      return new Response(JSON.stringify({ error: "Erro ao criar pagamento: " + err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }
}
