// Mercado Pago handler for create-payment
// Migrated from mercado-pago-create-subscription

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

export default async function handleMercadoPago(req: Request, ctx: HandlerContext) {
  const { supabaseAdmin, supabaseUrl, group_id, user_id, billing_cycle, months, reason, referral_code, payment_type, corsHeaders } = ctx;
  const settings = await getGatewaySettings();
  const mpAccessToken = settings.mercadopago_access_token || Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") || "";

  if (!mpAccessToken) {
    throw new Error("Chave de acesso do Mercado Pago não configurada. Configure no Admin → Configurações → Mercado Pago → Access Token.");
  }

const body = ctx.body || {};
  const force_new_plan = body.force_new_plan || false;
  const type = payment_type || "subscription";
  const cycleMonths = months && months > 0 ? months : 1;

  const { data: group, error: groupError } = await supabaseAdmin
    .from("groups")
    .select("*, service:service_id(*)")
    .eq("id", group_id)
    .single();

  const cycle = billing_cycle || group?.billing_cycle || "monthly";

  if (groupError || !group) {
    return new Response(
      JSON.stringify({ error: "Grupo não encontrado" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const webhookUrl = `${supabaseUrl}/functions/v1/mercado-pago-webhook`;
  const mpHeaders = {
    "Authorization": `Bearer ${mpAccessToken}`,
    "Content-Type": "application/json",
  };

  const entranceAmount = Number(group.entrance_fee || 0);
  const subscriptionAmount = Number(group.price_per_slot || 0);

  if (type === "entrance" || type === "combined") {
    if (entranceAmount <= 0 && type === "entrance") {
      return new Response(
        JSON.stringify({ error: "Este grupo não possui taxa de adesão" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Combined: entrance + first subscription
    const totalAmount = type === "combined" ? entranceAmount + subscriptionAmount : entranceAmount;
    const externalReference = `${group_id}:${user_id}:${type}`;

    const items = [{
      title: type === "combined" ? `Adesão + 1ª Mensalidade - ${group.name}` : `Taxa de Adesão - ${group.name}`,
      description: type === "combined" 
        ? `Taxa de adesão (R$ ${entranceAmount.toFixed(2)}) + 1ª mensalidade (R$ ${subscriptionAmount.toFixed(2)}) para ${group.name}`
        : `Pagamento único da taxa de adesão para o grupo ${group.name}`,
      quantity: 1,
      currency_id: "BRL",
      unit_price: totalAmount,
    }];

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: mpHeaders,
      body: JSON.stringify({
        items,
        external_reference: externalReference,
        notification_url: webhookUrl,
        statement_descriptor: "DIVIDEPASS",
      }),
    });

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error("MP entrance/combined error:", mpData);
      const errMsg = mpData?.message || mpData?.error || JSON.stringify(mpData);
      return new Response(
        JSON.stringify({ error: "Erro ao criar pagamento: " + errMsg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const initialStatus = await getInitialPaymentStatus(supabaseAdmin, group_id, user_id, true);

    return Response.json(
      {
        preference_id: mpData.id,
        init_point: mpData.init_point,
        sandbox_init_point: mpData.sandbox_init_point,
        payment_type: type,
        gateway: "mercadopago",
        total_amount: totalAmount,
        entrance_amount: entranceAmount,
        subscription_amount: subscriptionAmount,
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
    const mpFrequencyType = "months";
    let mpFrequency = 1;
    if (cycle === "quarterly") mpFrequency = 3;
    else if (cycle === "semiannual") mpFrequency = 6;
    else if (cycle === "annual") mpFrequency = 12;

    const planKey = `plan_${subscriptionAmount}_${mpFrequency}_${mpFrequencyType}`;

    const { data: existingPlan } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", planKey)
      .maybeSingle();

    let preapprovalPlanId = null;

    if (!force_new_plan && existingPlan?.value) {
      preapprovalPlanId = existingPlan.value;
    }

    if (!preapprovalPlanId) {
      const planBody = {
        reason: reason,
        back_url: "https://www.dividepass.com/dashboard/credentials",
        auto_recurring: {
          frequency: mpFrequency,
          frequency_type: mpFrequencyType,
          transaction_amount: subscriptionAmount,
          currency_id: "BRL",
        },
        payment_methods_allowed: {
          payment_types: [
            { id: "credit_card" },
            { id: "debit_card" },
          ],
        },
      };

      const planResp = await fetch("https://api.mercadopago.com/preapproval_plan", {
        method: "POST",
        headers: mpHeaders,
        body: JSON.stringify(planBody),
      });

      const planData = await planResp.json();

      if (!planResp.ok) {
        console.error("MP plan creation error:", planData);
        return new Response(
          JSON.stringify({ error: "Erro ao criar plano de assinatura", details: planData }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      preapprovalPlanId = planData.id;

      await supabaseAdmin.from("app_settings").upsert({
        key: planKey,
        value: preapprovalPlanId,
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
        gateway: "mercadopago",
        payment_method: body.payment_method || null,
        mercado_pago_status: "pending",
        external_reference: `${group_id}:${user_id}:subscription`,
        started_at: new Date().toISOString(),
        custom_cycle_months: cycle === "custom" ? (Number(body.custom_cycle_months) || null) : null,
        custom_cycle_days: cycle === "days" ? (Number(body.custom_cycle_days) || null) : null,
        custom_cycle_label: body.custom_cycle_label || null,
      }, { onConflict: "user_id, group_id" });

    await supabaseAdmin
      .from("group_members")
      .update({ payment_status: "awaiting_subscription", gateway: "mercadopago" })
      .eq("group_id", group_id)
      .eq("user_id", user_id);

    const checkoutUrl = `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=${preapprovalPlanId}`;

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
        init_point: checkoutUrl,
        payment_type: "subscription",
        gateway: "mercadopago",
      },
      { headers: corsHeaders }
    );
  }
}
