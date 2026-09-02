import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewaySettings } from "../create-payment/handlers/settings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IOPAY_PROD = "https://api.iopay.com.br/api/";
const IOPAY_SANDBOX = "https://sandbox.api.iopay.com.br/api/";

function getBaseUrl(settings: Record<string, string>): string {
  return settings.iopay_env === "sandbox" ? IOPAY_SANDBOX : IOPAY_PROD;
}

async function getCardToken(settings: Record<string, string>): Promise<string> {
  const baseUrl = getBaseUrl(settings);
  const resp = await fetch(`${baseUrl}v1/card/authentication`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: settings.iopay_email,
      secret: settings.iopay_secret,
      io_seller_id: settings.iopay_seller_id,
    }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error("Card auth failed: " + JSON.stringify(data));
  return data.access_token;
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const authHeader = req.headers.get("authorization") || "";
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Token não fornecido" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const jwt = authHeader.replace("Bearer ", "");
      const { data: { user: caller } } = await supabaseAdmin.auth.getUser(jwt);
      if (!caller) {
        return new Response(JSON.stringify({ error: "Token inválido" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: callerProfile } = await supabaseAdmin
        .from("users").select("role").eq("id", caller.id).maybeSingle();
      if (callerProfile?.role !== "admin") {
        return new Response(JSON.stringify({ error: "Apenas admins podem acessar" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let settings: Record<string, string>;
      try {
        settings = await getGatewaySettings();
      } catch (e: any) {
        return new Response(JSON.stringify({ error: "Erro ao buscar configurações: " + e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const body = await req.json();
      const { user_id, action } = body;

      if (!user_id) {
        return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: userProfile } = await supabaseAdmin
        .from("users").select("customer_id_iopay").eq("id", user_id).maybeSingle();

      if (!userProfile?.customer_id_iopay) {
        return Response.json({ cards: [], error: "Usuário não possui cliente IOPay" }, { headers: corsHeaders });
      }

      const customerId = userProfile.customer_id_iopay;
      const baseUrl = getBaseUrl(settings);
      const cardToken = await getCardToken(settings);

      if (action === "set_default") {
        const { id_card } = body;
        if (!id_card) {
          return new Response(JSON.stringify({ error: "id_card required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const setResp = await fetch(`${baseUrl}v1/card/set_default/${customerId}`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${cardToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ id_card }),
        });
        const setData = await setResp.text();
        console.log("[admin-iopay-cards] set_default:", setResp.status, setData.substring(0, 300));
        return Response.json({ success: setResp.ok, raw: setData }, { headers: corsHeaders });
      }

      const resp = await fetch(`${baseUrl}v1/card/list/${customerId}`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${cardToken}`, "Content-Type": "application/json" },
      });
      const raw = await resp.text();
      console.log("[admin-iopay-cards] list:", resp.status, raw.substring(0, 500));

      let data: any;
      try { data = JSON.parse(raw); } catch { data = { raw }; }

      let cards: any[] = [];
      if (Array.isArray(data)) cards = data;
      else if (Array.isArray(data?.items)) cards = data.items;
      else if (Array.isArray(data?.cards)) cards = data.cards;
      else if (data?.success && typeof data.success === "object") {
        if (Array.isArray(data.success)) cards = data.success;
        else if (Array.isArray(data.success?.items)) cards = data.success.items;
        else if (Array.isArray(data.success?.cards)) cards = data.success.cards;
      }

      return Response.json({ cards, customer_id: customerId }, { headers: corsHeaders });

    } catch (error: any) {
      console.error("[admin-iopay-cards] FATAL:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  },
};
