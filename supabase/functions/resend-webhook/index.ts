import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function verifyWebhookSignature(
  body: string,
  signature: string | null,
  secret: string,
): boolean {
  // Fail-closed: sem signature ou sem secret a validacao falha.
  if (!signature || !secret) return false;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const bodyData = encoder.encode(body);

  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  ).then((key) =>
    crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)),
      bodyData,
    )
  );
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const rawBody = await req.text();

      // ---------------------------------------------------------------------
      // SEGURANCA (S12): fail-closed
      // ---------------------------------------------------------------------
      // Antes, `verifyWebhookSignature` devolvia TRUE quando o secret nao
      // estava configurado — ou seja, qualquer POST forjado era aceito e
      // gravava email_logs (bounces/complaints falsos, poluindo a trilha de
      // entrega). Agora: sem secret configurado a function nem responde, e
      // sem assinatura valida o pedido e recusado.
      // ---------------------------------------------------------------------
      if (!webhookSecret) {
        console.error("RESEND_WEBHOOK_SECRET nao configurado — webhook recusado");
        return new Response("Webhook not configured", {
          status: 503,
          headers: corsHeaders,
        });
      }

      const signature = req.headers.get("resend-signature") || "";
      if (!signature) {
        return new Response("Missing signature", {
          status: 401,
          headers: corsHeaders,
        });
      }

      const isValid = await verifyWebhookSignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        console.error("Invalid webhook signature");
        return new Response("Invalid signature", {
          status: 401,
          headers: corsHeaders,
        });
      }

      const event = JSON.parse(rawBody);
      const { type, created_at, data } = event;

      console.log(`Resend webhook event: ${type}`, JSON.stringify(data, null, 2));

      const logEntry = {
        event_type: type,
        email_id: data?.email_id || null,
        from: data?.from || null,
        to: data?.to?.[0] || null,
        subject: data?.subject || null,
        created_at: created_at || new Date().toISOString(),
        raw_event: event,
      };

      const { error: logError } = await supabaseAdmin
        .from("email_logs")
        .insert(logEntry);

      if (logError) {
        console.error("Failed to log email event:", logError);
      }

      switch (type) {
        case "email.bounced":
          console.log(`Email bounced: ${data?.to?.[0]} | Reason: ${data?.bounce?.message}`);
          break;

        case "email.complained":
          console.log(`Email complained (spam): ${data?.to?.[0]}`);
          break;

        case "email.delivery_delayed":
          console.log(`Email delivery delayed: ${data?.to?.[0]}`);
          break;

        case "email.delivered":
          console.log(`Email delivered: ${data?.to?.[0]}`);
          break;

        case "email.opened":
          console.log(`Email opened: ${data?.to?.[0]}`);
          break;

        case "email.clicked":
          console.log(`Email clicked: ${data?.to?.[0]} | URL: ${data?.click?.url}`);
          break;

        default:
          console.log(`Unhandled event type: ${type}`);
      }

      return new Response("OK", { status: 200, headers: corsHeaders });
    } catch (error) {
      console.error("resend-webhook error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  },
};
