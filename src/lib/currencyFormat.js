/**
 * Formatação de moeda (pt-BR).
 *
 * Vive num módulo próprio — e não dentro do componente do gráfico — porque
 * o `react-refresh` não permite um arquivo de componente exportar funções
 * soltas: o Fast Refresh do Vite só funciona quando o arquivo exporta
 * componentes.
 */

/** R$ 12.345,67 — valor completo (cards, tooltip, tabela). */
export function formatCurrencyFull(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

/**
 * R$ 12.345,67 -> "R$ 12,3 mil" — valor compacto (eixo do gráfico).
 *
 * O eixo precisa caber em poucos pixels: o valor cheio viraria uma mancha
 * sobre a grade.
 */
export function formatCurrencyCompact(value) {
  const number = Number(value) || 0;
  const abs = Math.abs(number);
  const sign = number < 0 ? '-' : '';

  if (abs >= 1000000) {
    return `${sign}R$ ${(abs / 1000000).toFixed(abs >= 10000000 ? 0 : 1).replace('.', ',')} mi`;
  }
  if (abs >= 1000) {
    return `${sign}R$ ${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1).replace('.', ',')} mil`;
  }
  return `${sign}R$ ${abs.toFixed(0)}`;
}
