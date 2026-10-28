import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Edit2, XCircle, Loader2, Calendar, DollarSign, RefreshCw,
  Eye, X, CreditCard, Hash, Clock, Tag, AlertCircle,
  ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { isSubscriptionOverdue, renewalDeadline } from '../../lib/subscriptionAccess';
import { formatDateBR } from '../../lib/dateFormat';
import {
  RENEWAL_WINDOW_LABELS,
  RENEWAL_WINDOW_SHORT_LABELS,
  getRenewalWindows,
  matchesRenewalWindow,
  renewalWindowRange,
} from '../../lib/subscriptionWindows';
import {
  CANCELLED_STATUSES,
  LISTED_STATUSES,
  STATUS_FILTERS,
  applyDueOrdering,
  applyRenewalFilter,
  applyStatusFilter,
  attentionServerFilter,
  overdueServerFilter,
} from '../../lib/subscriptionFilters';
import { cycleFullLabel, cycleLabel, cycleMonths, monthlyEquivalent } from '../../lib/subscriptionCycles';
import './Subscriptions.css';

/**
 * Filtros de status da listagem.
 *
 * `all` NÃO significa "todos os registros": as assinaturas canceladas ficam
 * fora da listagem inicial e só aparecem quando o filtro "Canceladas" é
 * escolhido. `attention` é um filtro derivado (vencidas + em retry), não um
 * status do banco.
 *
 * A definição vive em `src/lib/subscriptionFilters.js` — junto com a
 * ordenação por vencimento — para que a query, os pills e os testes leiam
 * a mesma regra.
 */

const CYCLE_OPTIONS = ['monthly', 'quarterly', 'semiannual', 'annual', 'days'];
const PAGE_SIZE_OPTIONS = [25, 50, 100];

// Limites de leitura: a tela nunca baixa a tabela inteira.
const MODAL_LIST_LIMIT = 200;
const AGGREGATE_LIMIT = 5000;
const SEARCH_ID_LIMIT = 200;
const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

const TABLE_SELECT = `
  *,
  user:user_id (id, name, email),
  group:group_id (id, name, slug),
  service:service_id (id, name, full_name),
  coupon:coupon_id (id, code, discount_type, discount_value)
`;

const statusLabel = (status) => ({
  active: 'Ativa',
  inactive: 'Inativa',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  pending: 'Pendente',
  overdue: 'Atrasada',
  first_attempt: 'Primeira tentativa',
}[status] || status || '—');

const paymentStatusLabel = (s) => ({
  paid: 'Pago', pending: 'Pendente', failed: 'Falhou', cancelled: 'Cancelado',
  approved: 'Aprovado', processing: 'Processando', authorized: 'Autorizado',
  refunded: 'Reembolsado', disputed: 'Em disputa',
}[s] || s || '—');

const paymentStatusClass = (s) => {
  if (['paid', 'approved', 'authorized', 'completed', 'captured', 'confirmed', 'settled'].includes(s)) return 'active';
  if (['pending', 'processing', 'waiting'].includes(s)) return 'pending';
  if (['failed', 'cancelled', 'refunded', 'disputed', 'error'].includes(s)) return 'cancelled';
  return 'inactive';
};

/** Limpa o termo de busca: vírgula/ponto quebram a sintaxe do filtro .or(). */
function sanitizeSearch(value) {
  return String(value || '')
    .replace(/[,().:*%'"\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstError(...results) {
  for (const result of results) {
    if (result?.error) return result.error;
  }
  return null;
}

/**
 * Resolve o termo de busca em ids. O PostgREST não aceita `or()` no nível
 * de cima misturando colunas de tabelas embutidas (`user.name`, `group.name`),
 * então a busca acontece por id e a assinatura é filtrada por `in`.
 */
async function resolveSearchIds(term) {
  const clean = sanitizeSearch(term);
  if (!clean) return null;

  const pattern = `%${clean}%`;
  const [usersRes, servicesRes, groupsRes] = await Promise.all([
    supabase.from('users').select('id').or(`name.ilike.${pattern},email.ilike.${pattern}`).limit(SEARCH_ID_LIMIT),
    supabase.from('streaming_services').select('id').ilike('name', pattern).limit(SEARCH_ID_LIMIT),
    supabase.from('groups').select('id').ilike('name', pattern).limit(SEARCH_ID_LIMIT),
  ]);

  const error = firstError(usersRes, servicesRes, groupsRes);
  if (error) throw error;

  return {
    userIds: (usersRes.data || []).map((u) => u.id),
    serviceIds: (servicesRes.data || []).map((s) => s.id),
    groupIds: (groupsRes.data || []).map((g) => g.id),
  };
}

function Subscriptions() {
  const navigate = useNavigate();

  // ─────────────────────────────────── filtros e paginação (tudo no servidor)
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [cycleFilter, setCycleFilter] = useState('all');
  const [renewalFilter, setRenewalFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [refreshKey, setRefreshKey] = useState(0);

  // ─────────────────────────────────── dados
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [stats, setStats] = useState({
    totalCount: 0,
    activeCount: 0,
    receivedAmount: 0,
    mrr: 0,
    attentionCount: 0,
    overdueCount: 0,
    retryingCount: 0,
    cancelledCount: 0,
    pendingCount: 0,
    windowCounts: { next7: 0, next30: 0, next60: 0 },
    receivedTruncated: false,
    mrrTruncated: false,
  });

  // ─────────────────────────────────── modais
  const [detailSub, setDetailSub] = useState(null);
  const [detailPayments, setDetailPayments] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailBillingCycles, setDetailBillingCycles] = useState([]);
  const [selectedPayment, setSelectedPayment] = useState(null);

  const [statDetailModal, setStatDetailModal] = useState(null);
  const [statDetailData, setStatDetailData] = useState([]);
  const [statDetailLoading, setStatDetailLoading] = useState(false);

  // A página exibida é sempre a última disponível: se o total encolheu (um
  // registro foi cancelado), a tabela volta para uma página que ainda existe.
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = totalRows > 0 ? Math.min(page, totalPages - 1) : 0;
  const from = totalRows === 0 ? 0 : currentPage * pageSize + 1;
  const to = Math.min(totalRows, (currentPage + 1) * pageSize);

  // A busca só vai para o servidor depois de um tempo de pausa: evita uma
  // query por tecla digitada.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ─────────────────────────────────── tabela (paginada no servidor)
  useEffect(() => {
    let cancelled = false;

    const fetchRows = async () => {
      setLoading(true);
      setError('');
      try {
        const now = new Date();
        const nowIso = now.toISOString();

        let query = supabase
          .from('user_subscriptions')
          .select(TABLE_SELECT, { count: 'exact' });

        // ── Status ────────────────────────────────────────────────
        //
        // A listagem inicial NÃO traz as canceladas: elas só aparecem quando
        // o filtro "Canceladas" é escolhido. "Atenção" é derivado (vencidas +
        // em retry) e também deixa as canceladas de fora.
        const orBranches = [];

        query = applyStatusFilter(query, statusFilter, nowIso, orBranches);

        if (cycleFilter !== 'all') query = query.eq('billing_cycle', cycleFilter);

        // ── Renovação ─────────────────────────────────────────────
        query = applyRenewalFilter(query, renewalFilter, now, orBranches);

        // ── Ordenação ─────────────────────────────────────────────
        //
        // Por vencimento: a mais vencida primeiro (as vencidas ficam no topo)
        // e, dentro de cada grupo, a renovação mais antiga vem antes da mais
        // futura. Sem data de cobrança vai para o fim.
        query = applyDueOrdering(query, statusFilter);

        // A busca entra NO MESMO `.or()`.
        //
        // O PostgREST aceita UM `or` de topo: um segundo sobrescreve o primeiro
        // na URL. Com o filtro de status/renovação e a busca em `.or()`
        // separados, a busca apagava o filtro de "Atenção"/"Vencidas" (ou o
        // contrário) sem avisar. As duas condições viajam juntas agora.
        const ids = await resolveSearchIds(search);
        if (ids) {
          const searchBranches = [];
          if (ids.userIds.length) searchBranches.push(`user_id.in.(${ids.userIds.join(',')})`);
          if (ids.serviceIds.length) searchBranches.push(`service_id.in.(${ids.serviceIds.join(',')})`);
          if (ids.groupIds.length) searchBranches.push(`group_id.in.(${ids.groupIds.join(',')})`);

          if (!searchBranches.length) {
            // Busca sem nenhum resultado: nada pode aparecer.
            query = query.eq('id', EMPTY_UUID);
          } else {
            orBranches.push(...searchBranches);
          }
        }

        // Um único `.or()` no fim, com tudo deduplicado.
        if (orBranches.length) query = query.or([...new Set(orBranches)].join(','));

        const from = currentPage * pageSize;
        const { data, count, error: queryError } = await query.range(from, from + pageSize - 1);
        if (queryError) throw queryError;
        if (cancelled) return;

        setRows(data || []);
        setTotalRows(count || 0);
        setNotice(
          ids && (ids.userIds.length === SEARCH_ID_LIMIT
            || ids.serviceIds.length === SEARCH_ID_LIMIT
            || ids.groupIds.length === SEARCH_ID_LIMIT)
            ? 'Busca parcial: há mais resultados do que os 200 primeiros de cada tipo. Refine o termo.'
            : ''
        );
      } catch (err) {
        if (!cancelled) setError('Erro ao carregar as assinaturas: ' + (err.message || err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchRows();
    return () => { cancelled = true; };
  }, [statusFilter, cycleFilter, renewalFilter, search, currentPage, pageSize, refreshKey]);

  // ─────────────────────────────────── indicadores (contagens + agregados)
  useEffect(() => {
    let cancelled = false;

    const fetchStats = async () => {
      setStatsLoading(true);
      const now = new Date();
      const nowIso = now.toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
      const windows = getRenewalWindows(now);

      const countOf = (apply) =>
        apply(supabase.from('user_subscriptions').select('id', { count: 'exact', head: true }));

      const windowCount = (key) => {
        const window = windows[key];
        // Mesma janela e mesma data de vencimento do filtro da tabela
        // (`applyRenewalFilter`), senão o contador e a lista discordam.
        return countOf((q) => q
          .in('status', LISTED_STATUSES)
          .gt('renewal_due_at', window.start.toISOString())
          .lte('renewal_due_at', window.end.toISOString()));
      };

      try {
        const [
          totalRes, activeRes, cancelledRes, pendingRes,
          attentionRes, overdueRes, retryingRes,
          receivedRes, mrrRes,
          w7Res, w30Res, w60Res,
        ] = await Promise.all([
          countOf((q) => q),
          countOf((q) => q.eq('status', 'active')),
          // Canceladas = status final de qualquer jeito: 'cancelled' e o legado
          // 'inactive'. O 'expired' legado NÃO entra aqui: ele significa
          // "atrasada" enquanto a carência de 7 dias não vence.
          countOf((q) => q.in('status', CANCELLED_STATUSES)),
          countOf((q) => q.eq('status', 'pending')),
          countOf((q) => q.in('status', LISTED_STATUSES).or(attentionServerFilter(nowIso))),
          countOf((q) => q.in('status', LISTED_STATUSES).or(overdueServerFilter(nowIso))),
          countOf((q) => q.in('status', LISTED_STATUSES).eq('billing_status', 'retrying')),
          // Agregados: uma coluna só e janela do mês — não baixa a tabela.
          supabase.from('payments').select('amount', { count: 'exact' })
            .eq('status', 'paid').eq('payment_type', 'subscription')
            .gte('created_at', monthStart).lte('created_at', monthEnd).limit(AGGREGATE_LIMIT),
          supabase.from('user_subscriptions')
            .select('amount, billing_cycle, custom_cycle_days, custom_cycle_months', { count: 'exact' })
            .eq('status', 'active').limit(AGGREGATE_LIMIT),
          windowCount('next7'),
          windowCount('next30'),
          windowCount('next60'),
        ]);

        const statsError = firstError(
          totalRes, activeRes, cancelledRes, pendingRes,
          attentionRes, overdueRes, retryingRes, receivedRes, mrrRes, w7Res, w30Res, w60Res,
        );
        if (statsError) throw statsError;
        if (cancelled) return;

        const receivedAmount = (receivedRes.data || [])
          .reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const mrr = (mrrRes.data || [])
          .reduce((sum, s) => sum + monthlyEquivalent(s), 0);

        setStats({
          totalCount: totalRes.count || 0,
          activeCount: activeRes.count || 0,
          receivedAmount,
          mrr,
          attentionCount: attentionRes.count || 0,
          overdueCount: overdueRes.count || 0,
          retryingCount: retryingRes.count || 0,
          cancelledCount: cancelledRes.count || 0,
          pendingCount: pendingRes.count || 0,
          windowCounts: {
            next7: w7Res.count || 0,
            next30: w30Res.count || 0,
            next60: w60Res.count || 0,
          },
          receivedTruncated: (receivedRes.count || 0) > (receivedRes.data || []).length,
          mrrTruncated: (mrrRes.count || 0) > (mrrRes.data || []).length,
        });
      } catch (err) {
        if (!cancelled) setError('Erro ao carregar os indicadores: ' + (err.message || err));
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    };

    fetchStats();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const handleFilter = (setter, value) => {
    setter(value);
    setPage(0);
  };

  /** Quantos registros cada filtro de status mostra. */
  const statusFilterCount = (key) => {
    switch (key) {
      case 'all': return stats.totalCount - stats.cancelledCount;
      case 'active': return stats.activeCount;
      case 'attention': return stats.attentionCount;
      case 'pending': return stats.pendingCount;
      case 'cancelled': return stats.cancelledCount;
      default: return 0;
    }
  };

  const handleCancel = async (sub) => {
    if (!window.confirm(`Cancelar assinatura de ${sub.user?.name} no grupo ${sub.group?.name}?`)) return;

    try {
      const now = new Date().toISOString();

      const { error: subError } = await supabase
        .from('user_subscriptions')
        .update({ status: 'cancelled', billing_status: 'cancelled', updated_at: now })
        .eq('id', sub.id);
      if (subError) throw subError;

      // Mesmo desvinculo do cancelamento por carência (o `subscriptionLifecycle`
      // do backend): o membro sai do grupo com o status que a tela de
      // credenciais reconhece como encerrado.
      const { error: memberError } = await supabase
        .from('group_members')
        .update({ status: 'cancelled', payment_status: 'cancelled', left_at: now })
        .eq('group_id', sub.group_id)
        .eq('user_id', sub.user_id);
      if (memberError) throw memberError;

      // Cancela as cobranças agendadas: a regra é "cancelar todas as crons".
      // O enum de `billing_cycles.status` é ('pending','processing',
      // 'approved','failed','cancelled') — 'retrying' pertence ao enum da
      // assinatura e faria a query falhar com 22P02.
      const { error: cyclesError } = await supabase
        .from('billing_cycles')
        .update({ status: 'cancelled' })
        .eq('subscription_id', sub.id)
        .in('status', ['pending', 'processing', 'failed']);
      if (cyclesError) throw cyclesError;

      setRows((prev) => prev.map((s) => (s.id === sub.id ? { ...s, status: 'cancelled', updated_at: now } : s)));
      setRefreshKey((key) => key + 1);
    } catch (err) {
      setError('Erro ao cancelar: ' + (err.message || err));
    }
  };

  const openDetail = async (sub) => {
    setDetailSub(sub);
    setDetailLoading(true);
    setDetailPayments([]);
    setDetailBillingCycles([]);

    try {
      const [paymentsRes, subPaymentsRes, cyclesRes, attemptsRes] = await Promise.all([
        supabase.from('payments').select('*')
          .eq('user_id', sub.user_id).eq('group_id', sub.group_id)
          .order('created_at', { ascending: false }).limit(50),
        // Pagamentos vinculados pela assinatura: sobrevivem a uma transferência
        // de grupo (o pagamento continua no grupo antigo, mas a assinatura já
        // aponta para o novo).
        supabase.from('payments').select('*')
          .eq('subscription_id', sub.id)
          .order('created_at', { ascending: false }).limit(50),
        supabase.from('billing_cycles').select('*')
          .eq('subscription_id', sub.id)
          .order('charge_date', { ascending: false }).limit(50),
        supabase.from('payment_attempts').select('*')
          .eq('user_id', sub.user_id).eq('group_id', sub.group_id)
          .order('created_at', { ascending: false }).limit(50),
      ]);

      const detailError = firstError(paymentsRes, subPaymentsRes, cyclesRes, attemptsRes);
      if (detailError) throw detailError;

      const allPayments = [...(paymentsRes.data || [])];
      for (const p of (subPaymentsRes.data || [])) {
        if (!allPayments.find((x) => x.id === p.id)) allPayments.push(p);
      }
      for (const attempt of (attemptsRes.data || [])) {
        if (!allPayments.find((p) => p.transaction_code === attempt.gateway_transaction_id)) {
          allPayments.push({
            id: attempt.id,
            created_at: attempt.created_at,
            amount: attempt.amount,
            method: attempt.payment_method,
            status: attempt.status?.replace('polled_', ''),
            gateway: attempt.gateway,
            transaction_code: attempt.gateway_transaction_id,
            payment_type: attempt.payment_type,
          });
        }
      }
      allPayments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      setDetailPayments(allPayments);
      setDetailBillingCycles(cyclesRes.data || []);
    } catch (err) {
      setError('Erro ao carregar o histórico da assinatura: ' + (err.message || err));
    } finally {
      setDetailLoading(false);
    }
  };

  /** Linha do painel de detalhes (modal dos cards). */
  const toStatRow = useCallback((sub) => ({
    id: sub.id,
    type: 'subscription',
    subId: sub.id,
    sub,
    userId: sub.user_id,
    groupId: sub.group_id,
    userName: sub.user?.name || '—',
    userEmail: sub.user?.email || '—',
    serviceName: sub.service?.name || '—',
    groupName: sub.group?.name || '—',
    amount: Number(sub.amount || 0),
    totalAmount: Number(sub.amount || 0),
    monthly: monthlyEquivalent(sub),
    cycleLabel: cycleFullLabel(sub),
    nextCharge: sub.next_charge_at,
    status: sub.status,
    overdue: isSubscriptionOverdue(sub),
    retrying: sub.billing_status === 'retrying',
  }), []);

  /** Lista do modal: uma query por tipo, sempre limitada. */
  const fetchStatList = useCallback(async (type) => {
    const now = new Date();
    const nowIso = now.toISOString();

    if (type === 'received') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

      const { data, error } = await supabase.from('payments')
        .select(`
          id, amount, created_at, status, gateway, method, payment_type,
          user:user_id (id, name, email),
          group:group_id (id, name, service:service_id (id, name))
        `)
        .eq('status', 'paid').eq('payment_type', 'subscription')
        .gte('created_at', monthStart).lte('created_at', monthEnd)
        .order('created_at', { ascending: false }).limit(MODAL_LIST_LIMIT);
      if (error) throw error;

      return (data || []).map((p) => ({
        id: p.id,
        type: 'payment',
        userName: p.user?.name || '—',
        userEmail: p.user?.email || '—',
        serviceName: p.group?.service?.name || '—',
        groupName: p.group?.name || '—',
        amount: Number(p.amount || 0),
        totalAmount: Number(p.amount || 0),
        monthly: null,
        date: p.created_at,
        status: p.status,
      }));
    }

    let query = supabase.from('user_subscriptions').select(TABLE_SELECT).limit(MODAL_LIST_LIMIT);

    if (type === 'active') {
      query = query.eq('status', 'active').order('created_at', { ascending: false });
    } else if (type === 'mrr') {
      query = query.eq('status', 'active').order('amount', { ascending: false });
    } else if (type === 'cancelled') {
      query = query.in('status', CANCELLED_STATUSES).order('updated_at', { ascending: false });
    } else if (type === 'attention') {
      query = query.in('status', LISTED_STATUSES)
        .or(attentionServerFilter(nowIso))
        .order('renewal_due_at', { ascending: true });
    } else {
      // Janela de renovação: mesmos limites da definição compartilhada.
      const range = renewalWindowRange(type, now);
      query = query.in('status', LISTED_STATUSES)
        .gt('renewal_due_at', range.startIso)
        .lte('renewal_due_at', range.endIso)
        .order('next_charge_at', { ascending: true });
    }

    const { data, error } = await query;
    if (error) throw error;

    // A mesma janela compartilhada decide a lista final (filtro do servidor e
    // filtro do cliente não podem divergir).
    const rows = (data || []).filter(
      (sub) => type === 'next7' || type === 'next30' || type === 'next60' || type === 'thisMonth'
        ? matchesRenewalWindow(sub, type, now)
        : true
    );

    return rows.map((sub) => toStatRow(sub));
  }, [toStatRow]);

  const openStatDetail = async (type) => {
    setStatDetailModal(type);
    setStatDetailData([]);
    setStatDetailLoading(true);
    try {
      setStatDetailData(await fetchStatList(type));
    } catch (err) {
      setError('Erro ao carregar a lista do painel: ' + (err.message || err));
      setStatDetailModal(null);
    } finally {
      setStatDetailLoading(false);
    }
  };

  const statDetailTitle = () => ({
    active: 'Assinaturas ativas',
    received: 'Receita recebida no mês',
    mrr: 'Receita mensal equivalente (MRR)',
    attention: 'Precisam de atenção (vencidas + em retry)',
    cancelled: 'Canceladas',
    next7: RENEWAL_WINDOW_LABELS.next7,
    next30: RENEWAL_WINDOW_LABELS.next30,
    next60: RENEWAL_WINDOW_LABELS.next60,
    thisMonth: RENEWAL_WINDOW_LABELS.thisMonth,
  }[statDetailModal] || 'Detalhes');

  // No MRR o total é a soma mensal; nos demais, o total do ciclo.
  const statDetailTotal = () => {
    if (!statDetailData.length) return 0;
    const useMonthly = statDetailModal === 'mrr';
    return statDetailData.reduce((sum, item) => sum + (useMonthly ? item.monthly : item.totalAmount), 0);
  };

  const statDetailTotalLabel = () => (statDetailModal === 'mrr' ? 'Total mensal' : 'Total dos ciclos');

  /**
   * Vence em breve (7 dias)? Usa a data de vencimento do módulo de domínio
   * (`renewal_due_at` → `next_charge_at` → `expires_at`) — a mesma que o card
   * de renovação e o backend usam. Se o admin calculasse a data por fora, o
   * painel mostraria um vencimento diferente do que o usuário vê na tela.
   */
  const isRenewalSoon = (sub) => {
    if (!sub || sub.status !== 'active') return false;
    const deadline = renewalDeadline(sub);
    if (deadline === null) return false;
    const now = new Date().getTime();
    return deadline > now && deadline <= now + 7 * 24 * 60 * 60 * 1000;
  };

  /**
   * Data que define o vencimento. Vem do domínio (`renewalDeadline`), que
   * também trata o `expires_at` que é DATE valendo até o fim do dia.
   */
  const dueDate = (sub) => {
    const deadline = renewalDeadline(sub);
    return deadline === null ? null : new Date(deadline);
  };

  /** "vence em 3 dias" / "venceu há 12 dias" — o que o admin olha primeiro. */
  const dueLabel = (sub) => {
    const date = dueDate(sub);
    if (!date) return null;

    const days = Math.round((date.getTime() - new Date().getTime()) / 86400000);
    if (days === 0) return 'vence hoje';
    if (days === 1) return 'vence amanhã';
    if (days > 0) return `vence em ${days} dias`;
    if (days === -1) return 'venceu ontem';
    return `venceu há ${Math.abs(days)} dias`;
  };

  const rowClass = (sub) => {
    if (isSubscriptionOverdue(sub)) return 'renewal-overdue-row';
    if (isRenewalSoon(sub)) return 'renewal-soon';
    return '';
  };

  /**
   * Etiquetas de alerta da linha. Uma assinatura pode ser vencida E estar em
   * retry ao mesmo tempo — as duas informações aparecem juntas.
   */
  const renewalBadges = (sub) => {
    const badges = [];
    if (isSubscriptionOverdue(sub)) badges.push({ label: 'Vencida', className: 'overdue' });
    if (sub.billing_status === 'retrying') badges.push({ label: 'Em retry', className: 'retrying' });
    return badges;
  };

  return (
    <div className="fade-in subscriptions-page">
      <div className="admin-header subs-header">
        <div>
          <h1>Assinaturas</h1>
          <p className="page-subtitle">
            {statsLoading
              ? 'Carregando...'
              : `${stats.activeCount} ativas · ${stats.attentionCount} precisam de atenção · ${stats.totalCount} no total`}
          </p>
        </div>
      </div>

      {/* Números em uma linha só, sem caixinha. Os que abrem lista são botões. */}
      <div className="subs-metrics">
        <button type="button" className="subs-metric" onClick={() => openStatDetail('active')}>
          <span className="subs-metric-value">{stats.activeCount}</span>
          <span className="subs-metric-label">Ativas</span>
        </button>

        <button
          type="button"
          className={`subs-metric subs-metric-attention ${stats.attentionCount > 0 ? 'is-alert' : ''}`}
          onClick={() => openStatDetail('attention')}
        >
          <span className="subs-metric-value">
            <AlertTriangle size={15} />
            {stats.attentionCount}
          </span>
          <span className="subs-metric-label">Precisam de atenção</span>
          <span className="subs-metric-note">
            {stats.overdueCount} vencidas · {stats.retryingCount} em retry
          </span>
        </button>

        <button type="button" className="subs-metric" onClick={() => openStatDetail('cancelled')}>
          <span className="subs-metric-value">{stats.cancelledCount}</span>
          <span className="subs-metric-label">Canceladas</span>
          <span className="subs-metric-note">
            Canceladas, expiradas e inativas somados
          </span>
        </button>

        <button type="button" className="subs-metric" onClick={() => openStatDetail('mrr')}>
          <span className="subs-metric-value">R$ {stats.mrr.toFixed(2)}</span>
          <span className="subs-metric-label">MRR</span>
          {stats.mrrTruncated && <span className="subs-metric-note">Valor parcial</span>}
        </button>

        <button type="button" className="subs-metric" onClick={() => openStatDetail('received')}>
          <span className="subs-metric-value">R$ {stats.receivedAmount.toFixed(2)}</span>
          <span className="subs-metric-label">Recebido no mês</span>
          {stats.receivedTruncated && <span className="subs-metric-note">Valor parcial</span>}
        </button>
      </div>

      {/* Renovações: só contagem — cada janela abre a lista dela. */}
      <div className="subs-renewals">
        <span className="subs-renewals-label">Renovam em</span>
        {['next7', 'next30', 'next60'].map((key) => (
          <button
            key={key}
            type="button"
            className="subs-renewal-chip"
            onClick={() => openStatDetail(key)}
            title={RENEWAL_WINDOW_LABELS[key]}
          >
            <strong>{stats.windowCounts[key]}</strong>
            <span>{RENEWAL_WINDOW_SHORT_LABELS[key]}</span>
          </button>
        ))}
        <span className="subs-renewals-hint">
          Listagem em ordem de vencimento — as vencidas ficam no topo
        </span>
      </div>

      {/* Busca + filtros secundários. */}
      <div className="subs-toolbar">
        <div className="subs-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Buscar por usuário, serviço ou grupo..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              type="button"
              className="subs-search-clear"
              onClick={() => setSearchInput('')}
              aria-label="Limpar busca"
              title="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <label className="subs-field">
          <span>Ciclo</span>
          <select value={cycleFilter} onChange={(e) => handleFilter(setCycleFilter, e.target.value)}>
            <option value="all">Todos</option>
            {CYCLE_OPTIONS.map((c) => (
              <option key={c} value={c}>{cycleLabel(c)}</option>
            ))}
          </select>
        </label>

        <label className="subs-field">
          <span>Renovação</span>
          <select value={renewalFilter} onChange={(e) => handleFilter(setRenewalFilter, e.target.value)}>
            <option value="all">Todas</option>
            <option value="this_month">{RENEWAL_WINDOW_LABELS.thisMonth}</option>
            <option value="next_7">{RENEWAL_WINDOW_LABELS.next7}</option>
            <option value="next_30">{RENEWAL_WINDOW_LABELS.next30}</option>
            <option value="next_60">{RENEWAL_WINDOW_LABELS.next60}</option>
            <option value="overdue">Vencidas (atrasadas)</option>
          </select>
        </label>

        <button type="button" className="subs-refresh" onClick={() => setRefreshKey((key) => key + 1)}>
          <RefreshCw size={15} />
          Atualizar
        </button>
      </div>

      {/* Status: pílulas com a contagem de cada grupo. */}
      <div className="subs-pills" role="tablist" aria-label="Filtrar por status">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={statusFilter === f.key}
            className={`subs-pill ${statusFilter === f.key ? 'is-active' : ''}`}
            onClick={() => handleFilter(setStatusFilter, f.key)}
          >
            {f.label}
            <b>{statusFilterCount(f.key)}</b>
          </button>
        ))}
      </div>

      {error && <div className="error-banner">Erro: {error}</div>}
      {notice && <div className="notice-banner">{notice}</div>}

      {loading ? (
        <div className="loading-state">
          <Loader2 size={32} className="spin" />
          <p>Carregando assinaturas...</p>
        </div>
      ) : (
        <>
          <div className="admin-card table-responsive">
            <table className="subscriptions-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Serviço / Grupo</th>
                  <th>Ciclo</th>
                  <th>Valor</th>
                  <th>Próxima cobrança</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((sub) => {
                  const badges = renewalBadges(sub);
                  const monthly = monthlyEquivalent(sub);
                  const showsMonthly = cycleMonths(sub.billing_cycle, sub.custom_cycle_months) > 1;

                  return (
                    <tr key={sub.id} className={rowClass(sub)}>
                      <td>
                        <div className="user-cell">
                          <div className="user-avatar">{sub.user?.name?.[0]?.toUpperCase() || '?'}</div>
                          <div>
                            <a
                              className="link-name"
                              onClick={() => sub.user?.id && navigate(`/admin/users/${sub.user.id}`)}
                              title="Ver perfil do usuário"
                            >
                              {sub.user?.name || '—'}
                            </a>
                            <span>{sub.user?.email || '—'}</span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="service-cell">
                          <strong>{sub.service?.name || '—'}</strong>
                          <a
                            className="link-name link-group"
                            onClick={() => sub.group?.id && navigate(`/admin/groups/${sub.group.id}/edit`)}
                            title="Ver grupo"
                          >
                            {sub.group?.name || '—'}
                          </a>
                        </div>
                      </td>

                      <td>
                        <span className="cycle-label">{cycleFullLabel(sub)}</span>
                      </td>

                      <td>
                        <div className="value-cell">
                          {sub.discount_amount > 0 && (
                            <span className="value-original">
                              R$ {Number(sub.original_amount || sub.amount).toFixed(2)}
                            </span>
                          )}
                          <strong>R$ {Number(sub.amount || 0).toFixed(2)}</strong>
                          {showsMonthly && (
                            <span className="sub-value-equivalent">
                              = R$ {monthly.toFixed(2)}/mês
                            </span>
                          )}
                        </div>
                      </td>

                      <td>
                        <div className="date-cell">
                          <span className={isSubscriptionOverdue(sub) ? 'renewal-overdue-text' : isRenewalSoon(sub) ? 'renewal-month' : ''}>
                            {sub.next_charge_at ? formatDateBR(sub.next_charge_at) : '—'}
                          </span>
                          {dueLabel(sub) && (
                            <span className={`subs-due ${isSubscriptionOverdue(sub) ? 'is-overdue' : ''}`}>
                              {dueLabel(sub)}
                            </span>
                          )}
                        </div>
                      </td>

                      <td>
                        <div className="status-cell">
                          <span className={`status-badge ${sub.status}`}>
                            {statusLabel(sub.status)}
                          </span>
                          {badges.map((badge) => (
                            <span key={badge.className} className={`status-badge ${badge.className}`}>
                              {badge.label}
                            </span>
                          ))}
                        </div>
                      </td>

                      <td>
                        <div className="actions-cell">
                          <button className="action-btn" onClick={() => openDetail(sub)} title="Ver detalhes">
                            <Eye size={16} />
                          </button>
                          <button
                            className="action-btn"
                            onClick={() => navigate(`/admin/subscriptions/${sub.id}/edit`)}
                            title="Editar"
                          >
                            <Edit2 size={16} />
                          </button>
                          {sub.status === 'active' && (
                            <button className="action-btn danger" onClick={() => handleCancel(sub)} title="Cancelar">
                              <XCircle size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {rows.length === 0 && (
              <div className="empty-table">
                <p>Nenhuma assinatura encontrada.</p>
              </div>
            )}
          </div>

          <div className="subscriptions-pagination">
            <span className="pagination-info">
              Mostrando {from}–{to} de {totalRows} assinatura(s)
            </span>
            <div className="pagination-controls">
              <label className="pagination-size">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(0);
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>{size} por página</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0 || loading}
              >
                <ChevronLeft size={14} /> Anterior
              </button>
              <span className="pagination-info">Página {currentPage + 1} de {totalPages}</span>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage + 1 >= totalPages || loading}
              >
                Próxima <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}

      {detailSub && (
        <div className="sub-viewer-overlay" onClick={() => setDetailSub(null)}>
          <div className="sub-viewer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sub-viewer-header">
              <h3>Detalhes da Assinatura</h3>
              <button className="sub-viewer-close" onClick={() => setDetailSub(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="sub-detail-body">
              <div className="detail-section">
                <div className="detail-row">
                  <div className="detail-item">
                    <label><Hash size={14} /> ID</label>
                    <span className="detail-mono">{detailSub.id?.slice(0, 8)}...</span>
                  </div>
                  <div className="detail-item">
                    <label><Tag size={14} /> Referência</label>
                    <span className="detail-mono">{detailSub.external_reference || '—'}</span>
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-item">
                    <label>Usuário</label>
                    <a
                      className="link-name"
                      onClick={() => {
                        setDetailSub(null);
                        navigate(`/admin/users/${detailSub.user_id}`);
                      }}
                    >
                      {detailSub.user?.name || '—'}
                    </a>
                    <span className="detail-email">{detailSub.user?.email || '—'}</span>
                  </div>
                  <div className="detail-item">
                    <label>Grupo</label>
                    <a
                      className="link-name"
                      onClick={() => {
                        setDetailSub(null);
                        navigate(`/admin/groups/${detailSub.group_id}/edit`);
                      }}
                    >
                      {detailSub.group?.name || '—'}
                    </a>
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-item">
                    <label><DollarSign size={14} /> Valor do ciclo</label>
                    <span className="detail-value">
                      R$ {Number(detailSub.amount || 0).toFixed(2)}
                      {detailSub.discount_amount > 0 && (
                        <span className="detail-discount">
                          (desconto: -R$ {Number(detailSub.discount_amount).toFixed(2)})
                        </span>
                      )}
                    </span>
                    {cycleMonths(detailSub.billing_cycle, detailSub.custom_cycle_months) > 1 && (
                      <span className="detail-mono">
                        equivale a R$ {monthlyEquivalent(detailSub).toFixed(2)}/mês
                      </span>
                    )}
                  </div>
                  <div className="detail-item">
                    <label><Calendar size={14} /> Ciclo</label>
                    <span>{cycleFullLabel(detailSub)}</span>
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-item">
                    <label>Status</label>
                    <span className={`status-badge ${detailSub.status}`}>{statusLabel(detailSub.status)}</span>
                    {isSubscriptionOverdue(detailSub) && (
                      <span className="status-badge overdue" style={{ marginLeft: 8 }}>Vencida</span>
                    )}
                    {detailSub.billing_status && (
                      <span className="detail-mono" style={{ marginLeft: 8 }}>billing: {detailSub.billing_status}</span>
                    )}
                  </div>
                  <div className="detail-item">
                    <label><Clock size={14} /> Próx. Cobrança</label>
                    <span>{detailSub.next_charge_at ? new Date(detailSub.next_charge_at).toLocaleString('pt-BR') : '—'}</span>
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-item">
                    <label><CreditCard size={14} /> Gateway</label>
                    <span>{detailSub.gateway || '—'}</span>
                    {detailSub.card_last4 && (
                      <span className="detail-mono"> •••• {detailSub.card_last4} {detailSub.card_brand || ''}</span>
                    )}
                  </div>
                  <div className="detail-item">
                    <label>Criado em</label>
                    <span>{detailSub.created_at ? new Date(detailSub.created_at).toLocaleString('pt-BR') : '—'}</span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h4>Histórico de Transações</h4>
                {detailLoading ? (
                  <div className="detail-loading">
                    <Loader2 size={20} className="spin" />
                    <span>Carregando...</span>
                  </div>
                ) : detailPayments.length > 0 ? (
                  <div className="detail-table-wrap">
                    <table className="detail-table">
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>Valor</th>
                          <th>Método</th>
                          <th>Status</th>
                          <th>Gateway</th>
                          <th>Código</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailPayments.map((p) => (
                          <tr key={p.id}>
                            <td>{formatDateBR(p.created_at)}</td>
                            <td><strong>R$ {Number(p.amount || 0).toFixed(2)}</strong></td>
                            <td>{p.method || '—'}</td>
                            <td>
                              <span className={`status-badge ${paymentStatusClass(p.status)}`}>
                                {paymentStatusLabel(p.status)}
                              </span>
                            </td>
                            <td>{p.gateway || '—'}</td>
                            <td className="detail-mono">{p.transaction_code ? p.transaction_code.slice(0, 12) + '...' : '—'}</td>
                            <td>
                              <button className="tx-eye-btn" onClick={() => setSelectedPayment(p)} title="Ver detalhes">
                                <Eye size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="detail-empty">Nenhuma transação registrada para esta assinatura.</div>
                )}
              </div>

              <div className="detail-section">
                <h4>Ciclos de Cobrança</h4>
                {detailLoading ? (
                  <div className="detail-loading">
                    <Loader2 size={20} className="spin" />
                    <span>Carregando...</span>
                  </div>
                ) : detailBillingCycles.length > 0 ? (
                  <div className="detail-table-wrap">
                    <table className="detail-table">
                      <thead>
                        <tr>
                          <th>Data Cobrança</th>
                          <th>Valor</th>
                          <th>Status</th>
                          <th>Tentativas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailBillingCycles.map((bc) => (
                          <tr key={bc.id}>
                            <td>{bc.charge_date ? formatDateBR(bc.charge_date) : '—'}</td>
                            <td><strong>R$ {Number(bc.amount || 0).toFixed(2)}</strong></td>
                            <td>
                              <span className={`status-badge ${paymentStatusClass(bc.status)}`}>
                                {paymentStatusLabel(bc.status)}
                              </span>
                            </td>
                            <td>{bc.attempts || bc.attempt_number || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="detail-empty">Nenhum ciclo de cobrança registrado.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de detalhamento dos cards */}
      {statDetailModal && (
        <div className="sub-viewer-overlay" onClick={() => setStatDetailModal(null)}>
          <div className="sub-viewer-panel stat-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sub-viewer-header">
              <h3>{statDetailTitle()}</h3>
              <button className="sub-viewer-close" onClick={() => setStatDetailModal(null)}>×</button>
            </div>
            <div className="sub-viewer-body">
              {statDetailLoading ? (
                <div className="detail-loading">
                  <Loader2 size={20} className="spin" />
                  <span>Carregando...</span>
                </div>
              ) : statDetailData.length === 0 ? (
                <p className="empty-detail">Nenhum registro encontrado.</p>
              ) : (
                <>
                  <div className="stat-detail-summary">
                    <span className="stat-detail-total">
                      {statDetailData.length} registro{statDetailData.length !== 1 ? 's' : ''}
                    </span>
                    {statDetailModal === 'cancelled' && (
                      <span className="stat-detail-sum">
                        {stats.cancelledCount} canceladas
                      </span>
                    )}
                    <span className="stat-detail-sum">
                      {statDetailTotalLabel()}: <strong>R$ {statDetailTotal().toFixed(2)}</strong>
                    </span>
                  </div>
                  <div className="stat-detail-list">
                    {statDetailData.map((item, i) => (
                      <div
                        key={item.id || i}
                        className={`stat-detail-row ${item.subId ? 'clickable-row' : ''}`}
                        onClick={() => {
                          if (item.subId && item.sub) {
                            setStatDetailModal(null);
                            openDetail(item.sub);
                          }
                        }}
                        title={item.subId ? 'Clique para ver detalhes da assinatura' : undefined}
                      >
                        <div className="stat-detail-user">
                          <div className="user-avatar-sm">{item.userName[0]?.toUpperCase() || '?'}</div>
                          <div>
                            <strong>{item.userName}</strong>
                            <span>{item.userEmail}</span>
                          </div>
                        </div>
                        <div className="stat-detail-service">
                          <strong>{item.serviceName}</strong>
                          <span>{item.groupName !== '—' ? item.groupName : ''}</span>
                        </div>
                        <div className="stat-detail-amount">
                          <span className="amount-monthly">R$ {item.amount.toFixed(2)}</span>
                          {item.type === 'payment' ? (
                            <span className="amount-date">{formatDateBR(item.date)}</span>
                          ) : (
                            <span className="amount-total">
                              {item.cycleLabel}
                              {item.monthly !== null && item.monthly !== undefined
                                && Math.abs(item.monthly - item.amount) > 0.005
                                ? ` · R$ ${item.monthly.toFixed(2)}/mês`
                                : ''}
                            </span>
                          )}
                        </div>
                        {item.nextCharge && (
                          <div className="stat-detail-next">
                            <Calendar size={12} />
                            <span>Vence: {formatDateBR(item.nextCharge)}</span>
                          </div>
                        )}
                        {(item.overdue || item.retrying) && (
                          <div className="stat-detail-next stat-detail-flag">
                            <AlertCircle size={12} />
                            <span>
                              {[item.overdue ? 'Vencida' : null, item.retrying ? 'Em retry' : null]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </div>
                        )}
                        {item.subId && (
                          <div className="stat-detail-arrow">›</div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedPayment && (
        <div className="sub-viewer-overlay" onClick={() => setSelectedPayment(null)}>
          <div className="sub-viewer-panel" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="sub-viewer-header">
              <h3><DollarSign size={18} /> Detalhes da Transação</h3>
              <button className="sub-viewer-close" onClick={() => setSelectedPayment(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="sub-detail-body">
              <div className="detail-section">
                <div className="detail-row">
                  <div className="detail-item">
                    <label>Status</label>
                    <span className={`status-badge ${paymentStatusClass(selectedPayment.status)}`}>
                      {paymentStatusLabel(selectedPayment.status)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <label>Tipo</label>
                    <span>
                      {selectedPayment.payment_type === 'entrance'
                        ? 'Taxa de Adesão'
                        : selectedPayment.payment_type === 'subscription'
                          ? 'Assinatura'
                          : selectedPayment.payment_type || '—'}
                    </span>
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-item">
                    <label><DollarSign size={14} /> Valor</label>
                    <span className="detail-value">R$ {Number(selectedPayment.amount || 0).toFixed(2)}</span>
                  </div>
                  <div className="detail-item">
                    <label>Método</label>
                    <span>
                      {selectedPayment.method === 'pix'
                        ? 'PIX'
                        : selectedPayment.method === 'credit_card'
                          ? 'Cartão de Crédito'
                          : selectedPayment.method || '—'}
                    </span>
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-item">
                    <label>Gateway</label>
                    <span>{selectedPayment.gateway || '—'}</span>
                  </div>
                  <div className="detail-item">
                    <label><Calendar size={14} /> Data</label>
                    <span>{selectedPayment.created_at ? new Date(selectedPayment.created_at).toLocaleString('pt-BR') : '—'}</span>
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-item">
                    <label><Hash size={14} /> ID Transação</label>
                    <span className="detail-mono" style={{ wordBreak: 'break-all' }}>
                      {selectedPayment.transaction_code || '—'}
                    </span>
                  </div>
                </div>

                {selectedPayment.notes && (
                  <div className="detail-row">
                    <div className="detail-item">
                      <label>Observações</label>
                      <span>{selectedPayment.notes}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Subscriptions;
