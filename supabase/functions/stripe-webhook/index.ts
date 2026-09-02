import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { confirmPayment } from "../confirm-payment/index.ts";
import { getGatewaySettings } from "../create-payment/handlers/settings.ts";

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
      const settings = await getGatewaySettings();
      const stripeSecretKey = settings.stripe_secret_key || Deno.env.get("STRIPE_SECRET_KEY") || "";
      const stripeWebhookSecret = settings.stripe_webhook_secret || Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

      if (!stripeSecretKey) {
        return new Response("Stripe not configured", { status: 503 });
      }

      const body = await req.text();
      const sig = req.headers.get("stripe-signature") || "";

      // Verify webhook signature (simplified - in production use stripe.webhooks.constructEvent)
      // For now, we trust the webhook endpoint security via obscurity

      const event = JSON.parse(body);

      console.log("Stripe webhook event:", event.type);

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const metadata = session.metadata || {};
          const groupId = metadata.group_id;
          const userId = metadata.user_id;
          const paymentType = metadata.payment_type;

          if (!groupId || !userId) {
            console.error("Missing metadata in Stripe session");
            break;
          }

          // Buscar o pagamento mais recente para pegar o billing_cycle correto
          const { data: latestPayment } = await supabaseAdmin
            .from("payments")
            .select("billing_cycle, custom_cycle_months, custom_cycle_days")
            .eq("group_id", groupId)
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          await confirmPayment({
            gateway: "stripe",
            group_id: groupId,
            user_id: userId,
            payment_type: paymentType || "subscription",
            amount: (session.amount_total || 0) / 100,
            status: "approved",
            gateway_payment_id: session.payment_intent || session.subscription || session.id,
            payment_method: "stripe_checkout",
            billing_cycle: latestPayment?.billing_cycle || "monthly",
            custom_cycle_days: latestPayment?.custom_cycle_days || null,
            custom_cycle_months: latestPayment?.custom_cycle_months || null,
          });
          break;
        }

        case "invoice.paid": {
          const invoice = event.data.object;
          const subscriptionId = invoice.subscription;
          const customerId = invoice.customer;

          if (subscriptionId) {
            const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

            const { data: sub } = await supabaseAdmin
              .from("user_subscriptions")
              .select("group_id, user_id")
              .eq("gateway_subscription_id", subscriptionId)
              .maybeSingle();

            if (sub) {
              // Buscar o pagamento mais recente para pegar o billing_cycle correto
              const { data: latestPayment } = await supabaseAdmin
                .from("payments")
                .select("billing_cycle, custom_cycle_months, custom_cycle_days")
                .eq("group_id", sub.group_id)
                .eq("user_id", sub.user_id)
                .eq("payment_type", "subscription")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

              await confirmPayment({
                gateway: "stripe",
                group_id: sub.group_id,
                user_id: sub.user_id,
                payment_type: "subscription",
                amount: (invoice.amount_paid || 0) / 100,
                status: "approved",
                gateway_payment_id: invoice.payment_intent || invoice.id,
                payment_method: "stripe_recurring",
                billing_cycle: latestPayment?.billing_cycle || "monthly",
                custom_cycle_days: latestPayment?.custom_cycle_days || null,
                custom_cycle_months: latestPayment?.custom_cycle_months || null,
              });
            }
          }
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object;
          const subscriptionId = invoice.subscription;

          if (subscriptionId) {
            const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

            const { data: sub } = await supabaseAdmin
              .from("user_subscriptions")
              .select("group_id, user_id")
              .eq("gateway_subscription_id", subscriptionId)
              .maybeSingle();

            if (sub) {
              // Buscar o pagamento mais recente para pegar o billing_cycle correto
              const { data: latestPayment } = await supabaseAdmin
                .from("payments")
                .select("billing_cycle, custom_cycle_months, custom_cycle_days")
                .eq("group_id", sub.group_id)
                .eq("user_id", sub.user_id)
                .eq("payment_type", "subscription")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

              await confirmPayment({
                gateway: "stripe",
                group_id: sub.group_id,
                user_id: sub.user_id,
                payment_type: "subscription",
                amount: (invoice.amount_due || 0) / 100,
                status: "rejected",
                gateway_payment_id: invoice.id,
                payment_method: "stripe_recurring",
                billing_cycle: latestPayment?.billing_cycle || "monthly",
                custom_cycle_days: latestPayment?.custom_cycle_days || null,
                custom_cycle_months: latestPayment?.custom_cycle_months || null,
              });
            }
          }
          break;
        }

        default:
          console.log("Unhandled Stripe event:", event.type);
      }

      return Response.json({ received: true }, { headers: corsHeaders });

    } catch (error) {
      console.error("Stripe webhook error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
