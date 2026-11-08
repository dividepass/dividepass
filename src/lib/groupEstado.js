/**
 * ESTADO DO GRUPO — esgotado, cheio, desativado.
 *
 * Três situations em que o grupo NÃO aceita mais gente:
 *
 *   - ESGOTADO: o fornecedor está sem estoque (tag "Esgotado"). O grupo
 *     continua na vitrine, mas ninguém entra.
 *   - CHEIO: não sobrou vaga (comportamento antigo, que já existia).
 *   - DESATIVADO: o grupo foi fechado (`status = 'closed'`).
 *
 * Quando o grupo está em um desses estados, o card fica mais TRANSPARENTE:
 * o olho vai direto para o que dá para comprar.
 *
 * O bloqueio de verdade (que impede a cobrança) está no servidor
 * (`create-payment` recusa com 403 `grupo_esgotado`); aqui é só a
 * aparência.
 */

export const TAG_ESGOTADO = 'Esgotado';

/** O grupo está sem estoque no fornecedor? */
export function grupoEsgotado(group) {
  if (!group) return false;
  const tags = Array.isArray(group.tags) ? group.tags : [];
  return tags.some((t) => String(t || '').trim().toLowerCase() === TAG_ESGOTADO.toLowerCase());
}

/** O grupo foi fechado/desativado? */
export function grupoDesativado(group) {
  if (!group) return false;
  return String(group.status || '').trim().toLowerCase() === 'closed';
}

/** Esgotado OU desativado — os dois não aceitam mais gente. */
export function grupoIndisponivel(group) {
  return grupoEsgotado(group) || grupoDesativado(group);
}

/** Texto curto do estado esgotado (usado no card e no botão). */
export const TEXTO_ESGOTADO = 'Esgotado';
