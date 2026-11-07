/**
 * E-MAILS DO CICLO DE PAGAMENTO — "recebemos" e "você entrou no grupo"
 * =============================================================================
 * POR QUE ESTE MÓDULO EXISTE
 * --------------------------
 * Antes, o único e-mail de confirmação do mundo era `subscription_created`,
 * disparado DENTRO de `confirm-payment/index.ts`. Isso significava:
 *
 *   - o polling do navegador (`check-iopay-tx`) confirmava o pagamento com a
 *     PRÓPRIA cópia da lógica e NUNCA mandava e-mail;
 *   - a confirmação manual do admin (`force-confirm-payment`) também nunca
 *     mandava e-mail;
 *   - e não existia nenhum aviso de "recebemos o seu pagamento" — a cliente
 *     pagava e só recebia o e-mail do gateway.
 *
 * Resultado em produção: a Fran pagou R$ 59,40, o gateway aprovou, o sistema
 * não liberou o grupo e ela recebeu NENHUM e-mail da DividePass — só o do
 * gateway. Ficou sem saber o que tinha acontecido e abriu um suporte.
 *
 * COMO FUNCIONA AGORA
 * -------------------
 * Todo caminho que confirma um pagamento (webhook, polling, confirmação
 * manual e o job de reconciliação) passa por `confirmPayment`, que chama
 * ESTE módulo. Assim os e-mails saem sempre, independente de por onde o
 * pagamento foi confirmado.
 *
 * Os dois e-mails são idempotentes por `dedup_key`: reenvio do webhook,
 * replay do polling ou o job de reconciliação passando de novo não geram
 * e-mail duplicado.
 */

import {
  sendUserEmail,
  loadEmailSettings,
  isEventEnabled,
} from "./user-emails.ts";
import {
  paymentReceivedTemplate,
  memberJoinedTemplate,
  appUrl,
} from "./email-templates.ts";

export type PaymentEmailResult = {
  sent: boolean;
  reason: string;
  error?: string;
};

/** Dados que os dois e-mails precisam. */
type PaymentEmailContext = {
  userId: string;
  groupId: string;
  /** Valor pago (R$). */
  amount?: number | null;
  /** Transação do gateway — entra na chave de dedup. */
  transactionId?: string | null;
  /** 'subscription' | 'entrance' | 'combined' | 'invoice' */
  paymentType?: string | null;
};

/** Carrega nome/e-mail do cliente e nome do grupo. */
async function carregarContexto(
  supabaseAdmin: any,
  ctx: PaymentEmailContext,
): Promise<{ user: { name: string; email: string } | null; groupName: string | null }> {
  const [userRes, groupRes] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("name, email")
      .eq("id", ctx.userId)
      .limit(1),
    supabaseAdmin
      .from("groups")
      .select("name")
      .eq("id", ctx.groupId)
      .limit(1),
  ]);

  const u = (userRes?.data || [])[0];
  const g = (groupRes?.data || [])[0];

  return {
    user: u?.email ? { name: u.name || "cliente", email: u.email } : null,
    groupName: g?.name || null,
  };
}

/**
 * E-mail 1 — "Recebemos o seu pagamento".
 *
 * Sai assim que o gateway aprova o pagamento. Antes da liberação no grupo:
 * a cliente precisa saber que o dinheiro caiu, mesmo que a liberação leve
 * alguns minutos.
 */
export async function notifyPaymentReceived(
  supabaseAdmin: any,
  ctx: PaymentEmailContext,
): Promise<PaymentEmailResult> {
  try {
    const settings = await loadEmailSettings(supabaseAdmin);
    if (!isEventEnabled(settings, "payment_received")) {
      return { sent: false, reason: "desativado nas configurações" };
    }

    const { user, groupName } = await carregarContexto(supabaseAdmin, ctx);
    if (!user) return { sent: false, reason: "usuário sem e-mail" };

    const url = appUrl({
      SITE_URL: Deno.env.get("SITE_URL"),
      APP_URL: Deno.env.get("APP_URL"),
    });

    const content = paymentReceivedTemplate({
      name: user.name,
      groupName: groupName || "seu grupo",
      amount: Number(ctx.amount || 0),
      paymentType: ctx.paymentType || null,
      url,
    });

    const result = await sendUserEmail(supabaseAdmin, {
      eventType: "payment_received",
      // A chave carrega a transação: o mesmo pagamento não gera dois avisos,
      // mas uma renovação nova (nova transação) avisa de novo.
      dedupKey: `payment_received:${ctx.transactionId || `${ctx.userId}:${ctx.groupId}`}`,
      userId: ctx.userId,
      to: user.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      meta: {
        group_id: ctx.groupId,
        group_name: groupName || null,
        amount: Number(ctx.amount || 0),
        payment_type: ctx.paymentType || null,
        transaction_id: ctx.transactionId || null,
      },
    });

    return { sent: result.sent, reason: result.reason, error: result.error };
  } catch (error: any) {
    console.error(
      "[payment-emails] falha no e-mail de pagamento recebido:",
      error,
    );
    return {
      sent: false,
      reason: "erro",
      error: error?.message || String(error),
    };
  }
}

/**
 * E-mail 2 — "Sua assinatura foi criada / acabamos de ingressar você no grupo".
 *
 * Sai DEPOIS que o vínculo no grupo foi gravado. É o e-mail que fecha o
 * ciclo: o dinheiro entrou, a pessoa entrou no grupo e as credenciais estão
 * na conta dela.
 */
export async function notifyMemberJoined(
  supabaseAdmin: any,
  ctx: PaymentEmailContext,
): Promise<PaymentEmailResult> {
  try {
    const settings = await loadEmailSettings(supabaseAdmin);
    if (!isEventEnabled(settings, "member_joined")) {
      return { sent: false, reason: "desativado nas configurações" };
    }

    const { user, groupName } = await carregarContexto(supabaseAdmin, ctx);
    if (!user) return { sent: false, reason: "usuário sem e-mail" };

    const url = appUrl({
      SITE_URL: Deno.env.get("SITE_URL"),
      APP_URL: Deno.env.get("APP_URL"),
    });

    const content = memberJoinedTemplate({
      name: user.name,
      groupName: groupName || "seu grupo",
      amount: ctx.amount != null ? Number(ctx.amount) : null,
      paymentType: ctx.paymentType || null,
      url,
    });

    const result = await sendUserEmail(supabaseAdmin, {
      eventType: "member_joined",
      dedupKey: `member_joined:${ctx.transactionId || `${ctx.userId}:${ctx.groupId}`}`,
      userId: ctx.userId,
      to: user.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      meta: {
        group_id: ctx.groupId,
        group_name: groupName || null,
        amount: ctx.amount != null ? Number(ctx.amount) : null,
        payment_type: ctx.paymentType || null,
        transaction_id: ctx.transactionId || null,
      },
    });

    return { sent: result.sent, reason: result.reason, error: result.error };
  } catch (error: any) {
    console.error(
      "[payment-emails] falha no e-mail de entrada no grupo:",
      error,
    );
    return {
      sent: false,
      reason: "erro",
      error: error?.message || String(error),
    };
  }
}
