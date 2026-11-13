/**
 * ESTADO DO GRUPO — esgotado, cheio, desativado.
 *
 * O vocabulário de status é o MESMO do painel da Pulse Coding:
 *
 *   - "Na vitrine"   → liberado, clicável, dá para comprar;
 *   - "Formando"     → grupo ainda montando (dá para entrar, mas não fecha);
 *   - "Esgotado"     → indisponível: NÃO é clicável, ninguém entra e
 *                      ninguém paga.
 *
 * Três situations em que o grupo NÃO aceita mais gente:
 *
 *   - ESGOTADO: o fornecedor está sem estoque (tag "Esgotado"). O grupo
 *     continua na vitrine, mas ninguém entra.
 *   - CHEIO: não sobrou vaga (comportamento antigo, que já existia).
 *   - DESATIVADO: o grupo foi fechado (`status = 'closed'`). É o que a
 *     sincronização com a Pulse faz quando o produto vira "Indisponível" lá.
 *
 * Quando o grupo está em um desses estados, o card fica mais TRANSPARENTE:
 * o olho vai direto para o que dá para comprar.
 *
 * O bloqueio de verdade (que impede a cobrança) está no servidor
 * (`create-payment` recusa com 403 `grupo_esgotado` / `grupo_desativado`);
 * aqui é só a aparência — e a decisão de não deixar clicar.
 */

export const TAG_ESGOTADO = 'Esgotado';

/** Rótulos de status (o mesmo tom do painel da Pulse). */
export const STATUS_NA_VITRINE = 'Na vitrine';
export const STATUS_FORMANDO = 'Formando';
export const STATUS_ESGOTADO = 'Esgotado';

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

/**
 * O grupo está LIBERADO (liberado e clicável)?
 *
 * "Formando" continua liberado: a pessoa entra no grupo enquanto ele monta.
 */
export function grupoLiberado(group) {
  return !grupoIndisponivel(group);
}

/**
 * O rótulo do status do grupo, no vocabulário da Pulse.
 *
 *   - "Esgotado"   → esgotado OU desativado (indisponível);
 *   - "Formando"   → o grupo ainda está montando;
 *   - "Na vitrine" → liberado, à venda.
 */
export function statusGrupoLabel(group) {
  if (grupoIndisponivel(group)) return STATUS_ESGOTADO;
  if (String(group?.status || '').trim().toLowerCase() === 'forming') return STATUS_FORMANDO;
  return STATUS_NA_VITRINE;
}

/** Texto curto do estado esgotado (usado no card e no botão). */
export const TEXTO_ESGOTADO = 'Esgotado';
