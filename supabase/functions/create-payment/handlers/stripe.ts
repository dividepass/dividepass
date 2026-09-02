// Stripe handler for create-payment

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

export default async function handleStripe(req: Request, ctx: HandlerContext) {
  const { supabaseAdmin, supabaseUrl, group_id, user_id, billing_cycle, months, reason, referral_code, payment_type, corsHeaders } = ctx;
  const settings = await getGatewaySettings();
  const stripeSecretKey = settings.stripe_secret_key || Deno.env.get("STRIPE_SECRET_KEY") || "";

  if (!stripeSecretKey) {
    throw new Error("Chave Secreta do Stripe não configurada. Configure no Admin → Configurações → Stripe → Chave Secreta.");
  }

  const body = ctx.body || {};
  const type = payment_type || "subscription";
  const cycleMonths = months && months > 0 ? months : 1;
  const cycle = billing_cycle || group.billing_cycle || "monthly";

  const { data: group, error: groupError } = await supabaseAdmin
    .from("groups")
    .select("*, service:service_id(*)")
    .eq("id", group_id)
    .single();

  if (groupError || !group) {
    return new Response(
      JSON.stringify({ error: "Grupo não encontrado" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const stripeHeaders = {
    "Authorization": `Bearer ${stripeSecretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const successUrl = `https://dividepass.com/dashboard/credentials?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `https://dividepass.com/checkout/${group.slug || group_id}`;

  if (type === "entrance") {
    const entranceAmount = Number(group.entrance_fee || 0);

    if (entranceAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Este grupo não possui taxa de adesão" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const initialStatus = await getInitialPaymentStatus(supabaseAdmin, group_id, user_id, true);

    // Create Stripe Checkout Session for one-time payment
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("payment_method_types[0]", "card");
    params.append("payment_method_types[1]", "pix");
    params.append("line_items[0][price_data][currency]", "brl");
    params.append("line_items[0][price_data][product_data][name]", `Taxa de Adesão - ${group.name}`);
    params.append("line_items[0][price_data][product_data][description]", `Pagamento único da taxa de adesão para o grupo ${group.name}`);
    params.append("line_items[0][price_data][unit_amount]", String(Math.round(entranceAmount * 100)));
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);
    params.append("client_reference_id", `${group_id}:${user_id}:entrance`);
    params.append("metadata[group_id]", group_id);
    params.append("metadata[user_id]", user_id);
    params.append("metadata[payment_type]", "entrance");
    params.append("metadata[reason]", reason);

    const sessionResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: stripeHeaders,
      body: params.toString(),
    });

    const sessionData = await sessionResp.json();

    if (!sessionResp.ok) {
      console.error("Stripe entrance error:", sessionData);
      const errMsg = sessionData?.error?.message || sessionData?.message || JSON.stringify(sessionData);
      return new Response(
        JSON.stringify({ error: "Erro ao criar sessão: " + errMsg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return Response.json(
      {
        init_point: sessionData.url,
        session_id: sessionData.id,
        payment_type: "entrance",
        gateway: "stripe",
      },
      { headers: corsHeaders }
    );

  } else {
    // Subscription
    const { data: member } = await supabaseAdmin
      .from("group_members")
      .select("payment_status, subscription_deadline")
      .eq("group_id", group_id)
      .eq("user_id", user_id)
      .maybeSingle();

    if (member?.payment_status === "expired") {
      return new Response(
        JSON.stringify({ error: "Prazo expirou. Entre novamente no grupo." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (group.has_entrance_fee && member?.payment_status !== "entrance_paid" && member?.payment_status !== "awaiting_subscription") {
      return new Response(
        JSON.stringify({ error: "Taxa de entrada ainda não foi paga." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (member?.subscription_deadline && new Date(member.subscription_deadline) < new Date()) {
      await supabaseAdmin
        .from("group_members")
        .update({ payment_status: "expired", status: "cancelled", left_at: new Date().toISOString() })
        .eq("group_id", group_id)
        .eq("user_id", user_id);

      return new Response(
        JSON.stringify({ error: "Prazo de 12h expirou." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const subscriptionAmount = group.price_per_slot;

    // Map cycle to Stripe interval
    let interval = "month";
    let intervalCount = 1;
    if (cycle === "quarterly") { interval = "month"; intervalCount = 3; }
    else if (cycle === "semiannual") { interval = "month"; intervalCount = 6; }
    else if (cycle === "annual") { interval = "year"; intervalCount = 1; }

    // Create or get Stripe Price
    const priceKey = `stripe_price_${subscriptionAmount}_${interval}_${intervalCount}`;
    const { data: existingPrice } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", priceKey)
      .maybeSingle();

    let priceId = existingPrice?.value;

    if (!priceId) {
      // Create product + price
      const productParams = new URLSearchParams();
      productParams.append("name", reason);

      const productResp = await fetch("https://api.stripe.com/v1/products", {
        method: "POST",
        headers: stripeHeaders,
        body: productParams.toString(),
      });
      const productData = await productResp.json();

      if (!productResp.ok) {
        return new Response(
          JSON.stringify({ error: "Erro ao criar produto", details: productData }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const priceParams = new URLSearchParams();
      priceParams.append("product", productData.id);
      priceParams.append("currency", "brl");
      priceParams.append("unit_amount", String(Math.round(subscriptionAmount * 100)));
      priceParams.append("recurring[interval]", interval);
      priceParams.append("recurring[interval_count]", String(intervalCount));

      const priceResp = await fetch("https://api.stripe.com/v1/prices", {
        method: "POST",
        headers: stripeHeaders,
        body: priceParams.toString(),
      });
      const priceData = await priceResp.json();

      if (!priceResp.ok) {
        return new Response(
          JSON.stringify({ error: "Erro ao criar preço", details: priceData }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      priceId = priceData.id;

      await supabaseAdmin.from("app_settings").upsert({
        key: priceKey,
        value: priceId,
      }, { onConflict: "key" });
    }

    await supabaseAdmin
      .from("user_subscriptions")
      .upsert({
        user_id,
        group_id,
        service_id: group.service_id,
        billing_cycle: cycle,
        amount: subscriptionAmount,
        status: "pending",
        gateway: "stripe",
        payment_method: body.payment_method || null,
        external_reference: `${group_id}:${user_id}:subscription`,
        started_at: new Date().toISOString(),
        custom_cycle_months: cycle === "custom" ? (Number(body.custom_cycle_months) || null) : null,
        custom_cycle_days: cycle === "days" ? (Number(body.custom_cycle_days) || null) : null,
        custom_cycle_label: body.custom_cycle_label || null,
      }, { onConflict: "user_id, group_id" });

    await supabaseAdmin
      .from("group_members")
      .update({ payment_status: "awaiting_subscription", gateway: "stripe" })
      .eq("group_id", group_id)
      .eq("user_id", user_id);

    // Create Stripe Checkout Session for subscription
    const params = new URLSearchParams();
    params.append("mode", "subscription");
    params.append("payment_method_types[0]", "card");
    params.append("payment_method_types[1]", "pix");
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);
    params.append("client_reference_id", `${group_id}:${user_id}:subscription`);
    params.append("metadata[group_id]", group_id);
    params.append("metadata[user_id]", user_id);
    params.append("metadata[payment_type]", "subscription");

    const sessionResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: stripeHeaders,
      body: params.toString(),
    });

    const sessionData = await sessionResp.json();

    if (!sessionResp.ok) {
      console.error("Stripe subscription error:", sessionData);
      const errMsg = sessionData?.error?.message || sessionData?.message || JSON.stringify(sessionData);
      return new Response(
        JSON.stringify({ error: "Erro ao criar sessão: " + errMsg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Referral
    if (referral_code) {
      try {
        const { data: referrer } = await supabaseAdmin
          .from("user_referral_codes")
          .select("user_id")
          .eq("referral_code", referral_code)
          .maybeSingle();

        if (referrer && referrer.user_id !== user_id) {
          const existingReferral = await supabaseAdmin
            .from("referrals")
            .select("id")
            .eq("invitee_id", user_id)
            .eq("referral_code", referral_code)
            .maybeSingle();

          if (!existingReferral.data) {
            await supabaseAdmin.from("referrals").insert({
              referrer_id: referrer.user_id,
              invitee_id: user_id,
              referral_code,
              group_id,
              status: "pending",
              points: 10,
            });
          }
        }
      } catch (refErr) {
        console.error("Referral error:", refErr);
      }
    }

    return Response.json(
      {
        init_point: sessionData.url,
        session_id: sessionData.id,
        payment_type: "subscription",
        gateway: "stripe",
      },
      { headers: corsHeaders }
    );
  }
}
