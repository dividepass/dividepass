// ============================================================================
// Polling do status de um pagamento Woovi.
//
// POR QUE EXISTE
// --------------
// O `check-iopay-tx` é o que faz o checkout sair da tela de "aguarde o
// pagamento" quando o usuário paga por Pix. A Woovi tem o seu equivalente
// aqui: `check-woovi-tx`.
//
// O webhook (`woovi-webhook`) é o caminho principal de confirmação, mas o
// polling é a rede de segurança: se o webhook estiver atrasado, atrasado
// para sempre (ou ainda não tiver sido registrado na Woovi — o caso da
// integração em standby), o polling confirma assim mesmo.
//
// A REGRA DE CONFIRMAÇÃO É A MESMA DO WEBHOOK
// --------------------------------------------
// Tudo que decide "o que fazer quando o pagamento foi aprovado" mora em
// `_shared/woovi-confirm.ts`. Aqui só há o CONSULTAR O STATUS.
//
// FORMATO DA RESPOSTA
// -------------------
// Mesma do `check-iopay-tx`, para o frontend não precisar bifurcar:
//   { transaction_id, status, confirmed, confirm_error?, amount,
//     payment_method, pix_copy_paste? }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewaySettings } from "../create-payment/handlers/settings.ts";
import {
  getWooviConfig,
  erroAppIdAusente,
  wooviRequest,
  fromCents,
  isApprovedStatus,
  isRejectedStatus,
  WooviApiError,
} from "../_shared/woovi.ts";
import { confirmWooviCharge, confirmWooviInstallment } from "../_shared/woovi-confirm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const settings = await getGatewaySettings();
      const cfg = getWooviConfig(settings);

      if (!cfg.appId) {
        return json(
          {
            transaction_id: null,
            status: "not_configured",
            confirmed: false,
            error: erroAppIdAusente(cfg.env),
            ambiente: cfg.env,
          },
          200,
        );
      }

      // ---------------------------------------------------------------------
      // AUTENTICAÇÃO (mesma política do check-iopay-tx)
      // ---------------------------------------------------------------------
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
      const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

      if (!jwt) {
        return json({ error: "Não autenticado" }, 401);
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

      const { data: authData } = await supabaseAdmin.auth.getUser(jwt);
      if (!authData?.user) {
        return json({ error: "Token inválido" }, 401);
      }

      const body = await req.json();
      const { transaction_id } = body;

      if (!transaction_id) {
        return json({ error: "transaction_id é obrigatório" }, 400);
      }

      // ── É uma COBRANÇA avulsa? ────────────────────────────────────────────
      let charge: any = null;
      try {
        const res = await wooviRequest<any>(cfg, "GET", `/api/v1/charge/${transaction_id}`);
        charge = res?.charge || res;
      } catch (e: any) {
        if (!(e instanceof WooviApiError) || (e.status !== 404 && e.status !== 400)) {
          console.error("[check-woovi-tx] GET charge erro:", e?.message || e);
        }
      }

      if (charge && charge.identifier) {
        const status = String(charge.status || "pending").toUpperCase();
        const amount = fromCents(charge.value || 0);
        const paid = status === "COMPLETED" || isApprovedStatus(status);

        console.log(`[check-woovi-tx] charge ${transaction_id} status=${status} paid=${paid}`);

        if (!paid) {
          return json({
            transaction_id,
            status: status.toLowerCase(),
            confirmed: false,
            amount,
            payment_method: "pix",
            pix_copy_paste: charge.brCode || null,
          });
        }

        // ── Cobrança paga: confirma (idempotente) ──────────────────────────
        const result = await confirmWooviCharge(supabaseAdmin, { charge });
        return json({
          transaction_id,
          status: "completed",
          confirmed: result.ok,
          confirm_error: result.ok ? undefined : result.error,
          amount: result.amount ?? amount,
          payment_method: "pix",
          pix_copy_paste: charge.brCode || null,
        });
      }

      // ── Não é charge: então é o MANDATE do Pix Automático ────────────────
      const subRes = await wooviRequest<any>(cfg, "GET", `/api/v1/subscriptions/${transaction_id}`);
      const subscription = subRes?.subscription || subRes;

      if (!subscription?.globalID) {
        return json({
          transaction_id,
          status: "unknown",
          confirmed: false,
          error: "Transação não encontrada na Woovi",
        });
      }

      const instRes = await wooviRequest<any>(
        cfg,
        "GET",
        `/api/v1/subscriptions/${transaction_id}/installments`,
      );
      const installments: any[] = instRes?.installments || [];

      // A parcela mais recente que já foi paga.
      const paidInstallment =
        installments.find((i: any) => {
          const st = String(i?.status || i?.cobr?.status || "").toUpperCase();
          return st === "COMPLETED" || isApprovedStatus(st);
        }) || null;

      const latest = installments[installments.length - 1] || null;
      const latestStatus = String(
        latest?.status || latest?.cobr?.status || subscription?.status || "pending",
      ).toUpperCase();

      const mandateStatus = String(
        subscription?.pixRecurring?.status || subscription?.pixRecurringOptions?.status || "",
      ).toUpperCase();

      console.log(
        `[check-woovi-tx] mandate ${transaction_id} mandate=${mandateStatus} ultima=${latestStatus} ` +
          `parcelas=${installments.length} paga=${!!paidInstallment}`,
      );

      if (!paidInstallment) {
        return json({
          transaction_id,
          status: latestStatus.toLowerCase(),
          confirmed: false,
          amount: fromCents(latest?.value || subscription?.value || 0),
          payment_method: "pix",
          // O mandate ainda não foi aprovado pelo pagador.
          mandate_status: mandateStatus.toLowerCase() || null,
          rejected: isRejectedStatus(mandateStatus) || isRejectedStatus(latestStatus),
        });
      }

      // ── Parcela paga: confirma ───────────────────────────────────────────
      const result = await confirmWooviInstallment(supabaseAdmin, {
        paymentSubscriptionGlobalID: subscription.globalID,
        correlationID: subscription.correlationID,
        installmentNumber: paidInstallment.installmentNumber,
        value: paidInstallment.value,
        cobr: { identifierId: paidInstallment.cobr?.identifierId },
      });

      return json({
        transaction_id,
        status: "completed",
        confirmed: result.ok,
        confirm_error: result.ok ? undefined : result.error,
        amount: fromCents(paidInstallment.value || subscription?.value || 0),
        payment_method: "pix",
        mandate_status: mandateStatus.toLowerCase() || null,
      });
    } catch (e: any) {
      console.error("[check-woovi-tx] erro:", e);
      return json(
        {
          transaction_id: null,
          status: "error",
          confirmed: false,
          error: e?.message || "erro interno",
        },
        500,
      );
    }
  },
};
