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
      const asaasApiKey = settings.asaas_api_key || Deno.env.get("ASAAS_API_KEY") || "";
      const asaasEnv = settings.asaas_env || Deno.env.get("ASAAS_ENV") || "sandbox";
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

      if (!asaasApiKey) {
        return new Response("Asaas not configured", { status: 503 });
      }

      const baseUrl = asaasEnv === "production"
        ? "https://api.asaas.com"
        : "https://sandbox.asaas.com/api/v3";

      const body = await req.json();

      console.log("Asaas webhook event:", body.event);

      const paymentId = body.payment?.id || body.subscription?.id;
      if (!paymentId) {
        return Response.json({ received: true }, { headers: corsHeaders });
      }

      // Fetch payment details from Asaas
      const asaasHeaders = {
        "access_token": asaasApiKey,
        "Content-Type": "application/json",
      };

      const paymentResp = await fetch(`${baseUrl}/payments/${paymentId}`, {
        headers: asaasHeaders,
      });
      const paymentData = await paymentResp.json();

      if (!paymentResp.ok) {
        console.error("Asaas fetch payment error:", paymentData);
        return Response.json({ received: true }, { headers: corsHeaders });
      }

      const externalRef = paymentData.externalReference || "";
      const parts = externalRef.split(":");

      if (parts.length < 3) {
        console.error("Invalid external reference:", externalRef);
        return Response.json({ received: true }, { headers: corsHeaders });
      }

      const groupId = parts[0];
      const userId = parts[1];
      const paymentType = parts[2] as "entrance" | "subscription";

      // Map Asaas status
      let status: "approved" | "rejected" | "pending" = "pending";
      if (paymentData.status === "CONFIRMED" || paymentData.status === "RECEIVED") {
        status = "approved";
      } else if (paymentData.status === "OVERDUE" || paymentData.status === "DELETED" || paymentData.status === "REFUNDED") {
        status = "rejected";
      }

      await confirmPayment({
        gateway: "asaas",
        group_id: groupId,
        user_id: userId,
        payment_type: paymentType,
        amount: paymentData.value,
        status,
        gateway_payment_id: paymentData.id,
        payment_method: paymentData.billingType || "asaas",
      });

      return Response.json({ received: true }, { headers: corsHeaders });

    } catch (error) {
      console.error("Asaas webhook error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
