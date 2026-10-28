/**
 * Regra de margem da plataforma — DividePass (2026-10-27)
 *
 * FONT ÚNICA da regra. O front (wizard de criação, painel admin) e o SQL do
 * repasse (database/update-platform-fee-tiers.sql) precisam usar exatamente a
 * mesma tabela de faixas, senão o dono vê uma simulação e recebe outra.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A MARGEM DEPENDE DO VALOR MENSAL, NÃO DO TOTAL DO CICLO
 *
 * Um grupo de R$ 10/mês vendido como trimestral fatura R$ 30. Se a faixa fosse
 * pelo total, o grupo cairia numa faixa melhor só por causa do ciclo — e o
 * incentivo seria vender ciclos longos. Por isso a faixa olha SEMPRE o preço
 * mensal (groups.price_per_slot), que é o valor de referência.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AS FAIXAS (margem da plataforma, sobre o valor mensal)
 *
 *   R$ 5,00 até R$ 8,00 ...... 50%
 *   R$ 8,01 até R$ 15,00 ..... 40%
 *   R$ 15,01 até R$ 30,00 .... 35%
 *   R$ 30,01 até R$ 50,00 .... 25%
 *   R$ 50,01 até R$ 85,00 .... 20%
 *   R$ 85,01 até R$ 150,00 ... 15%
 *   acima de R$ 150,00 ....... 12%
 *
 * Abaixo de R$ 5,00 não existe grupo: é o valor mínimo aceito.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Menor valor mensal que a plataforma aceita para um grupo. */
export const MIN_PRICE_PER_SLOT = 5;

/** Faixas de margem. `max` é o teto INCLUSIVO da faixa (em reais). */
export const PLATFORM_FEE_TIERS = [
  { max: 8, percent: 50 },
  { max: 15, percent: 40 },
  { max: 30, percent: 35 },
  { max: 50, percent: 25 },
  { max: 85, percent: 20 },
  { max: 150, percent: 15 },
  { max: Infinity, percent: 12 },
];

/**
 * Margem da plataforma para um preço mensal.
 * @param {number|string} price preço MENSAL (groups.price_per_slot)
 * @returns {number} percentual (0-100)
 */
export function platformFeePercent(price) {
  const value = parseFloat(price);
  if (!Number.isFinite(value) || value <= 0) return PLATFORM_FEE_TIERS[0].percent;
  const tier = PLATFORM_FEE_TIERS.find(t => value <= t.max);
  return tier ? tier.percent : PLATFORM_FEE_TIERS[PLATFORM_FEE_TIERS.length - 1].percent;
}

/**
 * Simulação de recebimento de UM ciclo mensal.
 *
 * O ARREDONDAMENTO É FEITO EM CENTAVOS (inteiro) e a taxa é arredondada ANTES
 * do líquido — exatamente como faz o SQL do repasse
 * (database/update-platform-fee-tiers.sql: ROUND(amount * pct / 100, 2)).
 * Com float, R$ 29,90 × 35% dá 10,4649999... e o JS arredondaria para
 * R$ 10,46 enquanto o banco credita R$ 10,47 — o dono veria um centavo a
 * menos no app do que na carteira.
 *
 * @param {number|string} price valor mensal cobrado de cada pessoa
 * @returns {{ price:number, percent:number, platformFee:number, net:number, belowMinimum:boolean }}
 */
export function simulatePrice(price) {
  const value = parseFloat(price) || 0;
  const cents = Math.round(value * 100);
  const percent = platformFeePercent(value);
  const platformFeeCents = Math.round((cents * percent) / 100);
  return {
    price: cents / 100,
    percent,
    platformFee: platformFeeCents / 100,
    net: (cents - platformFeeCents) / 100,
    belowMinimum: value > 0 && value < MIN_PRICE_PER_SLOT,
  };
}

/**
 * Simulação de QUALQUER cobrança de um grupo (ciclo trimestral, anual, ...).
 *
 * A FAIXA é escolhida pelo preço MENSAL do grupo; a margem é aplicada sobre o
 * valor total cobrado. Um grupo de R$ 10/mês vendido como trimestral fatura
 * R$ 30: a faixa continua sendo a de R$ 10 (40%) e a plataforma retém 40% dos
 * R$ 30 — nunca uma faixa melhor por causa do ciclo longo.
 *
 * @param {number|string} amount valor total cobrado nesta transação
 * @param {number|string} monthlyPrice preço MENSAL do grupo (groups.price_per_slot)
 */
export function simulateAmount(amount, monthlyPrice) {
  const value = parseFloat(amount) || 0;
  const cents = Math.round(value * 100);
  const percent = platformFeePercent(monthlyPrice);
  const platformFeeCents = Math.round((cents * percent) / 100);
  return {
    amount: cents / 100,
    percent,
    platformFee: platformFeeCents / 100,
    net: (cents - platformFeeCents) / 100,
  };
}

/** Formata em pt-BR: 29.9 -> "29,90" */
export function brl(value) {
  const n = parseFloat(value) || 0;
  return n.toFixed(2).replace('.', ',');
}
