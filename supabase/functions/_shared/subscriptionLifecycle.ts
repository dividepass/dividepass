/**
 * Ciclo de vida da assinatura — regras de status em UM lugar só.
 *
 * REGRAS (as mesmas do `src/lib/subscriptionAccess.js` do front):
 *
 *   ATIVA      renovação > agora
 *   ATRASADA   renovação <= agora e ainda não passou da carência de 7 dias
 *              (o grupo continua visível; o acesso às credenciais, não)
 *   CANCELADA  passou de 7 dias: assinatura cancelada, usuário desvinculado do
 *              grupo, cobranças agendadas canceladas. A assinatura só passa a
 *              aparecer no histórico.
 *
 * A data de renovação é `renewal_due_at` (coluna nova, ver
 * `database/subscription-status-rules.sql`). Ela NÃO é mexida nas tentativas
 * de cobrança: `next_charge_at` anda para frente a cada retry, e usar ele
 * como "data de vencimento" encurtaria a carência de quem teve cartão
 * recusado. Legado (sem `renewal_due_at`) cai para `next_charge_at` e depois
 * `expires_at`.
 */

import { dispatchNotification } from "./send-notification.ts";
import { notifySubscriptionCancelled } from "./subscription-emails.ts";
import {
  renewalDueAt,
  isOverdue,
  isPastGrace,
  graceEnd,
  OVERDUE_GRACE_DAYS,
} from "./subscription-dates.ts";

export interface LifecycleResult {
  overdue: number;
  cancelled: number;
  cancelledIds: string[];
}

/**
 * Cancela a assinatura de verdade.
 *
 * Faz as quatro coisas que a regra exige:
 *  1. `user_subscriptions.status = 'cancelled'` (e para de tentar cobrar)
 *  2. `group_members` → status/payment_status 'cancelled' + `left_at`
 *     (desvincula o usuário do grupo)
 *  3. `billing_cycles` pendentes → 'cancelled' (cancela as crons)
 *  4. log + notificação
 */
export async function cancelSubscription(
  admin: any,
  sub: any,
  reason: string,
  now = new Date(),
): Promise<void> {
  const iso = now.toISOString();

  // 1. Assinatura
  await admin
    .from("user_subscriptions")
    .update({
      status: "cancelled",
      billing_status: "cancelled",
      retry_count: 0,
      updated_at: iso,
    })
    .eq("id", sub.id);

  // 2. Vínculo com o grupo
  await admin
    .from("group_members")
    .update({
      status: "cancelled",
      payment_status: "cancelled",
      left_at: iso,
      updated_at: iso,
    })
    .eq("group_id", sub.group_id)
    .eq("user_id", sub.user_id);

  // 3. Crons (cobranças agendadas) — nada de tentar cobrar de quem saiu.
  //
  // O enum de `billing_cycles.status` é `billing_status`
  // ('pending','processing','approved','failed','cancelled'). 'retrying' é de
  // OUTRO enum (`subscription_billing_status`, da assinatura): usá-lo aqui
  // devolve erro 22P02 e a crons NÃO seria cancelada.
  // "Ainda vai cobrar" = pending (agendado) + processing (em voo) + failed
  // (recusado, com next_retry_at).
  const { error: cyclesError } = await admin
    .from("billing_cycles")
    .update({ status: "cancelled" })
    .eq("subscription_id", sub.id)
    .in("status", ["pending", "processing", "failed"]);

  if (cyclesError) {
    // Não derruba o cancelamento inteiro (o vínculo e o histórico vêm antes),
    // mas deixa o erro registrado — sem isso a falha passava silenciosa.
    console.error(
      `[subscriptionLifecycle] falha ao cancelar as cobranças da assinatura ${sub.id}:`,
      cyclesError.message,
    );
  }

  // 4. Histórico
  await admin.from("activity_logs").insert({
    user_id: sub.user_id,
    action: "update",
    entity_type: "subscription",
    entity_id: sub.id,
    description: reason,
  });

  const { data: group } = await admin
    .from("groups")
    .select("name, owner_id")
    .eq("id", sub.group_id)
    .maybeSingle();

  const { data: user } = await admin
    .from("users")
    .select("name, email")
    .eq("id", sub.user_id)
    .maybeSingle();

  const audience = [sub.user_id, group?.owner_id].filter(Boolean);
  if (audience.length) {
    await dispatchNotification(admin, {
      title: "Assinatura cancelada",
      message: `A assinatura de ${group?.name || "grupo"} foi cancelada após 7 dias de atraso. O acesso foi encerrado e a assinatura segue no histórico.`,
      event_type: "subscription_cancelled",
      metadata: {
        user_id: sub.user_id,
        group_id: sub.group_id,
        group_name: group?.name || sub.group_id,
        reason,
      },
      audience: { type: "users", user_ids: Array.from(new Set(audience)) },
      channels: ["in_app", "push"],
      url: `/dashboard/subscription-history`,
    }).catch((e: unknown) => console.error("push notification error (lifecycle cancel):", e));
  }

  // E-mail de assinatura cancelada — o fechamento do ciclo para o cliente.
  // Não lança: uma falha de e-mail não pode derrubar o cancelamento (o
  // vínculo com o grupo e o histórico já foram gravados acima).
  await notifySubscriptionCancelled(admin, {
    userId: sub.user_id,
    groupId: sub.group_id,
    cancelledAt: now,
  }).catch((e: unknown) =>
    console.error("email error (lifecycle cancel):", e),
  );

  console.log(
    `X Subscription ${sub.id} CANCELLED (${reason}) | user=${sub.user_id} group=${sub.group_id} (${user?.email || "?"})`,
  );
}

/**
 * Aplica as regras de status em todas as assinaturas elegíveis.
 *
 * Elegível = assinatura com data de renovação e status 'active' ou 'expired'
 * (o 'expired' legado é "atrasada" e precisa ser normalizado).
 */
export async function applySubscriptionLifecycle(
  admin: any,
  now = new Date(),
): Promise<LifecycleResult> {
  const result: LifecycleResult = { overdue: 0, cancelled: 0, cancelledIds: [] };

  const { data, error } = await admin
    .from("user_subscriptions")
    .select(
      "id, user_id, group_id, service_id, status, billing_status, next_charge_at, expires_at, renewal_due_at, billing_cycle, custom_cycle_days, custom_cycle_months, amount",
    )
    .in("status", ["active", "expired"]);

  if (error) throw error;

  for (const sub of data || []) {
    const due = renewalDueAt(sub);
    if (!due) continue;

    if (isPastGrace(sub, now)) {
      await cancelSubscription(
        admin,
        sub,
        `Assinatura cancelada: ${OVERDUE_GRACE_DAYS} dias de atraso na renovação (vencimento em ${due.toISOString().slice(0, 10)}).`,
        now,
      );
      result.cancelled++;
      result.cancelledIds.push(sub.id);
      continue;
    }

    if (isOverdue(sub, now)) {
      // Atrasada: o grupo continua visível, mas o membro fica marcado como
      // inadimplente (acesso às credenciais bloqueado). A assinatura segue
      // 'active' no banco para que a cobrança automática ainda tente o
      // cartão e — principalmente — para que ela CONTINUE LISTADA em "Minhas
      // Assinaturas"/"Assinaturas Ativas" durante a carência (o estado
      // ATRASADA é derivado da data, não do status).
      const { data: member } = await admin
        .from("group_members")
        .select("id, payment_status, status")
        .eq("group_id", sub.group_id)
        .eq("user_id", sub.user_id)
        .maybeSingle();

      if (member && member.payment_status !== "overdue" && member.payment_status !== "cancelled") {
        await admin
          .from("group_members")
          .update({ payment_status: "overdue", updated_at: now.toISOString() })
          .eq("id", member.id);
      }

      // Normaliza o legado: 'expired' era o status que o job de faturas
      // gravava para "atrasada". Enquanto a carência não vence, a assinatura
      // volta para 'active' — assim ela continua nas listagens do usuário e
      // aparece como ATRASADA (derivado da data).
      if (sub.status === "expired") {
        await admin
          .from("user_subscriptions")
          .update({ status: "active", updated_at: now.toISOString() })
          .eq("id", sub.id);
      }

      result.overdue++;
    }
  }

  return result;
}
