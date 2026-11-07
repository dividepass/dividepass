import { supabase } from './supabase';

/**
 * CHAT DO GRUPO
 * =============
 *
 * O dono liga/desliga a troca de mensagens entre os membros na etapa de
 * criacao. A coluna `groups.chat_enabled` entra por migration
 * (database/add-platform-plans-and-group-visibility.sql).
 *
 * Sem a coluna no banco, o grupo mantem o chat ligado (comportamento antigo)
 * e o front nao manda o campo no INSERT/UPDATE.
 */

let cached = null;

/** A coluna `chat_enabled` ja existe no banco? */
export async function chatColumnAvailable() {
  if (cached === true) return true;

  try {
    const { data, error } = await supabase.from('groups').select('*').limit(1);
    if (error) return false;

    const row = data && data[0];
    if (!row) return false;

    cached = 'chat_enabled' in row;
    return cached;
  } catch {
    return false;
  }
}

/** O banco respondeu que nao conhece a coluna `chat_enabled`. */
export function isMissingChatColumn(error) {
  if (!error) return false;
  const texto = `${error.message || ''} ${error.details || ''} ${error.code || ''} ${error.hint || ''}`;
  return /chat_enabled/i.test(texto)
    && /(column|does not exist|nao existe|PGRST204|42703)/i.test(texto);
}

/**
 * O grupo tem chat? Sem a coluna no banco (ou com o grupo legado) o chat
 * continua liberado — o chat nunca some sozinho.
 */
export function isChatEnabled(group) {
  if (!group) return true;
  if (!('chat_enabled' in group)) return true;
  return group.chat_enabled !== false;
}
