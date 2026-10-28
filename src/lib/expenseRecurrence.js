/**
 * Recorrência de despesas — módulo puro, compartilhado.
 *
 * A tela de Despeses (`pages/admin/Expenses.jsx`) mantinha uma cópia local
 * desta função; a tela de Evolução precisa do MESMO cálculo para atribuir o
 * custo de cada mês da linha de lucro. Duas implementações divergem com
 * facilidade — uma delas erra o dia do vencimento e o custo cai no mês
 * errado — então a regra mora aqui e as duas telas leem o mesmo lugar.
 *
 * CORREÇÃO DE FEV/2026
 * --------------------
 * A versão anterior construía o próximo vencimento com
 * `new Date(ano, mes + 1, dia)`. Com `dia = 31`, o mês de fevereiro (28/29
 * dias) "estourava" e o calendário pulava o mês inteiro; o mesmo acontecia
 * com `dia = 29` ou `30` em bissextos. Aqui o dia é limitado ao último dia
 * do mês (`clampDayInMonth`), então a recorrência cai em todo mês previsto.
 */

/**
 * Último dia do mês (28, 29, 30 ou 31) para o par (ano, mês).
 *
 * @param {number} year
 * @param {number} monthIndex 0-based (0 = janeiro)
 */
export function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Constrói a data de vencimento no mês, limitando o dia ao último dia
 * disponível (dia 31 em fevereiro vira 28/29, não o mês seguinte).
 */
function dueDateInMonth(year, monthIndex, day) {
  const clamped = Math.min(day, lastDayOfMonth(year, monthIndex));
  return new Date(year, monthIndex, clamped);
}

/**
 * "YYYY-MM-DD" -> Date na MEIA-NOITE LOCAL.
 *
 * `new Date('2026-01-31')` é meia-noite UTC, que no Brasil (UTC-3) vira
 * 30/01 às 21h — o dia da despesa viraria o dia anterior. Parseando as
 * partes na mão, a data é sempre o dia do calendário, no fuso de quem olha.
 */
function parseLocalDate(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/**
 * Meses (YYYY-MM) em que uma despesa recorrente incide.
 *
 * @param {number|string} recurrenceDay dia do vencimento
 * @param {string} startDate            data inicial (YYYY-MM-DD)
 * @param {string|null} endDate         data final (YYYY-MM-DD) — null = sem limite
 * @param {number|null} count           número máximo de ocorrências
 * @param {string[]|null} skippedMonths meses pulados (YYYY-MM)
 * @returns {string[]} chaves YYYY-MM, em ordem cronológica
 */
export function getRecurrenceMonths(recurrenceDay, startDate, endDate, count, skippedMonths) {
  const months = [];
  if (!startDate || !recurrenceDay) return months;

  const day = parseInt(recurrenceDay, 10);
  if (!Number.isFinite(day) || day < 1 || day > 31) return months;

  const start = parseLocalDate(startDate);
  if (!start || Number.isNaN(start.getTime())) return months;

  const limit = endDate ? parseLocalDate(endDate) : null;
  const skipped = Array.isArray(skippedMonths) ? skippedMonths : [];

  const maxIterations = count && count > 0 ? count : 120;
  let year = start.getFullYear();
  let monthIndex = start.getMonth();
  let iterations = 0;

  while (iterations < maxIterations) {
    const current = dueDateInMonth(year, monthIndex, day);

    if (limit && current > limit) break;

    if (current >= start) {
      const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
      if (!skipped.includes(key)) months.push(key);
    }

    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
    iterations++;
  }

  return months;
}
