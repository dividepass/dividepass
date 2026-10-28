/**
 * Regras de filtro e ordenação da listagem de assinaturas (admin).
 *
 * Estas regras ficam aqui — e não espalhadas dentro do componente — porque
 * são a definição ÚNICA de "o que a listagem mostra". A query do servidor, os
 * contadores dos pills e os testes leem as mesmas regras, então não há como
 * o card e a tabela discordarem.
 *
 * SEMÂNTICA
 * ----------
 * - A listagem inicial (`all`) NÃO traz as assinaturas CANCELADAS. Elas só
 *   aparecem quando o filtro "Canceladas" é escolhido. (Cancelar é um
 *   ato explícito; o que está cancelado não deve ocupar a fila do dia.)
 * - `attention` é derivado, não um status do banco: vencidas (renovação no
 *   passado) OU em retry.
 * - A ordenação é por VENCIMENTO: a mais vencida primeiro e, dentro de cada
 *   grupo, a renovação mais antiga antes da mais futura. Assinatura sem
 *   data de cobrança vai para o fim.
 * - Para as canceladas o vencimento não diz nada — o que importa é quando
 *   o cancelamento aconteceu.
 */

import { renewalWindowRange } from './subscriptionWindows';

/**
 * Filtros de status da listagem (a ordem é a ordem em que aparecem).
 *
 * Os status legados do banco ('expired', 'inactive') NAO tem filtro próprio:
 * eles entram na pilha de "Canceladas". A regra nova reduz a interface a
 * quatro estados (Ativa, Atrasada, Pendente, Cancelada) e o painel admin
 * mostra os mesmos quatro.
 */
export const STATUS_FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'active', label: 'Ativas' },
  { key: 'attention', label: 'Atenção' },
  { key: 'pending', label: 'Pendentes' },
  { key: 'cancelled', label: 'Canceladas' },
];

/**
 * Status que a listagem "viva" mostra — ainda não canceladas.
 *
 * 'expired' é o legado que o job de faturas gravava para "atrasada": entra na
 * lista até o job de status normalizá-lo (virar 'active' dentro da carência ou
 * 'cancelled' depois dela). A migration e o job de status cuidam dessa
 * normalização; a listagem não depende do job para mostrar a atrasada.
 */
export const LISTED_STATUSES = ['active', 'expired', 'pending'];

/**
 * Status terminal: cancelada de verdade.
 *
 * 'inactive' é o legado de "inativa" — também terminal. Já o 'expired' NÃO
 * entra aqui: ele significa "atrasada" enquanto a carência de 7 dias não
 * vence (e a pessoa ainda pode renovar), então aparece em "Atenção", não em
 * "Canceladas".
 */
export const CANCELLED_STATUSES = ['cancelled', 'inactive'];

/** Filtro de renovação da tabela -> chave da janela compartilhada. */
export const RENEWAL_FILTER_WINDOWS = {
  this_month: 'thisMonth',
  next_7: 'next7',
  next_30: 'next30',
  next_60: 'next60',
};

/**
 * "Vencida" no servidor, espelhando `isSubscriptionOverdue`: assinatura não
 * cancelada com a data de renovação no passado.
 *
 * A data de renovação é `renewal_due_at` (o vencimento do ciclo, que NÃO anda
 * a cada retry). As assinaturas antigas, sem a coluna, caem para
 * `next_charge_at` e, na falta dele, para `expires_at`.
 *
 * Devolvido em "branches" (cada branch vira um item do `.or()`) para que o
 * filtro de status e o filtro de renovação sejam combinados em UM `.or()` —
 * dois `.or()` soltos no PostgREST não podem ser combinados com segurança.
 */
export function overdueBranches(nowIso) {
  return [
    `and(renewal_due_at.not.is.null,renewal_due_at.lt.${nowIso})`,
    `and(renewal_due_at.is.null,next_charge_at.not.is.null,next_charge_at.lt.${nowIso})`,
    `and(renewal_due_at.is.null,next_charge_at.is.null,expires_at.lt.${nowIso})`,
  ];
}

export function overdueServerFilter(nowIso) {
  return overdueBranches(nowIso).join(',');
}

/** "Vencida" ou "em retry" — o que está quebrado e precisa de atenção. */
export function attentionBranches(nowIso) {
  return [...overdueBranches(nowIso), 'billing_status.eq.retrying'];
}

export function attentionServerFilter(nowIso) {
  return attentionBranches(nowIso).join(',');
}

/**
 * Aplica o filtro de status na query.
 *
 * @param {object} query      builder do PostgREST
 * @param {string} statusFilter chave de STATUS_FILTERS
 * @param {string} nowIso     instante de referência
 * @param {string[]} branches  acumulador dos branches do `.or()` (mutado)
 */
export function applyStatusFilter(query, statusFilter, nowIso, branches) {
  if (statusFilter === 'cancelled') {
    // Só as canceladas de verdade (inclui o legado 'inactive'). O 'expired'
    // legado NÃO entra: ele significa "atrasada" enquanto a carência não
    // vence, e a pessoa ainda pode renovar.
    return query.in('status', CANCELLED_STATUSES);
  }

  if (statusFilter === 'attention') {
    branches.push(...attentionBranches(nowIso));
    return query.in('status', LISTED_STATUSES);
  }

  if (statusFilter === 'all') {
    // Listagem inicial: as canceladas ficam de fora.
    return query.in('status', LISTED_STATUSES);
  }

  return query.eq('status', statusFilter);
}

/**
 * Aplica o filtro de renovação na query.
 *
 * @param {object} query        builder do PostgREST
 * @param {string} renewalFilter 'all' | 'overdue' | 'this_month' | 'next_7' | ...
 * @param {Date} now            instante de referência
 * @param {string[]} branches   acumulador dos branches do `.or()` (mutado)
 */
export function applyRenewalFilter(query, renewalFilter, now, branches) {
  if (renewalFilter === 'overdue') {
    branches.push(...overdueBranches(now.toISOString()));
    return query;
  }

  if (renewalFilter === 'all') return query;

  const range = renewalWindowRange(RENEWAL_FILTER_WINDOWS[renewalFilter], now);
  if (!range) return query;

  // A janela olha a data de vencimento do ciclo (`renewal_due_at`) — a mesma
  // que decide o status. O `next_charge_at` anda a cada retry de cartão, então
  // filtrar por ele mostraria um vencimento que não é o fim do acesso.
  // (A assinatura sem `renewal_due_at` fica de fora: sem data de vencimento
  // não existe janela de renovação para ela.)
  return query
    .gt('renewal_due_at', range.startIso)
    .lte('renewal_due_at', range.endIso);
}

/**
 * Ordena por vencimento: a mais vencida primeiro e, dentro de cada grupo, a
 * renovação mais antiga antes da mais futura. Sem data de cobrança no fim.
 *
 * A ordenação usa `renewal_due_at` (vencimento do ciclo) com `next_charge_at`
 * como desempate — é a mesma data que a coluna "Vencimento" mostra, então a
 * lista fica na ordem em que o vencimento é lido.
 */
export function applyDueOrdering(query, statusFilter) {
  if (statusFilter === 'cancelled') {
    return query.order('updated_at', { ascending: false, nullsFirst: false });
  }

  return query
    .order('renewal_due_at', { ascending: true, nullsFirst: false })
    .order('next_charge_at', { ascending: true, nullsFirst: false })
    .order('updated_at', { ascending: false });
}
