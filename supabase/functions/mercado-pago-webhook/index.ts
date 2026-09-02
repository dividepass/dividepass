import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function verifyMpSignature(req: Request, body: string): Promise<boolean> {
  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature) return false;

  const webhookSecret = Deno.env.get("MP_WEBHOOK_SECRET") || "";
  if (!webhookSecret) {
    console.warn("MP_WEBHOOK_SECRET not configured — skipping signature verification");
    return true;
  }

  try {
    const parts = xSignature.split(",").reduce((acc: Record<string, string>, part: string) => {
      const [k, v] = part.split("=");
      acc[k] = v;
      return acc;
    }, {});

    const ts = parts["ts"];
    const hash = parts["v1"];
    if (!ts || !hash) return false;

    const encoder = new TextEncoder();
    const keyData = encoder.encode(webhookSecret);
    const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

    const payload = body + ts;
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(payload));
    const computedHash = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");

    return computedHash === hash;
  } catch (err) {
    console.error("Signature verification error:", err);
    return false;
  }
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const mpAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";

      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const body = await req.json();
      console.log("Webhook received:", JSON.stringify(body));

      const bodyStr = JSON.stringify(body);
      const isValid = await verifyMpSignature(req, bodyStr);
      if (!isValid) {
        console.error("Invalid MP webhook signature");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const topic = body.type || body.topic || body.action;
      const resourceId = body.data?.id;

      if (!topic || !resourceId) {
        return new Response(
          JSON.stringify({ message: "Evento ignorado" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================
      // STEP 1: Pagamento avulso (taxa de entrada) via "payment"
      // ============================================
      if (topic === "payment") {
        const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${resourceId}`, {
          headers: { Authorization: `Bearer ${mpAccessToken}` },
        });

        if (!mpResponse.ok) {
          console.error("Failed to fetch payment from MP");
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        const payment = await mpResponse.json();
        const externalReference = payment.external_reference;

        if (!externalReference) {
          console.error("Payment without external_reference");
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        const parts = externalReference.split(":");
        const group_id = parts[0];
        const user_id = parts[1];
        const paymentType = parts[2] || "entrance";

        if (!group_id || !user_id) {
          console.error("Invalid external_reference", externalReference);
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        const amount = payment.transaction_amount || 0;
        const paidAt = payment.date_approved || new Date().toISOString();

        if (payment.status !== "approved") {
          console.log(`Payment status: ${payment.status}. Ignoring.`);
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        // Buscar grupo
        const { data: group, error: groupError } = await supabaseAdmin
          .from("groups")
          .select("service_id, name, billing_cycle, price_per_slot, has_entrance_fee, entrance_fee, owner_id, is_official")
          .eq("id", group_id)
          .single();

        if (groupError || !group) {
          console.error("Group not found", groupError);
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        // Handle combined payment type
        if (paymentType === "combined") {
          console.log(`Combined payment received for group ${group_id}, user ${user_id}`);
          
          // Call confirm-payment logic directly or use the shared function
          const { confirmPayment } = await import("../confirm-payment/index.ts");
          await confirmPayment({
            gateway: "mercadopago",
            group_id,
            user_id,
            payment_type: "combined",
            amount,
            status: "approved",
            gateway_payment_id: String(resourceId),
            payment_method: payment.payment_method_id || "mercado_pago",
          });
          
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        // Taxa de adesão paga
        console.log(`Entrance fee paid for group ${group_id}, user ${user_id}`);

        const entranceDeadline = new Date();
        entranceDeadline.setHours(entranceDeadline.getHours() + 12);

        await supabaseAdmin
          .from("group_members")
          .upsert({
            group_id, user_id,
            status: "active",
            payment_status: "entrance_paid",
            entrance_paid_at: paidAt,
            entrance_payment_id: String(resourceId),
            subscription_deadline: entranceDeadline.toISOString(),
          }, { onConflict: "group_id, user_id" });

        // Registrar pagamento
        await supabaseAdmin
          .from("payments")
          .insert({
            user_id, group_id, amount,
            method: payment.payment_method_id || "mercado_pago",
            status: "paid",
            transaction_code: String(resourceId),
            paid_at: paidAt,
            payment_type: "entrance",
            notes: "Taxa de adesão - pagamento único",
          });

        // Platform event: payment (entrance)
        await supabaseAdmin.from("platform_events").insert({
          event_type: "payment",
          title: "Pagamento de adesão",
          message: `Taxa de adesão de R$ ${amount.toFixed(2)} paga no grupo "${group.name}" via Mercado Pago.`,
          metadata: JSON.stringify({ user_id, group_id, amount, gateway: "mercadopago", payment_type: "entrance", gateway_payment_id: String(resourceId) }),
          created_by: user_id,
        });

        // Credita wallet do dono
        if (group.owner_id && !group.is_official) {
          try {
            const { data: settingsData } = await supabaseAdmin
              .from("app_settings")
              .select("key, value")
              .in("key", ["gateway_fee_percent", "platform_fee_percent"]);

            const settings: Record<string, string> = {};
            settingsData?.forEach(s => { settings[s.key] = s.value; });

            const gatewayRate = parseFloat(settings.gateway_fee_percent || "4.98") / 100;
            const platformRate = parseFloat(settings.platform_fee_percent || "3.95") / 100;
            const totalFees = gatewayRate + platformRate;
            const ownerAmount = amount * (1 - totalFees);

            await supabaseAdmin.rpc("credit_wallet", {
              p_user_id: group.owner_id,
              p_amount: ownerAmount,
              p_description: `Taxa de adesão no grupo ${group.name}`,
              p_reference_type: "entrance",
              p_reference_id: null,
              p_group_id: group_id,
            });
          } catch (walletErr) {
            console.error("Wallet credit error:", walletErr);
          }
        }
      }

      // ============================================
      // STEP 2: Assinatura recorrente via "preapproval"
      // ============================================
      if (topic === "preapproval" || topic === "subscription_preapproval") {
        const mpResponse = await fetch(`https://api.mercadopago.com/preapproval/${resourceId}`, {
          headers: { Authorization: `Bearer ${mpAccessToken}` },
        });

        if (!mpResponse.ok) {
          console.error("Failed to fetch preapproval from MP");
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        const preapproval = await mpResponse.json();
        const externalReference = preapproval.external_reference;

        let group_id: string;
        let user_id: string;

        if (externalReference && externalReference.includes(":")) {
          const parts = externalReference.split(":");
          group_id = parts[0];
          user_id = parts[1];
        } else if (preapproval.external_reference && preapproval.external_reference.includes(":")) {
          // Fallback: external_reference no preapproval
          const parts = preapproval.external_reference.split(":");
          group_id = parts[0];
          user_id = parts[1];
        } else if (preapproval.preapproval_plan_id) {
          // Plano checkout - buscar plano no banco e encontrar a assinatura pendente
          const { data: planEntry } = await supabaseAdmin
            .from("app_settings")
            .select("key, value")
            .eq("value", preapproval.preapproval_plan_id)
            .like("key", "plan_%")
            .maybeSingle();

          if (!planEntry) {
            console.error("Plan not found in app_settings", preapproval.preapproval_plan_id);
            return new Response("OK", { status: 200, headers: corsHeaders });
          }

          const planParts = planEntry.key.replace("plan_", "").split("_");
          const planAmount = parseFloat(planParts[0]);

          // Usar payer email para desambiguar
          const payerEmail = preapproval.payer_email || preapproval.card?.cardholder?.email;

          let query = supabaseAdmin
            .from("user_subscriptions")
            .select("user_id, group_id")
            .eq("status", "pending")
            .eq("amount", planAmount);

          if (payerEmail) {
            // Join com users para filtrar por email
            const { data: users } = await supabaseAdmin
              .from("users")
              .select("id")
              .eq("email", payerEmail)
              .limit(1);
            if (users?.length) {
              query = query.eq("user_id", users[0].id);
            }
          }

          const { data: pendingSub } = await query
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!pendingSub) {
            console.error("No pending subscription found for plan", planEntry.key);
            return new Response("OK", { status: 200, headers: corsHeaders });
          }

          group_id = pendingSub.group_id;
          user_id = pendingSub.user_id;
        } else {
          console.error("Preapproval without external_reference or plan_id");
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        if (!group_id || !user_id) {
          console.error("Could not resolve group_id/user_id");
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        console.log(`Preapproval status: ${preapproval.status} for group ${group_id}, user ${user_id}`);

        // Tratar status que cancelam/pausam a assinatura
        if (["cancelled", "paused", "expired"].includes(preapproval.status)) {
          console.log(`Preapproval ${preapproval.status} — cancelling subscription locally`);
          await supabaseAdmin
            .from("user_subscriptions")
            .update({
              status: "cancelled",
              billing_status: "cancelled",
              mercado_pago_status: preapproval.status,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", user_id)
            .eq("group_id", group_id);

          await supabaseAdmin
            .from("group_members")
            .update({
              status: "cancelled",
              payment_status: "cancelled",
              left_at: new Date().toISOString(),
            })
            .eq("user_id", user_id)
            .eq("group_id", group_id);

          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        // Só ativa quando status for "authorized"
        if (preapproval.status !== "authorized") {
          console.log(`Preapproval status ${preapproval.status}. Waiting for authorized.`);
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        // Buscar grupo
        const { data: group, error: groupError } = await supabaseAdmin
          .from("groups")
          .select("service_id, name, billing_cycle, price_per_slot, owner_id, is_official")
          .eq("id", group_id)
          .single();

        if (groupError || !group) {
          console.error("Group not found", groupError);
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        // Buscar o pagamento mais recente para pegar o billing_cycle correto
        const { data: latestPayment } = await supabaseAdmin
          .from("payments")
          .select("billing_cycle, custom_cycle_months, custom_cycle_days")
          .eq("group_id", group_id)
          .eq("user_id", user_id)
          .eq("payment_type", "subscription")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const cycle = latestPayment?.billing_cycle || group.billing_cycle || "monthly";
        const cycleDays = latestPayment?.custom_cycle_days || null;
        const customCycleMonths = latestPayment?.custom_cycle_months || null;

        const subscriptionAmount = group.price_per_slot;
        const paidAt = preapproval.last_date_approved || new Date().toISOString();

        // Calcular cycleMonths baseado no ciclo
        const getCycleMonths = (c: string, cm: number | null) => {
          if (c === "days") return 0;
          if (c === "quarterly") return 3;
          if (c === "semiannual") return 6;
          if (c === "annual") return 12;
          if (c === "custom") return cm || 1;
          return 1;
        };
        const cycleMonths = getCycleMonths(cycle, customCycleMonths);

        const expiresAt = new Date();
        if (cycle === "days" && cycleDays) {
          expiresAt.setDate(expiresAt.getDate() + cycleDays);
        } else {
          expiresAt.setMonth(expiresAt.getMonth() + cycleMonths);
        }

        // Atualizar assinatura
        await supabaseAdmin
          .from("user_subscriptions")
          .upsert({
            user_id, group_id,
            service_id: group.service_id,
            billing_cycle: cycle,
            amount: subscriptionAmount,
            status: "active",
            mercado_pago_status: "authorized",
            mercado_pago_subscription_id: preapproval.id,
            external_reference: externalReference,
            started_at: new Date().toISOString(),
            expires_at: expiresAt.toISOString(),
          }, { onConflict: "user_id, group_id" });

        // ACESSO LIBERADO
        await supabaseAdmin
          .from("group_members")
          .upsert({
            group_id, user_id,
            status: "active",
            payment_status: "active",
            joined_at: new Date().toISOString(),
          }, { onConflict: "group_id, user_id" });

        // Registrar pagamento
        await supabaseAdmin
          .from("payments")
          .insert({
            user_id, group_id,
            amount: subscriptionAmount,
            method: "mercado_pago_preapproval",
            status: "paid",
            transaction_code: String(resourceId),
            paid_at: paidAt,
            payment_type: "subscription",
            notes: `Assinatura recorrente ${cycle}`,
          });

        // Platform events: payment + member_joined
        const { data: mpUser } = await supabaseAdmin
          .from("users").select("name").eq("id", user_id).maybeSingle();

        await supabaseAdmin.from("platform_events").insert({
          event_type: "payment",
          title: "Pagamento de assinatura",
          message: `Assinatura de R$ ${subscriptionAmount.toFixed(2)} paga no grupo "${group.name}" via Mercado Pago.`,
          metadata: JSON.stringify({ user_id, group_id, amount: subscriptionAmount, gateway: "mercadopago", payment_type: "subscription", gateway_payment_id: String(resourceId) }),
          created_by: user_id,
        });

        await supabaseAdmin.from("platform_events").insert({
          event_type: "member_joined",
          title: "Membro ingressou no grupo",
          message: `${mpUser?.name || user_id} ingressou no grupo "${group.name}".`,
          metadata: JSON.stringify({ user_id, group_id, amount: subscriptionAmount, gateway: "mercadopago" }),
          created_by: user_id,
        });

        // Credita wallet do dono
        if (group.owner_id && !group.is_official) {
          try {
            const { data: memberUser } = await supabaseAdmin
              .from("users")
              .select("name")
              .eq("id", user_id)
              .maybeSingle();

            const memberName = memberUser?.name || "Membro";

            const { data: settingsData } = await supabaseAdmin
              .from("app_settings")
              .select("key, value")
              .in("key", ["gateway_fee_percent", "platform_fee_percent"]);

            const settings: Record<string, string> = {};
            settingsData?.forEach(s => { settings[s.key] = s.value; });

            const gatewayRate = parseFloat(settings.gateway_fee_percent || "4.98") / 100;
            const platformRate = parseFloat(settings.platform_fee_percent || "3.95") / 100;
            const totalFees = gatewayRate + platformRate;
            const ownerAmount = subscriptionAmount * (1 - totalFees);

            const { data: subData } = await supabaseAdmin
              .from("user_subscriptions")
              .select("id")
              .eq("user_id", user_id)
              .eq("group_id", group_id)
              .maybeSingle();

            await supabaseAdmin.rpc("credit_wallet", {
              p_user_id: group.owner_id,
              p_amount: ownerAmount,
              p_description: `Assinatura de ${memberName} no grupo ${group.name}`,
              p_reference_type: "subscription",
              p_reference_id: subData?.id || null,
              p_group_id: group_id,
            });
          } catch (walletErr) {
            console.error("Wallet credit error:", walletErr);
          }
        }

        // Fatura
        await supabaseAdmin
          .from("invoices")
          .update({ status: "paid", paid_at: paidAt })
          .eq("user_id", user_id)
          .eq("group_id", group_id)
          .eq("status", "pending")
          .order("due_date", { ascending: true })
          .limit(1);

        const nextDue = new Date();
        nextDue.setMonth(nextDue.getMonth() + cycleMonths);

        await supabaseAdmin
          .from("invoices")
          .insert({
            user_id, group_id,
            amount: subscriptionAmount,
            due_date: nextDue.toISOString().split("T")[0],
            status: "pending",
          });

        // Referral
        try {
          const { data: referral } = await supabaseAdmin
            .from("referrals")
            .select("id, referrer_id, group_id, points")
            .eq("invitee_id", user_id)
            .eq("status", "pending")
            .maybeSingle();

          if (referral) {
            const isSameGroup = referral.group_id === group_id;
            const bonusPoints = isSameGroup ? 5 : 0;
            const totalPoints = (referral.points || 0) + 10 + bonusPoints;

            await supabaseAdmin
              .from("referrals")
              .update({
                status: "completed",
                points: totalPoints,
                completed_at: new Date().toISOString(),
                group_id,
              })
              .eq("id", referral.id);
          }
        } catch (refErr) {
          console.error("Referral error:", refErr);
        }
      }

      return new Response(
        JSON.stringify({ received: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error("Webhook error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
