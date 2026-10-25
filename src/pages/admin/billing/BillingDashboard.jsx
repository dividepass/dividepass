import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import {
  DollarSign,
  TrendingUp,
  Users,
  AlertTriangle,
  Calendar,
  XCircle,
  CheckCircle,
  Repeat,
  CreditCard,
  Zap,
  Loader2,
  QrCode,
  Link2,
  Copy,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Info,
  X,
  AlertCircle,
} from 'lucide-react';
import './BillingDashboard.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const AGENDA_PAGE_SIZE = 25;

// ---------------------------------------------------------------- helpers

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

function toDateStr(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR');
}

const CYCLE_LABELS = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
  days: 'Dias',
  custom: 'Personalizado',
};

function cycleLabel(subscription) {
  const base = CYCLE_LABELS[subscription?.billing_cycle] || subscription?.billing_cycle || '—';
  if (subscription?.billing_cycle === 'days' && subscription?.custom_cycle_days) {
    return `${base} (${subscription.custom_cycle_days}d)`;
  }
  if (subscription?.billing_cycle === 'custom' && subscription?.custom_cycle_months) {
    return `${base} (${subscription.custom_cycle_months}m)`;
  }
  return base;
}

// Equivalente mensal de uma assinatura (ciclos maiores normalizados).
function monthlyEquivalent(subscription) {
  const amount = Number(subscription?.amount || 0);
  switch (subscription?.billing_cycle) {
    case 'monthly': return amount;
    case 'quarterly': return amount / 3;
    case 'semiannual': return amount / 6;
    case 'annual': return amount / 12;
    case 'custom': return subscription?.custom_cycle_months ? amount / subscription.custom_cycle_months : amount;
    default: return amount;
  }
}

// `billing_status` só aceita 'active' e 'retrying' — 'overdue'/'failed' não existem.
function isOverdue(subscription, now = new Date()) {
  if (!subscription) return false;
  if (subscription.billing_status === 'retrying') return true;
  return !!subscription.next_charge_at && new Date(subscription.next_charge_at) < now;
}

function subscriptionBadge(subscription, now = new Date()) {
  if (subscription?.billing_status === 'retrying') return { label: 'Em tentativa', tone: 'processing' };
  if (isOverdue(subscription, now)) return { label: 'Vencida', tone: 'failed' };
  if (subscription?.next_charge_at) return { label: 'Agendada', tone: 'approved' };
  return { label: 'Sem previsão', tone: 'pending' };
}

// Chama uma edge function sempre com o JWT do admin e nunca engole o erro.
async function callEdgeFunction(functionName, body) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session) {
    throw new Error('Sessão do admin não encontrada. Faça login novamente.');
  }
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${sessionData.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Resposta inválida de ${functionName} (HTTP ${response.status}): ${raw.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status} ao chamar ${functionName}`);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Nomes de usuário/grupo resolvidos por id (evita depender do nome da FK).
async function fetchDirectory(userIds, groupIds) {
  const users = [...new Set(userIds.filter(Boolean))];
  const groups = [...new Set(groupIds.filter(Boolean))];
  const [usersRes, groupsRes] = await Promise.all([
    users.length
      ? supabase.from('users').select('id, name, email').in('id', users)
      : Promise.resolve({ data: [] }),
    groups.length
      ? supabase.from('groups').select('id, name').in('id', groups)
      : Promise.resolve({ data: [] }),
  ]);
  return {
    users: new Map((usersRes.data || []).map(u => [u.id, u])),
    groups: new Map((groupsRes.data || []).map(g => [g.id, g])),
  };
}

const SUBSCRIPTION_FIELDS = `
  id, amount, status, billing_status, billing_cycle, custom_cycle_days, custom_cycle_months,
  next_charge_at, retry_count, card_id, card_last4, card_brand,
  user:user_id (id, name, email),
  group:group_id (id, name),
  service:service_id (id, name)
`;

async function querySubscriptions({ overdueOnly = false, from = null, to = null, limit = 200 } = {}) {
  const nowIso = new Date().toISOString();
  let query = supabase
    .from('user_subscriptions')
    .select(SUBSCRIPTION_FIELDS)
    .eq('status', 'active')
    .order('next_charge_at', { ascending: true });

  if (overdueOnly) {
    query = query.or(`next_charge_at.lt.${nowIso},billing_status.eq.retrying`);
  }
  if (from) query = query.gte('next_charge_at', from);
  if (to) query = query.lte('next_charge_at', to);

  const { data, error } = await query.limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

// ------------------------------------------------------------ drill-downs

const DRILLDOWNS = {
  revenue: {
    title: 'Receita recebida no mês',
    description: 'Pagamentos de assinatura com status pago no mês corrente.',
    load: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
      const { data, error } = await supabase
        .from('payments')
        .select('id, user_id, group_id, amount, method, payment_type, created_at')
        .eq('status', 'paid')
        .eq('payment_type', 'subscription')
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      const rows = data || [];
      const dir = await fetchDirectory(rows.map(r => r.user_id), rows.map(r => r.group_id));
      return rows.map(r => ({
        key: r.id,
        primary: dir.users.get(r.user_id)?.name || '—',
        secondary: `${dir.users.get(r.user_id)?.email || 'sem e-mail'} · ${dir.groups.get(r.group_id)?.name || 'sem grupo'} · ${formatDate(r.created_at)}`,
        value: formatCurrency(r.amount),
        tone: 'success',
      }));
    },
  },
  mrr: {
    title: 'Receita mensal equivalente (MRR)',
    description: 'Valor das assinaturas ativas normalizado para um mês (ciclos maiores divididos).',
    load: async () => {
      const rows = await querySubscriptions({ limit: 200 });
      return rows.map(s => ({
        key: s.id,
        primary: s.user?.name || '—',
        secondary: `${s.user?.email || ''} · ${s.group?.name || 'sem grupo'} · ${cycleLabel(s)}`,
        value: formatCurrency(monthlyEquivalent(s)),
        tone: 'success',
      }));
    },
  },
  active: {
    title: 'Assinaturas ativas',
    description: 'Assinaturas com status ativo, independentemente da próxima cobrança.',
    load: async () => {
      const rows = await querySubscriptions({ limit: 200 });
      return rows.map(s => ({
        key: s.id,
        primary: s.user?.name || '—',
        secondary: `${s.user?.email || ''} · ${s.group?.name || 'sem grupo'} · ${s.service?.name || 'sem serviço'}`,
        value: formatCurrency(s.amount),
        tone: 'default',
      }));
    },
  },
  overdue: {
    title: 'Assinaturas vencidas / em retry',
    description: 'Assinaturas cuja próxima cobrança já passou ou que estão em tentativa de repagamento.',
    load: async () => {
      const rows = await querySubscriptions({ overdueOnly: true, limit: 200 });
      return rows.map(s => ({
        key: s.id,
        primary: s.user?.name || '—',
        secondary: `${s.user?.email || ''} · ${s.group?.name || 'sem grupo'} · próxima: ${formatDate(s.next_charge_at)}`,
        value: formatCurrency(s.amount),
        tone: 'failed',
      }));
    },
  },
  failures: {
    title: 'Falhas de cobrança',
    description: 'Ciclos de cobrança recusados pelo gateway nos últimos 30 dias.',
    load: async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('billing_cycles')
        .select('id, subscription_id, user_id, group_id, amount, charge_date, attempt_number, error_message, error_code, created_at')
        .eq('status', 'failed')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      const rows = data || [];
      const dir = await fetchDirectory(rows.map(r => r.user_id), rows.map(r => r.group_id));
      return rows.map(r => ({
        key: r.id,
        primary: dir.users.get(r.user_id)?.name || '—',
        secondary: `${dir.groups.get(r.group_id)?.name || 'sem grupo'} · ${formatDate(r.charge_date)} · ${r.error_message || r.error_code || 'sem motivo informado'}`,
        value: formatCurrency(r.amount),
        tone: 'failed',
      }));
    },
  },
  next30: {
    title: 'Valor a cobrar nos próximos 30 dias',
    description: 'Assinaturas ativas com próxima cobrança dentro dos próximos 30 dias.',
    load: async () => {
      const now = new Date();
      const from = now.toISOString();
      const to = new Date(now.getTime() + 30 * 86400000).toISOString();
      const rows = await querySubscriptions({ from, to, limit: 200 });
      return rows.map(s => ({
        key: s.id,
        primary: s.user?.name || '—',
        secondary: `${s.user?.email || ''} · ${s.group?.name || 'sem grupo'} · ${formatDate(s.next_charge_at)}`,
        value: formatCurrency(s.amount),
        tone: 'default',
      }));
    },
  },
};

// ------------------------------------------------------------------ toast

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(onClose, 7000);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;
  return (
    <div className={`billing-toast ${toast.type}`} role="status">
      {toast.type === 'success' && <CheckCircle size={16} />}
      {toast.type === 'error' && <AlertCircle size={16} />}
      {toast.type === 'warning' && <AlertTriangle size={16} />}
      {toast.type === 'info' && <Info size={16} />}
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Fechar aviso"><X size={14} /></button>
    </div>
  );
}

// -------------------------------------------------------------- component

function BillingDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState(null);
  const [chargingId, setChargingId] = useState(null);
  const [confirmForce, setConfirmForce] = useState(false);
  const [runningBilling, setRunningBilling] = useState(false);
  const [billingResult, setBillingResult] = useState(null);

  const [metrics, setMetrics] = useState({
    monthRevenue: 0,
    mrr: 0,
    activeSubscriptions: 0,
    overdue: 0,
    retrying: 0,
    failures: 0,
    next30Amount: 0,
    next30Count: 0,
  });

  const [agenda, setAgenda] = useState([]);
  const [agendaTotal, setAgendaTotal] = useState(0);
  const [agendaPage, setAgendaPage] = useState(0);
  const [agendaLoading, setAgendaLoading] = useState(true);
  const [withoutCard, setWithoutCard] = useState([]);
  const [todayCharges, setTodayCharges] = useState([]);
  const [recentFailures, setRecentFailures] = useState([]);

  const [drilldown, setDrilldown] = useState(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  const [showCustomCharge, setShowCustomCharge] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customPaymentMethod, setCustomPaymentMethod] = useState('pix');
  const [creatingCharge, setCreatingCharge] = useState(false);
  const [chargeResult, setChargeResult] = useState(null);

  const showToast = useCallback((type, message) => {
    setToast({ type, message });
  }, []);
  const closeToast = useCallback(() => setToast(null), []);

  // ------------------------------------------------- Blocos 2 e 3 (carga)
  useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      setLoading(true);
      const now = new Date();
      const nowIso = now.toISOString();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
      const in30 = new Date(now.getTime() + 30 * 86400000).toISOString();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const overdueFilter = `next_charge_at.lt.${nowIso},billing_status.eq.retrying`;

      try {
        const [
          activeRes,
          paymentsRes,
          mrrRes,
          overdueRes,
          retryingRes,
          failuresRes,
          next30Res,
          totalRes,
          noCardRes,
          todayRes,
          failedSubsRes,
          failedCyclesRes,
        ] = await Promise.all([
          // contagens (head count): não baixam a tabela
          supabase.from('user_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
          supabase.from('payments').select('amount').eq('status', 'paid').eq('payment_type', 'subscription')
            .gte('created_at', monthStart).lte('created_at', monthEnd),
          // agregados: apenas 3 colunas, sem join (leitura mínima necessária para o cálculo)
          supabase.from('user_subscriptions').select('amount, billing_cycle, custom_cycle_months').eq('status', 'active'),
          supabase.from('user_subscriptions').select('id', { count: 'exact', head: true })
            .eq('status', 'active').or(overdueFilter),
          supabase.from('user_subscriptions').select('id', { count: 'exact', head: true })
            .eq('status', 'active').eq('billing_status', 'retrying'),
          supabase.from('billing_cycles').select('id', { count: 'exact', head: true })
            .eq('status', 'failed').gte('created_at', thirtyDaysAgo),
          supabase.from('user_subscriptions').select('amount, next_charge_at').eq('status', 'active')
            .not('next_charge_at', 'is', null).gte('next_charge_at', nowIso).lte('next_charge_at', in30),
          supabase.from('user_subscriptions').select('id', { count: 'exact', head: true })
            .eq('status', 'active').not('next_charge_at', 'is', null),
          supabase.from('user_subscriptions').select(SUBSCRIPTION_FIELDS)
            .eq('status', 'active')
            .or('card_id.is.null,card_last4.is.null')
            .not('next_charge_at', 'is', null)
            .order('next_charge_at', { ascending: true })
            .limit(50),
          supabase.from('user_subscriptions').select(SUBSCRIPTION_FIELDS)
            .eq('status', 'active')
            .not('next_charge_at', 'is', null)
            .gte('next_charge_at', todayStart).lte('next_charge_at', todayEnd)
            .order('next_charge_at', { ascending: true })
            .limit(50),
          supabase.from('user_subscriptions').select(SUBSCRIPTION_FIELDS)
            .eq('status', 'active')
            .or(overdueFilter)
            .order('next_charge_at', { ascending: true })
            .limit(25),
          supabase.from('billing_cycles')
            .select(`
              id, subscription_id, user_id, group_id, amount, charge_date, attempt_number,
              error_message, error_code, next_retry_at, created_at,
              user:users!billing_cycles_user_id_fkey (id, name, email),
              group:groups!billing_cycles_group_id_fkey (id, name)
            `)
            .eq('status', 'failed')
            .order('created_at', { ascending: false })
            .limit(50),
        ]);

        const firstError = [activeRes, paymentsRes, mrrRes, overdueRes, retryingRes, failuresRes, next30Res, totalRes, noCardRes, todayRes, failedSubsRes, failedCyclesRes]
          .find(r => r.error);
        if (firstError?.error) {
          setLoadError(firstError.error.message);
        } else {
          setLoadError('');
        }

        const monthRevenue = (paymentsRes.data || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);

        let mrr = 0;
        (mrrRes.data || []).forEach(s => { mrr += monthlyEquivalent(s); });

        const next30Rows = next30Res.data || [];
        const next30Amount = next30Rows.reduce((sum, s) => sum + Number(s.amount || 0), 0);

        setMetrics({
          monthRevenue,
          mrr,
          activeSubscriptions: activeRes.count || 0,
          overdue: overdueRes.count || 0,
          retrying: retryingRes.count || 0,
          failures: failuresRes.count || 0,
          next30Amount,
          next30Count: next30Rows.length,
        });

        setWithoutCard(noCardRes.data || []);
        setTodayCharges(todayRes.data || []);
        setAgendaTotal(totalRes.count || 0);

        // Falhas: junta assinaturas vencidas/em-retry com o ciclo que falhou.
        const cycles = failedCyclesRes.data || [];
        const cycleBySub = new Map();
        cycles.forEach(c => {
          if (c.subscription_id && !cycleBySub.has(c.subscription_id)) cycleBySub.set(c.subscription_id, c);
        });

        const failureRows = [];
        (failedSubsRes.data || []).forEach(s => {
          const cycle = cycleBySub.get(s.id);
          failureRows.push({
            id: `sub-${s.id}`,
            origem: 'assinatura',
            subscriptionId: s.id,
            userName: s.user?.name || '—',
            userEmail: s.user?.email || '',
            serviceName: s.service?.name || '—',
            groupName: s.group?.name || '—',
            amount: s.amount,
            reason: cycle?.error_message || cycle?.error_code || null,
            attempt: s.retry_count || 0,
            nextRetryAt: cycle?.next_retry_at || s.next_charge_at,
            date: cycle?.charge_date || s.next_charge_at,
            hasCard: !!s.card_last4,
          });
          if (cycle) cycleBySub.delete(s.id);
        });

        cycleBySub.forEach(c => {
          failureRows.push({
            id: `cycle-${c.id}`,
            origem: 'ciclo',
            subscriptionId: c.subscription_id,
            userName: c.user?.name || '—',
            userEmail: c.user?.email || '',
            serviceName: '—',
            groupName: c.group?.name || '—',
            amount: c.amount,
            reason: c.error_message || c.error_code || null,
            attempt: c.attempt_number || 0,
            nextRetryAt: c.next_retry_at,
            date: c.charge_date || c.created_at,
            hasCard: true,
          });
        });

        failureRows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        setRecentFailures(failureRows);
      } catch (err) {
        setLoadError(err.message || 'Falha ao carregar os dados de cobrança.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadOverview();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // ------------------------------------------------------- Bloco 1 (agenda)
  useEffect(() => {
    let cancelled = false;

    async function loadAgenda() {
      setAgendaLoading(true);
      const from = agendaPage * AGENDA_PAGE_SIZE;
      const to = from + AGENDA_PAGE_SIZE - 1;
      try {
        const { data, error } = await supabase
          .from('user_subscriptions')
          .select(SUBSCRIPTION_FIELDS)
          .eq('status', 'active')
          .not('next_charge_at', 'is', null)
          .order('next_charge_at', { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        if (!cancelled) setAgenda(data || []);
      } catch (err) {
        if (!cancelled) {
          setAgenda([]);
          setLoadError(err.message || 'Falha ao carregar a agenda de recorrência.');
        }
      } finally {
        if (!cancelled) setAgendaLoading(false);
      }
    }

    loadAgenda();
    return () => { cancelled = true; };
  }, [agendaPage, refreshKey]);

  // ------------------------------------------------------------- ações

  const handleChargeNow = async (subscription) => {
    if (!subscription?.id) return;
    const label = subscription.user?.name || subscription.user?.email || subscription.id;
    setChargingId(subscription.id);
    try {
      const data = await callEdgeFunction('process-recurring-billing', {
        manual: true,
        subscription_id: subscription.id,
      });

      const approved = Number(data.approved || 0);
      const failed = Number(data.failed || 0);
      const skipped = Number(data.skipped || 0);
      const processed = Number(data.processed || 0);
      const details = Array.isArray(data.details) ? data.details : [];
      const own = details.find(d => d.subscription_id === subscription.id);
      const reason = own?.error || (Array.isArray(data.errors) && data.errors[0]) || null;

      if (approved > 0) {
        showToast('success', `Cobrança aprovada para ${label}.`);
      } else if (failed > 0) {
        showToast('error', `Cobrança recusada para ${label}${reason ? `: ${reason}` : '.'}`);
      } else if (skipped > 0) {
        showToast('warning', `Cobrança ignorada para ${label} (sem cartão salvo ou gateway não configurado).`);
      } else if (processed === 0) {
        showToast('warning', `Nada foi cobrado para ${label}: a assinatura não é elegível no momento.`);
      } else {
        showToast('info', `Cobrança processada para ${label}: ${processed} processada(s), ${approved} aprovada(s), ${failed} falha(s), ${skipped} ignorada(s).`);
      }
      setRefreshKey(k => k + 1);
    } catch (err) {
      showToast('error', `Erro ao cobrar ${label}: ${err.message}`);
    } finally {
      setChargingId(null);
    }
  };

  const handleForceBilling = async () => {
    setRunningBilling(true);
    setBillingResult(null);
    try {
      const data = await callEdgeFunction('manage-crons', { action: 'run_now', jobname: 'process-recurring-billing' });
      let parsed = null;
      if (typeof data.response === 'string') {
        try { parsed = JSON.parse(data.response); } catch { parsed = null; }
      } else if (data.response && typeof data.response === 'object') {
        parsed = data.response;
      }
      if (!parsed) {
        setBillingResult({
          type: 'warning',
          message: `Execução disparada, mas a resposta do job não pôde ser lida: ${String(data.response || data.status || '').slice(0, 300)}`,
        });
      } else {
        setBillingResult({
          type: parsed.failed > 0 ? 'error' : 'success',
          message: `Processadas: ${parsed.processed || 0} · Aprovadas: ${parsed.approved || 0} · Falhas: ${parsed.failed || 0} · Ignoradas: ${parsed.skipped || 0} · Canceladas: ${parsed.cancelled || 0}`,
          errors: Array.isArray(parsed.errors) ? parsed.errors : [],
        });
      }
      setRefreshKey(k => k + 1);
    } catch (err) {
      setBillingResult({ type: 'error', message: err.message });
    } finally {
      setRunningBilling(false);
      setConfirmForce(false);
    }
  };

  const handleCreateCustomCharge = async () => {
    if (!customAmount || Number(customAmount) <= 0) {
      showToast('error', 'Informe um valor válido para a cobrança avulsa.');
      return;
    }
    if (!customDescription) {
      showToast('error', 'Informe a descrição da cobrança avulsa.');
      return;
    }
    setCreatingCharge(true);
    setChargeResult(null);
    try {
      const data = await callEdgeFunction('create-custom-charge', {
        amount: Number(customAmount),
        description: customDescription,
        payment_method: customPaymentMethod,
      });
      setChargeResult(data);
    } catch (err) {
      setChargeResult({ error: err.message });
    } finally {
      setCreatingCharge(false);
    }
  };

  const openDrilldown = async (key) => {
    const config = DRILLDOWNS[key];
    if (!config) return;
    setDrilldown({ ...config, key, rows: [] });
    setDrilldownLoading(true);
    try {
      const rows = await config.load();
      setDrilldown(current => (current && current.key === key ? { ...current, rows } : current));
    } catch (err) {
      setDrilldown(current => (current && current.key === key ? { ...current, error: err.message } : current));
    } finally {
      setDrilldownLoading(false);
    }
  };

  const closeDrilldown = useCallback(() => setDrilldown(null), []);

  // ------------------------------------------------------------- derivados

  const now = new Date();
  const todayStr = toDateStr(now);
  const in7Str = toDateStr(new Date(now.getTime() + 7 * 86400000));

  const buckets = [
    { key: 'overdue', label: 'Vencidas (aguardando)', tone: 'overdue', rows: [] },
    { key: 'today', label: 'Hoje', tone: 'today', rows: [] },
    { key: 'week', label: 'Próximos 7 dias', tone: 'week', rows: [] },
    { key: 'later', label: 'Mais adiante', tone: 'later', rows: [] },
  ];

  agenda.forEach(subscription => {
    const date = toDateStr(subscription.next_charge_at);
    if (!date) return;
    if (date < todayStr) buckets[0].rows.push(subscription);
    else if (date === todayStr) buckets[1].rows.push(subscription);
    else if (date <= in7Str) buckets[2].rows.push(subscription);
    else buckets[3].rows.push(subscription);
  });

  const totalPages = Math.max(1, Math.ceil(agendaTotal / AGENDA_PAGE_SIZE));

  const metricsList = [
    {
      key: 'revenue',
      label: 'Receita recebida no mês',
      value: formatCurrency(metrics.monthRevenue),
      sub: 'Pagamentos de assinatura pagos no mês',
      icon: <DollarSign size={22} />,
      iconClass: 'revenue',
    },
    {
      key: 'mrr',
      label: 'Receita mensal (MRR)',
      value: formatCurrency(metrics.mrr),
      sub: 'Assinaturas ativas normalizadas por mês',
      icon: <Repeat size={22} />,
      iconClass: 'subscriptions',
    },
    {
      key: 'active',
      label: 'Assinaturas ativas',
      value: metrics.activeSubscriptions,
      sub: 'Status ativo no banco',
      icon: <Users size={22} />,
      iconClass: 'profit',
    },
    {
      key: 'overdue',
      label: 'Vencidas / atrasadas',
      value: metrics.overdue,
      sub: `${metrics.retrying} em retry · as demais aguardam nova cobrança`,
      icon: <Calendar size={22} />,
      iconClass: 'costs',
    },
    {
      key: 'failures',
      label: 'Falhas de cobrança (30 dias)',
      value: metrics.failures,
      sub: 'Ciclos recusados pelo gateway',
      icon: <XCircle size={22} />,
      iconClass: 'costs',
    },
    {
      key: 'next30',
      label: 'A cobrar nos próximos 30 dias',
      value: formatCurrency(metrics.next30Amount),
      sub: `${metrics.next30Count} assinatura(s) na janela`,
      icon: <TrendingUp size={22} />,
      iconClass: 'tickets',
    },
  ];

  return (
    <div className="billing-dashboard">
      <div className="admin-header">
        <div>
          <h1>Cobranças Recorrentes</h1>
          <p>Controle os agendamentos de recorrência: quem vai ser cobrado, quando e o que falhou.</p>
        </div>
        <div className="billing-header-actions">
          {confirmForce ? (
            <>
              <button className="btn btn-primary btn-sm" onClick={handleForceBilling} disabled={runningBilling}>
                {runningBilling ? <><Loader2 size={14} className="spinning" /> Executando...</> : <><Zap size={14} /> Confirmar execução</>}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => setConfirmForce(false)} disabled={runningBilling}>
                Cancelar
              </button>
            </>
          ) : (
            <button className="btn btn-outline btn-sm" onClick={() => setConfirmForce(true)} disabled={runningBilling}>
              <Zap size={14} /> Forçar cobrança recorrente
            </button>
          )}
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setShowCustomCharge(v => !v); setChargeResult(null); setCustomAmount(''); setCustomDescription(''); }}
          >
            <DollarSign size={14} /> Cobrança avulsa
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setRefreshKey(k => k + 1)} title="Atualizar dados">
            <RefreshCw size={14} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {loadError && (
        <div className="billing-error-banner">
          <AlertCircle size={16} />
          <span>Não foi possível carregar parte dos dados: {loadError}</span>
        </div>
      )}

      {billingResult && (
        <div className={`billing-force-result ${billingResult.type}`}>
          {billingResult.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          <div className="billing-force-result-body">
            <span>{billingResult.message}</span>
            {billingResult.errors?.length > 0 && (
              <ul className="billing-force-errors">
                {billingResult.errors.slice(0, 5).map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            )}
          </div>
          <button className="billing-force-dismiss" onClick={() => setBillingResult(null)} aria-label="Fechar">&times;</button>
        </div>
      )}

      {showCustomCharge && (
        <div className="billing-panel">
          <div className="billing-panel-header">
            <h3>Nova cobrança avulsa</h3>
            <button className="btn btn-outline btn-sm" onClick={() => { setShowCustomCharge(false); setChargeResult(null); }}><X size={16} /></button>
          </div>

          {!chargeResult ? (
            <div className="billing-panel-form">
              <div>
                <label htmlFor="billing-custom-amount">Valor (R$)</label>
                <input id="billing-custom-amount" type="number" step="0.01" min="0.01" value={customAmount} onChange={e => setCustomAmount(e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <label htmlFor="billing-custom-description">Descrição</label>
                <input id="billing-custom-description" type="text" value={customDescription} onChange={e => setCustomDescription(e.target.value)} placeholder="Ex: Venda externa, correção, etc." maxLength={50} />
              </div>
              <div>
                <label>Método de cobrança</label>
                <div className="billing-method-options">
                  <button type="button" className={`btn ${customPaymentMethod === 'pix' ? 'btn-primary' : 'btn-outline'} btn-sm`} onClick={() => setCustomPaymentMethod('pix')}><QrCode size={14} /> PIX QR Code</button>
                  <button type="button" className={`btn ${customPaymentMethod === 'link' ? 'btn-primary' : 'btn-outline'} btn-sm`} onClick={() => setCustomPaymentMethod('link')}><Link2 size={14} /> Link de Pagamento</button>
                </div>
              </div>
              <button className="btn btn-primary" onClick={handleCreateCustomCharge} disabled={creatingCharge}>
                {creatingCharge ? <><Loader2 size={16} className="spinning" /> Criando...</> : <><DollarSign size={16} /> Gerar cobrança</>}
              </button>
            </div>
          ) : chargeResult.error ? (
            <div className="billing-panel-error"><AlertCircle size={16} /> Erro: {chargeResult.error}</div>
          ) : (
            <div className="billing-panel-form">
              <div className="billing-panel-success"><CheckCircle size={16} /> Cobrança criada com sucesso!</div>
              <div className="billing-panel-info">
                <strong>Valor:</strong> {formatCurrency(chargeResult.amount)}<br />
                <strong>Descrição:</strong> {chargeResult.description}<br />
                <strong>Código:</strong> {chargeResult.reference_code}
              </div>

              {chargeResult.pix_copy_paste && (
                <div>
                  <label>PIX copia e cola</label>
                  <div className="billing-panel-pix">{chargeResult.pix_copy_paste}</div>
                  <button className="btn btn-outline btn-sm" onClick={() => navigator.clipboard.writeText(chargeResult.pix_copy_paste)}>
                    <Copy size={14} /> Copiar código PIX
                  </button>
                </div>
              )}

              {chargeResult.pix_qrcode && (
                <div className="billing-panel-qr">
                  <img src={`data:image/png;base64,${chargeResult.pix_qrcode}`} alt="QR Code PIX" />
                </div>
              )}

              {chargeResult.checkout_url && (
                <div>
                  <label>Link de pagamento</label>
                  <div className="billing-panel-link">
                    <input type="text" readOnly value={chargeResult.checkout_url} />
                    <button className="btn btn-outline btn-sm" onClick={() => navigator.clipboard.writeText(chargeResult.checkout_url)} aria-label="Copiar link"><Copy size={14} /></button>
                  </div>
                </div>
              )}

              <button className="btn btn-outline btn-sm" onClick={() => { setChargeResult(null); setCustomAmount(''); setCustomDescription(''); }}>Nova cobrança</button>
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------- Bloco 1: Agenda */}
      <section className="billing-section">
        <div className="billing-section-header">
          <div>
            <h2>Agenda de recorrência</h2>
            <p className="billing-section-sub">
              {agendaTotal} assinatura(s) com cobrança programada. Ordenado pela próxima cobrança.
            </p>
          </div>
          <div className="billing-section-actions">
            <button className="btn btn-outline btn-sm" onClick={() => setAgendaPage(p => Math.max(0, p - 1))} disabled={agendaPage === 0 || agendaLoading}>
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="billing-pagination">Página {agendaPage + 1} de {totalPages}</span>
            <button className="btn btn-outline btn-sm" onClick={() => setAgendaPage(p => p + 1)} disabled={agendaPage + 1 >= totalPages || agendaLoading}>
              Próxima <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {agendaLoading ? (
          <p className="empty-state">Carregando agendamentos...</p>
        ) : agenda.length === 0 ? (
          <p className="empty-state">Nenhuma assinatura ativa com próxima cobrança programada.</p>
        ) : (
          <div className="billing-agenda">
            {buckets.filter(bucket => bucket.rows.length > 0).map(bucket => (
              <div key={bucket.key} className={`billing-agenda-group ${bucket.tone}`}>
                <h3 className="billing-agenda-title">
                  {bucket.label}
                  <span className="billing-agenda-count">{bucket.rows.length}</span>
                </h3>
                <div className="billing-table-wrap">
                  <table className="billing-table">
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th>Serviço / Grupo</th>
                        <th>Ciclo</th>
                        <th>Valor</th>
                        <th>Próxima cobrança</th>
                        <th>Cartão</th>
                        <th>Status</th>
                        <th>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bucket.rows.map(subscription => {
                        const badge = subscriptionBadge(subscription, now);
                        const hasCard = !!subscription.card_last4;
                        return (
                          <tr key={subscription.id} className={!hasCard ? 'billing-row-no-card' : ''}>
                            <td>
                              <div className="billing-cell-user">
                                <strong>{subscription.user?.name || '—'}</strong>
                                <span>{subscription.user?.email || ''}</span>
                              </div>
                            </td>
                            <td>
                              <div className="billing-cell-stack">
                                <span>{subscription.service?.name || '—'}</span>
                                <span className="billing-cell-muted">{subscription.group?.name || '—'}</span>
                              </div>
                            </td>
                            <td>{cycleLabel(subscription)}</td>
                            <td><strong>{formatCurrency(subscription.amount)}</strong></td>
                            <td>{formatDateTime(subscription.next_charge_at)}</td>
                            <td>
                              {hasCard
                                ? <span className="billing-card-chip"><CreditCard size={12} /> •••• {subscription.card_last4} {subscription.card_brand || ''}</span>
                                : <span className="billing-no-card">sem cartão</span>}
                            </td>
                            <td><span className={`status-badge ${badge.tone}`}>{badge.label}</span></td>
                            <td>
                              <button
                                className="billing-charge-btn"
                                onClick={() => handleChargeNow(subscription)}
                                disabled={chargingId === subscription.id || !hasCard}
                                title={hasCard ? 'Cobrar agora via process-recurring-billing' : 'Sem cartão salvo: a cobrança automática não acontece'}
                              >
                                {chargingId === subscription.id
                                  ? <><Loader2 size={14} className="spinning" /> Cobrando...</>
                                  : <><Zap size={14} /> Cobrar agora</>}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------- Assinaturas sem cartão salvo */}
      <section className="billing-section billing-warning-section">
        <div className="billing-section-header">
          <div>
            <h2><AlertTriangle size={16} /> Sem cartão salvo</h2>
            <p className="billing-section-sub">
              Estas assinaturas não são cobradas automaticamente — é a causa nº 1 de “a cobrança não aconteceu”.
            </p>
          </div>
        </div>
        {withoutCard.length === 0 ? (
          <p className="empty-state">Todas as assinaturas ativas têm cartão salvo.</p>
        ) : (
          <div className="billing-table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Serviço / Grupo</th>
                  <th>Valor</th>
                  <th>Próxima cobrança</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {withoutCard.map(subscription => (
                  <tr key={subscription.id} className="billing-row-no-card">
                    <td>
                      <div className="billing-cell-user">
                        <strong>{subscription.user?.name || '—'}</strong>
                        <span>{subscription.user?.email || ''}</span>
                      </div>
                    </td>
                    <td>
                      <div className="billing-cell-stack">
                        <span>{subscription.service?.name || '—'}</span>
                        <span className="billing-cell-muted">{subscription.group?.name || '—'}</span>
                      </div>
                    </td>
                    <td><strong>{formatCurrency(subscription.amount)}</strong></td>
                    <td>{formatDateTime(subscription.next_charge_at)}</td>
                    <td>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => navigate(`/admin/subscriptions/${subscription.id}/edit`)}
                      >
                        Abrir assinatura
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------- Bloco 2: Números */}
      <section className="billing-section">
        <div className="billing-section-header">
          <div>
            <h2>Números</h2>
            <p className="billing-section-sub">Clique em um cartão para ver os lançamentos por trás do número.</p>
          </div>
        </div>
        <div className="metrics-grid billing-metrics">
          {metricsList.map(metric => (
            <button
              key={metric.key}
              type="button"
              className="metric-card billing-metric-card"
              onClick={() => openDrilldown(metric.key)}
            >
              <div className={`metric-icon ${metric.iconClass}`}>{metric.icon}</div>
              <div className="metric-info">
                <span className="metric-label">{metric.label}</span>
                <span className="metric-value">{metric.value}</span>
                <span className="metric-sub">{metric.sub}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* -------------------------------------------- Bloco 3: Atividade */}
      <section className="billing-section">
        <div className="billing-section-header">
          <h2>Cobranças de hoje</h2>
          <span className="billing-section-total">{formatCurrency(todayCharges.reduce((sum, c) => sum + Number(c.amount || 0), 0))}</span>
        </div>
        {todayCharges.length === 0 ? (
          <p className="empty-state">Nenhuma cobrança programada para hoje.</p>
        ) : (
          <div className="billing-table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Serviço / Grupo</th>
                  <th>Ciclo</th>
                  <th>Valor</th>
                  <th>Cartão</th>
                  <th>Status</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {todayCharges.map(charge => {
                  const badge = subscriptionBadge(charge, now);
                  const hasCard = !!charge.card_last4;
                  return (
                    <tr key={charge.id} className={!hasCard ? 'billing-row-no-card' : ''}>
                      <td>
                        <div className="billing-cell-user">
                          <strong>{charge.user?.name || '—'}</strong>
                          <span>{charge.user?.email || ''}</span>
                        </div>
                      </td>
                      <td>
                        <div className="billing-cell-stack">
                          <span>{charge.service?.name || '—'}</span>
                          <span className="billing-cell-muted">{charge.group?.name || '—'}</span>
                        </div>
                      </td>
                      <td>{cycleLabel(charge)}</td>
                      <td><strong>{formatCurrency(charge.amount)}</strong></td>
                      <td>
                        {hasCard
                          ? <span className="billing-card-chip"><CreditCard size={12} /> •••• {charge.card_last4}</span>
                          : <span className="billing-no-card">sem cartão</span>}
                      </td>
                      <td><span className={`status-badge ${badge.tone}`}>{badge.label}</span></td>
                      <td>
                        <button
                          className="billing-charge-btn"
                          onClick={() => handleChargeNow(charge)}
                          disabled={chargingId === charge.id || !hasCard}
                          title={hasCard ? 'Cobrar agora' : 'Sem cartão salvo'}
                        >
                          {chargingId === charge.id
                            ? <><Loader2 size={14} className="spinning" /> Cobrando...</>
                            : <><Zap size={14} /> Cobrar agora</>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="billing-section">
        <div className="billing-section-header">
          <div>
            <h2>Falhas recentes</h2>
            <p className="billing-section-sub">Motivo informado pelo gateway e número de tentativas por assinatura.</p>
          </div>
        </div>
        {recentFailures.length === 0 ? (
          <p className="empty-state">Nenhuma falha registrada. As falhas aparecem aqui quando o gateway recusa uma cobrança.</p>
        ) : (
          <div className="billing-table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Serviço / Grupo</th>
                  <th>Origem</th>
                  <th>Valor</th>
                  <th>Motivo</th>
                  <th>Tentativas</th>
                  <th>Próxima tentativa</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {recentFailures.map(failure => (
                  <tr key={failure.id}>
                    <td>
                      <div className="billing-cell-user">
                        <strong>{failure.userName}</strong>
                        <span>{failure.userEmail}</span>
                      </div>
                    </td>
                    <td>
                      <div className="billing-cell-stack">
                        <span>{failure.serviceName}</span>
                        <span className="billing-cell-muted">{failure.groupName}</span>
                      </div>
                    </td>
                    <td><span className="billing-origin-badge">{failure.origem}</span></td>
                    <td><strong>{formatCurrency(failure.amount)}</strong></td>
                    <td>
                      <span className="error-cell" title={failure.reason || ''}>
                        {failure.reason || 'Motivo não informado pelo gateway'}
                      </span>
                    </td>
                    <td>
                      <span className={failure.attempt >= 2 ? 'billing-attempt billing-attempt-high' : 'billing-attempt'}>
                        tentativa {failure.attempt}
                      </span>
                    </td>
                    <td>{formatDate(failure.nextRetryAt)}</td>
                    <td>
                      {failure.subscriptionId ? (
                        <button
                          className="billing-charge-btn"
                          onClick={() => handleChargeNow({ id: failure.subscriptionId, user: { name: failure.userName } })}
                          disabled={chargingId === failure.subscriptionId}
                        >
                          {chargingId === failure.subscriptionId
                            ? <><Loader2 size={14} className="spinning" /> Cobrando...</>
                            : <><Zap size={14} /> Cobrar agora</>}
                        </button>
                      ) : (
                        <span className="billing-cell-muted">sem assinatura</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------- Drill-down */}
      {drilldown && (
        <div className="billing-modal-overlay" onClick={closeDrilldown}>
          <div className="billing-modal" onClick={e => e.stopPropagation()}>
            <div className="billing-modal-header">
              <h3>{drilldown.title}</h3>
              <button className="btn btn-outline btn-sm" onClick={closeDrilldown} aria-label="Fechar"><X size={16} /></button>
            </div>
            <p className="billing-modal-desc">{drilldown.description}</p>
            {drilldownLoading ? (
              <p className="empty-state">Carregando...</p>
            ) : drilldown.error ? (
              <div className="billing-panel-error"><AlertCircle size={16} /> {drilldown.error}</div>
            ) : drilldown.rows.length === 0 ? (
              <p className="empty-state">Nenhum lançamento encontrado para este período.</p>
            ) : (
              <div className="billing-modal-list">
                {drilldown.rows.map(row => (
                  <div key={row.key} className="billing-modal-row">
                    <div className="billing-modal-row-info">
                      <strong>{row.primary}</strong>
                      <span>{row.secondary}</span>
                    </div>
                    <span className={`billing-modal-value ${row.tone}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}

export default BillingDashboard;
