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

      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      // ---------------------------------------------------------------------
      // AUTENTICACAO (S12) — PRIMEIRO, antes de qualquer validacao de payload
      // ---------------------------------------------------------------------
      // Esta function consulta/confirmar um pagamento no Mercado Pago. Sem
      // JWT, qualquer um com um payment_id ou external_reference via a
      // situacao de pagamento de outra pessoa.
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

      const { payment_id, external_reference } = await req.json();

      if (!payment_id && !external_reference) {
        return new Response(
          JSON.stringify({ error: "payment_id ou external_reference é obrigatório" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let paymentStatus = "unknown";
      let paymentData: Record<string, unknown> | null = null;

      if (payment_id) {
        const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
          headers: { Authorization: `Bearer ${mpAccessToken}` },
        });

        if (mpResponse.ok) {
          paymentData = await mpResponse.json();
          paymentStatus = String(paymentData?.status || "unknown");
        }
      }

      const [group_id, user_id] = (external_reference || String(paymentData?.external_reference || "")).split(":");

      if (!group_id || !user_id) {
        return new Response(
          JSON.stringify({ error: "external_reference inválido" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: group } = await supabaseAdmin
        .from("groups")
        .select("service_id, name")
        .eq("id", group_id)
        .single();

      return Response.json({
        status: paymentStatus,
        group_id,
        user_id,
        service_id: group?.service_id || null,
        group_name: group?.name || null,
        payment: paymentData,
      }, { headers: corsHeaders });
    } catch (error) {
      console.error("Verify payment error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
