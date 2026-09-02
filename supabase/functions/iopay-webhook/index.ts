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
      const ioSecret = settings.iopay_secret || Deno.env.get("IOPAY_SECRET") || "";
      const ioEmail = settings.iopay_email || Deno.env.get("IOPAY_EMAIL") || "";
      const ioSellerId = settings.iopay_seller_id || Deno.env.get("IOPAY_SELLER_ID") || "";
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

      if (!ioSecret || !ioEmail || !ioSellerId) {
        return new Response("IOPay not configured", { status: 503 });
      }

      const body = await req.json();

      console.log("IOPay webhook event:", body.type);

      // IOPay webhook: { id, type, status, reference_id }
      const transactionId = body.id;
      const referenceId = body.reference_id;
      const eventType = body.type;

      if (!transactionId && !referenceId) {
        return Response.json({ received: true }, { headers: corsHeaders });
      }

      // Fetch transaction details from IOPay
      const iopayEnv = settings.iopay_env || "production";
      const apiBase = iopayEnv === "sandbox"
        ? "https://sandbox.api.iopay.com.br/api/"
        : "https://api.iopay.com.br/api/";

      // Auth via auth/login (with query params + body for IOPay compat)
      let bearerToken = "";
      try {
        const authUrl = `${apiBase}auth/login?email=${encodeURIComponent(ioEmail)}&secret=${encodeURIComponent(ioSecret)}&io_seller_id=${encodeURIComponent(ioSellerId)}`;
        const authResp = await fetch(authUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: ioEmail, secret: ioSecret, io_seller_id: ioSellerId }),
        });
        const authData = await authResp.json();
        bearerToken = authData.access_token || "";
      } catch (e) {
        console.error("IOPay webhook auth error:", e);
      }

      let transactionData: any = null;

      if (transactionId && bearerToken) {
        const txResp = await fetch(`${apiBase}v1/transaction/get/${transactionId}`, {
          headers: {
            "Authorization": `Bearer ${bearerToken}`,
            "Content-Type": "application/json",
          },
        });

        if (txResp.ok) {
          transactionData = await txResp.json();
        }
      }

      if (!transactionData) {
        console.error("Could not fetch IOPay transaction:", transactionId);
        return Response.json({ received: true }, { headers: corsHeaders });
      }

      // Parse external reference from reference_id
      const externalRef = transactionData.reference_id || referenceId || "";
      const parts = externalRef.split(":");

      if (parts.length < 3) {
        console.error("Invalid external reference:", externalRef);
        return Response.json({ received: true }, { headers: corsHeaders });
      }

      const groupId = parts[0];
      const userId = parts[1];
      const paymentType = parts[2] as "entrance" | "subscription" | "combined";

      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      const { data: subInfo } = await supabaseAdmin
        .from("user_subscriptions")
        .select("billing_cycle, custom_cycle_days, custom_cycle_months, payment_method")
        .eq("group_id", groupId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .maybeSingle();

      const rawStatus = String(transactionData.status || body.status || "pending").toLowerCase().trim();
      const approvedStatuses = new Set(["succeeded", "approved", "paid", "authorized", "captured", "completed", "done", "success", "settled", "confirmed"]);
      const rejectedStatuses = new Set(["failed", "cancelled", "canceled", "rejected", "refused", "denied", "voided", "expired", "error", "chargeback"]);

      // Map IOPay status using the same tolerant logic as polling/manual verify
      let status: "approved" | "rejected" | "pending" = "pending";
      if (approvedStatuses.has(rawStatus)) {
        status = "approved";
      } else if (rejectedStatuses.has(rawStatus)) {
        status = "rejected";
      }

      // Buscar o billing_cycle do pagamento criado
      const { data: paymentData } = await supabaseAdmin
        .from("payments")
        .select("billing_cycle, custom_cycle_months, custom_cycle_days, months")
        .eq("transaction_code", transactionId)
        .maybeSingle();

      await confirmPayment({
        gateway: "iopay",
        group_id: groupId,
        user_id: userId,
        payment_type: paymentType,
        amount: (transactionData.amount || 0) / 100,
        status,
        gateway_payment_id: transactionData.id || transactionId,
        payment_method: transactionData.payment_method || subInfo?.payment_method || "iopay",
        billing_cycle: paymentData?.billing_cycle || subInfo?.billing_cycle || group?.billing_cycle || "monthly",
        custom_cycle_days: paymentData?.custom_cycle_days || subInfo?.custom_cycle_days || null,
        custom_cycle_months: paymentData?.custom_cycle_months || subInfo?.custom_cycle_months || null,
      });

      // Log webhook attempt
      try {
        await supabaseAdmin.from("payment_attempts").insert({
          user_id: userId,
          group_id: groupId,
          gateway: "iopay",
          payment_method: transactionData.payment_method || "webhook",
          payment_type: paymentType,
          amount: (transactionData.amount || 0) / 100,
          status: `webhook_${status}`,
          gateway_transaction_id: transactionId,
          external_reference: externalRef,
          gateway_response: { event_type: eventType, webhook_status: body.status, confirmed_status: status },
        });
      } catch (e) { console.error("payment_attempts webhook log error:", e); }

      return Response.json({ received: true }, { headers: corsHeaders });

    } catch (error) {
      console.error("IOPay webhook error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
