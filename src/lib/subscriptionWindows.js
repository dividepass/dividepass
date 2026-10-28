/**
 * Janelas de renovação — definição única da tela de assinaturas.
 *
 * A tela tinha TRÊS definições diferentes de "próximos 30 dias" (o card,
 * o modal e o filtro da tabela), cada uma contando um conjunto diferente de
 * assinaturas. Aqui as janelas existem uma vez: os limites (start/end) saem
 * de uma única função e são consumidos tanto pelas queries (server-side)
 * quanto pelos filtros de tabela e pelos modais.
 *
 * SEMÂNTICA
 * ----------
 * Todas as janelas olham a DATA DE VENCIMENTO do ciclo — `renewal_due_at`
 * (coluna que o pagamento aprovado grava), com queda para `next_charge_at` e
 * `expires_at` nas assinaturas antigas. É a mesma data que decide o status
 * (ativa/atrasada/cancelada): o `next_charge_at` anda a cada retry de cartão,
 * então usá-lo aqui mostraria um vencimento que não é o fim do acesso.
 *
 *   next7     (hoje,      hoje+7d]   -> "Vencem em até 7 dias"
 *   next30    (hoje+7d,   hoje+30d]  -> "Vencem entre 8 e 30 dias"
 *   next60    (hoje+30d,  hoje+60d]  -> "Vencem entre 31 e 60 dias"
 *   thisMonth (hoje,      fim do mês] -> "Vencem ainda neste mês"
 *
 * As três janelas de dias são DISJUNTAS: a de 30 dias não inclui os 7 dias
 * (o bug antigo) e cada rótulo diz exatamente o intervalo que conta.
 * `thisMonth` é a visão de calendário (o que ainda vence dentro do mês
 * corrente) e pode sobrepor as janelas de dias — por isso o rótulo é
 * explícito e ela não entra na tira de contagem.
 */

import { subscriptionRenewalDate } from './subscriptionAccess';

const DAY_MS = 24 * 60 * 60 * 1000;

export const RENEWAL_WINDOW_KEYS = ['thisMonth', 'next7', 'next30', 'next60'];

export const RENEWAL_WINDOW_LABELS = {
  thisMonth: 'Vencem ainda neste mês',
  next7: 'Vencem em até 7 dias',
  next30: 'Vencem entre 8 e 30 dias',
  next60: 'Vencem entre 31 e 60 dias',
};

export const RENEWAL_WINDOW_SHORT_LABELS = {
  thisMonth: 'neste mês',
  next7: '7 dias',
  next30: '8–30 dias',
  next60: '31–60 dias',
};

/** Limites (Date) de cada janela, a partir de um instante de referência. */
export function getRenewalWindows(now = new Date()) {
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  return {
    // "ainda neste mês": do agora até o fim do mês corrente.
    thisMonth: {
      start: monthStart.getTime() > now.getTime() ? monthStart : new Date(now.getTime()),
      end: monthEnd,
    },
    next7: {
      start: new Date(now.getTime()),
      end: new Date(now.getTime() + 7 * DAY_MS),
    },
    next30: {
      start: new Date(now.getTime() + 7 * DAY_MS),
      end: new Date(now.getTime() + 30 * DAY_MS),
    },
    next60: {
      start: new Date(now.getTime() + 30 * DAY_MS),
      end: new Date(now.getTime() + 60 * DAY_MS),
    },
  };
}

/** Limites em ISO, prontos para as queries do Supabase. */
export function renewalWindowRange(key, now = new Date()) {
  const window = getRenewalWindows(now)[key];
  if (!window) return null;
  return {
    startIso: window.start.toISOString(),
    endIso: window.end.toISOString(),
  };
}

/** Uma assinatura pertence à janela? Mesma regra usada nas queries. */
export function matchesRenewalWindow(sub, key, now = new Date()) {
  const window = getRenewalWindows(now)[key];
  if (!window) return false;

  // A data do vencimento vem do módulo de domínio (mesma do card de renovação
  // e da regra de status): `renewal_due_at` → `next_charge_at` → `expires_at`.
  const raw = subscriptionRenewalDate(sub);
  if (!raw) return false;

  const time = new Date(raw).getTime();
  if (Number.isNaN(time)) return false;

  return time > window.start.getTime() && time <= window.end.getTime();
}

/** Filtra uma lista de assinaturas pela janela. */
export function filterByRenewalWindow(list, key, now = new Date()) {
  return (list || []).filter((sub) => matchesRenewalWindow(sub, key, now));
}
