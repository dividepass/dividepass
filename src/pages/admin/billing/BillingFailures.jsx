import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { Link } from 'react-router-dom';
import { RefreshCw, Search, AlertTriangle } from 'lucide-react';
import './BillingFailures.css';

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function BillingFailures() {
  const [loading, setLoading] = useState(true);
  const [failures, setFailures] = useState([]);
  const [filterPeriod, setFilterPeriod] = useState('all');
  const [filterGateway, setFilterGateway] = useState('all');
  const [filterAttempt, setFilterAttempt] = useState('all');
  const [search, setSearch] = useState('');
  const [retryingId, setRetryingId] = useState(null);

  const fetchFailures = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('billing_cycles')
      .select(`
        id, amount, attempt_number, error_message, error_code, next_retry_at,
        charge_date, created_at, updated_at, gateway, gateway_transaction_id,
        user_id, group_id, subscription_id,
        user:users!billing_cycles_user_id_fkey (id, name, email),
        group:groups!billing_cycles_group_id_fkey (id, name),
        subscription:user_subscriptions!billing_cycles_subscription_id_fkey (
          card_last4, card_brand, billing_cycle, gateway as sub_gateway, status,
          service_id
        ),
        service:streaming_services!user_subscriptions_service_id_fkey (name)
      `)
      .eq('status', 'failed');

    if (filterPeriod === 'today') {
      const today = new Date().toISOString().split('T')[0];
      query = query.eq('charge_date', today);
    } else if (filterPeriod === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      query = query.gte('charge_date', weekAgo.toISOString().split('T')[0]);
    } else if (filterPeriod === 'month') {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      query = query.gte('charge_date', monthAgo.toISOString().split('T')[0]);
    }

    if (filterGateway !== 'all') {
      query = query.eq('gateway', filterGateway);
    }

    if (filterAttempt !== 'all') {
      query = query.eq('attempt_number', parseInt(filterAttempt));
    }

    const { data } = await query.order('updated_at', { ascending: false });

    let filtered = data || [];
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(f =>
        f.user?.name?.toLowerCase().includes(s) ||
        f.user?.email?.toLowerCase().includes(s) ||
        f.group?.name?.toLowerCase().includes(s) ||
        f.error_message?.toLowerCase().includes(s)
      );
    }

    setFailures(filtered);
    setLoading(false);
  }, [filterPeriod, filterGateway, filterAttempt, search]);

  useEffect(() => {
    fetchFailures();
  }, [fetchFailures]);

  async function handleRetryCharge(failure) {
    setRetryingId(failure.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-recurring-billing`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ subscription_id: failure.subscription_id, manual: true }),
      });
      const result = await resp.json();
      if (result.success) {
        alert('Cobrança reprocessada com sucesso!');
        fetchFailures();
      } else {
        alert('Erro: ' + (result.error || 'Desconhecido'));
      }
    } catch (e) {
      alert('Erro ao reprocessar: ' + e.message);
    }
    setRetryingId(null);
  }

  const filtered = failures;

  return (
    <div className="billing-failures-page">
      <div className="admin-header">
        <h1>Dashboard de Falhas</h1>
        <p>Gerencie cobranças recusadas e reprocessamentos</p>
      </div>

      <div className="billing-nav-links">
        <Link to="/admin/billing" className="billing-nav">Dashboard</Link>
        <Link to="/admin/subscriptions" className="billing-nav">Assinaturas SaaS</Link>
        <Link to="/admin/wallets" className="billing-nav">Carteiras</Link>
        <Link to="/admin/billing/calendar" className="billing-nav">Calendário</Link>
        <Link to="/admin/billing/failures" className="billing-nav active">Falhas</Link>
        <Link to="/admin/billing/crons" className="billing-nav">Crons</Link>
      </div>

      <div className="failures-filters">
        <div className="filter-group">
          <label>Período</label>
          <select value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}>
            <option value="all">Todos</option>
            <option value="today">Hoje</option>
            <option value="week">Última Semana</option>
            <option value="month">Último Mês</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Gateway</label>
          <select value={filterGateway} onChange={e => setFilterGateway(e.target.value)}>
            <option value="all">Todos</option>
            <option value="iopay">IOPay</option>
            <option value="mercadopago">Mercado Pago</option>
            <option value="stripe">Stripe</option>
            <option value="asaas">Asaas</option>
            <option value="pagarme">Pagar.me</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Tentativa</label>
          <select value={filterAttempt} onChange={e => setFilterAttempt(e.target.value)}>
            <option value="all">Todas</option>
            <option value="1">1a Tentativa</option>
            <option value="2">2a Tentativa</option>
            <option value="3">3a Tentativa</option>
          </select>
        </div>

        <div className="filter-group search-group">
          <label>Buscar</label>
          <div className="search-input-wrap">
            <Search size={16} />
            <input
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
          <p>Nenhuma falha encontrada com os filtros selecionados.</p>
        </div>
      ) : (
        <div className="failures-table-wrap">
          <table className="failures-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Plano</th>
                <th>Grupo</th>
                <th>Valor</th>
                <th>Tentativa</th>
                <th>Erro</th>
                <th>Última Tentativa</th>
                <th>Próxima Tentativa</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <tr key={f.id}>
                  <td>
                    <div className="failure-user">
                      <strong>{f.user?.name || 'N/A'}</strong>
                      <span>{f.user?.email || ''}</span>
                    </div>
                  </td>
                  <td>{f.service?.name || 'N/A'}</td>
                  <td>{f.group?.name || 'N/A'}</td>
                  <td className="failure-amount">{formatCurrency(f.amount)}</td>
                  <td>
                    <span className={`attempt-badge attempt-${f.attempt_number}`}>
                      {f.attempt_number}a
                    </span>
                  </td>
                  <td className="failure-error">{f.error_message || 'N/A'}</td>
                  <td>{new Date(f.updated_at).toLocaleDateString('pt-BR')}</td>
                  <td>
                    {f.next_retry_at
                      ? new Date(f.next_retry_at).toLocaleDateString('pt-BR')
                      : '-'}
                  </td>
                  <td>
                    {f.subscription?.status === 'active' && (
                      <button
                        className="retry-btn"
                        onClick={() => handleRetryCharge(f)}
                        disabled={retryingId === f.id}
                      >
                        <RefreshCw size={14} className={retryingId === f.id ? 'spinning' : ''} />
                        {retryingId === f.id ? 'Processando...' : 'Cobrar Agora'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default BillingFailures;
