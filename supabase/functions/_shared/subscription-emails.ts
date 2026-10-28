/**
 * E-MAILS DE ASSINATURA — REGRA DE NEGÓCIO
 *
 * `_shared/user-emails.ts` cuida do TRANSPORTE (SMTP + trava de duplicidade).
 * Aqui mora o QUÊ: quando disparar, para quem, com o quê.
 *
 * Um detalhe importante: o e-mail "Assinatura confirmada" só sai na
 * ASSINATURA NOVA. A renovação do ciclo seguinte NÃO manda esse e-mail de novo
 * — quem renova já recebeu o aviso de vencimento. A distinção é feita pela
 * chave de dedup, que carrega o `created_at` da assinatura: a mesma assinatura
 * sempre gera a mesma chave, então a segunda tentativa é barrada pelo índice
 * UNIQUE. Uma assinatura CANCELADA e refeita é outra linha, com outra chave —
 * e aí o e-mail sai de novo, como deve ser.
 */

import {
  sendUserEmail,
  loadEmailSettings,
  isEventEnabled,
} from "./user-emails.ts";
import {
  subscriptionCreatedTemplate,
  paymentFailedTemplate,
  cancelledTemplate,
  appUrl,
} from "./email-templates.ts";
import { renewalDueAt } from "./subscription-dates.ts";

export type SubscriptionEmailResult = {
  sent: boolean;
  reason: string;
  error?: string;
};

/**
 * E-mail de "assinatura cancelada".
 *
 * Disparado quando a carência de 7 dias acaba e o acesso é encerrado. É o
 * fechamento do ciclo: a pessoa recebe o aviso de renovação, o aviso de
 * atraso e, se não regularizar, o cancelamento.
 */
export async function notifySubscriptionCancelled(
  supabaseAdmin: any,
  params: {
    userId: string;
    groupId: string;
    /** Data em que o acesso foi encerrado (fim da carência). */
    cancelledAt?: Date;
  },
): Promise<SubscriptionEmailResult> {
  try {
    const settings = await loadEmailSettings(supabaseAdmin);
    if (
      !settings.cancelled ||
      !isEventEnabled(settings, "subscription_cancelled")
    ) {
      return { sent: false, reason: "desativado nas configurações" };
    }

    const [userRes, groupRes, subRes] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, name, email")
        .eq("id", params.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("groups")
        .select("id, name")
        .eq("id", params.groupId)
        .maybeSingle(),
      supabaseAdmin
        .from("user_subscriptions")
        .select("id, created_at")
        .eq("user_id", params.userId)
        .eq("group_id", params.groupId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const user = userRes?.data;
    if (!user?.email) {
      return { sent: false, reason: "usuário sem e-mail" };
    }

    const sub = (subRes || [])[0];
    const url = appUrl({
      SITE_URL: Deno.env.get("SITE_URL"),
      APP_URL: Deno.env.get("APP_URL"),
    });

    const content = cancelledTemplate({
      name: user.name || "cliente",
      groupName: groupRes?.data?.name || "seu grupo",
      url,
    });

    const result = await sendUserEmail(supabaseAdmin, {
      eventType: "subscription_cancelled",
      dedupKey: `subscription_cancelled:${sub?.id || params.groupId}:${sub?.created_at || params.userId}`,
      userId: params.userId,
      to: user.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      meta: {
        subscription_id: sub?.id || null,
        group_id: params.groupId,
        group_name: groupRes?.data?.name || null,
        cancelled_at: (params.cancelledAt || new Date()).toISOString(),
      },
    });

    return {
      sent: result.sent,
      reason: result.reason,
      error: result.error,
    };
  } catch (error: any) {
    console.error(
      "[subscription-emails] falha no e-mail de assinatura cancelada:",
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
 * E-mail de "assinatura confirmada".
 *
 * Chamado depois que o pagamento da assinatura é aprovado. Não lança: a
 * confirmação do pagamento não pode depender do e-mail.
 */
export async function notifySubscriptionCreated(
  supabaseAdmin: any,
  params: {
    userId: string;
    groupId: string;
    /** Transação/gateway — entra na trilha, não na chave de dedup. */
    transactionId?: string | null;
  },
): Promise<SubscriptionEmailResult> {
  try {
    const settings = await loadEmailSettings(supabaseAdmin);
    if (!settings.subscription || !isEventEnabled(settings, "subscription_created")) {
      return { sent: false, reason: "desativado nas configurações" };
    }

    // ── A assinatura (a mais recente do par usuário/grupo) ───────────────
    const { data: subRows } = await supabaseAdmin
      .from("user_subscriptions")
      .select(
        "id, user_id, group_id, service_id, amount, billing_cycle, status, renewal_due_at, next_charge_at, expires_at, created_at",
      )
      .eq("user_id", params.userId)
      .eq("group_id", params.groupId)
      .order("created_at", { ascending: false })
      .limit(1);

    const sub = (subRows || [])[0];
    if (!sub) {
      return { sent: false, reason: "assinatura não encontrada" };
    }

    const [userRes, groupRes, serviceRes] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, name, email")
        .eq("id", params.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("groups")
        .select("id, name")
        .eq("id", params.groupId)
        .maybeSingle(),
      sub.service_id
        ? supabaseAdmin
            .from("streaming_services")
            .select("id, name, full_name")
            .eq("id", sub.service_id)
            .maybeSingle()
        : Promise.resolve({ data: null as any }),
    ]);

    const user = userRes?.data;
    if (!user?.email) {
      return { sent: false, reason: "usuário sem e-mail" };
    }

    const due = renewalDueAt(sub);
    const url = appUrl({
      SITE_URL: Deno.env.get("SITE_URL"),
      APP_URL: Deno.env.get("APP_URL"),
    });

    const content = subscriptionCreatedTemplate({
      name: user.name || "cliente",
      groupName: groupRes?.data?.name || "seu grupo",
      serviceName:
        serviceRes?.data?.full_name || serviceRes?.data?.name || null,
      amount: sub.amount,
      cycle: sub.billing_cycle,
      renewalDate: due ? due.toISOString() : new Date().toISOString(),
      url,
    });

    const result = await sendUserEmail(supabaseAdmin, {
      eventType: "subscription_created",
      // `created_at` é o que separa "assinatura nova" de "renovação": a
      // renovação reaproveita a mesma linha, logo a chave é a mesma e o
      // banco barra o segundo envio.
      dedupKey: `subscription_created:${sub.id}:${sub.created_at}`,
      userId: params.userId,
      to: user.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      meta: {
        subscription_id: sub.id,
        group_id: params.groupId,
        group_name: groupRes?.data?.name || null,
        service_name: serviceRes?.data?.full_name || serviceRes?.data?.name || null,
        amount: Number(sub.amount) || 0,
        billing_cycle: sub.billing_cycle,
        renewal_due_at: due ? due.toISOString() : null,
        transaction_id: params.transactionId || null,
      },
    });

    return {
      sent: result.sent,
      reason: result.reason,
      error: result.error,
    };
  } catch (error: any) {
    console.error(
      "[subscription-emails] falha no e-mail de assinatura criada:",
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
 * E-mail de "não conseguimos cobrar".
 *
 * Disparado quando a cobrança recorrente é recusada. A chave carrega o ciclo
 * (a data da tentativa) para que o cliente não receba o mesmo aviso várias
 * vezes no mesmo ciclo, mas receba um novo se o ciclo for refundido.
 */
export async function notifyPaymentFailed(
  supabaseAdmin: any,
  params: {
    userId: string;
    groupId: string;
    amount: number;
    /** Data da próxima tentativa de cobrança. */
    retryDate: Date;
    /** Número da tentativa (1..3). */
    attempt?: number;
  },
): Promise<SubscriptionEmailResult> {
  try {
    const settings = await loadEmailSettings(supabaseAdmin);
    if (
      !settings.paymentFailed ||
      !isEventEnabled(settings, "payment_failed")
    ) {
      return { sent: false, reason: "desativado nas configurações" };
    }

    const [userRes, groupRes, subRes] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, name, email")
        .eq("id", params.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("groups")
        .select("id, name")
        .eq("id", params.groupId)
        .maybeSingle(),
      supabaseAdmin
        .from("user_subscriptions")
        .select("id, created_at")
        .eq("user_id", params.userId)
        .eq("group_id", params.groupId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const user = userRes?.data;
    if (!user?.email) {
      return { sent: false, reason: "usuário sem e-mail" };
    }

    const sub = (subRes || [])[0];
    const url = appUrl({
      SITE_URL: Deno.env.get("SITE_URL"),
      APP_URL: Deno.env.get("APP_URL"),
    });

    const content = paymentFailedTemplate({
      name: user.name || "cliente",
      groupName: groupRes?.data?.name || "seu grupo",
      amount: params.amount,
      retryDate: params.retryDate.toISOString(),
      url,
    });

    const attempt = params.attempt || 1;

    const result = await sendUserEmail(supabaseAdmin, {
      eventType: "payment_failed",
      dedupKey: `payment_failed:${sub?.id || params.groupId}:${params.retryDate.toISOString()}:${attempt}`,
      userId: params.userId,
      to: user.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      meta: {
        subscription_id: sub?.id || null,
        group_id: params.groupId,
        group_name: groupRes?.data?.name || null,
        amount: Number(params.amount) || 0,
        attempt,
        retry_at: params.retryDate.toISOString(),
      },
    });

    return {
      sent: result.sent,
      reason: result.reason,
      error: result.error,
    };
  } catch (error: any) {
    console.error(
      "[subscription-emails] falha no e-mail de cobrança recusada:",
      error,
    );
    return {
      sent: false,
      reason: "erro",
      error: error?.message || String(error),
    };
  }
}
