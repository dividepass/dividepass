import { supabase } from './supabase';

let cached = null;

/**
 * A coluna `groups.has_ads` entra por migration
 * (database/add-group-has-ads.sql). Até ela existir, mandar o campo no
 * INSERT/UPDATE do grupo quebraria o cadastro inteiro (PostgREST 42703),
 * então o front pergunta se a coluna já está no `select('*')` e só envia o
 * campo quando ela existe.
 *
 * Só guardamos uma resposta POSITIVA: quando o usuário ainda não tem nenhum
 * grupo, não dá para provar que a coluna existe — aí o seletor fica
 * escondido (nada quebra) e a próxima consulta, depois do rascunho existir,
 * resolve.
 */
export async function hasAdsColumnAvailable() {
  if (cached === true) return true;

  try {
    const { data, error } = await supabase.from('groups').select('*').limit(1);
    if (error) return false;

    const row = data && data[0];
    if (!row) return false;

    cached = 'has_ads' in row;
    return cached;
  } catch {
    return false;
  }
}

/**
 * O banco respondeu que não conhece a coluna `has_ads` (42703 / PGRST204).
 * Aí o insert/update é refeito sem o campo e o seletor se desliga.
 */
export function isMissingHasAdsColumn(error) {
  if (!error) return false;
  const texto = `${error.message || ''} ${error.details || ''} ${error.code || ''} ${error.hint || ''}`;
  return /has_ads/i.test(texto) && /(column|does not exist|nao existe|PGRST204|42703)/i.test(texto);
}
