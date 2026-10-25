import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { confirmPayment } from "../confirm-payment/index.ts";
import { getGatewaySettings } from "../create-payment/handlers/settings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * A IO Pay responde a transacao em varios formatos dependendo do endpoint
 * ({"success":{...}}, {"data":{...}}, {"result":{...}}, ou o objeto cru).
 * Sem desembrulhar, `transactionData.reference_id` vem undefined e o webhook
 * aborta em "Invalid external reference" — a confirmacao nunca acontece.
 * (O `force-confirm-payment` ja fazia isso; o webhook nao.)
 */
function extractResponseData(payload: any): any {
  if (!payload) return null;
  if (typeof payload !== "object") return null;
  const candidates = [payload.success, payload.data, payload.result, payload.transaction];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return payload;
}

/**
 * `payment_attempts` NAO tem coluna unica em `gateway_transaction_id`: o
 * polling do browser (`check-iopay-tx`) grava uma linha nova a cada poll com
 * o MESMO id. Com 2+ linhas, um `.maybeSingle()` devolve erro, `data` fica
 * null e o webhook saia com 200 sem confirmar nada — exatamente o sintoma
 * "o usuario pagou e a assinatura nao atualizou".
 *
 * Por isso: busca a linha mais ANTIGA (a de criacao, que e a que carrega
 * `external_reference` e `coupon_id`) com `.limit(1)`, nunca `.maybeSingle()`.
 */
async function findAttempt(supabaseAdmin: any, transactionId: string) {
  const { data, error } = await supabaseAdmin
    .from("payment_attempts")
    .select("id, gateway_transaction_id, external_reference, user_id, group_id, payment_method")
    .eq("gateway_transaction_id", transactionId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("[iopay-webhook] erro ao ler payment_attempts:", error.message);
    return null;
  }
  return (data && data[0]) || null;
}

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
        bearerToken = authData?.success?.access_token || authData?.data?.access_token || authData?.access_token || "";
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
          transactionData = extractResponseData(await txResp.json());
        } else {
          console.error("[iopay-webhook] IO Pay recusou a leitura da transacao:", txResp.status);
        }
      }

      if (!transactionData) {
        console.error("Could not fetch IOPay transaction:", transactionId);
        return Response.json({ received: true }, { headers: corsHeaders });
      }

      // Parse external reference from reference_id
      //
      // SEGURANCA (S11): o IO Pay nao assina seus webhooks, entao a unica
      // garantia de que a requisicao e legítima vem da propria transacao no
      // gateway. Por isso:
      //   1. a referencia vem SEMPRE da transacao (nunca do body), e
      //   2. a transacao precisa existir no banco como tentativa de pagamento
      //      (payment_attempts) — a tabela passou a ser service_role-only
      //      justamente para que o transaction_id nao seja publico.
      const externalRef = transactionData.reference_id || "";
      const parts = externalRef.split(":");

      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      // A transacao precisa ter sido criada por nos (payment_attempts).
      // Sem isso, qualquer transaction_id valido do gateway IO Pay — inclusive
      // de outra loja — poderia ser jogado no webhook para ativar uma vaga.
      const attempt = await findAttempt(supabaseAdmin, transactionId);

      if (!attempt) {
        console.error(
          "[iopay-webhook] transacao sem pagamento registrado — webhook ignorado:",
          transactionId,
        );
        return Response.json({ received: true }, { headers: corsHeaders });
      }

      // A referencia da transacao precisa ser a mesma que gravamos na tentativa.
      if (
        attempt.external_reference &&
        externalRef &&
        attempt.external_reference !== externalRef
      ) {
        console.error(
          "[iopay-webhook] referencia divergente entre tentativa e gateway — webhook ignorado",
          { esperado: attempt.external_reference, recebido: externalRef },
        );
        return Response.json({ received: true }, { headers: corsHeaders });
      }

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

      // ------------------------------------------------------------------
      // PAGAMENTO DE FATURA (reference_id = "invoice:<id>")
      //
      // A referencia de fatura tem 2 partes, nao 3. Antes ela caia no
      // early-return "Invalid external reference" e a fatura ficava
      // pendente para sempre — so o polling do browser resolvia.
      // ------------------------------------------------------------------
      if (parts[0] === "invoice") {
        const invoiceId = parts[1];
        if (!invoiceId) {
          console.error("[iopay-webhook] referencia de fatura invalida:", externalRef);
          return Response.json({ received: true }, { headers: corsHeaders });
        }

        const { data: invoice } = await supabaseAdmin
          .from("invoices")
          .select("id, user_id, group_id, amount, status")
          .eq("id", invoiceId)
          .limit(1);

        const inv = invoice && invoice[0];
        if (!inv) {
          console.error("[iopay-webhook] fatura nao encontrada para a referencia:", externalRef);
          return Response.json({ received: true }, { headers: corsHeaders });
        }

        if (status === "approved" && inv.status === "pending") {
          const { error: invErr } = await supabaseAdmin
            .from("invoices")
            .update({
              status: "paid",
              paid_at: new Date().toISOString(),
              gateway_transaction_id: String(transactionId),
            })
            .eq("id", inv.id)
            .eq("status", "pending");

          if (invErr) {
            console.error("[iopay-webhook] falha ao marcar fatura como paga:", invErr.message);
          } else {
            console.log("[iopay-webhook] fatura quitada pelo webhook:", inv.id);
            await supabaseAdmin.from("platform_events").insert({
              event_type: "payment",
              title: "Pagamento de fatura",
              message: `Fatura #${String(inv.id).slice(0, 8).toUpperCase()} quitada via webhook`,
              metadata: JSON.stringify({
                invoice_id: inv.id,
                user_id: inv.user_id,
                group_id: inv.group_id,
                amount: inv.amount,
                gateway: "iopay",
                payment_type: "invoice",
                transaction_id: transactionId,
              }),
            });
          }
        }

        return Response.json({ received: true, payment_type: "invoice" }, { headers: corsHeaders });
      }

      if (parts.length < 3) {
        console.error("Invalid external reference:", externalRef);
        return Response.json({ received: true }, { headers: corsHeaders });
      }

      const groupId = parts[0];
      const userId = parts[1];
      const paymentType = parts[2] as "entrance" | "subscription" | "combined";

      // `.maybeSingle()` em `user_subscriptions` por (group_id, user_id) falha
      // do mesmo jeito: um usuario pode ter mais de uma assinatura no mesmo
      // grupo (historico de transferencias). Busca a mais recente.
      const { data: subInfoRows } = await supabaseAdmin
        .from("user_subscriptions")
        .select("id, billing_cycle, custom_cycle_days, custom_cycle_months, payment_method, card_last4, card_brand")
        .eq("group_id", groupId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      const subInfo = (subInfoRows && subInfoRows[0]) || null;

      // O grupo precisa ser carregado: antes esta linha usava `group?.billing_cycle`
      // sem que `group` existisse no escopo -> ReferenceError -> HTTP 500 -> o
      // pagamento nunca era confirmado (acontecia quando NAO havia assinatura
      // para o par grupo/usuario, por exemplo em pagamento so de taxa de adesao).
      const { data: groupRows } = await supabaseAdmin
        .from("groups")
        .select("billing_cycle, custom_cycle_days, custom_cycle_months")
        .eq("id", groupId)
        .limit(1);
      const group = (groupRows && groupRows[0]) || null;

      // Buscar o billing_cycle do pagamento criado.
      // `payments.transaction_code` tambem pode ter mais de uma linha (uma
      // rejeitada + uma aprovada), entao `.maybeSingle()` aqui tambem abortava.
      const { data: paymentRows } = await supabaseAdmin
        .from("payments")
        .select("billing_cycle, custom_cycle_months, custom_cycle_days, months")
        .eq("transaction_code", transactionId)
        .order("created_at", { ascending: false })
        .limit(1);
      const paymentData = (paymentRows && paymentRows[0]) || null;

      const confirmResult = await confirmPayment({
        gateway: "iopay",
        group_id: groupId,
        user_id: userId,
        payment_type: paymentType,
        amount: (transactionData.amount || 0) / 100,
        status,
        gateway_payment_id: transactionData.id || transactionId,
        payment_method: transactionData.payment_method || subInfo?.payment_method || "credit_card",
        billing_cycle: paymentData?.billing_cycle || subInfo?.billing_cycle || group?.billing_cycle || "monthly",
        custom_cycle_days: paymentData?.custom_cycle_days || subInfo?.custom_cycle_days || null,
        custom_cycle_months: paymentData?.custom_cycle_months || subInfo?.custom_cycle_months || null,
      });

      if (!confirmResult?.success && status !== "pending") {
        console.error(
          "[iopay-webhook] confirmPayment nao confirmou:",
          confirmResult?.error || "erro desconhecido",
        );
      }

      // Log do webhook: ATUALIZA a tentativa existente em vez de inserir uma
      // linha nova com o mesmo `gateway_transaction_id`. Inserir criava a
      // duplicata que quebrava o proprio webhook na entrega seguinte.
      const { error: logErr } = await supabaseAdmin
        .from("payment_attempts")
        .update({
          status: `webhook_${status}`,
          gateway_response: {
            event_type: eventType,
            webhook_status: body.status,
            confirmed_status: status,
          },
        })
        .eq("id", attempt.id);

      if (logErr) {
        console.error("[iopay-webhook] falha ao registrar o log do webhook:", logErr.message);
      }

      return Response.json(
        { received: true, confirmed: status === "approved" },
        { headers: corsHeaders },
      );

    } catch (error) {
      console.error("IOPay webhook error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
