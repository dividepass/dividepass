// Asaas handler for create-payment

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

function getCycleMonths(cycle: string): number {
  switch (cycle) {
    case "quarterly": return 3;
    case "semiannual": return 6;
    case "annual": return 12;
    case "custom": return 1;
    default: return 1;
  }
}

function getAsaasCycle(cycle: string): string {
  switch (cycle) {
    case "monthly": return "MONTHLY";
    case "quarterly": return "QUARTERLY";
    case "semiannual": return "SEMI_ANNUAL";
    case "annual": return "YEARLY";
    default: return "MONTHLY";
  }
}

export default async function handleAsaas(req: Request, ctx: HandlerContext) {
  const { supabaseAdmin, supabaseUrl, group_id, user_id, billing_cycle, months, reason, referral_code, payment_type, corsHeaders } = ctx;
  const settings = await getGatewaySettings();
  const asaasApiKey = settings.asaas_api_key || Deno.env.get("ASAAS_API_KEY") || "";
  const asaasEnv = settings.asaas_env || Deno.env.get("ASAAS_ENV") || "sandbox";

  if (!asaasApiKey) {
    throw new Error("ASAAS_API_KEY não configurado");
  }

  const baseUrl = asaasEnv === "production"
    ? "https://api.asaas.com"
    : "https://sandbox.asaas.com/api/v3";

  const body = ctx.body || {};
  const type = payment_type || "subscription";
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

  const asaasHeaders = {
    "access_token": asaasApiKey,
    "Content-Type": "application/json",
  };

  // Get or create customer
  const { data: userProfile } = await supabaseAdmin
    .from("users")
    .select("name, email")
    .eq("id", user_id)
    .maybeSingle();

  const customerName = userProfile?.name || "Cliente DividePass";
  const customerEmail = userProfile?.email || `${user_id}@dividepass.com`;

  // Search existing customer
  const searchResp = await fetch(
    `${baseUrl}/customers?email=${encodeURIComponent(customerEmail)}`,
    { headers: asaasHeaders }
  );
  const searchData = await searchResp.json();

  let customerId = searchData.data?.[0]?.id;

  if (!customerId) {
    const createResp = await fetch(`${baseUrl}/customers`, {
      method: "POST",
      headers: asaasHeaders,
      body: JSON.stringify({
        name: customerName,
        email: customerEmail,
        cpfCnpj: "00000000000",
      }),
    });
    const createData = await createResp.json();

    if (!createResp.ok) {
      console.error("Asaas customer error:", createData);
      return new Response(
        JSON.stringify({ error: "Erro ao criar cliente", details: createData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    customerId = createData.id;
  }

  const externalReference = `${group_id}:${user_id}:${type}`;
  const webhookUrl = `${supabaseUrl}/functions/v1/asaas-webhook`;

  if (type === "entrance") {
    const entranceAmount = Number(group.entrance_fee || 0);

    if (entranceAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Este grupo não possui taxa de adesão" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const initialStatus = await getInitialPaymentStatus(supabaseAdmin, group_id, user_id, true);

    // Create one-time payment
    const paymentResp = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: asaasHeaders,
      body: JSON.stringify({
        customer: customerId,
        billingType: "CREDIT_CARD",
        value: entranceAmount,
        dueDate: new Date().toISOString().split("T")[0],
        description: `Taxa de Adesão - ${group.name}`,
        externalReference,
        notificationUrl: webhookUrl,
      }),
    });

    const paymentData = await paymentResp.json();

    if (!paymentResp.ok) {
      console.error("Asaas payment error:", paymentData);
      return new Response(
        JSON.stringify({ error: "Erro ao criar pagamento", details: paymentData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get payment checkout URL
    const invoiceResp = await fetch(
      `${baseUrl}/payments/${paymentData.id}/invoiceUrl`,
      { headers: asaasHeaders }
    );
    const invoiceData = await invoiceResp.json();

    return Response.json(
      {
        init_point: invoiceData.url || paymentData.invoiceUrl,
        payment_id: paymentData.id,
        payment_type: "entrance",
        gateway: "asaas",
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
    const asaasCycle = getAsaasCycle(cycle);

    // Create subscription
    const subResp = await fetch(`${baseUrl}/subscriptions`, {
      method: "POST",
      headers: asaasHeaders,
      body: JSON.stringify({
        customer: customerId,
        billingType: "CREDIT_CARD",
        value: subscriptionAmount,
        cycle: asaasCycle,
        description: reason,
        externalReference,
        notificationUrl: webhookUrl,
      }),
    });

    const subData = await subResp.json();

    if (!subResp.ok) {
      console.error("Asaas subscription error:", subData);
      return new Response(
        JSON.stringify({ error: "Erro ao criar assinatura", details: subData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
        gateway: "asaas",
        payment_method: body.payment_method || null,
        gateway_subscription_id: subData.id,
        gateway_status: subData.status,
        external_reference: externalReference,
        started_at: new Date().toISOString(),
        custom_cycle_months: cycle === "custom" ? (Number(body.custom_cycle_months) || null) : null,
        custom_cycle_days: cycle === "days" ? (Number(body.custom_cycle_days) || null) : null,
        custom_cycle_label: body.custom_cycle_label || null,
      }, { onConflict: "user_id, group_id" });

    await supabaseAdmin
      .from("group_members")
      .update({ payment_status: "awaiting_subscription", gateway: "asaas" })
      .eq("group_id", group_id)
      .eq("user_id", user_id);

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

    // Get checkout URL
    const checkoutResp = await fetch(
      `${baseUrl}/subscriptions/${subData.id}/paymentUrl`,
      { headers: asaasHeaders }
    );
    const checkoutData = await checkoutResp.json();

    return Response.json(
      {
        init_point: checkoutData.url || subData.paymentUrl,
        subscription_id: subData.id,
        payment_type: "subscription",
        gateway: "asaas",
      },
      { headers: corsHeaders }
    );
  }
}
