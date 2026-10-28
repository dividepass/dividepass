/**
 * Estado de acesso do usuário a uma assinatura.
 *
 * O banco guarda três coisas que a interface tratava como uma só:
 *  - `status` da assinatura: ativa, cancelada ou pendente
 *  - `billing_status`: como está o ciclo de cobrança
 *  - `next_charge_at` / `expires_at`: até quando o acesso está pago
 *
 * REGRAS DE STATUS (fonte única — o mesmo cálculo vale para a tela, para o
 * card de renovação e para o backend):
 *
 *   ATIVA      renovação > agora
 *   ATRASADA   renovação <= agora e ainda não passou da carência de 7 dias
 *   CANCELADA  passou da carência de 7 dias (ou o banco já marcou cancelada)
 *   PENDENTE   pagamento em aberto (banco: `status = 'pending'`)
 *
 * A carência de 7 dias é o que segura a regra: enquanto a assinatura está
 * ATRASADA o grupo continua visível para o usuário (com card de renovação e
 * botão de pagamento), mas o acesso às credenciais fica bloqueado. Passados 7
 * dias, a assinatura é cancelada, o usuário é desvinculado do grupo, as
 * cobranças agendadas são canceladas e a assinatura só aparece no histórico.
 *
 * Estados legados do banco (`expired`, `inactive`) são normalizados aqui:
 * `expired` continua vivo enquanto a carência não vence (é o que o antigo
 * `process-overdue-invoices` gravava para "atrasada"), `inactive` é terminal.
 * Ou seja: a interface mostra QUATRO estados, não seis.
 */

export const ACCESS_ACTIVE = 'active';
export const ACCESS_OVERDUE = 'overdue';
export const ACCESS_CANCELLED = 'cancelled';
export const ACCESS_PENDING = 'pending';

/** Dias de carência após o vencimento antes de cancelar a assinatura. */
export const OVERDUE_GRACE_DAYS = 7;

/** Dias antes do vencimento em que o card de renovação aparece. */
export const RENEWAL_REMINDER_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Data que define até quando a assinatura está paga.
 *
 * `renewal_due_at` (coluna nova) é a fonte da verdade: é o vencimento do ciclo
 * e NÃO anda para frente a cada tentativa de cobrança (o `next_charge_at` anda,
 * e usá-lo encurtaria a carência de quem teve cartão recusado). Legado sem a
 * coluna cai para `next_charge_at` e depois `expires_at`.
 */
export function subscriptionRenewalDate(sub) {
  if (!sub) return null;
  return sub.renewal_due_at || sub.next_charge_at || sub.expires_at || null;
}

/**
 * Momento em que o acesso expira.
 *
 * `expires_at` é coluna DATE: vale até o FIM do dia, não até a meia-noite
 * (que o Postgres interpretaria como UTC e cortaria o dia à noite no Brasil).
 * `next_charge_at` é timestamptz: vale o instante.
 */
export function renewalDeadline(sub) {
  const ref = subscriptionRenewalDate(sub);
  if (!ref) return null;

  const raw = String(ref).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const endOfDay = new Date(`${raw}T23:59:59.999`);
    return Number.isNaN(endOfDay.getTime()) ? null : endOfDay.getTime();
  }

  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? null : time;
}

/** A renovação já passou (a assinatura está atrasada). */
export function isSubscriptionOverdue(sub, now = Date.now()) {
  if (!sub) return false;
  if (sub.status === 'cancelled' || sub.status === 'inactive') return false;

  const deadline = renewalDeadline(sub);
  if (deadline === null) return false;

  return deadline < now;
}

/** A carência de 7 dias já acabou: a assinatura deve ser cancelada. */
export function isSubscriptionPastGrace(sub, now = Date.now()) {
  if (!sub) return false;
  if (sub.status === 'cancelled' || sub.status === 'inactive') return true;

  const deadline = renewalDeadline(sub);
  if (deadline === null) return false;

  return deadline + OVERDUE_GRACE_DAYS * DAY_MS < now;
}

/**
 * Estado de acesso (derivado).
 *
 * `status = 'expired'` é legado de "atrasada": enquanto a carência não vence
 * a assinatura continua ATRASADA (grupo visível, renovação possível). Passada
 * a carência, vira CANCELADA.
 */
export function subscriptionAccessState(sub, now = Date.now()) {
  if (!sub) return ACCESS_CANCELLED;
  if (sub.status === 'cancelled' || sub.status === 'inactive') return ACCESS_CANCELLED;
  if (sub.status === 'pending') return ACCESS_PENDING;
  if (isSubscriptionPastGrace(sub, now)) return ACCESS_CANCELLED;
  if (isSubscriptionOverdue(sub, now)) return ACCESS_OVERDUE;
  return ACCESS_ACTIVE;
}

/** Só a assinatura ativa e em dia dá acesso ao conteúdo do grupo. */
export function hasSubscriptionAccess(sub, now = Date.now()) {
  return subscriptionAccessState(sub, now) === ACCESS_ACTIVE;
}

/** Texto curto do estado, para tag e aviso. */
export function subscriptionAccessLabel(sub, now = Date.now()) {
  switch (subscriptionAccessState(sub, now)) {
    case ACCESS_OVERDUE: return 'Atrasada';
    case ACCESS_CANCELLED: return 'Cancelada';
    case ACCESS_PENDING: return 'Pendente';
    default: return 'Ativa';
  }
}

/**
 * Dias até a renovação. Negativo = já venceu.
 *
 * Arredonda para cima: uma renovação que vence hoje (ainda no horário) é
 * "0 dias", não "-1".
 */
export function daysUntilRenewal(sub, now = Date.now()) {
  const deadline = renewalDeadline(sub);
  if (deadline === null) return null;

  const diff = deadline - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / DAY_MS);
}

/**
 * Precisa mostrar o aviso de renovação?
 *
 * Sim quando falta pouco (2 dias) ou quando já está atrasada. Cancelada não
 * entra: o caminho passa a ser o histórico.
 */
export function needsRenewalReminder(sub, now = Date.now()) {
  const state = subscriptionAccessState(sub, now);
  if (state === ACCESS_OVERDUE) return true;
  if (state !== ACCESS_ACTIVE) return false;

  const days = daysUntilRenewal(sub, now);
  if (days === null) return false;
  return days <= RENEWAL_REMINDER_DAYS;
}

/**
 * A assinatura aparece nas listagens do usuário (Meus Grupos / Assinaturas
 * Ativas)? Cancelada não aparece — só no histórico.
 */
export function isSubscriptionVisible(sub, now = Date.now()) {
  return subscriptionAccessState(sub, now) !== ACCESS_CANCELLED;
}

/** A assinatura está cancelada (desvinculada do grupo)? */
export function isSubscriptionCancelled(sub, now = Date.now()) {
  return subscriptionAccessState(sub, now) === ACCESS_CANCELLED;
}
