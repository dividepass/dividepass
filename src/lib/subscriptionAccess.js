/**
 * Estado de acesso do usuário a uma assinatura.
 *
 * O banco guarda três coisas que a interface tratava como uma só:
 *  - `status` da assinatura: ativa, cancelada ou pendente
 *  - `billing_status`: como está o ciclo de cobrança
 *  - `next_charge_at` / `expires_at`: até quando o acesso está pago
 *
 * Uma assinatura `active` com a renovação vencida continua ativa no banco — o
 * status só muda quando o acesso é encerrado de vez. Mas o acesso às
 * credenciais precisa considerar a data: quem não renovou não acessa, e o
 * painel precisa oferecer a renovação.
 */

export const ACCESS_ACTIVE = 'active';
export const ACCESS_OVERDUE = 'overdue';
export const ACCESS_CANCELLED = 'cancelled';
export const ACCESS_PENDING = 'pending';

/** Data que define até quando a assinatura está paga. */
export function subscriptionRenewalDate(sub) {
  if (!sub) return null;
  return sub.next_charge_at || sub.expires_at || null;
}

/**
 * Momento em que o acesso expira.
 *
 * `expires_at` é coluna DATE: vale até o FIM do dia, não até a meia-noite
 * (que o Postgres interpretaria como UTC e cortaria o dia à noite no Brasil).
 * `next_charge_at` é timestamptz: vale o instante.
 */
function renewalDeadline(sub) {
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

/** A renovação já passou e a assinatura continua ativa no banco. */
export function isSubscriptionOverdue(sub) {
  if (!sub) return false;
  if (sub.status === 'cancelled') return false;

  const deadline = renewalDeadline(sub);
  if (deadline === null) return false;

  return deadline < Date.now();
}

export function subscriptionAccessState(sub) {
  if (!sub) return ACCESS_CANCELLED;
  if (sub.status === 'cancelled') return ACCESS_CANCELLED;
  if (sub.status === 'pending') return ACCESS_PENDING;
  if (isSubscriptionOverdue(sub)) return ACCESS_OVERDUE;
  return ACCESS_ACTIVE;
}

/** Só a assinatura ativa e em dia dá acesso ao conteúdo do grupo. */
export function hasSubscriptionAccess(sub) {
  return subscriptionAccessState(sub) === ACCESS_ACTIVE;
}

/** Texto curto do estado, para tag e aviso. */
export function subscriptionAccessLabel(sub) {
  switch (subscriptionAccessState(sub)) {
    case ACCESS_OVERDUE: return 'Vencida';
    case ACCESS_CANCELLED: return 'Cancelada';
    case ACCESS_PENDING: return 'Pendente';
    default: return 'Ativa';
  }
}
