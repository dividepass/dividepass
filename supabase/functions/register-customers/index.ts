// register-customers: Creates customers on all gateways when a user registers
// Called from AuthProvider after successful registration

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const body = await req.json();
      const { user_id } = body;

      if (!user_id) {
        return new Response(
          JSON.stringify({ error: "user_id required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get user profile
      const { data: user, error: userError } = await supabaseAdmin
        .from("users")
        .select("id, name, email, phone")
        .eq("id", user_id)
        .single();

      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: "User not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if already has customers
      const { data: existing } = await supabaseAdmin
        .from("users")
        .select("customer_id_iopay, customer_id_stripe, customer_id_asaas, customer_id_mercadopago, customer_id_pagarme")
        .eq("id", user_id)
        .single();

      const settings = await getGatewaySettings();
      const results: Record<string, string | null> = {};

      // ── IOPay Customer ──
      if (!existing?.customer_id_iopay && settings.iopay_secret) {
        try {
          const ioEmail = settings.iopay_email || "";
          const ioSecret = settings.iopay_secret || "";
          const ioSellerId = settings.iopay_seller_id || "";
          const iopayEnv = settings.iopay_env || "production";
          const baseUrl = iopayEnv === "sandbox"
            ? "https://sandbox.api.iopay.com.br/api/"
            : "https://api.iopay.com.br/api/";

          // Auth via auth/login endpoint (with query params + body)
          const authUrl = `${baseUrl}auth/login?email=${encodeURIComponent(ioEmail)}&secret=${encodeURIComponent(ioSecret)}&io_seller_id=${encodeURIComponent(ioSellerId)}`;
          const authResp = await fetch(authUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: ioEmail,
              secret: ioSecret,
              io_seller_id: ioSellerId,
            }),
          });

          const authData = await authResp.json();
          if (authResp.ok && authData.access_token) {
            const resp = await fetch(`${baseUrl}v1/customer/new`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${authData.access_token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                first_name: user.name || "Cliente",
                email: user.email,
                phone: user.phone || "",
                address: {
                  city: "Sao Paulo",
                  state: "SP",
                },
              }),
            });

            const data = await resp.json();
            const custId = data.id || data.Id;
            if (resp.ok && custId) {
              results.customer_id_iopay = custId;
              await supabaseAdmin
                .from("users")
                .update({ customer_id_iopay: custId })
                .eq("id", user_id);
            } else {
              console.error("IOPay customer creation error:", data);
            }
          } else {
            console.error("IOPay auth error:", authData);
          }
        } catch (e) {
          console.error("IOPay customer creation error:", e);
        }
      }

      // ── Stripe Customer ──
      if (!existing?.customer_id_stripe && settings.stripe_secret_key) {
        try {
          const resp = await fetch("https://api.stripe.com/v1/customers", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${settings.stripe_secret_key}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              email: user.email,
              name: user.name || "",
              metadata: `[user_id]=${user_id}`,
            }).toString(),
          });

          const data = await resp.json();
          if (resp.ok && data.id) {
            results.customer_id_stripe = data.id;
            await supabaseAdmin
              .from("users")
              .update({ customer_id_stripe: data.id })
              .eq("id", user_id);
          }
        } catch (e) {
          console.error("Stripe customer creation error:", e);
        }
      }

      // ── Asaas Customer ──
      if (!existing?.customer_id_asaas && settings.asaas_api_key) {
        try {
          const asaasEnv = settings.asaas_env || "sandbox";
          const baseUrl = asaasEnv === "production"
            ? "https://api.asaas.com"
            : "https://sandbox.asaas.com/api/v3";

          const resp = await fetch(`${baseUrl}/customers`, {
            method: "POST",
            headers: {
              "access_token": settings.asaas_api_key,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: user.name || "Cliente",
              email: user.email,
              phone: user.phone || "",
              cpfCnpj: "",
            }),
          });

          const data = await resp.json();
          if (resp.ok && data.id) {
            results.customer_id_asaas = data.id;
            await supabaseAdmin
              .from("users")
              .update({ customer_id_asaas: data.id })
              .eq("id", user_id);
          }
        } catch (e) {
          console.error("Asaas customer creation error:", e);
        }
      }

      // ── Mercado Pago (no customer API - uses email reference) ──
      results.customer_id_mercadopago = user.email;

      // ── PagarMe Customer (V5 API) ──
      if (!existing?.customer_id_pagarme && settings.pagarme_secret_key) {
        try {
          const resp = await fetch("https://api.pagar.me/core/v5/customers", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Basic " + btoa(settings.pagarme_secret_key + ":"),
            },
            body: JSON.stringify({
              name: user.name || "Cliente",
              email: user.email,
              type: "individual",
            }),
          });

          const data = await resp.json();
          if (resp.ok && data.id) {
            results.customer_id_pagarme = data.id;
            await supabaseAdmin
              .from("users")
              .update({ customer_id_pagarme: data.id })
              .eq("id", user_id);
          }
        } catch (e) {
          console.error("PagarMe customer creation error:", e);
        }
      }

      return Response.json(
        { success: true, customers: results },
        { headers: corsHeaders }
      );

    } catch (error) {
      console.error("register-customers error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
