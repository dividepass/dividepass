import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_GATEWAYS = ["mercadopago", "stripe", "asaas", "iopay", "pagarme"];

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const body = await req.json();
      const { group_id, user_id, billing_cycle, months, reason, referral_code, payment_type, gateway: bodyGateway, coupon_id, discount_amount, final_amount } = body;

      if (!group_id || !user_id || !reason) {
        return new Response(
          JSON.stringify({ error: "Dados incompletos" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Prefer gateway from frontend body, fallback to DB
      let gateway = bodyGateway;
      if (!gateway || !VALID_GATEWAYS.includes(gateway)) {
        const { data: gatewaySetting } = await supabaseAdmin
          .from("app_settings")
          .select("value")
          .eq("key", "active_gateway")
          .maybeSingle();
        gateway = gatewaySetting?.value || "mercadopago";
      }

      console.log(`[create-payment] gateway=${gateway} type=${payment_type} group=${group_id}`);

      const ctx = { supabaseAdmin, supabaseUrl, group_id, user_id, billing_cycle, months, reason, referral_code, payment_type, corsHeaders, body, coupon_id, discount_amount, final_amount };

      // Route to the correct gateway handler
      switch (gateway) {
        case "stripe": {
          const mod = await import("./handlers/stripe.ts");
          return mod.default(req, ctx);
        }
        case "asaas": {
          const mod = await import("./handlers/asaas.ts");
          return mod.default(req, ctx);
        }
        case "iopay": {
          const mod = await import("./handlers/iopay.ts");
          return mod.default(req, ctx);
        }
        case "pagarme": {
          const mod = await import("./handlers/pagarme.ts");
          return mod.default(req, ctx);
        }
        case "mercadopago":
        default: {
          const mod = await import("./handlers/mercadopago.ts");
          return mod.default(req, ctx);
        }
      }
    } catch (error) {
      console.error("create-payment error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
