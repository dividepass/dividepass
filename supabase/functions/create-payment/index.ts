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

      // ---------------------------------------------------------------------
      // AUTENTICACAO (S12) — PRIMEIRO, antes de qualquer validacao de payload
      // ---------------------------------------------------------------------
      // Antes, `user_id` vinha do BODY e nao havia nenhuma validacao de JWT.
      // Qualquer um criava uma assinatura/grupo em nome de outra pessoa.
      // Agora o chamador e autenticado e o user_id e derivado do token.
      // A checagem vem antes da validacao do body para nao revelar detalhes
      // de schema (quais campos existem) a quem nao esta autenticado.
      // ---------------------------------------------------------------------
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();

      if (!token) {
        return new Response(
          JSON.stringify({ error: "Não autenticado" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !authData?.user) {
        return new Response(
          JSON.stringify({ error: "Token inválido" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let user_id = authData.user.id;

      const body = await req.json();
      const { group_id, billing_cycle, months, reason, referral_code, payment_type, gateway: bodyGateway, coupon_id, discount_amount, final_amount, invoice_id } = body;

      if (!group_id || !reason) {
        return new Response(
          JSON.stringify({ error: "Dados incompletos" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Cobranca de fatura: so pode ser paga por quem e o dono da fatura.
      if (payment_type === "invoice") {
        if (!invoice_id) {
          return new Response(
            JSON.stringify({ error: "invoice_id é obrigatório para pagamento de fatura" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const { data: invoice } = await supabaseAdmin
          .from("invoices")
          .select("id, user_id, status")
          .eq("id", invoice_id)
          .maybeSingle();

        if (!invoice || invoice.user_id !== authData.user.id) {
          return new Response(
            JSON.stringify({ error: "Fatura não encontrada" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        user_id = invoice.user_id;
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

      // ATENCAO: `discount_amount` e `final_amount` vem do BODY do cliente e
      // sao NAO CONFIAVEIS. O handler do IO Pay (handlers/iopay.ts) ignora
      // esses valores e recalcula o desconto a partir da tabela `coupons`
      // (handlers/coupon.ts). Os outros handlers (stripe, asaas, mercadopago,
      // pagarme) ainda os usam e PRECISAM da mesma correcao — porem esses
      // gateways estao inativos (app_settings.active_gateway = 'iopay') e
      // quebrados por TDZ.
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
