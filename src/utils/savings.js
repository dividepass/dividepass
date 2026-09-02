/**
 * Utilities para cálculo de economia — MINIMAL VERSION
 * Apenas funções standalone exportadas.
 * NÃO adiciona lógica complexa aqui para evitar TDZ errors no bundler.
 */

// ── Formatação ─────────────────────────────────────────────────
export function fmtBRL(value) {
  if (value == null || isNaN(value)) return 'R$ 0,00';
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
}

export function fmtPercentage(value) {
  if (value == null || isNaN(value)) return '0%';
  if (value < 1) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

// ── Ciclo de cobrança ──────────────────────────────────────────
export function getCycleMonths(billingCycle, customMonths = null) {
  switch (billingCycle) {
    case 'monthly':    return 1;
    case 'quarterly':  return 3;
    case 'semiannual': return 6;
    case 'annual':     return 12;
    case 'custom':     return customMonths || 1;
    default:           return 1;
  }
}

export function getBillingLabel(billingCycle, cycleMonths) {
  switch (billingCycle) {
    case 'monthly':    return 'mensal';
    case 'quarterly':  return 'trimestral';
    case 'semiannual': return 'semestral';
    case 'annual':     return 'anual';
    default:           return cycleMonths === 1 ? 'mensal' : `${cycleMonths} meses`;
  }
}

export function normalizeToMonthly(amount, billingCycle, customMonths = null) {
  if (!amount || amount <= 0) return 0;
  const cycle = getCycleMonths(billingCycle, customMonths);
  return amount / cycle;
}

// ── Staleness ──────────────────────────────────────────────────
export function checkPriceStaleness(plan) {
  if (!plan) return { isStale: false, daysSinceVerified: 0, daysSinceUpdate: 0 };
  const now = new Date();
  const verifiedAt = plan.last_verified_at ? new Date(plan.last_verified_at) : null;
  const updatedAt = plan.updated_at ? new Date(plan.updated_at) : null;
  const daysSinceVerified = verifiedAt
    ? Math.floor((now - verifiedAt) / (1000 * 60 * 60 * 24)) : 999;
  const daysSinceUpdate = updatedAt
    ? Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24)) : 999;
  return {
    isStale: daysSinceVerified > 90 || daysSinceUpdate > 180,
    daysSinceVerified,
    daysSinceUpdate,
    needsReview: daysSinceVerified > 90,
  };
}

// ── Helpers simples ─────────────────────────────────────────────
export function isActiveSubscription(sub) {
  if (!sub) return false;
  return sub.status === 'active';
}

// ── Cálculos (standalone) ─────────────────────────────────────
export function calcYearProjection(monthlySavings) {
  return monthlySavings * 12;
}

export function calcMonthlySavingsTotal(subscriptions = []) {
  if (!subscriptions?.length) return { total: 0, eligible: [], ineligible: [], negativeAlerts: [] };
  const seenIds = new Set();
  const eligible = [];
  const ineligible = [];
  const negativeAlerts = [];
  let total = 0;
  subscriptions.forEach(sub => {
    if (!sub?.id) return;
    if (seenIds.has(sub.id)) return;
    seenIds.add(sub.id);
    if (!isActiveSubscription(sub)) {
      ineligible.push({ sub, reason: 'inactive' });
      return;
    }
    const officialPrice = Number(sub.service?.official_price) || Number(sub?.plan?.official_price) || 0;
    const userAmount = Number(sub.amount) || 0;
    if (!officialPrice || !userAmount) {
      ineligible.push({ sub, reason: 'no_price' });
      return;
    }
    const monthlyUser = normalizeToMonthly(userAmount, sub.billing_cycle, sub.custom_months);
    const monthlySavings = officialPrice - monthlyUser;
    if (monthlySavings < 0) {
      negativeAlerts.push({ subId: sub.id, serviceName: sub.service?.name, officialPrice, dividePassPrice: monthlyUser });
      eligible.push({ sub, monthlySavings });
    } else {
      total += monthlySavings;
      eligible.push({ sub, monthlySavings });
    }
  });
  return { total, eligible, ineligible, negativeAlerts };
}

export function calcTotalSaved(paidPayments = []) {
  if (!paidPayments?.length) return 0;
  return paidPayments.reduce((total, payment) => {
    if (!payment || payment.status !== 'paid' || payment.payment_type !== 'subscription') return total;
    const officialPrice = Number(payment.official_price) || 0;
    const paidAmount = Number(payment.paid_amount) || Number(payment.amount) || 0;
    if (!officialPrice) return total;
    const cycleMonths = getCycleMonths(payment.billing_cycle, payment.custom_months);
    return total + Math.max(0, (officialPrice * cycleMonths) - paidAmount);
  }, 0);
}

export function calcMonthSaved(paidPayments = []) {
  if (!paidPayments?.length) return 0;
  const now = new Date();
  return paidPayments.reduce((total, payment) => {
    if (!payment || payment.status !== 'paid' || payment.payment_type !== 'subscription') return total;
    const paidAt = payment.paid_at || payment.created_at;
    if (!paidAt) return total;
    const d = new Date(paidAt);
    if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return total;
    const officialPrice = Number(payment.official_price) || 0;
    const paidAmount = Number(payment.paid_amount) || Number(payment.amount) || 0;
    if (!officialPrice) return total;
    const cycleMonths = getCycleMonths(payment.billing_cycle, payment.custom_months);
    return total + Math.max(0, (officialPrice * cycleMonths) - paidAmount);
  }, 0);
}
