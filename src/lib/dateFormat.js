/**
 * Formatação de datas que não desloca o dia por fuso horário.
 *
 * O Postgres guarda dois tipos de data com regras diferentes:
 *  - `date` (due_date, expires_at): só o dia, "2026-04-09".
 *  - `timestamptz` (created_at, paid_at, next_charge_at): instante completo.
 *
 * `new Date("2026-04-09")` é interpretado como meia-noite UTC. Para quem está
 * em UTC-3 (Brasil), isso vira 08/04/2026 — o dia da cobrança aparecia um dia
 * antes do real, tanto no card de cobrança quanto na data de renovação das
 * credenciais.
 *
 * A regra aqui:
 *  - string só com data ("2026-04-09"): mostra exatamente esse dia;
 *  - timestamptz em meia-noite UTC (o formato canônico de data no Postgres):
 *    usa o dia em UTC;
 *  - qualquer outro instante: mostra no fuso do navegador, que é o correto
 *    para "quando isso aconteceu".
 */

/** "2026-04-09" (com ou sem sufixo de hora) -> dia no formato brasileiro. */
export function formatDateBR(value) {
  if (!value) return '-';

  const raw = String(value).trim();

  // Só data (coluna DATE): sem hora, sem fuso, sem deslocamento.
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return `${day}/${month}/${year}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '-';

  // Meia-noite UTC: o dia em UTC é o dia do calendário, não o dia local.
  const utcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  if (utcMidnight) {
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${date.getUTCFullYear()}`;
  }

  return date.toLocaleDateString('pt-BR');
}
