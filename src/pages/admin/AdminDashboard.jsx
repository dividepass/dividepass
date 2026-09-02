import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import {
  Users,
  CreditCard,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Activity,
  DollarSign,
  Shield,
} from 'lucide-react';
import './AdminDashboard.css';

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value || 0);
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'agora mesmo';
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `há ${Math.floor(diff / 86400)}d`;
  return date.toLocaleDateString('pt-BR');
}

function getActivityColor(action) {
  if (!action) return 'gray';
  const a = action.toLowerCase();
  if (a.includes('create') || a.includes('register') || a.includes('signup')) return 'green';
  if (a.includes('payment') || a.includes('pay')) return 'blue';
  if (a.includes('cancel') || a.includes('delete') || a.includes('remove')) return 'red';
  if (a.includes('update') || a.includes('edit')) return 'orange';
  return 'gray';
}

function getActivityIcon(action) {
  if (!action) return <Activity size={14} />;
  const a = action.toLowerCase();
  if (a.includes('create') || a.includes('register') || a.includes('signup')) return <Users size={14} />;
  if (a.includes('payment') || a.includes('pay')) return <CreditCard size={14} />;
  if (a.includes('cancel') || a.includes('delete')) return <AlertTriangle size={14} />;
  return <Activity size={14} />;
}

function isSuccessfulPaymentAttemptStatus(status) {
  if (!status) return false;
  const s = String(status).toLowerCase();
  return (
    s === 'approved' ||
    s === 'paid' ||
    s === 'authorized' ||
    s === 'captured' ||
    s === 'completed' ||
    s === 'done' ||
    s === 'success' ||
    s === 'succeeded' ||
    s === 'settled' ||
    s === 'confirmed' ||
    s.startsWith('polled_succeeded') ||
    s.startsWith('webhook_approved')
  );
}

function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    totalUsers: 0,
    activeSubscriptions: 0,
    monthlyRevenue: 0,
    saasCosts: 0,
    expectedProfit: 0,
    openTickets: 0,
  });
  const [activities, setActivities] = useState([]);
  const [stats, setStats] = useState({
    usersByRole: {},
    groupsByStatus: {},
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchDashboard() {
      setLoading(true);

      try {
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
        const last24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();

        const [
          usersRes,
          subsRes,
          revenueRes,
          attemptsRes,
          costsRes,
          ticketsRes,
          activityLogsRes,
          platformEventsRes,
          rolesRes,
          groupsRes,
        ] = await Promise.all([
          supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'user').maybeSingle().then(r => ({ ...r, count: r.count || 0 })),
          supabase.from('user_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active').maybeSingle().then(r => ({ ...r, count: r.count || 0 })),
          supabase.from('payments').select('amount, transaction_code, created_at').eq('status', 'paid').gte('created_at', firstDayOfMonth).lte('created_at', lastDayOfMonth),
          supabase.from('payment_attempts').select('amount, gateway_transaction_id, external_reference, status, created_at').gte('created_at', firstDayOfMonth).lte('created_at', lastDayOfMonth),
          supabase.from('master_accounts').select('cost').eq('status', 'active'),
          supabase.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']).maybeSingle().then(r => ({ ...r, count: r.count || 0 })),
          supabase.from('activity_logs').select('id, action, description, created_at').gte('created_at', last24Hours).order('created_at', { ascending: false }).limit(10),
          supabase.from('platform_events').select('id, event_type, title, message, created_at').gte('created_at', last24Hours).order('created_at', { ascending: false }).limit(10),
          supabase.from('users').select('role'),
          supabase.from('groups').select('status'),
        ]);

        if (cancelled) return;

        const totalUsers = usersRes.count || 0;
        const activeSubscriptions = subsRes.count || 0;

        let monthlyRevenue = 0;
        const paidPayments = (revenueRes.data || []).map((p) => ({
          key: p.transaction_code || null,
          amount: Number(p.amount) || 0,
        }));
        const seenKeys = new Set(paidPayments.map((p) => p.key).filter(Boolean));
        monthlyRevenue = paidPayments.reduce((sum, p) => sum + p.amount, 0);

        const fallbackAttempts = (attemptsRes.data || [])
          .filter((attempt) => isSuccessfulPaymentAttemptStatus(attempt.status))
          .filter((attempt) => {
            const attemptKey = attempt.gateway_transaction_id || attempt.external_reference || null;
            return attemptKey ? !seenKeys.has(attemptKey) : true;
          });

        monthlyRevenue += fallbackAttempts.reduce((sum, attempt) => sum + (Number(attempt.amount) || 0), 0);

        let saasCosts = 0;
        if (costsRes.data && costsRes.data.length > 0) {
          saasCosts = costsRes.data.reduce((sum, c) => sum + (Number(c.cost) || 0), 0);
        }

        const expectedProfit = monthlyRevenue - saasCosts;
        const openTickets = ticketsRes.count || 0;

        setMetrics({
          totalUsers,
          activeSubscriptions,
          monthlyRevenue,
          saasCosts,
          expectedProfit,
          openTickets,
        });

        const normalizedLogs = (activityLogsRes.data || []).map((log) => ({
          id: `log-${log.id}`,
          action: log.action,
          description: log.description || log.action,
          created_at: log.created_at,
        }));
        const normalizedEvents = (platformEventsRes.data || []).map((event) => ({
          id: `evt-${event.id}`,
          action: event.event_type,
          description: event.message || event.title || event.event_type,
          created_at: event.created_at,
        }));

        const recentActivities = [...normalizedEvents, ...normalizedLogs]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 10);

        setActivities(recentActivities);

        const rolesMap = {};
        (rolesRes.data || []).forEach((u) => {
          rolesMap[u.role] = (rolesMap[u.role] || 0) + 1;
        });

        const groupsMap = {};
        (groupsRes.data || []).forEach((g) => {
          groupsMap[g.status] = (groupsMap[g.status] || 0) + 1;
        });

        setStats({ usersByRole: rolesMap, groupsByStatus: groupsMap });
      } catch (err) {
        console.error('AdminDashboard fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchDashboard();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="fade-in">
        <div className="admin-header">
          <h1>Dashboard Geral</h1>
        </div>
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>Carregando dados...</span>
        </div>
      </div>
    );
  }

  const metricCards = [
    {
      icon: <Users size={20} />,
      iconClass: 'users',
      label: 'Total de Usuarios',
      value: metrics.totalUsers.toLocaleString('pt-BR'),
      sub: 'contas cadastradas',
    },
    {
      icon: <CreditCard size={20} />,
      iconClass: 'subscriptions',
      label: 'Assinaturas Ativas',
      value: metrics.activeSubscriptions.toLocaleString('pt-BR'),
      sub: 'assinaturas ativas',
    },
    {
      icon: <DollarSign size={20} />,
      iconClass: 'revenue',
      label: 'Receita Mensal',
      value: formatCurrency(metrics.monthlyRevenue),
      sub: 'pagamentos confirmados',
    },
    {
      icon: <TrendingDown size={20} />,
      iconClass: 'costs',
      label: 'Custos SaaS',
      value: formatCurrency(metrics.saasCosts),
      sub: 'contas ativas',
    },
    {
      icon: <TrendingUp size={20} />,
      iconClass: 'profit',
      label: 'Lucro Previsto',
      value: formatCurrency(metrics.expectedProfit),
      className: metrics.expectedProfit >= 0 ? 'positive' : 'negative',
      sub: 'receita - custos',
    },
    {
      icon: <AlertTriangle size={20} />,
      iconClass: 'tickets',
      label: 'Tickets Abertos',
      value: metrics.openTickets.toLocaleString('pt-BR'),
      sub: 'abertos ou em andamento',
    },
  ];

  return (
    <div className="fade-in admin-dashboard">
      <div className="admin-header">
        <h1>Dashboard Geral</h1>
        <p>Visao geral do sistema em tempo real</p>
      </div>

      <div className="metrics-grid">
        {metricCards.map((card) => (
          <div className="metric-card" key={card.label}>
            <div className={`metric-icon ${card.iconClass}`}>{card.icon}</div>
            <div className="metric-info">
              <span className="metric-label">{card.label}</span>
              <span className={`metric-value ${card.className || ''}`}>{card.value}</span>
              <span className="metric-sub">{card.sub}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="activity-section">
          <div className="activity-panel">
            <div className="panel-header">
             <h2>Atividade Recente (24h)</h2>
             {activities.length > 0 && <span className="badge">{activities.length}</span>}
           </div>
          {activities.length === 0 ? (
            <div className="empty-state">
              <Activity size={32} />
              <p>Nenhuma atividade registrada</p>
            </div>
          ) : (
            <ul className="activity-list">
              {activities.map((act) => (
                <li className="activity-item" key={act.id}>
                  <div className={`activity-dot ${getActivityColor(act.action)}`}>
                    {getActivityIcon(act.action)}
                  </div>
                  <div className="activity-content">
                    <div className="activity-desc">
                      {act.description || act.action || 'Atividade'}
                    </div>
                    <div className="activity-time">
                      {formatRelativeTime(act.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="stats-panel">
          <div className="panel-header">
            <h2>Resumo Rapido</h2>
          </div>
          <div className="stats-grid">
            <div className="stat-row">
              <span className="stat-label">
                <Shield size={16} /> Administradores
              </span>
              <span className="stat-value">{stats.usersByRole.admin || 0}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">
                <Users size={16} /> Usuarios
              </span>
              <span className="stat-value">{stats.usersByRole.user || 0}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">
                <Activity size={16} /> Grupos Abertos
              </span>
              <span className="stat-value">{stats.groupsByStatus.open || 0}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">
                <CreditCard size={16} /> Grupos Formando
              </span>
              <span className="stat-value">{stats.groupsByStatus.forming || 0}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">
                <AlertTriangle size={16} /> Grupos Fechados
              </span>
              <span className="stat-value">{stats.groupsByStatus.closed || 0}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
