import { supabase } from './supabase';

let cached = null;

/**
 * A coluna `groups.visibility` entra por migration
 * (database/add-platform-plans-and-group-visibility.sql). Antes dela existir:
 *  - mandar `visibility` no INSERT/UPDATE quebraria o cadastro do grupo
 *    (PostgREST 42703);
 *  - filtrar por `visibility` nas listagens publicas quebraria a query.
 *
 * A mesma estrategia de `lib/groupHasAds.js`: o front pergunta se a coluna ja
 * esta no `select('*')` e so usa o campo quando ela existe.
 */
export async function visibilityColumnAvailable() {
  if (cached === true) return true;

  try {
    const { data, error } = await supabase.from('groups').select('*').limit(1);
    if (error) return false;

    const row = data && data[0];
    if (!row) return false;

    cached = 'visibility' in row;
    return cached;
  } catch {
    return false;
  }
}

/** O banco respondeu que nao conhece a coluna `visibility`. */
export function isMissingVisibilityColumn(error) {
  if (!error) return false;
  const texto = `${error.message || ''} ${error.details || ''} ${error.code || ''} ${error.hint || ''}`;
  return /visibility/i.test(texto) && /(column|does not exist|nao existe|PGRST204|42703)/i.test(texto);
}

/**
 * Aplica o filtro de grupo publico numa query do PostgREST — mas so quando a
 * coluna existe no banco. Sem a coluna, nada e filtrado (comportamento antigo).
 */
export function applyPublicVisibility(query, available) {
  if (!available) return query;
  return query.eq('visibility', 'public');
}

/** Valor salvo no grupo. */
export const VISIBILITY_PUBLIC = 'public';
export const VISIBILITY_PRIVATE = 'private';

/**
 * Monta a query já filtrando os grupos privados (quando a coluna existe).
 *
 * @param {Function} buildQuery função que devolve a query do PostgREST
 * @returns {Promise<object>} a query com o filtro aplicado (ou sem ele)
 */
export async function withPublicVisibility(buildQuery) {
  const available = await visibilityColumnAvailable();
  const query = buildQuery();
  if (!available) return query;
  return query.eq('visibility', 'public');
}
