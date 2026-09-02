// PagarMe handler for create-payment — V5 API
// Auth: Basic Auth (secret_key: )
// One-time: POST /orders
// Subscription: POST /plans + POST /subscriptions
// PIX and credit card

import { getInitialPaymentStatus } from "./status-helpers.ts";

import { getGatewaySettings } from "./settings.ts";

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

const PM_BASE = "https://api.pagar.me/core/v5";

function basicAuth(secretKey: string): string {
  return "Basic " + btoa(secretKey + ":");
}

async function pmPost(path: string, body: any, secretKey: string): Promise<any> {
  const url = `${PM_BASE}${path}`;
  console.log(`PagarMe POST ${path}`, JSON.stringify(body).substring(0, 400));

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": basicAuth(secretKey),
    },
    body: JSON.stringify(body),
  });

  const raw = await resp.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { data = { raw }; }

  console.log(`PagarMe response [${resp.status}]:`, raw.substring(0, 600));

  if (!resp.ok) {
    console.error("PagarMe API error:", resp.status, raw);
    let errMsg = `HTTP ${resp.status}: `;
    if (data.message) {
      errMsg += data.message;
    }
    if (data.errors) {
      errMsg += " " + Object.entries(data.errors).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("; ");
    }
    if (!data.message && !data.errors) {
      errMsg += raw.substring(0, 300);
    }
    throw new Error(errMsg);
  }

  return data;
}

async function pmGet(path: string, secretKey: string): Promise<any> {
  const url = `${PM_BASE}${path}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": basicAuth(secretKey),
    },
  });
  const raw = await resp.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { data = { raw }; }
  console.log(`PagarMe GET ${path} [${resp.status}]:`, raw.substring(0, 400));
  return data;
}

export default async function handlePagarMe(req: Request, ctx: HandlerContext) {
  const { supabaseAdmin, supabaseUrl, group_id, user_id, billing_cycle, months, reason, referral_code, payment_type, corsHeaders } = ctx;
  const settings = await getGatewaySettings();
  const secretKey = (settings.pagarme_secret_key || "").trim();

  console.log("PagarMe settings check:", {
    has_secret_key: !!secretKey,
    secret_key_prefix: secretKey ? secretKey.substring(0, 10) : "EMPTY",
    secret_key_length: secretKey.length,
    all_pagarme_keys: Object.keys(settings).filter(k => k.startsWith("pagarme")),
  });

  if (!secretKey) {
    return new Response(
      JSON.stringify({ error: "Chave Secreta do Pagar.me não configurada. Configure no Admin → Configurações → Pagar.me → Chave Secreta." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate key format
  if (!secretKey.startsWith("sk_")) {
    return new Response(
      JSON.stringify({ error: `Formato de chave inválido. Deve começar com "sk_". Você enviou: "${secretKey.substring(0, 15)}..."` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("PagarMe auth test:", basicAuth(secretKey).substring(0, 30) + "...");

  const body = ctx.body || {};
  const type = payment_type || "subscription";
  const cycle = billing_cycle || group.billing_cycle || "monthly";
  const { card_number, card_holder_name, card_exp_month, card_exp_year, card_cvv, payment_method } = body;
  const isPix = payment_method === "pix";

  // Get group
  const { data: group, error: groupError } = await supabaseAdmin
    .from("groups")
    .select("*, service:service_id(*)")
    .eq("id", group_id)
    .single();

  if (groupError || !group) {
    return new Response(JSON.stringify({ error: "Grupo não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Ensure customer exists
  const { data: userProfile } = await supabaseAdmin
    .from("users")
    .select("customer_id_pagarme, name, email, phone")
    .eq("id", user_id)
    .maybeSingle();

  let customerId = userProfile?.customer_id_pagarme;

  if (!customerId) {
    try {
      const customerPayload: any = {
        name: userProfile?.name || "Cliente",
        type: "individual",
      };
      if (userProfile?.email) customerPayload.email = userProfile.email;

      // Only add phone if valid
      const cleanPhone = (userProfile?.phone || "").replace(/\D/g, "");
      if (cleanPhone.length >= 10) {
        const areaCode = cleanPhone.substring(0, 2);
        const number = cleanPhone.substring(2);
        customerPayload.phones = {
          mobile_phone: {
            country_code: "55",
            area_code: areaCode,
            number: number,
          },
        };
      }

      console.log("PagarMe creating customer:", JSON.stringify(customerPayload));
      const custData = await pmPost("/customers", customerPayload, secretKey);

      customerId = custData.id;
      if (customerId) {
        await supabaseAdmin.from("users").update({ customer_id_pagarme: customerId }).eq("id", user_id);
      }
    } catch (err: any) {
      console.error("PagarMe customer creation error:", err.message);
      const errorMsg = err.message.includes("Erro ao criar pagamento") ? err.message : `Erro ao criar cliente: ${err.message}`;
      return new Response(JSON.stringify({ error: errorMsg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  // Record gateway
  await supabaseAdmin.from("group_members").update({ payment_status: initialStatus }).eq("group_id", group_id).eq("user_id", user_id);

  const webhookUrl = `${supabaseUrl}/functions/v1/pagarme-webhook`;
  const code = `${group_id.substring(0, 8)}_${user_id.substring(0, 4)}_${type}`;

  if (type === "entrance") {
    const entranceAmount = Number(group.entrance_fee || 0);
    if (entranceAmount <= 0) {
      return new Response(JSON.stringify({ error: "Este grupo não possui taxa de adesão" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const initialStatus = await getInitialPaymentStatus(supabaseAdmin, group_id, user_id, true);

    const orderBody: any = {
      code,
      customer_id: customerId,
      items: [
        {
          amount: Math.round(entranceAmount * 100),
          description: `Taxa de Adesão - ${group.name}`,
          quantity: 1,
          code: `entrance_${group_id.substring(0, 8)}`,
        },
      ],
      payments: [],
      metadata: { group_id, user_id, type: "entrance" },
      closed: true,
    };

    if (isPix) {
      orderBody.payments.push({
        payment_method: "pix",
        pix: {
          expires_in: 3600,
        },
      });
    } else {
      if (!card_number || !card_holder_name || !card_exp_month || !card_exp_year || !card_cvv) {
        return new Response(JSON.stringify({ error: "Dados do cartão incompletos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const expYear = card_exp_year.length === 2 ? parseInt("20" + card_exp_year, 10) : parseInt(card_exp_year, 10);
      orderBody.payments.push({
        payment_method: "credit_card",
        credit_card: {
          installments: 1,
          statement_descriptor: "DIVIDEPASS",
          card: {
            number: card_number.replace(/\s/g, ""),
            holder_name: card_holder_name,
            exp_month: parseInt(card_exp_month, 10),
            exp_year: expYear,
            cvv: card_cvv,
          },
        },
      });
    }

    try {
      const txData = await pmPost("/orders", orderBody, secretKey);
      const txId = txData.id;
      const lastTx = txData.last_transaction || {};

      await supabaseAdmin.from("group_members").update({ status: "active", payment_status: "active" }).eq("group_id", group_id).eq("user_id", user_id);

      let pixQrBase64 = null;
      let pixCopyPaste = null;
      let pixQrUrl = null;

      if (isPix) {
        pixQrBase64 = lastTx.qr_code || lastTx.pix_qr_code || null;
        pixCopyPaste = lastTx.pix_copy_paste || lastTx.copy_paste || lastTx.payload || null;
        pixQrUrl = lastTx.qr_code_url || lastTx.pix_qr_code_url || null;

        // If QR code is a URL, fetch as base64
        if (pixQrUrl && !pixQrBase64) {
          try {
            const qrResp = await fetch(pixQrUrl);
            const blob = await qrResp.arrayBuffer();
            const bytes = new Uint8Array(blob);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
            pixQrBase64 = btoa(binary);
          } catch (e) { console.error("Failed to fetch PIX QR:", e); }
        }
      }

      return Response.json({
        transaction_id: txId,
        payment_type: "entrance",
        gateway: "pagarme",
        payment_method: isPix ? "pix" : "card",
        pix_qrcode: pixQrBase64,
        pix_qrcode_url: pixQrUrl,
        pix_copy_paste: pixCopyPaste,
        status: txData.status || "pending",
        init_point: null,
      }, { headers: corsHeaders });
    } catch (err: any) {
      console.error("PagarMe entrance error:", err.message);
      return new Response(JSON.stringify({ error: "Erro ao criar pagamento: " + err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

  } else {
    // ── Subscription ──
    const { data: member } = await supabaseAdmin
      .from("group_members")
      .select("payment_status, subscription_deadline")
      .eq("group_id", group_id).eq("user_id", user_id).maybeSingle();

    if (member?.payment_status === "expired") {
      return new Response(JSON.stringify({ error: "Prazo expirou. Entre novamente no grupo." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (group.has_entrance_fee && member?.payment_status !== "entrance_paid" && member?.payment_status !== "awaiting_subscription") {
      return new Response(JSON.stringify({ error: "Taxa de entrada ainda não foi paga." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const subscriptionAmount = group.price_per_slot;
    const intervalMap: Record<string, { interval: string; interval_count: number }> = {
      monthly: { interval: "month", interval_count: 1 },
      quarterly: { interval: "month", interval_count: 3 },
      semiannual: { interval: "month", interval_count: 6 },
      annual: { interval: "year", interval_count: 1 },
    };
    const cycleConfig = intervalMap[cycle] || { interval: "month", interval_count: 1 };

    const planCode = `plan_${group_id.substring(0, 8)}_${cycle}`;
    let planId: string | null = null;

    // Check if plan already cached in app_settings
    const { data: cachedPlan } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", `pagarme_plan_${planCode}`)
      .maybeSingle();

    if (cachedPlan?.value) {
      planId = cachedPlan.value;
    } else {
      // Create plan
      try {
        const planData = await pmPost("/plans", {
          name: `DividePass - ${group.name} (${cycle})`,
          description: reason,
          currency: "BRL",
          interval: cycleConfig.interval,
          interval_count: cycleConfig.interval_count,
          billing_type: "prepaid",
          minimum_price: Math.round(subscriptionAmount * 100),
          payment_methods: isPix ? ["pix"] : ["credit_card"],
          items: [
            {
              name: group.name,
              quantity: 1,
              pricing_scheme: {
                scheme_type: "unit",
                price: Math.round(subscriptionAmount * 100),
              },
            },
          ],
          metadata: { group_id, cycle },
        }, secretKey);

        planId = planData.id;
        // Cache plan in app_settings
        await supabaseAdmin.from("app_settings").upsert({ key: `pagarme_plan_${planCode}`, value: planId }, { onConflict: "key" });
      } catch (err: any) {
        console.error("PagarMe plan error:", err.message);
        return new Response(JSON.stringify({ error: "Erro ao criar plano: " + err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Create subscription
    const subBody: any = {
      plan_id: planId,
      customer_id: customerId,
      payment_method: isPix ? "pix" : "credit_card",
      code,
      metadata: { group_id, user_id, type: "subscription" },
    };

    if (!isPix) {
      if (!card_number || !card_holder_name || !card_exp_month || !card_exp_year || !card_cvv) {
        return new Response(JSON.stringify({ error: "Dados do cartão incompletos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const expYear = card_exp_year.length === 2 ? parseInt("20" + card_exp_year, 10) : parseInt(card_exp_year, 10);
      subBody.card = {
        number: card_number.replace(/\s/g, ""),
        holder_name: card_holder_name,
        exp_month: parseInt(card_exp_month, 10),
        exp_year: expYear,
        cvv: card_cvv,
      };
    }

    try {
      const subData = await pmPost("/subscriptions", subBody, secretKey);
      const subId = subData.id;

      await supabaseAdmin.from("user_subscriptions").upsert({
        user_id, group_id, service_id: group.service_id, billing_cycle: cycle, amount: subscriptionAmount,
        status: "pending", gateway: "pagarme", payment_method: body.payment_method || null, gateway_subscription_id: subId, external_reference: `${group_id}:${user_id}:subscription`, started_at: new Date().toISOString(),
        custom_cycle_months: cycle === "custom" ? (Number(body.custom_cycle_months) || null) : null,
        custom_cycle_days: cycle === "days" ? (Number(body.custom_cycle_days) || null) : null,
        custom_cycle_label: body.custom_cycle_label || null,
      }, { onConflict: "user_id, group_id" });

      await supabaseAdmin.from("group_members").update({ payment_status: "awaiting_subscription" }).eq("group_id", group_id).eq("user_id", user_id);

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

      // For PIX subscriptions, get the charge's QR code from current_cycle
      let pixQrBase64 = null;
      let pixCopyPaste = null;
      let pixQrUrl = null;

      if (isPix && subData.current_cycle) {
        try {
          // Fetch the current charge details
          const chargeData = await pmGet(`/subscriptions/${subId}/charges`, secretKey);
          const charges = chargeData.data || chargeData;
          const currentCharge = Array.isArray(charges) ? charges[0] : null;
          if (currentCharge?.last_transaction) {
            pixQrBase64 = currentCharge.last_transaction.qr_code || currentCharge.last_transaction.pix_qr_code || null;
            pixCopyPaste = currentCharge.last_transaction.pix_copy_paste || currentCharge.last_transaction.copy_paste || null;
            pixQrUrl = currentCharge.last_transaction.qr_code_url || currentCharge.last_transaction.pix_qr_code_url || null;
          }
        } catch (e) {
          console.error("Failed to fetch PIX charge details:", e);
        }
      }

      return Response.json({
        transaction_id: subId,
        payment_type: "subscription",
        gateway: "pagarme",
        payment_method: isPix ? "pix" : "card",
        pix_qrcode: pixQrBase64,
        pix_qrcode_url: pixQrUrl,
        pix_copy_paste: pixCopyPaste,
        status: subData.status || "pending",
        init_point: null,
      }, { headers: corsHeaders });
    } catch (err: any) {
      console.error("PagarMe subscription error:", err.message);
      return new Response(JSON.stringify({ error: "Erro ao criar assinatura: " + err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }
}
