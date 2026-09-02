import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const mpAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";

      if (!mpAccessToken) {
        throw new Error("MERCADO_PAGO_ACCESS_TOKEN não configurado");
      }

      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const body = await req.json();
      const { group_id, user_id, billing_cycle, months, reason, referral_code, payment_type } = body;
      const force_new_plan = body.force_new_plan || false;

      if (!group_id || !user_id || !reason) {
        return new Response(
          JSON.stringify({ error: "Dados incompletos" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const type = payment_type || "subscription";
      const cycleMonths = months && months > 0 ? months : 1;
      const cycle = billing_cycle || "monthly";

      const appUrl = (Deno.env.get("SITE_URL") || Deno.env.get("APP_URL") || "https://dividepass.com").replace(/\/$/, "");
      const backUrl = `${appUrl}/dashboard/credentials`;

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

      const webhookUrl = `${supabaseUrl}/functions/v1/mercado-pago-webhook`;

      if (type === "entrance") {
        // ============================================
        // STEP 1: Taxa de Adesão (pagamento avulso via Checkout Pro)
        // ============================================
        const entranceAmount = Number(group.entrance_fee || 0);

        if (entranceAmount <= 0) {
          return new Response(
            JSON.stringify({ error: "Este grupo não possui taxa de adesão" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const externalReference = `${group_id}:${user_id}:entrance`;

        const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${mpAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: [
              {
                title: `Taxa de Adesão - ${group.name}`,
                description: `Pagamento único da taxa de adesão para o grupo ${group.name}`,
                quantity: 1,
                currency_id: "BRL",
                unit_price: entranceAmount,
              },
            ],
            external_reference: externalReference,
            notification_url: webhookUrl,
            statement_descriptor: "DIVIDEPASS",
          }),
        });

        const mpData = await mpResponse.json();

        if (!mpResponse.ok) {
          console.error("MP entrance error:", mpData);
          return new Response(
            JSON.stringify({ error: "Erro ao criar pagamento da taxa de adesão", details: mpData }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { getInitialPaymentStatus } = await import("../create-payment/handlers/status-helpers.ts");
        const initialStatus = await getInitialPaymentStatus(supabaseAdmin, group_id, user_id, true);
        await supabaseAdmin.from("group_members").upsert({
          group_id, user_id,
          status: "pending",
          payment_status: initialStatus,
        }, { onConflict: "group_id, user_id" });

        return Response.json(
          {
            preference_id: mpData.id,
            init_point: mpData.init_point,
            sandbox_init_point: mpData.sandbox_init_point,
            payment_type: "entrance",
          },
          { headers: corsHeaders }
        );

      } else {
        // ============================================
        // STEP 2: Assinatura Recorrente (via Preapproval API)
        // ============================================

        // Verificar se a entrada foi paga
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

        // Verificar prazo 12h
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

        // Mapear ciclo para frequência do MP Preapproval
        const mpFrequencyType = "months";
        let mpFrequency = 1;
        if (cycle === "quarterly") mpFrequency = 3;
        else if (cycle === "semiannual") mpFrequency = 6;
        else if (cycle === "annual") mpFrequency = 12;

        // ============================================
        // Buscar ou criar preapproval_plan no MP
        // Chave: amount + frequency + frequency_type
        // ============================================
        const planKey = `plan_${subscriptionAmount}_${mpFrequency}_${mpFrequencyType}`;
        const mpHeaders = {
          "Authorization": `Bearer ${mpAccessToken}`,
          "Content-Type": "application/json",
        };

        // Verificar se já existe um plano salvo no banco
        const { data: existingPlan } = await supabaseAdmin
          .from("app_settings")
          .select("value")
          .eq("key", planKey)
          .maybeSingle();

        let preapprovalPlanId = null;

        if (!force_new_plan && existingPlan?.value) {
          preapprovalPlanId = existingPlan.value;
          console.log(`Using cached plan: ${preapprovalPlanId}`);
        }

        if (!preapprovalPlanId) {
          console.log(`Creating new preapproval plan: ${planKey}`);
          const planBody = {
            reason: reason,
            back_url: backUrl,
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

          // Salvar no banco para reutilizar (upsert para substituir plano com URL inválida)
          await supabaseAdmin.from("app_settings").upsert({
            key: planKey,
            value: preapprovalPlanId,
          }, { onConflict: "key" });

          console.log(`Plan created: ${preapprovalPlanId}`);
        }

        // O MP exige card_token_id para criar preapproval via API.
        // Solução: redirecionar para o checkout do plano que coleta o cartão automaticamente.
        // O external_reference é passado como query param e capturado no webhook.

        // Registrar pendente no banco antes de redirecionar
        await supabaseAdmin
          .from("user_subscriptions")
          .upsert({
            user_id,
            group_id,
            service_id: group.service_id,
            billing_cycle: cycle,
            amount: subscriptionAmount,
            status: "pending",
            mercado_pago_status: "pending",
            external_reference: `${group_id}:${user_id}:subscription`,
            started_at: new Date().toISOString(),
          }, { onConflict: "user_id, group_id" });

        // Atualizar membro
        await supabaseAdmin
          .from("group_members")
          .update({
            payment_status: "awaiting_subscription",
          })
          .eq("group_id", group_id)
          .eq("user_id", user_id);

        // URL de checkout do plano - o MP coleta cartão e cria a assinatura
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
          },
          { headers: corsHeaders }
        );
      }
    } catch (error) {
      console.error("Function error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
