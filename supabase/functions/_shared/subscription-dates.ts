/**
 * REGRAS DE DATA DA ASSINATURA — fonte única
 *
 * Estas funções são puras (só dependem de `Date`) e são usadas por três
 * lugares que NÃO podem depender uns dos outros:
 *
 *   - `_shared/subscriptionLifecycle.ts` (o job de status)
 *   - `_shared/subscription-emails.ts` (os e-mails de assinatura)
 *   - `src/lib/subscriptionAccess.js` (a tela — mesma regra, em JS)
 *
 * Por isso moram aqui, e não dentro do ciclo de vida: se o módulo de e-mail
 * importasse do de ciclo de vida, e o de ciclo de vida importasse do de
 * e-mail (para mandar o aviso de cancelamento), teríamos um ciclo de
 * imports.
 *
 * A data de renovação é `renewal_due_at` (coluna nova, ver
 * `database/subscription-status-rules.sql`). Ela NÃO é mexida nas tentativas
 * de cobrança: `next_charge_at` anda para frente a cada retry, e usar ele
 * como "data de vencimento" encurtaria a carência de quem teve cartão
 * recusado. Legado (sem `renewal_due_at`) cai para `next_charge_at` e depois
 * `expires_at`.
 */

export const OVERDUE_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Data de vencimento da renewal (data em que o acesso termina). */
export function renewalDueAt(sub: any): Date | null {
  if (!sub) return null;
  const raw = sub.renewal_due_at || sub.next_charge_at || sub.expires_at || null;
  if (!raw) return null;

  const text = String(raw).trim();
  // `expires_at` é DATE: vale até o FIM do dia.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const endOfDay = new Date(`${text}T23:59:59.999`);
    return Number.isNaN(endOfDay.getTime()) ? null : endOfDay;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A renovação já passou? */
export function isOverdue(sub: any, now = new Date()): boolean {
  if (!sub) return false;
  if (sub.status === "cancelled" || sub.status === "inactive") return false;
  const due = renewalDueAt(sub);
  if (!due) return false;
  return due.getTime() < now.getTime();
}

/** A carência de 7 dias acabou? Aí a assinatura é cancelada. */
export function isPastGrace(sub: any, now = new Date()): boolean {
  if (!sub) return false;
  if (sub.status === "cancelled" || sub.status === "inactive") return true;
  const due = renewalDueAt(sub);
  if (!due) return false;
  return due.getTime() + OVERDUE_GRACE_DAYS * DAY_MS < now.getTime();
}

/** Último instante em que ainda dá para renovar (fim da carência). */
export function graceEnd(sub: any): Date | null {
  const due = renewalDueAt(sub);
  if (!due) return null;
  return new Date(due.getTime() + OVERDUE_GRACE_DAYS * DAY_MS);
}

export { DAY_MS };
