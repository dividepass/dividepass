import { confirmPayment } from "../confirm-payment/index.ts";

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
      const body = await req.json();
      console.log("PagarMe webhook event:", body.type, body.id);

      // V5 webhook structure: { id, type, data: { id: "ch_xxx", status: "paid", ... } }
      const eventType = body.type || "";
      const data = body.data || {};
      const orderId = data.id || "";
      const status = data.status || "";

      if (!orderId) {
        return Response.json({ received: true }, { headers: corsHeaders });
      }

      // Map Pagar.me status
      let mappedStatus: "approved" | "rejected" | "pending" = "pending";
      if (status === "paid" || status === "captured") {
        mappedStatus = "approved";
      } else if (status === "canceled" || status === "refused" || status === "failed") {
        mappedStatus = "rejected";
      }

      // Parse metadata for group_id, user_id, type
      const metadata = data.metadata || {};
      const groupId = metadata.group_id;
      const userId = metadata.user_id;
      const paymentType = metadata.type as "entrance" | "subscription";

      if (!groupId || !userId || !paymentType) {
        console.error("Missing metadata in PagarMe webhook:", metadata);
        return Response.json({ received: true }, { headers: corsHeaders });
      }

      const amount = (data.amount || 0) / 100;

      await confirmPayment({
        gateway: "pagarme",
        group_id: groupId,
        user_id: userId,
        payment_type: paymentType,
        amount,
        status: mappedStatus,
        gateway_payment_id: orderId,
        payment_method: data.payment_method || "pagarme",
      });

      return Response.json({ received: true }, { headers: corsHeaders });

    } catch (error: any) {
      console.error("PagarMe webhook error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
