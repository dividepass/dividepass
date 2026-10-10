import { useState, useMemo, useEffect } from 'react';
import { Search, TrendingUp, Users, DollarSign, Calendar, RefreshCw, Loader2, Filter, ChevronDown, Eye, AlertCircle, Tag } from 'lucide-react';
import { supabase } from '../../lib/supabase';
// fmtBRL e getCycleMonths inlined para evitar TDZ no bundler
const fmtBRL = (value) => {
  if (value == null || isNaN(value)) return 'R$ 0,00';
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
};
const getCycleMonths = (billingCycle, customMonths = null) => {
  switch (billingCycle) {
    case 'monthly':    return 1;
    case 'quarterly':  return 3;
    case 'semiannual': return 6;
    case 'annual':     return 12;
    case 'custom':     return customMonths || 1;
    default:           return 1;
  }
};
import './SavingsStats.css';

const CYCLE_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

function SavingsStats() {
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [services, setServices] = useState([]);
  const [users, setUsers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');

  const [searchUser, setSearchUser] = useState('');
  const [searchService, setSearchService] = useState('');
  const [searchPlan, setSearchPlan] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('paid');

  const [selectedPayment, setSelectedPayment] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      // Buscar pagamentos de assinatura com plano
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select(`
          *,
          user:user_id(id, name, email),
          group:group_id(id, name, service_id),
          subscription:subscription_id(billing_cycle)
        `)
        .eq('payment_type', 'subscription')
        .order('created_at', { ascending: false })
        .limit(500);

      if (paymentsError) throw paymentsError;

      // Buscar serviços
      const { data: servicesData } = await supabase
        .from('streaming_services')
        .select('id, name, full_name')
        .eq('status', 'active');

      // Buscar usuários
      const { data: usersData } = await supabase
        .from('users')
        .select('id, name, email');

      // Buscar planos
      const { data: plansData } = await supabase
        .from('service_plans')
        .select('*')
        .eq('is_active', true)
        .order('service_id')
        .order('official_price');

      setPayments(paymentsData || []);
      setServices(servicesData || []);
      setUsers(usersData || []);
      setPlans(plansData || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Criar mapas para lookup rápido
  const servicesMap = useMemo(() => {
    const map = {};
    services.forEach(s => { map[s.id] = s; });
    return map;
  }, [services]);

  const usersMap = useMemo(() => {
    const map = {};
    users.forEach(u => { map[u.id] = u; });
    return map;
  }, [users]);

  const plansMap = useMemo(() => {
    const map = {};
    plans.forEach(p => { map[p.id] = p; });
    return map;
  }, [plans]);

  // Filtrar pagamentos
  const filteredPayments = useMemo(() => {
    let result = payments;

    // Filtro de status
    if (statusFilter !== 'all') {
      result = result.filter(p => p.status === statusFilter);
    }

    // Filtro de data
    if (dateFrom) {
      const from = new Date(dateFrom);
      result = result.filter(p => new Date(p.created_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59);
      result = result.filter(p => new Date(p.created_at) <= to);
    }

    // Filtro de usuário
    if (searchUser.trim()) {
      const q = searchUser.toLowerCase();
      result = result.filter(p => {
        const user = usersMap[p.user_id];
        return user?.name?.toLowerCase().includes(q) || user?.email?.toLowerCase().includes(q);
      });
    }

    // Filtro de serviço
    if (searchService.trim()) {
      const q = searchService.toLowerCase();
      result = result.filter(p => {
        const service = servicesMap[p.group?.service_id];
        return service?.name?.toLowerCase().includes(q) || service?.full_name?.toLowerCase().includes(q);
      });
    }

    // Filtro de plano
    if (searchPlan.trim()) {
      const q = searchPlan.toLowerCase();
      result = result.filter(p => {
        const planId = p.group?.plan_id;
        const plan = plansMap[planId];
        return plan?.name?.toLowerCase().includes(q) || plan?.plan_key?.toLowerCase().includes(q);
      });
    }

    return result;
  }, [payments, statusFilter, dateFrom, dateTo, searchUser, searchService, searchPlan, usersMap, servicesMap, plansMap]);

  // Estatísticas
  const stats = useMemo(() => {
    const paidPayments = filteredPayments.filter(p => p.status === 'paid');

    const totalSaved = paidPayments.reduce((sum, p) => {
      const official = Number(p.official_price) || 0;
      const paid = Number(p.paid_amount) || Number(p.amount) || 0;
      if (!official) return sum;
      const cycleMonths = getCycleMonths(p.subscription?.billing_cycle, p.custom_months);
      const totalOfficial = official * cycleMonths;
      return sum + Math.max(0, totalOfficial - paid);
    }, 0);

    const uniqueUsers = new Set(paidPayments.map(p => p.user_id)).size;
    const uniqueServices = new Set(paidPayments.map(p => p.group?.service_id).filter(Boolean)).size;
    const avgPerSubscriber = uniqueUsers > 0 ? totalSaved / uniqueUsers : 0;

    // Por serviço
    const byService = {};
    paidPayments.forEach(p => {
      const serviceId = p.group?.service_id;
      const service = servicesMap[serviceId];
      if (!serviceId) return;

      const official = Number(p.official_price) || 0;
      const paid = Number(p.paid_amount) || Number(p.amount) || 0;
      if (!official) return;
      const cycleMonths = getCycleMonths(p.subscription?.billing_cycle, p.custom_months);
      const totalOfficial = official * cycleMonths;
      const savings = Math.max(0, totalOfficial - paid);

      if (!byService[serviceId]) {
        byService[serviceId] = { service, totalSaved: 0, count: 0 };
      }
      byService[serviceId].totalSaved += savings;
      byService[serviceId].count++;
    });

    // Por usuário
    const byUser = {};
    paidPayments.forEach(p => {
      const userId = p.user_id;
      const user = usersMap[userId];
      if (!userId) return;

      const official = Number(p.official_price) || 0;
      const paid = Number(p.paid_amount) || Number(p.amount) || 0;
      if (!official) return;
      const cycleMonths = getCycleMonths(p.subscription?.billing_cycle, p.custom_months);
      const totalOfficial = official * cycleMonths;
      const savings = Math.max(0, totalOfficial - paid);

      if (!byUser[userId]) {
        byUser[userId] = { user, totalSaved: 0, count: 0 };
      }
      byUser[userId].totalSaved += savings;
      byUser[userId].count++;
    });

    return {
      total: totalSaved,
      users: uniqueUsers,
      avgPerSubscriber,
      services: uniqueServices,
      payments: paidPayments.length,
      byService: Object.values(byService).sort((a, b) => b.totalSaved - a.totalSaved),
      byUser: Object.values(byUser).sort((a, b) => b.totalSaved - a.totalSaved),
    };
  }, [filteredPayments, servicesMap, usersMap]);

  const fmtDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pt-BR');
  };

  const getPaymentStatusBadge = (status) => {
    const map = {
      paid: { label: 'Pago', class: 'badge-success' },
      pending: { label: 'Pendente', class: 'badge-warning' },
      refunded: { label: 'Estornado', class: 'badge-danger' },
      cancelled: { label: 'Cancelado', class: 'badge-danger' },
      test: { label: 'Teste', class: 'badge-info' },
    };
    const info = map[status] || { label: status, class: 'badge-info' };
    return <span className={`badge ${info.class}`}>{info.label}</span>;
  };

  return (
    <div className="savings-stats">
      <div className="admin-page-header">
        <div>
          <h1><TrendingUp size={24} /> Estatísticas de Economia</h1>
          <p>Audite os dados de economia dos assinantes</p>
        </div>
        <button className="btn btn-outline" onClick={fetchData} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="admin-error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Cards de estatísticas */}
      <div className="savings-stats-cards">
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'rgba(52, 211, 153, 0.15)', color: '#34d399' }}>
            <DollarSign size={20} />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">{fmtBRL(stats.total)}</span>
            <span className="stat-card-label">Total economizado (filtro)</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'rgba(79, 70, 229, 0.15)', color: '#818cf8' }}>
            <Users size={20} />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">{stats.users}</span>
            <span className="stat-card-label">Usuários únicos</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
            <Calendar size={20} />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">{stats.payments}</span>
            <span className="stat-card-label">Pagamentos (filtro)</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
            <TrendingUp size={20} />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">{fmtBRL(stats.avgPerSubscriber)}</span>
            <span className="stat-card-label">Média por assinante</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'rgba(14, 165, 233, 0.15)', color: '#0ea5e9' }}>
            <TrendingUp size={20} />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">{stats.services}</span>
            <span className="stat-card-label">Serviços distintos</span>
          </div>
        </div>
      </div>

      {/* Preços oficiais por plano (referência) */}
      {plans.length > 0 && (
        <div className="savings-section">
          <h2>Preços Oficiais por Plano</h2>
          <p className="savings-section-desc">
            Fonte de verdade para cálculo de economia. Atualize quando os serviços mudarem seus preços.
          </p>
          <div className="savings-plans-grid">
            {plans.reduce((groups, plan) => {
              const service = servicesMap[plan.service_id];
              if (!service) return groups;
              const existing = groups.find(g => g.serviceId === plan.service_id);
              if (existing) {
                existing.plans.push(plan);
              } else {
                groups.push({
                  serviceId: plan.service_id,
                  serviceName: service.full_name || service.name,
                  plans: [plan]
                });
              }
              return groups;
            }, []).map(group => (
              <div key={group.serviceId} className="savings-plan-group">
                <div className="savings-plan-group-name">{group.serviceName}</div>
                {group.plans.map(plan => (
                  <div key={plan.id} className="savings-plan-row">
                    <span className="savings-plan-name">{plan.name}</span>
                    <span className="savings-plan-price">{fmtBRL(plan.official_price)}<small>/{plan.billing_cycle === 'monthly' ? 'mês' : plan.billing_cycle}</small></span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Economia por serviço */}
      {stats.byService.length > 0 && (
        <div className="savings-section">
          <h2>Economia por Serviço</h2>
          <div className="savings-service-grid">
            {stats.byService.map(item => (
              <div key={item.service?.id} className="savings-service-card">
                <div className="savings-service-info">
                  <span className="savings-service-name">{item.service?.full_name || item.service?.name || 'Desconhecido'}</span>
                  <span className="savings-service-count">{item.count} pagamento{item.count > 1 ? 's' : ''}</span>
                </div>
                <span className="savings-service-value">{fmtBRL(item.totalSaved)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="savings-filters">
        <button className="btn btn-outline btn-sm" onClick={() => setShowFilters(!showFilters)}>
          <Filter size={14} />
          Filtros
          <ChevronDown size={14} className={showFilters ? 'rotate-180' : ''} />
        </button>

        {showFilters && (
          <div className="savings-filters-panel">
            <div className="savings-filter-row">
              <div className="filter-field">
                <label>Status</label>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="all">Todos</option>
                  <option value="paid">Pagos</option>
                  <option value="pending">Pendentes</option>
                  <option value="refunded">Estornados</option>
                  <option value="cancelled">Cancelados</option>
                  <option value="test">Teste</option>
                </select>
              </div>
              <div className="filter-field">
                <label>De</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div className="filter-field">
                <label>Até</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
              <div className="filter-field filter-field-wide">
                <label>Usuário</label>
                <div className="filter-search">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="Buscar por nome ou email..."
                    value={searchUser}
                    onChange={e => setSearchUser(e.target.value)}
                  />
                </div>
              </div>
              <div className="filter-field filter-field-wide">
                <label>Serviço</label>
                <div className="filter-search">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="Buscar por serviço..."
                    value={searchService}
                    onChange={e => setSearchService(e.target.value)}
                  />
                </div>
              </div>
              <div className="filter-field filter-field-wide">
                <label>Plano</label>
                <div className="filter-search">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="Buscar por plano..."
                    value={searchPlan}
                    onChange={e => setSearchPlan(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabela de pagamentos */}
      <div className="savings-table-wrap">
        {loading ? (
          <div className="admin-loading">
            <Loader2 size={24} className="spin" />
            <span>Carregando...</span>
          </div>
        ) : filteredPayments.length === 0 ? (
          <div className="admin-empty">
            <TrendingUp size={32} />
            <p>Nenhum pagamento encontrado com os filtros atuais.</p>
          </div>
        ) : (
          <table className="savings-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Usuário</th>
                <th>Serviço / Plano</th>
                <th>Valor Oficial</th>
                <th>Valor Pago</th>
                <th>Economia</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredPayments.slice(0, 100).map(payment => {
                const user = usersMap[payment.user_id];
                const service = servicesMap[payment.group?.service_id];
                const plan = plansMap[payment.group?.plan_id];
                const official = Number(payment.official_price) || 0;
                const paid = Number(payment.paid_amount) || Number(payment.amount) || 0;
                const cycleMonths = getCycleMonths(payment.subscription?.billing_cycle, payment.custom_months);
                const totalOfficial = official * cycleMonths;
                const savings = official > 0 ? Math.max(0, totalOfficial - paid) : 0;

                const serviceName = service?.full_name || service?.name || '-';
                const planBadge = plan ? (
                  <span className="plan-badge">
                    <Tag size={10} />
                    {plan.name}
                  </span>
                ) : null;

                if (!official) return (
                  <tr key={payment.id}>
                    <td>{fmtDate(payment.created_at)}</td>
                    <td>
                      <div className="savings-user-cell">
                        <span className="savings-user-name">{user?.name || payment.user_id}</span>
                        <span className="savings-user-email">{user?.email}</span>
                      </div>
                    </td>
                    <td>
                      <div>{serviceName}</div>
                      {planBadge}
                    </td>
                    <td className="text-muted">-</td>
                    <td>{fmtBRL(paid)}</td>
                    <td className="text-muted">-</td>
                    <td>{getPaymentStatusBadge(payment.status)}</td>
                    <td>
                      <button
                        className="btn btn-icon btn-ghost"
                        onClick={() => setSelectedPayment(payment)}
                        title="Ver detalhes"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                );

                return (
                  <tr key={payment.id} className={savings <= 0 ? 'row-no-savings' : ''}>
                    <td>{fmtDate(payment.created_at)}</td>
                    <td>
                      <div className="savings-user-cell">
                        <span className="savings-user-name">{user?.name || payment.user_id}</span>
                        <span className="savings-user-email">{user?.email}</span>
                      </div>
                    </td>
                    <td>
                      <div>{serviceName}</div>
                      {planBadge}
                    </td>
                    <td>
                      <div>{fmtBRL(official)}<small>/mês</small></div>
                      <div className="text-muted" style={{ fontSize: '0.65rem' }}>
                        {fmtBRL(totalOfficial)} total
                      </div>
                    </td>
                    <td>{fmtBRL(paid)}</td>
                    <td className={savings > 0 ? 'text-success' : 'text-muted'}>
                      {savings > 0 ? fmtBRL(savings) : '-'}
                    </td>
                    <td>{getPaymentStatusBadge(payment.status)}</td>
                    <td>
                      <button
                        className="btn btn-icon btn-ghost"
                        onClick={() => setSelectedPayment(payment)}
                        title="Ver detalhes"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {filteredPayments.length > 100 && (
          <p className="savings-table-info">
            Mostrando 100 de {filteredPayments.length} pagamentos. Use filtros para refinar.
          </p>
        )}
      </div>

      {/* Modal de detalhes */}
      {selectedPayment && (
        <div className="modal-overlay" onClick={() => setSelectedPayment(null)}>
          <div className="modal-content savings-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Detalhes do Pagamento</h3>
              <button className="btn btn-icon btn-ghost" onClick={() => setSelectedPayment(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="savings-detail-grid">
                <div className="detail-item">
                  <span className="detail-label">ID do pagamento</span>
                  <span className="detail-value">{selectedPayment.id}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Data</span>
                  <span className="detail-value">{fmtDate(selectedPayment.created_at)}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Usuário</span>
                  <span className="detail-value">
                    {usersMap[selectedPayment.user_id]?.name || selectedPayment.user_id}
                    <br />
                    <small>{usersMap[selectedPayment.user_id]?.email}</small>
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Serviço</span>
                  <span className="detail-value">
                    {servicesMap[selectedPayment.group?.service_id]?.full_name ||
                     servicesMap[selectedPayment.group?.service_id]?.name || '-'}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Gateway</span>
                  <span className="detail-value">{selectedPayment.gateway || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Transaction ID</span>
                  <span className="detail-value">{selectedPayment.transaction_code || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Preço oficial (mensal)</span>
                  <span className="detail-value text-muted">
                    {Number(selectedPayment.official_price) > 0
                      ? fmtBRL(selectedPayment.official_price)
                      : 'Não registrado'}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Ciclo de cobrança</span>
                  <span className="detail-value">
                    {selectedPayment.subscription?.billing_cycle || '-'} ({getCycleMonths(selectedPayment.subscription?.billing_cycle, selectedPayment.custom_months)} meses)
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Preço oficial total (período)</span>
                  <span className="detail-value text-muted">
                    {Number(selectedPayment.official_price) > 0
                      ? fmtBRL(Number(selectedPayment.official_price) * getCycleMonths(selectedPayment.subscription?.billing_cycle, selectedPayment.custom_months))
                      : '-'}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Valor pago</span>
                  <span className="detail-value">{fmtBRL(selectedPayment.paid_amount || selectedPayment.amount)}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Economia calculada</span>
                  <span className="detail-value text-success">
                    {Number(selectedPayment.official_price) > 0
                      ? fmtBRL(Math.max(0, Number(selectedPayment.official_price) * getCycleMonths(selectedPayment.subscription?.billing_cycle, selectedPayment.custom_months) - Number(selectedPayment.paid_amount || selectedPayment.amount)))
                      : 'N/A'}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Status</span>
                  <span className="detail-value">{getPaymentStatusBadge(selectedPayment.status)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SavingsStats;
