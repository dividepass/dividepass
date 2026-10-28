/**
 * Regra de faixas da margem da plataforma — DividePass (2026-10-27)
 *
 * MESMA TABELA de src/lib/platformFee.js (front) e de
 * database/update-platform-fee-tiers.sql (banco). Se mudar uma, mude as três.
 *
 * A FAIXA é escolhida pelo preço MENSAL do grupo (groups.price_per_slot),
 * nunca pelo total do ciclo: um grupo de R$ 10/mês vendido como trimestral
 * fatura R$ 30, mas continua na faixa de R$ 10.
 *
 *   R$ 5,00 até R$ 8,00 ...... 50%
 *   R$ 8,01 até R$ 15,00 ..... 40%
 *   R$ 15,01 até R$ 30,00 .... 35%
 *   R$ 30,01 até R$ 50,00 .... 25%
 *   R$ 50,01 até R$ 85,00 .... 20%
 *   R$ 85,01 até R$ 150,00 ... 15%
 *   acima de R$ 150,00 ....... 12%
 */
export const MIN_PRICE_PER_SLOT = 5;

export const PLATFORM_FEE_TIERS: { max: number; percent: number }[] = [
  { max: 8, percent: 50 },
  { max: 15, percent: 40 },
  { max: 30, percent: 35 },
  { max: 50, percent: 25 },
  { max: 85, percent: 20 },
  { max: 150, percent: 15 },
  { max: Infinity, percent: 12 },
];

/** Margem da plataforma (em %) para um preço mensal. */
export function platformFeePercent(monthlyPrice: number | string | null | undefined): number {
  const value = parseFloat(String(monthlyPrice ?? ""));
  if (!Number.isFinite(value) || value <= 0) return PLATFORM_FEE_TIERS[0].percent;
  const tier = PLATFORM_FEE_TIERS.find((t) => value <= t.max);
  return tier ? tier.percent : PLATFORM_FEE_TIERS[PLATFORM_FEE_TIERS.length - 1].percent;
}

/**
 * Simulação de um valor cobrado de um grupo.
 * @param amount   valor total cobrado na transação
 * @param monthlyPrice preço MENSAL do grupo (groups.price_per_slot)
 */
export function simulateAmount(
  amount: number | string | null | undefined,
  monthlyPrice: number | string | null | undefined,
): { amount: number; percent: number; platformFee: number; net: number } {
  const value = parseFloat(String(amount ?? "")) || 0;
  // centavos: mesma ordem de arredondamento do banco (taxa primeiro, depois
  // o líquido) para o log bater com a carteira
  const cents = Math.round(value * 100);
  const percent = platformFeePercent(monthlyPrice);
  const feeCents = Math.round((cents * percent) / 100);
  return {
    amount: cents / 100,
    percent,
    platformFee: feeCents / 100,
    net: (cents - feeCents) / 100,
  };
}
