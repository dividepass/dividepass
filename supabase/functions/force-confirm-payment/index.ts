import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyAdminPayment } from "../_shared/admin-payment-email.ts";
// Confirmação compartilhada — o mesmo caminho do webhook e do polling.
import { confirmPayment } from "../confirm-payment/index.ts";

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
  const resp = await fetch(`${baseUrl}auth/login?email=${encodeURIComponent(settings.iopay_email || "")}&secret=${encodeURIComponent(settings.iopay_secret || "")}&io_seller_id=${encodeURIComponent(settings.iopay_seller_id || "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: settings.iopay_email, secret: settings.iopay_secret, io_seller_id: settings.iopay_seller_id }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error("IOPay auth failed");
  return data.access_token;
}

function extractResponseData(data: any): any {
  if (data?.success && typeof data.success === "object") return data.success;
  if (data?.data && typeof data.data === "object") return data.data;
  return data;
}

function isApproved(status: string): boolean {
  const s = (status || "").toLowerCase();
  if (["succeeded", "approved", "paid", "authorized", "captured", "completed", "done", "success", "settled", "confirmed"].includes(s)) return true;
  if (["failed", "cancelled", "canceled", "rejected", "voided", "expired", "error", "denied", "refused", "chargeback"].includes(s)) return false;
  return false;
}

function calculateNextChargeDate(cycle: string, customDays?: number | null, customMonths?: number | null): Date {
  const d = new Date();
  if (cycle === "days" && customDays) {
    d.setDate(d.getDate() + customDays);
  } else if (cycle === "quarterly") {
    d.setMonth(d.getMonth() + 3);
  } else if (cycle === "semiannual") {
    d.setMonth(d.getMonth() + 6);
  } else if (cycle === "annual") {
    d.setFullYear(d.getFullYear() + 1);
  } else if (cycle === "custom") {
    d.setMonth(d.getMonth() + (customMonths || 1));
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}

async function getSettings(supabaseAdmin: any): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from("app_settings").select("key, value").in("key", [
    "iopay_env", "iopay_email", "iopay_secret", "iopay_seller_id",
  ]);
  const settings: Record<string, string> = {};
  (data || []).forEach((row: any) => { settings[row.key] = row.value; });
  return settings;
}

/**
 * Confirmação manual do admin — DELEGA para a confirmação compartilhada.
 *
 * POR QUE MUDOU
 * -------------
 * A confirmação manual tinha a sua PRÓPIA cópia da regra (mais 200 linhas).
 * Consequências diretas no caso real de 01/11/2026:
 *
 *   - quem era liberado na mão (o "Pagamento confirmado (forçado)") NÃO recebia
 *     nenhum e-mail — nem o aviso de pagamento recebido, nem o de assinatura
 *     criada. A Fran entrou no grupo às 15:40 e nunca recebeu um e-mail da
 *     DividePass;
 *   - a linha em `payments` não tinha `official_price`/`paid_amount` (o
 *     painel de economia ficava inconsistente);
 *   - faturas vencidas não eram quitadas e o `billing_cycles` do próximo
 *     ciclo não era criado — a renovação não nascia.
 *
 * Agora a confirmação manual passa pelo MESMO caminho de todo mundo
 * (`confirmPayment`): mesma liberação, mesmos eventos, mesmas faturas e os
 * DOIS e-mails do cliente.
 *
 * A única parte que continua aqui é a FATURA, que não existe na confirmação
 * compartilhada.
 */
async function confirmIOPayment(
  supabaseAdmin: any,
  group_id: string,
  user_id: string,
  payment_type: "entrance" | "subscription" | "combined" | "invoice",
  amount: number,
  gateway_payment_id: string,
): Promise<{ success: boolean; error?: string }> {
  // ── FATURA ────────────────────────────────────────────────────────────────
  if (payment_type === "invoice") {
    try {
      const { data: invToUpdate } = await supabaseAdmin
        .from("invoices")
        .select("id")
        .eq("user_id", user_id)
        .eq("group_id", group_id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (invToUpdate) {
        await supabaseAdmin.from("invoices").update({
          status: "paid",
          paid_at: new Date().toISOString(),
          gateway_transaction_id: gateway_payment_id,
        }).eq("id", invToUpdate.id);
      }

      supabaseAdmin.from("payments").insert({
        user_id,
        amount,
        method: "pix",
        status: "paid",
        payment_type: "invoice",
        group_id,
        transaction_code: gateway_payment_id,
        gateway: "iopay",
        notes: "Fatura via PIX",
      }).then(({ error }: any) => {
        if (error) console.error("[force-confirm] payments error:", error);
      });

      return { success: true };
    } catch (e: any) {
      return { success: false, error: "invoice error: " + e.message };
    }
  }

  // ── ADESÃO / ASSINATURA ───────────────────────────────────────────────────
  //
  // `forced: true` mantém o rótulo "Pagamento confirmado (forçado)" no
  // painel, para o admin distinguir na hora o que foi automático do que foi
  // liberado na mão.
  if (payment_type !== "entrance" && payment_type !== "subscription" && payment_type !== "combined") {
    return { success: false, error: "Tipo de pagamento desconhecido: " + payment_type };
  }

  const result = await confirmPayment({
    gateway: "iopay",
    group_id,
    user_id,
    payment_type,
    amount,
    status: "approved",
    gateway_payment_id,
    payment_method: "pix",
    forced: true,
  });

  if (!result?.success) {
    console.error(
      `[force-confirm] confirmPayment falhou (${payment_type}): ${result?.error}`,
    );
  }

  return { success: !!result?.success, error: result?.error };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: userData } = await supabaseAdmin.from("users").select("role").eq("id", user.id).maybeSingle();
    if (userData?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Sem permissão" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { transaction_id, payment_id, group_id, user_id, payment_type } = body;

    let txId = transaction_id;
    let targetUserId = user_id;
    let targetGroupId = group_id;
    let targetPaymentType = payment_type;
    let targetAmount = 0;

    if (payment_id && !txId) {
      const { data: payment } = await supabaseAdmin
        .from("payments").select("*").eq("id", payment_id).maybeSingle();
      if (payment) {
        txId = payment.transaction_code;
        targetUserId = payment.user_id;
        targetGroupId = payment.group_id;
        targetPaymentType = payment.payment_type;
        targetAmount = payment.amount;
      }
    }

    if (!txId && payment_id) {
      const { data: attempt } = await supabaseAdmin
        .from("payment_attempts").select("*").eq("id", payment_id).maybeSingle();
      if (attempt) {
        txId = attempt.gateway_transaction_id || attempt.external_reference;
        targetUserId = attempt.user_id;
        targetGroupId = attempt.group_id;
        targetPaymentType = attempt.payment_type;
        targetAmount = attempt.amount;
      }
    }

    if (!txId) {
      return new Response(JSON.stringify({ error: "Transaction ID não encontrado." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const settings = await getSettings(supabaseAdmin);
    if (!settings.iopay_secret || !settings.iopay_email || !settings.iopay_seller_id) {
      return new Response(JSON.stringify({ error: "Credenciais IOPAY não configuradas" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = await getToken(settings);
    const baseUrl = getBaseUrl(settings);

    const txResp = await fetch(`${baseUrl}v1/transaction/get/${txId}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const txRaw = await txResp.json();
    const txData = extractResponseData(txRaw);
    const status = String(txData?.status || txRaw?.status || "unknown").toLowerCase().trim();

    if (!isApproved(status)) {
      return new Response(JSON.stringify({
        confirmed: false,
        iopay_status: status,
        error: `Pagamento não aprovado no gateway (${status || 'unknown'}).`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!targetUserId || !targetGroupId) {
      const refId = txData?.reference_id || txRaw?.reference_id || "";
      if (refId.includes(":")) {
        const parts = refId.split(":");
        if (parts.length >= 2) {
          targetGroupId = targetGroupId || parts[0];
          targetUserId = targetUserId || parts[1];
          targetPaymentType = targetPaymentType || parts[2] || "subscription";
        }
      }
    }

    if (!targetUserId || !targetGroupId) {
      return new Response(JSON.stringify({
        error: "Não foi possível determinar user_id e group_id.",
        iopay_status: status,
        iopay_response: txRaw,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!targetAmount) {
      const rawAmount = txData?.amount ?? txRaw?.amount ?? 0;
      targetAmount = typeof rawAmount === "string" ? parseFloat(rawAmount) || 0 : rawAmount;
      if (targetAmount > 100) targetAmount = targetAmount / 100;
    }

    const result = {
      transaction_id: txId,
      iopay_status: status,
      is_approved: isApproved(status),
      user_id: targetUserId,
      group_id: targetGroupId,
      payment_type: targetPaymentType,
      amount: targetAmount,
      confirmed: false,
      error: null as string | null,
    };

    let confirmResult = await confirmIOPayment(supabaseAdmin, targetGroupId, targetUserId, targetPaymentType, targetAmount, txId);
    if (!confirmResult.success) {
      await new Promise(r => setTimeout(r, 1000));
      confirmResult = await confirmIOPayment(supabaseAdmin, targetGroupId, targetUserId, targetPaymentType, targetAmount, txId);
    }
    result.confirmed = confirmResult.success;
    result.error = confirmResult.error || null;

    // Confirmação manual pelo admin também avisa por e-mail (mesmo formato
    // do aviso automático — a deduplicação é pela transação).
    if (confirmResult.success) {
      await notifyAdminPayment(supabaseAdmin, {
        groupId: targetGroupId,
        userId: targetUserId,
        amount: targetAmount,
        paymentType: targetPaymentType,
        gateway: "iopay",
        transactionId: txId,
        paymentMethod: "pix",
      });
    }

    return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("force-confirm-payment error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});