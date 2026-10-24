import { confirmPayment } from "../confirm-payment/index.ts";
import { getGatewaySettings } from "../create-payment/handlers/settings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Verificacao da assinatura do webhook Pagar.me.
 *
 * O Pagar.me assina com HMAC-SHA1 do corpo cru usando o secret token da
 * conta, enviado no header `X-Hub-Signature`.
 */
async function verifyPagarmeSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  if (!secret || !header) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) {
    diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      // ---------------------------------------------------------------------
      // ASSINATURA DO WEBHOOK (S11)
      // ---------------------------------------------------------------------
      // Sem a verificacao do HMAC, qualquer POST forjado com um
      // `data.id` + `metadata` bastava para ativar a vaga de alguem.
      // Falhar FECHADO quando o secret nao esta configurado.
      // ---------------------------------------------------------------------
      const settings = await getGatewaySettings();
      const secretKey = (settings.pagarme_secret_key || Deno.env.get("PAGARME_SECRET_KEY") || "").trim();

      if (!secretKey) {
        console.error("[pagarme-webhook] PAGARME_SECRET_KEY não configurado — webhook recusado");
        return new Response("Webhook secret not configured", { status: 503 });
      }

      const rawBody = await req.text();
      const signature = req.headers.get("x-hub-signature") || "";

      const validSignature = await verifyPagarmeSignature(rawBody, signature, secretKey);
      if (!validSignature) {
        console.error("[pagarme-webhook] assinatura inválida — webhook rejeitado");
        return new Response(
          JSON.stringify({ error: "Assinatura inválida" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const body = JSON.parse(rawBody);
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
