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

async function getToken(settings: Record<string, string>): Promise<string> {
  const baseUrl = getBaseUrl(settings);
  const email = settings.iopay_email || "";
  const secret = settings.iopay_secret || "";
  const sellerId = settings.iopay_seller_id || "";
  const url = `${baseUrl}auth/login?email=${encodeURIComponent(email)}&secret=${encodeURIComponent(secret)}&io_seller_id=${encodeURIComponent(sellerId)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, secret, io_seller_id: sellerId }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error("IOPay auth failed: " + JSON.stringify(data));
  return data.access_token;
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

async function ensureIopayCustomer(
  supabaseAdmin: any,
  caller: any,
  settings: Record<string, string>,
): Promise<string | null> {
  const { data: profile } = await supabaseAdmin
    .from("users").select("customer_id_iopay, name, email, phone").eq("id", caller.id).maybeSingle();

  if (profile?.customer_id_iopay) return profile.customer_id_iopay;

  const baseUrl = getBaseUrl(settings);
  const token = await getToken(settings);

  const resp = await fetch(`${baseUrl}v1/customer/new`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      first_name: profile?.name || "Cliente",
      email: profile?.email || caller.email,
      phone: profile?.phone || "",
      address: { city: "Sao Paulo", state: "SP" },
    }),
  });
  const data = await resp.json();
  console.log("[iopay-cards] create customer response:", resp.status, JSON.stringify(data).substring(0, 300));

  let custId = data.id || data.Id;
  if (data?.success && typeof data.success === "object") {
    custId = custId || data.success.id || data.success.Id;
  }
  if (resp.ok && custId) {
    await supabaseAdmin.from("users").update({ customer_id_iopay: custId }).eq("id", caller.id);
    return custId;
  }

  console.error("[iopay-cards] Failed to create IOPay customer:", data);
  return null;
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

      let settings: Record<string, string>;
      try {
        settings = await getGatewaySettings();
      } catch (e: any) {
        return new Response(JSON.stringify({ error: "Erro ao buscar configurações: " + e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!settings.iopay_secret) {
        return new Response(JSON.stringify({ error: "IOPay não configurado" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const customerId = await ensureIopayCustomer(supabaseAdmin, caller, settings);
      if (!customerId) {
        return new Response(JSON.stringify({ error: "Não foi possível criar/encontrar cliente IOPay. Verifique as configurações." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const baseUrl = getBaseUrl(settings);

      if (req.method === "GET") {
        const cardToken = await getCardToken(settings);
        const resp = await fetch(`${baseUrl}v1/card/list/${customerId}`, {
          method: "GET",
          headers: { "Authorization": `Bearer ${cardToken}`, "Content-Type": "application/json" },
        });
        const raw = await resp.text();
        console.log("[iopay-cards] list response:", resp.status, raw.substring(0, 500));

        let data: any;
        try { data = JSON.parse(raw); } catch { data = { raw }; }

        let cards = [];
        if (Array.isArray(data)) cards = data;
        else if (Array.isArray(data?.items)) cards = data.items;
        else if (Array.isArray(data?.cards)) cards = data.cards;
        else if (data?.success && typeof data.success === "object") {
          if (Array.isArray(data.success)) cards = data.success;
          else if (Array.isArray(data.success?.items)) cards = data.success.items;
          else if (Array.isArray(data.success?.cards)) cards = data.success.cards;
        }

        console.log("[iopay-cards] parsed cards:", JSON.stringify(cards).substring(0, 500));

        return Response.json({ cards }, { headers: corsHeaders });
      }

      if (req.method === "POST") {
        const body = await req.json();
        const { action, card_number, holder_name, exp_month, exp_year, cvv, id_card } = body;

        if (action === "add") {
          if (!card_number || !holder_name || !exp_month || !exp_year || !cvv) {
            return new Response(JSON.stringify({ error: "Dados do cartão incompletos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          const cardToken = await getCardToken(settings);
          const year2 = exp_year.length === 4 ? exp_year.slice(-2) : exp_year;
          const month2 = exp_month.padStart(2, "0");

          const tokenResp = await fetch(`${baseUrl}v1/card/tokenize/token`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${cardToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              card_number: card_number.replace(/\s/g, ""),
              holder_name,
              expiration_month: month2,
              expiration_year: year2,
              security_code: cvv,
            }),
          });
          const tokenRaw = await tokenResp.text();
          console.log("[iopay-cards] tokenize:", tokenResp.status, tokenRaw.substring(0, 300));

          let tokenData: any;
          try { tokenData = JSON.parse(tokenRaw); } catch { tokenData = { raw: tokenRaw }; }

          let tokenId = tokenData?.token || tokenData?.id || tokenData?.success?.token || tokenData?.success?.id;
          if (tokenData?.success && typeof tokenData.success === "object") {
            tokenId = tokenId || tokenData.success.token || tokenData.success.id;
          }
          if (!tokenResp.ok || !tokenId) {
            return new Response(JSON.stringify({ error: "Erro ao tokenizar: " + tokenRaw.substring(0, 300) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          const assocResp = await fetch(`${baseUrl}v1/card/associate_token_with_customer`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${cardToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ id_customer: customerId, token: tokenId }),
          });
          const assocRaw = await assocResp.text();
          console.log("[iopay-cards] associate:", assocResp.status, assocRaw.substring(0, 300));

          let assocData: any;
          try { assocData = JSON.parse(assocRaw); } catch { assocData = { raw: assocRaw }; }

          let cardId = assocData?.id_card || assocData?.id || assocData?.success?.id_card || assocData?.success?.id;
          if (assocData?.success && typeof assocData.success === "object") {
            cardId = cardId || assocData.success.id_card || assocData.success.id;
          }
          if (!assocResp.ok || !cardId) {
            return new Response(JSON.stringify({ error: "Erro ao vincular: " + assocRaw.substring(0, 300) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          await fetch(`${baseUrl}v1/card/set_default/${customerId}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${cardToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ id_card: cardId }),
          });

          return Response.json({ success: true, id_card: cardId }, { headers: corsHeaders });
        }

        if (action === "set_default" && id_card) {
          const cardToken = await getCardToken(settings);
          await fetch(`${baseUrl}v1/card/set_default/${customerId}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${cardToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ id_card }),
          });
          return Response.json({ success: true }, { headers: corsHeaders });
        }

        return new Response(JSON.stringify({ error: "Ação inválida" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (req.method === "DELETE") {
        const { id_card } = await req.json();
        if (!id_card) {
          return new Response(JSON.stringify({ error: "id_card obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const cardToken = await getCardToken(settings);
        const resp = await fetch(`${baseUrl}v1/card/delete/${id_card}`, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${cardToken}`, "Content-Type": "application/json" },
        });
        const raw = await resp.text();
        console.log("[iopay-cards] delete:", resp.status, raw.substring(0, 300));

        return Response.json({ success: resp.ok, raw }, { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (error) {
      console.error("[iopay-cards] FATAL:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  },
};
