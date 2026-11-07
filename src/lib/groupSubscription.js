import { supabase } from './supabase';

/**
 * STATUS DA ASSINATURA DA CONTA COMPARTILHADA
 * =============================================
 *
 * O dono do grupo declara se a conta do serviço (Netflix, Spotify, ...) ja
 * esta paga e ativa ou se ele vai assinar quando o grupo fechar:
 *
 *   - 'active'  -> "Ja Assinei"  — a conta ja esta ativa e pronta para uso.
 *   - 'pending' -> "Vou Assinar" — assinarei apenas quando o grupo fechar.
 *
 * A coluna `groups.subscription_status` entra por migration
 * (database/add-platform-plans-and-group-visibility.sql). Antes dela existir,
 * mandar o campo no INSERT/UPDATE quebraria o cadastro do grupo (PostgREST
 * 42703) — por isso o front pergunta se a coluna ja esta no `select('*')` e
 * so usa o campo quando ela existe (mesma estrategia de lib/groupHasAds.js).
 */

export const SUBSCRIPTION_ACTIVE = 'active';
export const SUBSCRIPTION_PENDING = 'pending';

/** Opcoes da etapa "Status da Assinatura" (titulo/descricao das telas). */
export const SUBSCRIPTION_STATUS_OPTIONS = [
  {
    key: SUBSCRIPTION_ACTIVE,
    title: 'Já Assinei',
    desc: 'A conta já está ativa e pronta para uso.',
    tone: 'success',
  },
  {
    key: SUBSCRIPTION_PENDING,
    title: 'Vou Assinar',
    desc: 'Assinarei apenas quando o grupo fechar.',
    tone: 'warning',
  },
];

let cached = null;

/** A coluna `subscription_status` ja existe no banco? */
export async function subscriptionStatusColumnAvailable() {
  if (cached === true) return true;

  try {
    const { data, error } = await supabase.from('groups').select('*').limit(1);
    if (error) return false;

    const row = data && data[0];
    if (!row) return false;

    cached = 'subscription_status' in row;
    return cached;
  } catch {
    return false;
  }
}

/** O banco respondeu que nao conhece a coluna `subscription_status`. */
export function isMissingSubscriptionStatusColumn(error) {
  if (!error) return false;
  const texto = `${error.message || ''} ${error.details || ''} ${error.code || ''} ${error.hint || ''}`;
  return /subscription_status/i.test(texto)
    && /(column|does not exist|nao existe|PGRST204|42703)/i.test(texto);
}

/**
 * Status do grupo conforme a assinatura:
 *   - 'pending' -> 'forming' (o grupo aparece como "Formando" ate o dono
 *     confirmar que assinou);
 *   - 'active'  -> 'open'.
 *
 * @param {string} subscriptionStatus 'active' | 'pending'
 * @param {string} [fallback] status usado quando a assinatura esta ativa
 */
export function groupStatusForSubscription(subscriptionStatus, fallback = 'open') {
  if (subscriptionStatus === SUBSCRIPTION_PENDING) return 'forming';
  return fallback || 'open';
}

/** Texto curto do status (resumo do grupo, painel admin, aviso do dono). */
export function subscriptionStatusLabel(status) {
  if (status === SUBSCRIPTION_PENDING) return 'Vou assinar (grupo em formação)';
  if (status === SUBSCRIPTION_ACTIVE) return 'Já assinada';
  return '—';
}

/** O grupo ainda esta esperando o dono assinar a conta? */
export function isSubscriptionPending(status) {
  return status === SUBSCRIPTION_PENDING;
}
