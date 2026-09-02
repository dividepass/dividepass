/**
 * ================================================================
 * FONTE ÚNICA DA VERDADE — CÁLCULO DE ECONOMIA
 * ================================================================
 *
 * Este módulo é a ÚNICA fonte de cálculo de economia.
 * Nenhum outro componente deve recalcular valores de economia.
 * O frontend apenas consome e exibe os dados retornados.
 *
 * REGRAS (implementadas):
 * 1. Apenas subscription.status === 'active'
 * 2. Cada subscription.id entra no máximo uma vez (anti-duplicidade)
 * 3. Preço recorrente (recurring/annual/monthly) como referência oficial
 * 4. Preço promocional NÃO usado como referência
 * 5. Precisão total nos cálculos; arredondamento só na formatação
 * 6. Economia negativa não é "economia" — gera alerta
 * 7. Sem preço oficial → item.unavailable (não entra no cálculo)
 * 8. Todos os valores em R$; normalização mensal para ciclos > 1 mês
 */

// ── Utilitários locais (evita import de savings.js que causa TDZ error no bundler) ──
function fmtBRL(value) {
  if (value == null || isNaN(value)) return 'R$ 0,00';
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
}

function checkPriceStaleness(plan) {
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

// ── Utilitários internos ───────────────────────────────────────

function getCycleMonths(billingCycle, customMonths) {
  switch (billingCycle) {
    case 'monthly':    return 1;
    case 'quarterly':  return 3;
    case 'semiannual': return 6;
    case 'annual':     return 12;
    case 'custom':     return customMonths || 1;
    default:           return 1;
  }
}

function normalizeToMonthly(amount, billingCycle, customMonths) {
  if (!amount || amount <= 0) return 0;
  const cycle = getCycleMonths(billingCycle, customMonths);
  return amount / cycle;
}

/**
 * Obtém o preço oficial do plano para comparação.
 * Usa: plan.official_price > service.official_price (fallback)
 * Ignora: promotional (preço temporário)
 *
 * @param {Object} sub
 * @returns {{ price: number, type: string, isPromo: boolean, isVerified: boolean }}
 */
function getOfficialPriceData(sub) {
  if (!sub?.plan) {
    const servicePrice = Number(sub?.service?.official_price) || 0;
    return { price: servicePrice, type: 'recurring', isPromo: false, isVerified: false };
  }
  const plan = sub.plan;
  const priceType = plan.price_type || 'recurring';
  const officialPrice = Number(plan.official_price) || 0;
  const isVerified = plan.is_verified || false;
  const isPromo = priceType === 'promotional' || priceType === 'one_time';
  return { price: officialPrice, type: priceType, isPromo, isVerified };
}

/**
 * Verifica se uma assinatura está elegível para comparação.
 * Apenas: status === 'active'
 */
function isEligible(sub) {
  return sub && sub.status === 'active';
}

// ── Função Principal ─────────────────────────────────────────

/**
 * calculateUserSavings — FONTE ÚNICA DA VERDADE
 *
 * Calcula a economia de um usuário a partir de suas assinaturas ativas.
 * Retorna TODOS os dados necessários para qualquer tela/componente.
 *
 * @param {Array} subscriptions — user_subscriptions com .service e .plan
 * @returns {{
 *   totalOfficialMonthly: number,
 *   totalDividePassMonthly: number,
 *   monthlySavings: number,
 *   annualSavings: number,
 *   savingsPercentage: number,
 *   hasValidData: boolean,
 *   subscriptions: Array,
 *   unavailable: Array,
 *   negativeAlerts: Array,
 *   promoWarnings: Array,
 *   fetchedAt: string
 * }}
 */
export function calculateUserSavings(subscriptions = []) {
  const seenIds = new Set();
  const subscriptionItems = [];
  const unavailable = [];
  const negativeAlerts = [];
  const promoWarnings = [];

  let totalOfficialMonthly = 0;
  let totalDividePassMonthly = 0;
  let monthlySavings = 0;

  subscriptions.forEach(sub => {
    if (!sub?.id) return;

    // Anti-duplicidade
    if (seenIds.has(sub.id)) return;
    seenIds.add(sub.id);

    // Apenas ativas
    if (!isEligible(sub)) return;

    const officialData = getOfficialPriceData(sub);
    const officialPrice = officialData.price;

    // Sem preço oficial → unavailable
    if (!officialPrice || officialPrice <= 0) {
      unavailable.push({
        subscriptionId: sub.id,
        serviceId: sub.service?.id,
        serviceName: sub.service?.full_name || sub.service?.name || 'Serviço',
        serviceColor: sub.service?.color || '#6366f1',
        serviceIcon: sub.service?.icon,
        serviceIconUrl: sub.service?.icon_url,
        planName: sub.plan?.name || '',
        planId: sub.plan?.id || null,
        reason: 'no_price',
        // Valor que o usuário paga (pode ser shown mas não entra no cálculo)
        dividePassPrice: normalizeToMonthly(
          Number(sub.amount) || 0,
          sub.billing_cycle,
          sub.custom_months
        ),
      });
      return;
    }

    const userAmount = Number(sub.amount) || 0;
    if (!userAmount || userAmount <= 0) return;

    const dividePassMonthly = normalizeToMonthly(userAmount, sub.billing_cycle, sub.custom_months);
    const cycleMonths = getCycleMonths(sub.billing_cycle, sub.custom_months);
    const itemSavings = officialPrice - dividePassMonthly;

    // Aviso de plano promocional
    if (officialData.isPromo) {
      promoWarnings.push({
        subscriptionId: sub.id,
        serviceName: sub.service?.name,
        planName: sub.plan?.name,
      });
    }

    // Alerta de economia negativa
    if (itemSavings < 0) {
      negativeAlerts.push({
        subscriptionId: sub.id,
        serviceName: sub.service?.name,
        planName: sub.plan?.name,
        officialPrice,
        dividePassPrice: dividePassMonthly,
        negativeSavings: itemSavings,
      });
    }

    // Se economia negativa, não soma na economia total
    const effectiveSavings = Math.max(0, itemSavings);
    totalOfficialMonthly += officialPrice;
    totalDividePassMonthly += dividePassMonthly;
    monthlySavings += effectiveSavings;

    // Item individual
    subscriptionItems.push({
      subscriptionId: sub.id,
      serviceId: sub.service?.id,
      serviceName: sub.service?.full_name || sub.service?.name || 'Serviço',
      serviceColor: sub.service?.color || '#6366f1',
      serviceIcon: sub.service?.icon,
      serviceIconUrl: sub.service?.icon_url,
      planName: sub.plan?.name || '',
      planId: sub.plan?.id || null,
      officialPrice,
      dividePassPrice: dividePassMonthly,
      monthlySavings: effectiveSavings,
      annualSavings: effectiveSavings * 12,
      rawSavings: itemSavings, // pode ser negativo
      isNegative: itemSavings < 0,
      isPromo: officialData.isPromo,
      isVerified: officialData.isVerified,
      priceType: officialData.type,
      priceSource: sub.plan?.source_url || null,
      priceUpdatedAt: sub.plan?.updated_at || null,
      lastVerifiedAt: sub.plan?.last_verified_at || null,
      billingCycle: sub.billing_cycle,
      billingLabel: getBillingLabel(sub.billing_cycle, cycleMonths),
      cycleMonths,
      staleness: checkPriceStaleness(sub.plan),
    });
  });

  // Ordena por economia mensal (maior primeiro)
  subscriptionItems.sort((a, b) => b.monthlySavings - a.monthlySavings);

  const annualSavings = monthlySavings * 12;
  const savingsPercentage = totalOfficialMonthly > 0
    ? (monthlySavings / totalOfficialMonthly) * 100
    : 0;

  return {
    // Totais
    totalOfficialMonthly,
    totalDividePassMonthly,
    monthlySavings,
    annualSavings,
    savingsPercentage,
    hasValidData: subscriptionItems.length > 0,
    // Detalhamento
    subscriptions: subscriptionItems,
    unavailable,
    negativeAlerts,
    promoWarnings,
    fetchedAt: new Date().toISOString(),
  };
}

function getBillingLabel(billingCycle, cycleMonths) {
  switch (billingCycle) {
    case 'monthly':    return 'mensal';
    case 'quarterly':  return 'trimestral';
    case 'semiannual': return 'semestral';
    case 'annual':     return 'anual';
    default:           return cycleMonths === 1 ? 'mensal' : `${cycleMonths} meses`;
  }
}

/**
 * Resumo rápido para o card do dashboard.
 * Retorna apenas os valores principais.
 */
export function getSavingsSummary(savings) {
  return {
    totalOfficialMonthly: savings.totalOfficialMonthly,
    totalDividePassMonthly: savings.totalDividePassMonthly,
    monthlySavings: savings.monthlySavings,
    annualSavings: savings.annualSavings,
    savingsPercentage: savings.savingsPercentage,
    hasValidData: savings.hasValidData,
  };
}

/**
 * Formata percentual para apresentação.
 */
export function fmtPercentage(value) {
  if (value == null || isNaN(value)) return '0%';
  if (value < 1) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

/**
 * Verifica se há alertas administrativos a reportar.
 */
export function getAdminAlerts(savings) {
  return {
    negativeSavings: savings.negativeAlerts,
    stalePrices: savings.subscriptions.filter(s => s.staleness?.isStale),
    promoPlans: savings.promoWarnings,
    unavailableCount: savings.unavailable.length,
  };
}
