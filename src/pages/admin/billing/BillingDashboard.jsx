import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import {
  DollarSign,
  TrendingUp,
  Users,
  UserPlus,
  UserX,
  AlertTriangle,
  Calendar,
  XCircle,
  CheckCircle,
  BarChart3,
  Repeat,
  CreditCard,
  Zap,
  Loader2,
  QrCode,
  Link2,
  Copy,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import './BillingDashboard.css';

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

// Uma assinatura está em atraso quando a data da próxima cobrança já passou
// OU quando o gateway está em tentativa de repagamento.
// Não usamos billing_status 'overdue'/'failed': esses valores não existem no
// banco (só 'active' e 'retrying'), então o filtro antigo sempre retornava 0.
function isOverdueSub(s, now = new Date()) {
  if (!s) return false;
  if (s.billing_status === 'retrying') return true;
  return !!s.next_charge_at && new Date(s.next_charge_at) < now;
}

function subscriptionStatus(s, now = new Date()) {
  if (s?.billing_status === 'retrying') return { label: 'Em tentativa', tone: 'retrying' };
  if (isOverdueSub(s, now)) return { label: 'Atrasada', tone: 'overdue' };
  if (s?.next_charge_at) return { label: 'Agendada', tone: 'active' };
  return { label: 'Sem previsão', tone: 'pending' };
}

function BillingDashboard() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    monthRevenue: 0,
    futureRevenue: 0,
    activeSubscriptions: 0,
    newSubscribers: 0,
    cancelled: 0,
    retrying: 0,
    chargesToday: 0,
    todayAmount: 0,
    failuresToday: 0,
    approvalRate: 0,
    mrr: 0,
    arr: 0,
  });
  const [todayCharges, setTodayCharges] = useState([]);
  const [recentFailures, setRecentFailures] = useState([]);
  const [runningBilling, setRunningBilling] = useState(false);
  const [billingResult, setBillingResult] = useState(null);
  const [showCustomCharge, setShowCustomCharge] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customPaymentMethod, setCustomPaymentMethod] = useState('pix');
  const [creatingCharge, setCreatingCharge] = useState(false);
  const [chargeResult, setChargeResult] = useState(null);
  const [cardFilter, setCardFilter] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchBilling() {
      setLoading(true);
      try {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
      const today = now.toISOString().split('T')[0];
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString().split('T')[0];
      const nowIso = now.toISOString();

      const OVERDUE_FILTER = `next_charge_at.lt.${nowIso},billing_status.eq.retrying`;
      const isOverdue = (s) => isOverdueSub(s, now);

      const [
        subsActiveRes,
        subsNewRes,
        subsCancelledRes,
        subsRetryingRes,
        monthPayRes,
        todaySubsRes,
        failedSubsRes,
      ] = await Promise.all([
        supabase.from('user_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('user_subscriptions').select('id', { count: 'exact', head: true }).gte('started_at', today).lt('started_at', tomorrow),
        supabase.from('user_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'cancelled').gte('updated_at', firstDay),
        supabase.from('user_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active').eq('billing_status', 'retrying'),
        supabase.from('payments').select('amount').eq('status', 'paid').eq('payment_type', 'subscription').gte('created_at', firstDay).lte('created_at', lastDay),
        supabase.from('user_subscriptions')
          .select(`
            id, amount, status, billing_status, billing_cycle, custom_cycle_days, next_charge_at, retry_count, card_last4, card_brand,
            user:user_id (id, name, email),
            group:group_id (id, name),
            service:service_id (id, name)
          `)
          .eq('status', 'active')
          .not('next_charge_at', 'is', null)
          .gte('next_charge_at', today)
          .lt('next_charge_at', tomorrow),
        supabase.from('user_subscriptions')
          .select(`
            id, amount, status, billing_status, billing_cycle, next_charge_at, retry_count, card_last4, card_brand, updated_at,
            user:user_id (id, name, email),
            group:group_id (id, name),
            service:service_id (id, name)
          `)
          .or(OVERDUE_FILTER)
          .order('updated_at', { ascending: false })
          .limit(10),
      ]);

      let monthRevenue = 0;
      (monthPayRes.data || []).forEach(p => { monthRevenue += Number(p.amount || 0); });

      let futureRevenue = 0;
      const futureRes = await supabase
        .from('user_subscriptions')
        .select('amount')
        .eq('status', 'active')
        .not('next_charge_at', 'is', null)
        .gt('next_charge_at', now.toISOString());
      (futureRes.data || []).forEach(s => { futureRevenue += Number(s.amount || 0); });

      let chargesTodayCount = (todaySubsRes.data || []).length;
      let todayAmount = 0;
      (todaySubsRes.data || []).forEach(s => { todayAmount += Number(s.amount || 0); });

      let failuresTodayCount = 0;
      (todaySubsRes.data || []).forEach(s => {
        if (isOverdue(s)) failuresTodayCount++;
      });

      const allActiveRes = await supabase.from('user_subscriptions').select('billing_status', { count: 'exact', head: true }).eq('status', 'active');
      const totalActive = allActiveRes.count || 0;
      const allFailedRes = await supabase.from('user_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active').or(OVERDUE_FILTER);
      const totalFailed = allFailedRes.count || 0;
      let approvalRate = totalActive > 0 ? Math.round(((totalActive - totalFailed) / totalActive) * 100) : 100;

      // MRR: sum of monthly amounts from active subscriptions
      const mrrRes = await supabase.from('user_subscriptions').select('amount, billing_cycle, custom_cycle_months').eq('status', 'active');
      let mrr = 0;
      (mrrRes.data || []).forEach(s => {
        const amt = Number(s.amount || 0);
        if (s.billing_cycle === 'monthly') mrr += amt;
        else if (s.billing_cycle === 'quarterly') mrr += amt / 3;
        else if (s.billing_cycle === 'semiannual') mrr += amt / 6;
        else if (s.billing_cycle === 'annual') mrr += amt / 12;
        else if (s.billing_cycle === 'custom' && s.custom_cycle_months) mrr += amt / s.custom_cycle_months;
        else if (s.billing_cycle === 'days') mrr += amt; // approximate
        else mrr += amt;
      });

      setMetrics({
        monthRevenue,
        futureRevenue,
        activeSubscriptions: subsActiveRes.count || 0,
        newSubscribers: subsNewRes.count || 0,
        cancelled: subsCancelledRes.count || 0,
        retrying: subsRetryingRes.count || 0,
        chargesToday: chargesTodayCount,
        todayAmount,
        failuresToday: failuresTodayCount,
        approvalRate,
        mrr,
        arr: mrr * 12,
      });

      setTodayCharges(todaySubsRes.data || []);
      setRecentFailures(failedSubsRes.data || []);
      } catch (err) {
        console.error('BillingDashboard fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchBilling();
    return () => { cancelled = true; };
  }, []);

  const handleCreateCustomCharge = async () => {
    if (!customAmount || Number(customAmount) <= 0) return alert('Informe um valor válido');
    if (!customDescription) return alert('Informe uma descrição');
    setCreatingCharge(true);
    setChargeResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-custom-charge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          amount: Number(customAmount),
          description: customDescription,
          payment_method: customPaymentMethod,
          admin_id: session.user?.id,
        }),
      });
      const rawData = await resp.json();
      const data = rawData?.data || rawData;
      if (data.error) throw new Error(data.error);
      setChargeResult(data);
    } catch (e) {
      setChargeResult({ error: e.message });
    }
    setCreatingCharge(false);
  };

  const handleForceBilling = async () => {
    if (!window.confirm('Executar cobranças recorrentes agora? Isso vai cobrar todos os usuários com next_charge_at <= hoje.')) return;
    setRunningBilling(true);
    setBillingResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-crons`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'run_now', jobname: 'process-recurring-billing' }),
      });
      const data = await resp.json();
      if (data.success) {
        let parsed;
        try { parsed = JSON.parse(data.response); } catch { parsed = null; }
        const summary = parsed
          ? `Processadas: ${parsed.processed || 0} | Aprovadas: ${parsed.approved || 0} | Falhas: ${parsed.failed || 0} | Canceladas: ${parsed.cancelled || 0}`
          : data.response?.substring(0, 500) || 'Executado';
        setBillingResult({ type: 'success', message: summary });
      } else {
        setBillingResult({ type: 'error', message: data.response || data.error || 'Erro desconhecido' });
      }
    } catch (e) {
      setBillingResult({ type: 'error', message: e.message });
    }
    setRunningBilling(false);
  };

  if (loading) {
    return <div className="billing-loading">Carregando...</div>;
  }

  return (
    <div className="billing-dashboard">
      <div className="admin-header">
        <h1>Cobranças Recorrentes</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn btn-primary btn-sm" onClick={() => { setShowCustomCharge(true); setChargeResult(null); setCustomAmount(''); setCustomDescription(''); }}>
            <DollarSign size={14} /> Cobrança Personalizada
          </button>
        </div>
      </div>

      {showCustomCharge && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Nova Cobrança Personalizada</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowCustomCharge(false); setChargeResult(null); }}><XCircle size={16} /></button>
          </div>

          {!chargeResult ? (
            <div style={{ display: 'grid', gap: '1rem', maxWidth: '500px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 600 }}>Valor (R$)</label>
                <input type="number" step="0.01" min="0.01" value={customAmount} onChange={e => setCustomAmount(e.target.value)} placeholder="0,00" style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-main)' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 600 }}>Descrição</label>
                <input type="text" value={customDescription} onChange={e => setCustomDescription(e.target.value)} placeholder="Ex: Venda externa, correção, etc." maxLength={50} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-main)' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 600 }}>Método de Cobrança</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className={`btn ${customPaymentMethod === 'pix' ? 'btn-primary' : 'btn-outline'} btn-sm`} onClick={() => setCustomPaymentMethod('pix')}><QrCode size={14} /> PIX QR Code</button>
                  <button className={`btn ${customPaymentMethod === 'link' ? 'btn-primary' : 'btn-outline'} btn-sm`} onClick={() => setCustomPaymentMethod('link')}><Link2 size={14} /> Link de Pagamento</button>
                </div>
              </div>
              <button className="btn btn-primary" onClick={handleCreateCustomCharge} disabled={creatingCharge}>
                {creatingCharge ? <><Loader2 size={16} className="spin" /> Criando...</> : <><DollarSign size={16} /> Gerar Cobrança</>}
              </button>
            </div>
          ) : chargeResult.error ? (
            <div style={{ color: 'var(--danger)' }}>Erro: {chargeResult.error}</div>
          ) : (
            <div style={{ display: 'grid', gap: '1rem', maxWidth: '500px' }}>
              <div style={{ color: 'var(--success)', fontWeight: 600 }}>
                <CheckCircle size={16} /> Cobrança criada com sucesso!
              </div>
              <div style={{ fontSize: '0.9rem' }}>
                <strong>Valor:</strong> {formatCurrency(chargeResult.amount)}<br />
                <strong>Descrição:</strong> {chargeResult.description}<br />
                <strong>Código:</strong> {chargeResult.reference_code}
              </div>

              {chargeResult.pix_copy_paste && (
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 600 }}>PIX Copia e Cola</label>
                  <div style={{ background: 'var(--background)', border: '1px dashed var(--border)', borderRadius: '0.5rem', padding: '0.75rem', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                    {chargeResult.pix_copy_paste}
                  </div>
                  <button className="btn btn-outline btn-sm" onClick={() => navigator.clipboard.writeText(chargeResult.pix_copy_paste)}>
                    <Copy size={14} /> Copiar Código PIX
                  </button>
                </div>
              )}

              {chargeResult.pix_qrcode && (
                <div style={{ textAlign: 'center' }}>
                  <img src={`data:image/png;base64,${chargeResult.pix_qrcode}`} alt="QR Code PIX" style={{ maxWidth: '200px', background: '#FFFFFF', padding: '8px', borderRadius: '0.5rem' }} />
                </div>
              )}

              {chargeResult.checkout_url && (
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 600 }}>Link de Pagamento</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input type="text" readOnly value={chargeResult.checkout_url} style={{ flex: 1, padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-main)', fontSize: '0.85rem' }} />
                    <button className="btn btn-outline btn-sm" onClick={() => navigator.clipboard.writeText(chargeResult.checkout_url)}>
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
              )}

              <button className="btn btn-outline btn-sm" onClick={() => { setChargeResult(null); setCustomAmount(''); setCustomDescription(''); }}>Nova Cobrança</button>
            </div>
          )}
        </div>
      )}

      <div className="billing-nav-links">
        <Link to="/admin/billing" className="billing-nav active">Dashboard</Link>
        <Link to="/admin/subscriptions" className="billing-nav">Assinaturas SaaS</Link>
        <Link to="/admin/wallets" className="billing-nav">Carteiras</Link>
        <Link to="/admin/billing/calendar" className="billing-nav">Calendário</Link>
        <Link to="/admin/billing/failures" className="billing-nav">Falhas</Link>
        <Link to="/admin/billing/crons" className="billing-nav">Crons</Link>
      </div>

      <div className="billing-force-bar">
        <button
          className="billing-force-btn"
          onClick={handleForceBilling}
          disabled={runningBilling}
        >
          {runningBilling ? (
            <><Loader2 size={16} className="spinning" /> Executando cobranças...</>
          ) : (
            <><Zap size={16} /> Forçar Cobranças Recorrentes</>
          )}
        </button>
        {billingResult && (
          <div className={`billing-force-result ${billingResult.type}`}>
            {billingResult.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            <span>{billingResult.message}</span>
            <button className="billing-force-dismiss" onClick={() => setBillingResult(null)}>&times;</button>
          </div>
        )}
      </div>

      <div className="metrics-grid billing-metrics">
        <div className={`metric-card ${cardFilter === 'revenue' ? 'metric-card-active' : ''}`} onClick={() => setCardFilter(cardFilter === 'revenue' ? null : 'revenue')} style={{ cursor: 'pointer' }}>
          <div className="metric-icon revenue"><DollarSign size={22} /></div>
          <div className="metric-info">
            <span className="metric-label">Receita do Mês</span>
            <span className="metric-value">{formatCurrency(metrics.monthRevenue)}</span>
          </div>
        </div>

        <div className={`metric-card ${cardFilter === 'future' ? 'metric-card-active' : ''}`} onClick={() => setCardFilter(cardFilter === 'future' ? null : 'future')} style={{ cursor: 'pointer' }}>
          <div className="metric-icon" style={{ background: 'rgba(14, 165, 233, 0.1)', color: '#0EA5E9' }}><TrendingUp size={22} /></div>
          <div className="metric-info">
            <span className="metric-label">Receita Futura</span>
            <span className="metric-value">{formatCurrency(metrics.futureRevenue)}</span>
          </div>
        </div>

        <div className={`metric-card ${cardFilter === 'active' ? 'metric-card-active' : ''}`} onClick={() => setCardFilter(cardFilter === 'active' ? null : 'active')} style={{ cursor: 'pointer' }}>
          <div className="metric-icon subscriptions"><Users size={22} /></div>
          <div className="metric-info">
            <span className="metric-label">Assinaturas Ativas</span>
            <span className="metric-value">{metrics.activeSubscriptions}</span>
          </div>
        </div>

        <div className={`metric-card ${cardFilter === 'new' ? 'metric-card-active' : ''}`} onClick={() => setCardFilter(cardFilter === 'new' ? null : 'new')} style={{ cursor: 'pointer' }}>
          <div className="metric-icon" style={{ background: 'rgba(14, 165, 233, 0.1)', color: '#0EA5E9' }}><UserPlus size={22} /></div>
          <div className="metric-info">
            <span className="metric-label">Novos Assinantes</span>
            <span className="metric-value">{metrics.newSubscribers}</span>
          </div>
        </div>

        <div className={`metric-card ${cardFilter === 'cancelled' ? 'metric-card-active' : ''}`} onClick={() => setCardFilter(cardFilter === 'cancelled' ? null : 'cancelled')} style={{ cursor: 'pointer' }}>
          <div className="metric-icon costs"><UserX size={22} /></div>
          <div className="metric-info">
            <span className="metric-label">Canceladas</span>
            <span className="metric-value">{metrics.cancelled}</span>
          </div>
        </div>

        <div className={`metric-card ${cardFilter === 'retrying' ? 'metric-card-active' : ''}`} onClick={() => setCardFilter(cardFilter === 'retrying' ? null : 'retrying')} style={{ cursor: 'pointer' }}>
          <div className="metric-icon tickets"><AlertTriangle size={22} /></div>
          <div className="metric-info">
            <span className="metric-label">Em Tentativa</span>
            <span className="metric-value">{metrics.retrying}</span>
          </div>
        </div>

        <div className={`metric-card highlight ${cardFilter === 'today' ? 'metric-card-active' : ''}`} onClick={() => setCardFilter(cardFilter === 'today' ? null : 'today')} style={{ cursor: 'pointer' }}>
          <div className="metric-icon" style={{ background: 'rgba(79, 70, 229, 0.1)', color: '#4F46E5' }}><Calendar size={22} /></div>
          <div className="metric-info">
            <span className="metric-label">Cobranças Hoje</span>
            <span className="metric-value">{metrics.chargesToday}</span>
            {metrics.todayAmount > 0 && (
              <span className="metric-sub">{formatCurrency(metrics.todayAmount)}</span>
            )}
          </div>
        </div>

        <div className={`metric-card ${cardFilter === 'failures' ? 'metric-card-active' : ''}`} onClick={() => setCardFilter(cardFilter === 'failures' ? null : 'failures')} style={{ cursor: 'pointer' }}>
          <div className="metric-icon costs"><XCircle size={22} /></div>
          <div className="metric-info">
            <span className="metric-label">Falhas Hoje</span>
            <span className="metric-value">{metrics.failuresToday}</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon subscriptions"><CheckCircle size={22} /></div>
          <div className="metric-info">
            <span className="metric-label">Taxa de Aprovação</span>
            <span className="metric-value">{metrics.approvalRate}%</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon revenue"><BarChart3 size={22} /></div>
          <div className="metric-info">
            <span className="metric-label">Equivalente mensal</span>
            <span className="metric-value">{formatCurrency(metrics.mrr)}</span>
            <span className="metric-sub">Ciclos maiores normalizados por mês</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10B981' }}><Repeat size={22} /></div>
          <div className="metric-info">
            <span className="metric-label">ARR</span>
            <span className="metric-value">{formatCurrency(metrics.arr)}</span>
            <span className="metric-sub">Receita anual recorrente</span>
          </div>
        </div>
      </div>

      <div className="billing-sections">
        {(!cardFilter || cardFilter === 'today' || cardFilter === 'failures' || cardFilter === 'retrying') && (
        <div className="billing-section">
          <div className="billing-section-header">
            <h2>{cardFilter === 'failures' ? 'Falhas Hoje' : cardFilter === 'retrying' ? 'Em Tentativa' : 'Cobranças de Hoje'}</h2>
            {todayCharges.length > 0 && (
              <span className="billing-section-total">{formatCurrency(metrics.todayAmount)}</span>
            )}
          </div>
          {(() => {
            let data = todayCharges;
            if (cardFilter === 'failures') data = todayCharges.filter(c => isOverdueSub(c));
            else if (cardFilter === 'retrying') data = todayCharges.filter(c => c.billing_status === 'retrying');

            if (data.length === 0) {
              return <p className="empty-state">{cardFilter ? 'Nenhum item para este filtro.' : 'Nenhuma cobrança agendada para hoje.'}</p>;
            }
            return (
              <div className="billing-table-wrap">
                <table className="billing-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Serviço</th>
                      <th>Grupo</th>
                      <th>Ciclo</th>
                      <th>Cartão</th>
<th>Valor do ciclo</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map(charge => (
                      <tr key={charge.id}>
                        <td>
                          <div>
                            <strong>{charge.user?.name || '—'}</strong>
                            <span style={{ fontSize: '0.75em', color: 'var(--text-muted)', display: 'block' }}>{charge.user?.email || ''}</span>
                          </div>
                        </td>
                        <td>{charge.service?.name || '—'}</td>
                        <td>{charge.group?.name || '—'}</td>
                        <td>{charge.billing_cycle || '—'}</td>
                        <td>{charge.card_last4 ? `•••• ${charge.card_last4}` : <span style={{ color: '#ef4444' }}>Sem cartão</span>}</td>
                        <td><strong>{formatCurrency(charge.amount)}</strong></td>
                        <td>
                          {(() => {
                            const st = subscriptionStatus(charge, new Date());
                            return (
                              <span className={`status-badge ${st.tone}`}>
                                {st.label}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
        )}

        {(!cardFilter || cardFilter === 'failures' || cardFilter === 'retrying') && (
        <div className="billing-section">
          <h2>Falhas Recentes</h2>
          {recentFailures.length === 0 ? (
            <p className="empty-state">Nenhuma falha recente. Todas as assinaturas estão em dia.</p>
          ) : (
            <div className="billing-table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Serviço</th>
                    <th>Grupo</th>
                    <th>Valor</th>
                    <th>Cartão</th>
                    <th>Tentativas</th>
                    <th>Status</th>
                    <th>Atualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFailures.map(fail => (
                    <tr key={fail.id}>
                      <td>
                        <div>
                          <strong>{fail.user?.name || '—'}</strong>
                          <span style={{ fontSize: '0.75em', color: 'var(--text-muted)', display: 'block' }}>{fail.user?.email || ''}</span>
                        </div>
                      </td>
                      <td>{fail.service?.name || '—'}</td>
                      <td>{fail.group?.name || '—'}</td>
                      <td>{formatCurrency(fail.amount)}</td>
                      <td>{fail.card_last4 ? `•••• ${fail.card_last4}` : <span style={{ color: '#ef4444' }}>Sem cartão</span>}</td>
                      <td>
                        <span style={{ color: fail.retry_count >= 2 ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>
                          {fail.retry_count || 0}ª
                        </span>
                      </td>
<td>
                          {(() => {
                            const st = subscriptionStatus(fail, new Date());
                            return (
                              <span className={`status-badge ${st.tone}`}>
                                {st.label}
                              </span>
                            );
                          })()}
                        </td>
                      <td>{fail.updated_at ? new Date(fail.updated_at).toLocaleDateString('pt-BR') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

export default BillingDashboard;
