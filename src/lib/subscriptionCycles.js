/**
 * Ciclo de faturamento das assinaturas — fonte única da verdade.
 *
 * Semântica do sistema:
 *  - `user_subscriptions.amount` é o TOTAL do ciclo contratado
 *    (Spotify semestral = R$ 12,90 pelo semestre);
 *  - `groups.price_per_slot` é o preço MENSAL da vaga.
 *
 * Misturar os dois é o que fazia a tela de edição gravar o preço mensal
 * num ciclo semestral (e a cobrança cobrar menos do que o contratado).
 * Estas funções existem para que ninguém precise recalcular na mão.
 */

/** Quantos meses tem cada periodicidade. `days` não tem meses fixos. */
export const CYCLE_MONTHS = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

export const CYCLE_LABELS = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
  days: 'Dias',
  custom: 'Personalizado',
};

export function cycleLabel(cycle) {
  return CYCLE_LABELS[cycle] || cycle || '—';
}

export function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Meses do ciclo.
 * Retorna 0 para o ciclo em dias (o valor gravado é o total do período) e
 * para o ciclo personalizado sem `custom_cycle_months` informado.
 */
export function cycleMonths(cycle, customCycleMonths) {
  if (cycle === 'days') return 0;
  if (cycle === 'custom') {
    const months = Number(customCycleMonths);
    return months > 0 ? months : 0;
  }
  return CYCLE_MONTHS[cycle] || 1;
}

/**
 * Total do ciclo a partir do preço mensal da vaga.
 * Ciclo em dias (meses = 0): o preço da vaga já é o total do período.
 */
export function cycleTotalFromMonthly(monthlyPrice, months) {
  const price = Number(monthlyPrice || 0);
  if (!months || months <= 0) return round2(price);
  return round2(price * months);
}

/** Equivalente mensal de uma assinatura (ciclo maior normalizado por mês). */
export function monthlyEquivalent(sub) {
  const amount = Number(sub?.amount || 0);
  const cycle = sub?.billing_cycle || 'monthly';

  if (cycle === 'days') {
    const days = Number(sub?.custom_cycle_days || 0);
    return days > 0 ? (amount / days) * 30 : amount;
  }

  const months = cycleMonths(cycle, sub?.custom_cycle_months);
  return months > 0 ? amount / months : amount;
}

/** "Semestral (6 meses)" — o ciclo inteiro numa linha só. */
export function cycleFullLabel(sub) {
  const base = cycleLabel(sub?.billing_cycle);

  if (sub?.billing_cycle === 'days') {
    return sub?.custom_cycle_days ? `${base} (${sub.custom_cycle_days} dias)` : base;
  }
  if (sub?.billing_cycle === 'custom') {
    return sub?.custom_cycle_months ? `${base} (${sub.custom_cycle_months} meses)` : base;
  }

  const months = CYCLE_MONTHS[sub?.billing_cycle] || 0;
  if (months > 0) return `${base} (${months} ${months > 1 ? 'meses' : 'mês'})`;
  return base;
}
