import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Edit2, XCircle, Loader2, Calendar, DollarSign, RefreshCw, Shield, Eye, X, CreditCard, Hash, Clock, Tag, TrendingUp, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './Subscriptions.css';

const STATUS_OPTIONS = ['active', 'inactive', 'cancelled', 'expired', 'pending'];
const CYCLE_OPTIONS = ['monthly', 'quarterly', 'semiannual', 'annual', 'days'];

// Quantos meses cada periodicidade representa
const CYCLE_MONTHS = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
  days: 0, // especial, usa custom_cycle_days
};

function Subscriptions() {
  const navigate = useNavigate();
  const [subscriptions, setSubscriptions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [cycleFilter, setCycleFilter] = useState('all');
  const [renewalFilter, setRenewalFilter] = useState('all');
  const [error, setError] = useState('');

  const [detailSub, setDetailSub] = useState(null);
  const [detailPayments, setDetailPayments] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailBillingCycles, setDetailBillingCycles] = useState([]);
  const [selectedPayment, setSelectedPayment] = useState(null);

  // Modal de detalhamento dos cards de receita
  const [statDetailModal, setStatDetailModal] = useState(null); // 'received' | 'monthly' | 'thisMonth' | 'next7' | 'next30' | 'next60'
  const [statDetailData, setStatDetailData] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      if (!cancelled) {
        setLoading(true);
        setError('');
      }
      try {
        const [subsRes, paymentsRes] = await Promise.all([
          supabase
            .from('user_subscriptions')
            .select(`
              *,
              user:user_id (id, name, email),
              group:group_id (id, name, slug),
              service:service_id (id, name, full_name),
              coupon:coupon_id (id, code, discount_type, discount_value)
            `)
            .order('created_at', { ascending: false }),
          supabase
            .from('payments')
            .select('*')
            .eq('status', 'paid')
            .eq('payment_type', 'subscription')
            .order('created_at', { ascending: false }),
        ]);

        if (subsRes.error) throw subsRes.error;
        if (!cancelled) {
          setSubscriptions(subsRes.data || []);
          setPayments(paymentsRes.data || []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, []);

  // Receita recebida este mês (pagamentos com data no mês atual)
  const receivedThisMonth = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    return payments
      .filter(p => {
        const date = new Date(p.created_at);
        return date >= startOfMonth && date <= endOfMonth;
      })
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }, [payments]);

  // Receita mensal equivalente (soma de todas as ativas normalizada para mensal)
  const monthlyEquivalent = useMemo(() => {
    return subscriptions
      .filter(s => s.status === 'active')
      .reduce((sum, s) => {
        const cycle = s.billing_cycle || 'monthly';
        const months = CYCLE_MONTHS[cycle];
        const amount = Number(s.amount || 0);

        if (months && months > 0) {
          // Normalizar para mensal
          return sum + (amount / months);
        } else if (cycle === 'days' && s.custom_cycle_days) {
          // custom_days: converter para mensal (30 dias)
          return sum + (amount / s.custom_cycle_days * 30);
        }
        // mensal ou desconhecido
        return sum + amount;
      }, 0);
  }, [subscriptions]);

  // Próximas renovações
  const renewalStats = useMemo(() => {
    const now = new Date();
    const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const sixtyDays = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const active = subscriptions.filter(s => s.status === 'active' && s.next_charge_at);

    const thisMonth = active.filter(s => {
      const nextCharge = new Date(s.next_charge_at);
      return nextCharge <= endOfMonth;
    });

    const next7Days = active.filter(s => {
      const nextCharge = new Date(s.next_charge_at);
      return nextCharge > now && nextCharge <= sevenDays;
    });

    const next30Days = active.filter(s => {
      const nextCharge = new Date(s.next_charge_at);
      return nextCharge > now && nextCharge <= thirtyDays;
    });

    const next60Days = active.filter(s => {
      const nextCharge = new Date(s.next_charge_at);
      return nextCharge > thirtyDays && nextCharge <= sixtyDays;
    });

    const calcRevenue = (subs) => subs.reduce((sum, s) => {
      const cycle = s.billing_cycle || 'monthly';
      const months = CYCLE_MONTHS[cycle];
      const amount = Number(s.amount || 0);

      if (months && months > 0) {
        return sum + (amount / months);
      } else if (cycle === 'days' && s.custom_cycle_days) {
        return sum + (amount / s.custom_cycle_days * 30);
      }
      return sum + amount;
    }, 0);

    return {
      thisMonth: { count: thisMonth.length, revenue: calcRevenue(thisMonth) },
      next7Days: { count: next7Days.length, revenue: calcRevenue(next7Days) },
      next30Days: { count: next30Days.length, revenue: calcRevenue(next30Days) },
      next60Days: { count: next60Days.length, revenue: calcRevenue(next60Days) },
    };
  }, [subscriptions]);

  const filtered = useMemo(() => {
    return subscriptions.filter(sub => {
      // Busca
      const matchesSearch =
        !search ||
        sub.user?.name?.toLowerCase().includes(search.toLowerCase()) ||
        sub.user?.email?.toLowerCase().includes(search.toLowerCase()) ||
        sub.service?.name?.toLowerCase().includes(search.toLowerCase()) ||
        sub.group?.name?.toLowerCase().includes(search.toLowerCase()) ||
        sub.external_reference?.toLowerCase().includes(search.toLowerCase());

      // Status
      const matchesStatus = statusFilter === 'all' || sub.status === statusFilter;

      // Periodicidade
      const matchesCycle = cycleFilter === 'all' || sub.billing_cycle === cycleFilter;

      // Renovação
      let matchesRenewal = true;
      if (renewalFilter !== 'all') {
        const now = new Date();
        const nextCharge = sub.next_charge_at ? new Date(sub.next_charge_at) : null;

        if (renewalFilter === 'this_month') {
          const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          matchesRenewal = nextCharge && nextCharge <= endOfMonth;
        } else if (renewalFilter === 'next_7') {
          const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          matchesRenewal = nextCharge && nextCharge > now && nextCharge <= sevenDays;
        } else if (renewalFilter === 'next_30') {
          const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          matchesRenewal = nextCharge && nextCharge > sevenDays && nextCharge <= thirtyDays;
        } else if (renewalFilter === 'next_60') {
          const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          const sixtyDays = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
          matchesRenewal = nextCharge && nextCharge > thirtyDays && nextCharge <= sixtyDays;
        }
      }

      return matchesSearch && matchesStatus && matchesCycle && matchesRenewal;
    });
  }, [subscriptions, search, statusFilter, cycleFilter, renewalFilter]);

  const handleCancel = async (sub) => {
    if (!window.confirm(`Cancelar assinatura de ${sub.user?.name} no grupo ${sub.group?.name}?`)) return;

    try {
      const now = new Date().toISOString();

      const { error: subError } = await supabase
        .from('user_subscriptions')
        .update({ status: 'cancelled', updated_at: now })
        .eq('id', sub.id);

      if (subError) throw subError;

      const { error: memberError } = await supabase
        .from('group_members')
        .update({ status: 'inactive', left_at: now })
        .eq('group_id', sub.group_id)
        .eq('user_id', sub.user_id);

      if (memberError) throw memberError;

      setSubscriptions(prev =>
        prev.map(s => s.id === sub.id ? { ...s, status: 'cancelled', updated_at: now } : s)
      );
    } catch (err) {
      setError('Erro ao cancelar: ' + err.message);
    }
  };

  const openDetail = async (sub) => {
    setDetailSub(sub);
    setDetailLoading(true);
    setDetailPayments([]);
    setDetailBillingCycles([]);

    try {
      const [paymentsRes, cyclesRes, attemptsRes] = await Promise.all([
        supabase
          .from('payments')
          .select('*')
          .eq('user_id', sub.user_id)
          .eq('group_id', sub.group_id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('billing_cycles')
          .select('*')
          .eq('subscription_id', sub.id)
          .order('charge_date', { ascending: false })
          .limit(50),
        supabase
          .from('payment_attempts')
          .select('*')
          .eq('user_id', sub.user_id)
          .eq('group_id', sub.group_id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      const allPayments = [...(paymentsRes.data || [])];
      for (const attempt of (attemptsRes.data || [])) {
        if (!allPayments.find(p => p.transaction_code === attempt.gateway_transaction_id)) {
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
      console.error('Detail fetch error:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const openStatDetail = (type) => {
    setStatDetailModal(type);

    if (type === 'received') {
      // Pagamentos do mês atual
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      const data = payments
        .filter(p => {
          const date = new Date(p.created_at);
          return date >= startOfMonth && date <= endOfMonth;
        })
        .map(p => {
          const sub = subscriptions.find(s =>
            s.user_id === p.user_id && s.group_id === p.group_id
          ) || {};
          return {
            userName: sub.user?.name || '—',
            userEmail: sub.user?.email || '—',
            serviceName: sub.service?.name || '—',
            groupName: sub.group?.name || '—',
            amount: Number(p.amount || 0),
            date: p.created_at,
            status: p.status,
            type: 'payment',
          };
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      setStatDetailData(data);
    } else if (type === 'monthly') {
      // Assinaturas ativas
      const data = subscriptions
        .filter(s => s.status === 'active')
        .map(s => {
          const cycle = s.billing_cycle || 'monthly';
          const months = CYCLE_MONTHS[cycle];
          const amount = Number(s.amount || 0);
          let monthlyAmount = amount;
          if (months && months > 0) monthlyAmount = amount / months;
          else if (cycle === 'days' && s.custom_cycle_days) monthlyAmount = amount / s.custom_cycle_days * 30;

          return {
            userName: s.user?.name || '—',
            userEmail: s.user?.email || '—',
            serviceName: s.service?.name || '—',
            groupName: s.group?.name || '—',
            amount: monthlyAmount,
            totalAmount: amount,
            cycle: cycle,
            cycleLabel: cycleLabel(cycle),
            status: s.status,
            nextCharge: s.next_charge_at,
            type: 'subscription',
          };
        })
        .sort((a, b) => b.amount - a.amount);
      setStatDetailData(data);
    } else {
      // Renovações: thisMonth, next7, next30, next60
      const now = new Date();
      const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const sixtyDays = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const active = subscriptions.filter(s => s.status === 'active' && s.next_charge_at);
      let filtered = [];

      if (type === 'thisMonth') {
        filtered = active.filter(s => {
          const nextCharge = new Date(s.next_charge_at);
          return nextCharge <= endOfMonth;
        });
      } else if (type === 'next7') {
        filtered = active.filter(s => {
          const nextCharge = new Date(s.next_charge_at);
          return nextCharge > now && nextCharge <= sevenDays;
        });
      } else if (type === 'next30') {
        filtered = active.filter(s => {
          const nextCharge = new Date(s.next_charge_at);
          return nextCharge > sevenDays && nextCharge <= thirtyDays;
        });
      } else if (type === 'next60') {
        filtered = active.filter(s => {
          const nextCharge = new Date(s.next_charge_at);
          return nextCharge > thirtyDays && nextCharge <= sixtyDays;
        });
      }

      const data = filtered.map(s => {
        const cycle = s.billing_cycle || 'monthly';
        const months = CYCLE_MONTHS[cycle];
        const amount = Number(s.amount || 0);
        let monthlyAmount = amount;
        if (months && months > 0) monthlyAmount = amount / months;
        else if (cycle === 'days' && s.custom_cycle_days) monthlyAmount = amount / s.custom_cycle_days * 30;

        return {
          userName: s.user?.name || '—',
          userEmail: s.user?.email || '—',
          serviceName: s.service?.name || '—',
          groupName: s.group?.name || '—',
          amount: monthlyAmount,
          totalAmount: amount,
          cycle: cycle,
          cycleLabel: cycleLabel(cycle),
          nextCharge: s.next_charge_at,
          status: s.status,
          subId: s.id,
          userId: s.user_id,
          groupId: s.group_id,
          type: 'renewal',
        };
      }).sort((a, b) => new Date(a.nextCharge) - new Date(b.nextCharge));

      setStatDetailData(data);
    }
  };

  const statDetailTitle = () => {
    switch (statDetailModal) {
      case 'received': return 'Receita recebida este mês';
      case 'monthly': return 'Receita mensal equivalente';
      case 'thisMonth': return 'Assinaturas que vencem este mês';
      case 'next7': return 'Assinaturas nos próximos 7 dias';
      case 'next30': return 'Assinaturas nos próximos 30 dias';
      case 'next60': return 'Assinaturas nos próximos 60 dias';
      default: return 'Detalhes';
    }
  };

  const statDetailTotal = () => {
    if (!statDetailData.length) return 0;
    return statDetailData.reduce((sum, d) => sum + d.amount, 0);
  };

  const statusLabel = (status) => ({
    active: 'Ativa',
    inactive: 'Inativa',
    cancelled: 'Cancelada',
    expired: 'Expirada',
    pending: 'Pendente',
  }[status] || status);

  const cycleLabel = (cycle) => ({
    monthly: 'Mensal',
    quarterly: 'Trimestral',
    semiannual: 'Semestral',
    annual: 'Anual',
    days: 'Dias',
  }[cycle] || cycle);

  const cycleMonthsLabel = (sub) => {
    const cycle = sub.billing_cycle || 'monthly';
    const months = CYCLE_MONTHS[cycle];
    if (months) return `(${months} mes${months > 1 ? 'es' : ''})`;
    if (cycle === 'days' && sub.custom_cycle_days) return `(${sub.custom_cycle_days} dias)`;
    return '';
  };

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

  const isRenewalSoon = (sub) => {
    if (!sub.next_charge_at || sub.status !== 'active') return false;
    const now = new Date();
    const nextCharge = new Date(sub.next_charge_at);
    const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return nextCharge > now && nextCharge <= sevenDays;
  };

  const isRenewalThisMonth = (sub) => {
    if (!sub.next_charge_at || sub.status !== 'active') return false;
    const now = new Date();
    const nextCharge = new Date(sub.next_charge_at);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return nextCharge <= endOfMonth && nextCharge > now;
  };

  return (
    <div className="fade-in subscriptions-page">
      <div className="admin-header">
        <div>
          <h1>Assinaturas dos Usuários</h1>
          <p className="page-subtitle">{subscriptions.length} assinaturas cadastradas</p>
        </div>
      </div>

      {/* Cards de estatísticas separados por conceito */}
      <div className="subscriptions-stats">
        <div className="stat-card">
          <Shield size={22} />
          <div>
            <span>{subscriptions.filter(s => s.status === 'active').length}</span>
            <small>Ativas</small>
          </div>
        </div>
        <div className="stat-card highlight clickable" onClick={() => receivedThisMonth > 0 && openStatDetail('received')}>
          <DollarSign size={22} />
          <div>
            <span>R$ {receivedThisMonth.toFixed(2)}</span>
            <small>Receita recebida este mês</small>
            {receivedThisMonth > 0 && <span className="stat-detail-hint">Ver detalhes ›</span>}
          </div>
        </div>
        <div className="stat-card clickable" onClick={() => monthlyEquivalent > 0 && openStatDetail('monthly')}>
          <TrendingUp size={22} />
          <div>
            <span>R$ {monthlyEquivalent.toFixed(2)}</span>
            <small>Receita mensal equivalente</small>
            {monthlyEquivalent > 0 && <span className="stat-detail-hint">Ver detalhes ›</span>}
          </div>
        </div>
        <div className="stat-card">
          <XCircle size={22} />
          <div>
            <span>{subscriptions.filter(s => s.status === 'cancelled' || s.status === 'expired').length}</span>
            <small>Canceladas/Expiradas</small>
          </div>
        </div>
      </div>

      {/* Cards de próximas renovações */}
      <div className="subscriptions-renewals">
        <div className={`renewal-card ${renewalStats.thisMonth.count > 0 ? 'alert' : ''} clickable`} onClick={() => renewalStats.thisMonth.count > 0 && openStatDetail('thisMonth')}>
          <AlertCircle size={18} />
          <div>
            <span className="renewal-count">{renewalStats.thisMonth.count}</span>
            <small>Vence este mês</small>
          </div>
          <span className="renewal-value">R$ {renewalStats.thisMonth.revenue.toFixed(2)}</span>
          {renewalStats.thisMonth.count > 0 && <span className="stat-detail-hint renewal-hint">Ver detalhes ›</span>}
        </div>
        <div className={`renewal-card ${renewalStats.next7Days.count > 0 ? 'critical' : ''} clickable`} onClick={() => renewalStats.next7Days.count > 0 && openStatDetail('next7')}>
          <AlertCircle size={18} />
          <div>
            <span className="renewal-count">{renewalStats.next7Days.count}</span>
            <small>Próximos 7 dias</small>
          </div>
          <span className="renewal-value">R$ {renewalStats.next7Days.revenue.toFixed(2)}</span>
          {renewalStats.next7Days.count > 0 && <span className="stat-detail-hint renewal-hint">Ver detalhes ›</span>}
        </div>
        <div className={`renewal-card ${renewalStats.next30Days.count > 0 ? 'warning' : ''} clickable`} onClick={() => renewalStats.next30Days.count > 0 && openStatDetail('next30')}>
          <Calendar size={18} />
          <div>
            <span className="renewal-count">{renewalStats.next30Days.count}</span>
            <small>Próximos 30 dias</small>
          </div>
          <span className="renewal-value">R$ {renewalStats.next30Days.revenue.toFixed(2)}</span>
          {renewalStats.next30Days.count > 0 && <span className="stat-detail-hint renewal-hint">Ver detalhes ›</span>}
        </div>
        <div className={`renewal-card clickable`} onClick={() => renewalStats.next60Days.count > 0 && openStatDetail('next60')}>
          <Clock size={18} />
          <div>
            <span className="renewal-count">{renewalStats.next60Days.count}</span>
            <small>Próximos 60 dias</small>
          </div>
          <span className="renewal-value">R$ {renewalStats.next60Days.revenue.toFixed(2)}</span>
          {renewalStats.next60Days.count > 0 && <span className="stat-detail-hint renewal-hint">Ver detalhes ›</span>}
        </div>
      </div>

      <div className="subscriptions-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Buscar por usuário, serviço, grupo ou referência..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <div className="filter-box">
            <Filter size={16} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Todos os status</option>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </div>

          <div className="filter-box">
            <Clock size={16} />
            <select value={cycleFilter} onChange={(e) => setCycleFilter(e.target.value)}>
              <option value="all">Todas periodicidades</option>
              {CYCLE_OPTIONS.map(c => (
                <option key={c} value={c}>{cycleLabel(c)}</option>
              ))}
            </select>
          </div>

          <div className="filter-box">
            <Calendar size={16} />
            <select value={renewalFilter} onChange={(e) => setRenewalFilter(e.target.value)}>
              <option value="all">Todas renovações</option>
              <option value="this_month">Vence este mês</option>
              <option value="next_7">Próximos 7 dias</option>
              <option value="next_30">Próximos 30 dias</option>
              <option value="next_60">Próximos 60 dias</option>
            </select>
          </div>
        </div>

        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          <RefreshCw size={16} />
          Atualizar
        </button>
      </div>

      {error && <div className="error-banner">Erro: {error}</div>}

      {loading ? (
        <div className="loading-state">
          <Loader2 size={32} className="spin" />
          <p>Carregando assinaturas...</p>
        </div>
      ) : (
        <div className="admin-card table-responsive">
          <table className="subscriptions-table">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Serviço / Grupo</th>
                <th>Valor</th>
                <th>Periodicidade</th>
                <th>Gateway</th>
                <th>Status</th>
                <th>Próx. Cobrança</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(sub => (
                <tr key={sub.id} className={isRenewalSoon(sub) ? 'renewal-soon' : isRenewalThisMonth(sub) ? 'renewal-this-month' : ''}>
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
                    <div>
                      {sub.discount_amount > 0 && (
                        <span style={{ textDecoration: 'line-through', color: '#9ca3af', fontSize: '0.8em' }}>
                          R$ {Number(sub.original_amount || sub.amount).toFixed(2)}
                        </span>
                      )}
                      <strong>R$ {Number(sub.amount || 0).toFixed(2)}</strong>
                    </div>
                  </td>
                  <td>
                    <div className="cycle-cell">
                      <span className="cycle-label">{cycleLabel(sub.billing_cycle)}</span>
                      <span className="cycle-months">{cycleMonthsLabel(sub)}</span>
                    </div>
                  </td>
                  <td>
                    <div>
                      <span>{sub.gateway || '—'}</span>
                      {sub.card_last4 && (
                        <div style={{ fontSize: '0.75em', color: '#9ca3af' }}>
                          •••• {sub.card_last4} {sub.card_brand || ''}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${sub.status}`}>
                      {statusLabel(sub.status)}
                    </span>
                    {sub.billing_status && sub.billing_status !== sub.status && (
                      <div style={{ fontSize: '0.7em', color: '#9ca3af' }}>
                        billing: {sub.billing_status}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="date-cell">
                      <span className={isRenewalSoon(sub) ? 'renewal-urgent' : isRenewalThisMonth(sub) ? 'renewal-month' : ''}>
                        {sub.next_charge_at ? new Date(sub.next_charge_at).toLocaleDateString('pt-BR') : '—'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="actions-cell">
                      <button
                        className="action-btn"
                        onClick={() => openDetail(sub)}
                        title="Ver detalhes"
                      >
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
              ))}
            </tbody>
          </table>

          {filtered.length === 0 && !loading && (
            <div className="empty-table">
              <p>Nenhuma assinatura encontrada.</p>
            </div>
          )}
        </div>
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
                    <label><DollarSign size={14} /> Valor</label>
                    <span className="detail-value">
                      R$ {Number(detailSub.amount || 0).toFixed(2)}
                      {detailSub.discount_amount > 0 && (
                        <span className="detail-discount">
                          (desconto: -R$ {Number(detailSub.discount_amount).toFixed(2)})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="detail-item">
                    <label><Calendar size={14} /> Ciclo</label>
                    <span>{cycleLabel(detailSub.billing_cycle)}</span>
                    {detailSub.custom_cycle_days && <span className="detail-mono"> ({detailSub.custom_cycle_days} dias)</span>}
                    {detailSub.custom_cycle_months && <span className="detail-mono"> ({detailSub.custom_cycle_months} meses)</span>}
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-item">
                    <label>Status</label>
                    <span className={`status-badge ${detailSub.status}`}>{statusLabel(detailSub.status)}</span>
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
                        {detailPayments.map(p => (
                          <tr key={p.id}>
                            <td>{new Date(p.created_at).toLocaleDateString('pt-BR')}</td>
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
                        {detailBillingCycles.map(bc => (
                          <tr key={bc.id}>
                            <td>{bc.charge_date ? new Date(bc.charge_date).toLocaleDateString('pt-BR') : '—'}</td>
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

      {/* Modal de detalhamento dos cards de receita */}
      {statDetailModal && (
        <div className="sub-viewer-overlay" onClick={() => setStatDetailModal(null)}>
          <div className="sub-viewer-panel stat-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="sub-viewer-header">
              <h3>{statDetailTitle()}</h3>
              <button className="sub-viewer-close" onClick={() => setStatDetailModal(null)}>×</button>
            </div>
            <div className="sub-viewer-body">
              {statDetailData.length === 0 ? (
                <p className="empty-detail">Nenhum registro encontrado.</p>
              ) : (
                <>
                  <div className="stat-detail-summary">
                    <span className="stat-detail-total">{statDetailData.length} registro{statDetailData.length !== 1 ? 's' : ''}</span>
                    <span className="stat-detail-sum">Total: <strong>R$ {statDetailTotal().toFixed(2)}</strong></span>
                  </div>
                  <div className="stat-detail-list">
                    {statDetailData.map((item, i) => (
                      <div
                        key={i}
                        className={`stat-detail-row ${item.type === 'renewal' ? 'clickable-row' : ''}`}
                        onClick={() => {
                          if (item.type === 'renewal' && item.subId) {
                            const sub = subscriptions.find(s => s.id === item.subId);
                            if (sub) {
                              setStatDetailModal(null);
                              openDetail(sub);
                            }
                          }
                        }}
                        title={item.type === 'renewal' ? 'Clique para ver detalhes da assinatura' : undefined}
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
                          {item.totalAmount && item.totalAmount !== item.amount ? (
                            <>
                              <span className="amount-monthly">R$ {item.amount.toFixed(2)}/mês</span>
                              <span className="amount-total">Total: R$ {item.totalAmount.toFixed(2)} ({item.cycleLabel})</span>
                            </>
                          ) : item.type === 'payment' ? (
                            <>
                              <span className="amount-monthly">R$ {item.amount.toFixed(2)}</span>
                              <span className="amount-date">{new Date(item.date).toLocaleDateString('pt-BR')}</span>
                            </>
                          ) : (
                            <>
                              <span className="amount-monthly">R$ {item.amount.toFixed(2)}/mês</span>
                              {item.cycleLabel && <span className="amount-total">{item.cycleLabel}</span>}
                            </>
                          )}
                        </div>
                        {item.nextCharge && (
                          <div className="stat-detail-next">
                            <Calendar size={12} />
                            <span>Vence: {new Date(item.nextCharge).toLocaleDateString('pt-BR')}</span>
                          </div>
                        )}
                        {item.type === 'renewal' && (
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
          <div className="sub-viewer-panel" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
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
                    <span>{selectedPayment.payment_type === 'entrance' ? 'Taxa de Adesão' : selectedPayment.payment_type === 'subscription' ? 'Assinatura' : selectedPayment.payment_type || '—'}</span>
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-item">
                    <label><DollarSign size={14} /> Valor</label>
                    <span className="detail-value">R$ {Number(selectedPayment.amount || 0).toFixed(2)}</span>
                  </div>
                  <div className="detail-item">
                    <label>Método</label>
                    <span>{selectedPayment.method === 'pix' ? 'PIX' : selectedPayment.method === 'credit_card' ? 'Cartão de Crédito' : selectedPayment.method || '—'}</span>
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
                    <span className="detail-mono" style={{ wordBreak: 'break-all' }}>{selectedPayment.transaction_code || '—'}</span>
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
