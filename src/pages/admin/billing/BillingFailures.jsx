import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { RefreshCw, Search, AlertTriangle, CheckCircle, Zap, Loader2, X, AlertCircle, Info } from 'lucide-react';
import './BillingFailures.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

function localDateStr(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

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

// `in()` com muitos ids gera uma URL gigante e o PostgREST pode recusar.
// Busca em lotes de 100 e concatena os resultados.
async function selectInChunks(table, column, values, columns) {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length === 0) return { data: [], error: null };
  const CHUNK_SIZE = 100;
  const data = [];
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE);
    const { data: rows, error } = await supabase.from(table).select(columns).in(column, chunk);
    if (error) return { data, error };
    data.push(...(rows || []));
  }
  return { data, error: null };
}

// Nomes de usuário/grupo resolvidos por id (não depende do nome da FK).
async function fetchDirectory(userIds, groupIds) {
  const [usersRes, groupsRes] = await Promise.all([
    selectInChunks('users', 'id', userIds, 'id, name, email'),
    selectInChunks('groups', 'id', groupIds, 'id, name'),
  ]);
  const errors = [];
  if (usersRes.error) errors.push(`users: ${usersRes.error.message}`);
  if (groupsRes.error) errors.push(`groups: ${groupsRes.error.message}`);
  return {
    users: new Map((usersRes.data || []).map(u => [u.id, u])),
    groups: new Map((groupsRes.data || []).map(g => [g.id, g])),
    errors,
  };
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(onClose, 7000);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;
  return (
    <div className={`failures-toast ${toast.type}`} role="status">
      {toast.type === 'success' && <CheckCircle size={16} />}
      {toast.type === 'error' && <AlertCircle size={16} />}
      {toast.type === 'warning' && <AlertTriangle size={16} />}
      {toast.type === 'info' && <Info size={16} />}
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Fechar aviso"><X size={14} /></button>
    </div>
  );
}

function BillingFailures() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [loadErrors, setLoadErrors] = useState([]);
  const [filterPeriod, setFilterPeriod] = useState('all');
  const [filterGateway, setFilterGateway] = useState('all');
  const [filterAttempt, setFilterAttempt] = useState('all');
  const [filterOrigin, setFilterOrigin] = useState('all');
  const [search, setSearch] = useState('');
  const [retryingId, setRetryingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const showToast = useCallback((type, message) => setToast({ type, message }), []);
  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    let cancelled = false;

    async function fetchFailures() {
      setLoading(true);
      const errors = [];

      const [cyclesRes, invoicesRes, retryingRes] = await Promise.all([
        // (a) ciclos de cobrança recusados pelo gateway
        supabase
          .from('billing_cycles')
          .select(`
            id, amount, attempt_number, error_message, error_code, next_retry_at,
            charge_date, created_at, gateway, gateway_transaction_id,
            user_id, group_id, subscription_id
          `)
          .eq('status', 'failed')
          .order('created_at', { ascending: false })
          .limit(200),
        // (b) faturas com status de falha
        // ATENÇÃO: a tabela `invoices` NÃO tem a coluna `service_id` (o serviço
        // vem do grupo). Pedir uma coluna inexistente faz o PostgREST devolver
        // 400 e derrubar a consulta inteira — era isso que produzia o aviso
        // "invoices: column invoices.service_id does not exist".
        supabase
          .from('invoices')
          .select('id, user_id, group_id, amount, due_date, status, gateway_transaction_id, paid_at')
          .eq('status', 'failed')
          .order('due_date', { ascending: false })
          .limit(200),
        // (c) assinaturas em retry (o gateway recusou e o cron vai tentar de novo)
        supabase
          .from('user_subscriptions')
          .select(`
            id, amount, status, billing_status, billing_cycle, retry_count, next_charge_at,
            payment_method, user_id, group_id, service_id,
            user:user_id (id, name, email),
            group:group_id (id, name),
            service:service_id (id, name)
          `)
          .eq('billing_status', 'retrying')
          .order('next_charge_at', { ascending: true })
          .limit(200),
      ]);

      if (cyclesRes.error) errors.push(`billing_cycles: ${cyclesRes.error.message}`);
      if (invoicesRes.error) errors.push(`invoices: ${invoicesRes.error.message}`);
      if (retryingRes.error) errors.push(`user_subscriptions (retrying): ${retryingRes.error.message}`);

      const cycles = cyclesRes.data || [];
      const invoices = invoicesRes.data || [];
      const retrying = retryingRes.data || [];

      // Assinaturas dos grupos com falha, SEM filtro de status: uma fatura
      // vencida expira a assinatura (`process-overdue-invoices` marca
      // 'expired') e é justamente essa assinatura que o admin precisa
      // reprocessar e reabrir.
      const subsRes = await selectInChunks(
        'user_subscriptions',
        'group_id',
        [...cycles.map(c => c.group_id), ...invoices.map(i => i.group_id)],
        'id, user_id, group_id, service_id, status, amount, created_at, service:service_id (id, name)'
      );
      if (subsRes.error) errors.push(`user_subscriptions: ${subsRes.error.message}`);
      const subs = subsRes.data || [];

      const subById = new Map(subs.map(s => [s.id, s]));
      const subByUserGroup = new Map();
      subs.forEach(s => {
        const key = `${s.user_id}|${s.group_id}`;
        if (!subByUserGroup.has(key)) subByUserGroup.set(key, []);
        subByUserGroup.get(key).push(s);
      });

      // `invoices` não tem `service_id`: a fatura é vinculada à assinatura pelo
      // par usuário/grupo (mesma regra do `process-overdue-invoices`).
      const matchSubscription = invoice => {
        const list = subByUserGroup.get(`${invoice.user_id}|${invoice.group_id}`) || [];
        if (list.length === 0) return null;
        const sameAmount = list.find(
          s => Math.abs(Number(s.amount || 0) - Number(invoice.amount || 0)) < 0.01
        );
        if (sameAmount) return sameAmount;
        const sorted = [...list].sort((a, b) => {
          if (a.status === 'active' && b.status !== 'active') return -1;
          if (b.status === 'active' && a.status !== 'active') return 1;
          return String(b.created_at || '').localeCompare(String(a.created_at || ''));
        });
        return sorted[0];
      };

      const dir = await fetchDirectory(
        [
          ...cycles.map(c => c.user_id),
          ...invoices.map(i => i.user_id),
          ...retrying.map(s => s.user_id),
        ],
        [...cycles.map(c => c.group_id), ...invoices.map(i => i.group_id)],
      );
      errors.push(...dir.errors);

      const merged = [];

      cycles.forEach(cycle => {
        const sub = subById.get(cycle.subscription_id);
        merged.push({
          key: `ciclo-${cycle.id}`,
          origem: 'ciclo',
          subscriptionId: cycle.subscription_id || null,
          userName: dir.users.get(cycle.user_id)?.name || sub?.user?.name || '—',
          userEmail: dir.users.get(cycle.user_id)?.email || '',
          groupName: dir.groups.get(cycle.group_id)?.name || '—',
          serviceName: sub?.service?.name || '—',
          amount: cycle.amount,
          reason: cycle.error_message || null,
          errorCode: cycle.error_code || null,
          attempt: cycle.attempt_number || 0,
          nextRetryAt: cycle.next_retry_at,
          date: cycle.charge_date || cycle.created_at,
          gateway: cycle.gateway || null,
        });
      });

      invoices.forEach(invoice => {
        const match = matchSubscription(invoice);
        merged.push({
          key: `fatura-${invoice.id}`,
          origem: 'fatura',
          subscriptionId: match?.id || null,
          userName: dir.users.get(invoice.user_id)?.name || '—',
          userEmail: dir.users.get(invoice.user_id)?.email || '',
          groupName: dir.groups.get(invoice.group_id)?.name || '—',
          serviceName: match?.service?.name || '—',
          amount: invoice.amount,
          reason: invoice.gateway_transaction_id
            ? `Transação do gateway: ${invoice.gateway_transaction_id}`
            : 'Fatura marcada como falha pelo gateway',
          errorCode: null,
          attempt: 0,
          nextRetryAt: null,
          date: invoice.due_date,
          gateway: null,
        });
      });

      retrying.forEach(sub => {
        merged.push({
          key: `assinatura-${sub.id}`,
          origem: 'assinatura',
          subscriptionId: sub.id,
          userName: sub.user?.name || '—',
          userEmail: sub.user?.email || '',
          groupName: sub.group?.name || '—',
          serviceName: sub.service?.name || '—',
          amount: sub.amount,
          reason: null,
          errorCode: null,
          attempt: sub.retry_count || 0,
          nextRetryAt: sub.next_charge_at,
          date: sub.next_charge_at,
          gateway: null,
        });
      });

      merged.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

      if (!cancelled) {
        setRows(merged);
        setLoadErrors(errors);
      }
      if (!cancelled) setLoading(false);
    }

    fetchFailures();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const handleRetryCharge = async (row) => {
    if (!row.subscriptionId) {
      showToast('error', 'Este item não tem assinatura vinculada — não há como reprocessar.');
      return;
    }
    setRetryingId(row.key);
    try {
      const data = await callEdgeFunction('process-recurring-billing', {
        manual: true,
        subscription_id: row.subscriptionId,
      });
      const approved = Number(data.approved || 0);
      const failed = Number(data.failed || 0);
      const skipped = Number(data.skipped || 0);
      const details = Array.isArray(data.details) ? data.details : [];
      const own = details.find(d => d.subscription_id === row.subscriptionId);
      const reason = own?.error || (Array.isArray(data.errors) && data.errors[0]) || null;

      if (approved > 0) {
        showToast('success', `Cobrança reprocessada e aprovada para ${row.userName}.`);
      } else if (failed > 0) {
        showToast('error', `A cobrança de ${row.userName} foi recusada novamente${reason ? `: ${reason}` : '.'}`);
      } else if (skipped > 0) {
        showToast('warning', `Reprocessamento ignorado para ${row.userName} (sem cartão salvo ou gateway não configurado).`);
      } else {
        showToast('info', `Nada foi cobrado para ${row.userName}: a assinatura não é elegível agora.`);
      }
      setRefreshKey(k => k + 1);
    } catch (err) {
      showToast('error', `Erro ao reprocessar ${row.userName}: ${err.message}`);
    } finally {
      setRetryingId(null);
    }
  };

  // Todos os filtros são aplicados no cliente sobre os dados já carregados:
  // a busca não dispara uma query por tecla digitada.
  const filtered = useMemo(() => {
    const today = new Date();
    const todayStr = localDateStr(today);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
    const term = search.trim().toLowerCase();

    return rows.filter(row => {
      if (filterOrigin !== 'all' && row.origem !== filterOrigin) return false;

      if (filterPeriod !== 'all') {
        const date = row.date ? String(row.date).slice(0, 10) : '';
        if (!date) return false;
        if (filterPeriod === 'today' && date !== todayStr) return false;
        if (filterPeriod === 'week' && date < localDateStr(weekAgo)) return false;
        if (filterPeriod === 'month' && date < localDateStr(monthAgo)) return false;
      }

      if (filterGateway !== 'all' && row.gateway !== filterGateway) return false;

      if (filterAttempt !== 'all' && String(row.attempt) !== filterAttempt) return false;

      if (term) {
        const haystack = [
          row.userName,
          row.userEmail,
          row.groupName,
          row.serviceName,
          row.reason,
          row.errorCode,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rows, search, filterPeriod, filterGateway, filterAttempt, filterOrigin]);

  return (
    <div className="billing-failures-page">
      <div className="admin-header">
        <div>
          <h1>Falhas de Cobrança</h1>
          <p>Ciclos recusados, faturas com falha e assinaturas em retry — com o motivo de cada uma.</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => setRefreshKey(k => k + 1)} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinning' : ''} /> Atualizar
        </button>
      </div>

      {loadErrors.length > 0 && (
        <div className="failures-error-banner">
          <AlertCircle size={16} />
          <div>
            <strong>Não foi possível carregar parte das falhas:</strong>
            <ul>
              {loadErrors.map((err, i) => <li key={i}>{err}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="failures-filters">
        <div className="filter-group">
          <label htmlFor="failures-period">Período</label>
          <select id="failures-period" value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}>
            <option value="all">Todos</option>
            <option value="today">Hoje</option>
            <option value="week">Última Semana</option>
            <option value="month">Último Mês</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="failures-origin">Origem</label>
          <select id="failures-origin" value={filterOrigin} onChange={e => setFilterOrigin(e.target.value)}>
            <option value="all">Todas</option>
            <option value="ciclo">Ciclo de cobrança</option>
            <option value="fatura">Fatura</option>
            <option value="assinatura">Assinatura em retry</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="failures-gateway">Gateway</label>
          <select id="failures-gateway" value={filterGateway} onChange={e => setFilterGateway(e.target.value)}>
            <option value="all">Todos</option>
            <option value="iopay">IOPay</option>
            <option value="mercadopago">Mercado Pago</option>
            <option value="stripe">Stripe</option>
            <option value="asaas">Asaas</option>
            <option value="pagarme">Pagar.me</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="failures-attempt">Tentativa</label>
          <select id="failures-attempt" value={filterAttempt} onChange={e => setFilterAttempt(e.target.value)}>
            <option value="all">Todas</option>
            <option value="0">Sem tentativa</option>
            <option value="1">1a Tentativa</option>
            <option value="2">2a Tentativa</option>
            <option value="3">3a Tentativa</option>
          </select>
        </div>

        <div className="filter-group search-group">
          <label htmlFor="failures-search">Buscar</label>
          <div className="search-input-wrap">
            <Search size={16} />
            <input
              id="failures-search"
              type="text"
              placeholder="Nome, email, grupo, erro..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="failures-loading">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="failures-empty">
          <AlertTriangle size={48} />
          {rows.length === 0 ? (
            <p>
              Nenhuma falha registrada. As falhas aparecem aqui quando o gateway recusa uma cobrança
              (o cron grava em <code>billing_cycles</code>).
            </p>
          ) : (
            <p>Nenhum item corresponde aos filtros selecionados.</p>
          )}
        </div>
      ) : (
        <div className="failures-table-wrap">
          <table className="failures-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Serviço</th>
                <th>Grupo</th>
                <th>Origem</th>
                <th>Valor</th>
                <th>Tentativa</th>
                <th>Motivo</th>
                <th>Data</th>
                <th>Próxima tentativa</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.key}>
                  <td>
                    <div className="failure-user">
                      <strong>{row.userName}</strong>
                      <span>{row.userEmail}</span>
                    </div>
                  </td>
                  <td>{row.serviceName}</td>
                  <td>{row.groupName}</td>
                  <td><span className="failure-origin">{row.origem}</span></td>
                  <td className="failure-amount">{formatCurrency(row.amount)}</td>
                  <td>
                    <span className={`attempt-badge attempt-${row.attempt}`}>
                      {row.attempt > 0 ? `${row.attempt}a` : '—'}
                    </span>
                  </td>
                  <td className="failure-error" title={row.reason || row.errorCode || ''}>
                    {row.reason || row.errorCode || 'Motivo não informado'}
                  </td>
                  <td>{formatDate(row.date)}</td>
                  <td>{row.nextRetryAt ? formatDate(row.nextRetryAt) : '—'}</td>
                  <td>
                    <div className="failure-actions">
                      <button
                        className="retry-btn"
                        onClick={() => handleRetryCharge(row)}
                        disabled={retryingId === row.key || !row.subscriptionId}
                        title={row.subscriptionId ? 'Reprocessar agora' : 'Sem assinatura vinculada'}
                      >
                        {retryingId === row.key
                          ? <><Loader2 size={14} className="spinning" /> Processando...</>
                          : <><Zap size={14} /> Reprocessar agora</>}
                      </button>
                      <button
                        className="retry-btn secondary"
                        onClick={() => navigate(`/admin/subscriptions/${row.subscriptionId}/edit`)}
                        disabled={!row.subscriptionId}
                      >
                        Abrir assinatura
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}

export default BillingFailures;
