import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  CreditCard,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Activity,
  DollarSign,
  ArrowRight,
  CheckCircle2,
  Ticket,
  Wallet,
  Target,
  UserPlus,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './AdminDashboard.css';

const CATEGORY_LABELS = {
  general: 'Geral',
  billing: 'Financeiro',
  credential: 'Credenciais',
  technical: 'Técnico',
  other: 'Outro',
};

const PRIORITY_LABELS = {
  normal: 'Normal',
  high: 'Alta',
  critical: 'Crítica',
};

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
  const navigate = useNavigate();
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
  const [openTickets, setOpenTickets] = useState([]);
  const [criticalTickets, setCriticalTickets] = useState([]);
  const [pendingGroups, setPendingGroups] = useState([]);
  const [approvingGroup, setApprovingGroup] = useState(null);
  const [signups, setSignups] = useState({
    day: 0,
    week: 0,
    month: 0,
    subsDay: 0,
    subsWeek: 0,
    subsMonth: 0,
    converted: 0,
  });
  const [pending, setPending] = useState({
    failedPayments: 0,
    onboardingPending: 0,
    couponsExpiring: 0,
    groupsToApprove: 0,
    waitlist: 0,
  });
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
        const in7Days = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)).toISOString();
        // Início do dia e da semana (segunda) para os cards de registros.
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
        startOfWeek.setHours(0, 0, 0, 0);
        const weekStartIso = startOfWeek.toISOString();

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
          openTicketsRes,
          criticalTicketsRes,
          failedPaymentsRes,
          onboardingPendingRes,
          couponsExpiringRes,
          groupsToApproveRes,
          waitlistRes,
          pendingGroupsRes,
          newUsersRes,
          newSubsRes,
        ] = await Promise.all([
          supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'user').maybeSingle().then(r => ({ ...r, count: r.count || 0 })),
          supabase.from('user_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active').maybeSingle().then(r => ({ ...r, count: r.count || 0 })),
          supabase.from('payments').select('amount, transaction_code, created_at').eq('status', 'paid').gte('created_at', firstDayOfMonth).lte('created_at', lastDayOfMonth),
          supabase.from('payment_attempts').select('amount, gateway_transaction_id, external_reference, status, created_at').gte('created_at', firstDayOfMonth).lte('created_at', lastDayOfMonth),
          supabase.from('master_accounts').select('cost').eq('status', 'active'),
          supabase.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'answered']).eq('archived', false).maybeSingle().then(r => ({ ...r, count: r.count || 0 })),
          supabase.from('activity_logs').select('id, action, description, created_at').gte('created_at', last24Hours).order('created_at', { ascending: false }).limit(10),
          supabase.from('platform_events').select('id, event_type, title, message, created_at').gte('created_at', last24Hours).order('created_at', { ascending: false }).limit(10),
          supabase.from('users').select('role'),
          supabase.from('groups').select('status'),
          supabase.from('support_tickets').select('id, subject, category, priority, status, created_at, user:users(id, name, email)').eq('archived', false).in('status', ['open', 'answered']).order('created_at', { ascending: true }).limit(50),
          supabase.from('support_tickets').select('id, subject, priority, created_at, user:users(id, name, email)').eq('archived', false).eq('priority', 'critical').in('status', ['open', 'answered']).order('created_at', { ascending: true }),
          // Pendências da fila do operador: contagens diretas, sem travar linhas.
          supabase.from('payment_attempts').select('id', { count: 'exact', head: true })
            .in('status', ['polled_failed', 'webhook_rejected'])
            .gte('created_at', firstDayOfMonth).lte('created_at', lastDayOfMonth)
            .then(r => ({ ...r, count: r.count || 0 })),
          supabase.from('users').select('id', { count: 'exact', head: true })
            .not('onboarding_started_at', 'is', null).is('onboarding_completed_at', null)
            .then(r => ({ ...r, count: r.count || 0 })),
          supabase.from('coupons').select('id', { count: 'exact', head: true })
            .eq('active', true).not('expires_at', 'is', null).lte('expires_at', in7Days)
            .then(r => ({ ...r, count: r.count || 0 })),
          // Grupos criados por usuário que ainda não foram aprovados.
          supabase.from('groups').select('id', { count: 'exact', head: true })
            .eq('approval_status', 'pending')
            .then(r => ({ ...r, count: r.count || 0 })),
          // Lista de espera: gente que quer entrar em um grupo.
          supabase.from('group_interest').select('id', { count: 'exact', head: true })
            .then(r => ({ ...r, count: r.count || 0 })),
          // Grupos pendentes de aprovação (os mais novos primeiro) — a fila
          // do operador começa por eles.
          supabase.from('groups').select(`
            id, name, created_at, price_per_slot, status,
            owner:owner_id (id, name, email),
            service:service_id (id, name)
          `).eq('approval_status', 'pending')
            .order('created_at', { ascending: false })
            .limit(8),
          // Registros do mês: quem criou conta e quem virou assinante.
          supabase.from('users').select('id, created_at')
            .eq('role', 'user').gte('created_at', firstDayOfMonth),
          supabase.from('user_subscriptions').select('user_id, created_at')
            .gte('created_at', firstDayOfMonth),
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
        setOpenTickets(openTicketsRes.data || []);
        setCriticalTickets(criticalTicketsRes.data || []);
        setPending({
          failedPayments: failedPaymentsRes.count || 0,
          onboardingPending: onboardingPendingRes.count || 0,
          couponsExpiring: couponsExpiringRes.count || 0,
          groupsToApprove: groupsToApproveRes.count || 0,
          waitlist: waitlistRes.count || 0,
        });

        // Grupos pendentes: entram no topo da fila do operador.
        setPendingGroups(pendingGroupsRes.data || []);

        // Registros do dia/semana/mês e quem virou assinante.
        const newUsers = newUsersRes.data || [];
        const newSubs = newSubsRes.data || [];
        const subUserIds = new Set(newSubs.map((s) => s.user_id));
        const inWindow = (iso, from) => iso && new Date(iso) >= from;
        const dayFrom = new Date(startOfDay);
        const weekFrom = new Date(weekStartIso);
        setSignups({
          day: newUsers.filter((u) => inWindow(u.created_at, dayFrom)).length,
          week: newUsers.filter((u) => inWindow(u.created_at, weekFrom)).length,
          month: newUsers.length,
          subsDay: newSubs.filter((s) => inWindow(s.created_at, dayFrom)).length,
          subsWeek: newSubs.filter((s) => inWindow(s.created_at, weekFrom)).length,
          subsMonth: newSubs.length,
          // Quem se registrou no mês E já tem assinatura.
          converted: newUsers.filter((u) => subUserIds.has(u.id)).length,
        });
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
          <h1>Painel</h1>
        </div>
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>Carregando dados...</span>
        </div>
      </div>
    );
  }

  /**
   * FILA DO OPERADOR
   * A tela abre aqui, não nos números. O operador precisa saber primeiro o
   * que está esperando ele — os números ficam logo abaixo, como contexto.
   * A ordem é por severidade; item sem pendência não aparece.
   */
  const approveGroup = async (groupId) => {
    setApprovingGroup(groupId);
    try {
      const { error } = await supabase
        .from('groups')
        .update({ approval_status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', groupId);
      if (error) throw error;

      const group = pendingGroups.find((g) => g.id === groupId);
      const adminUser = (await supabase.auth.getUser()).data.user?.id;
      const { error: eventError } = await supabase.from('platform_events').insert({
        event_type: 'group_approved',
        title: 'Grupo aprovado',
        message: `O grupo "${group?.name || ''}" foi aprovado e já pode receber pagamentos.`,
        metadata: JSON.stringify({ group_id: groupId }),
        created_by: adminUser,
      });
      if (eventError) console.error('AdminDashboard approve event error:', eventError);

      // O dono do grupo é avisado dentro do app.
      if (group?.owner?.id) {
        const { error: notifError } = await supabase.from('notifications').insert({
          user_id: group.owner.id,
          title: 'Grupo aprovado!',
          message: `Seu grupo "${group.name}" foi aprovado e já está visível no catálogo.`,
          event_type: 'group_approved',
          metadata: JSON.stringify({ group_id: groupId }),
        });
        if (notifError) console.error('AdminDashboard approve notification error:', notifError);
      }

      setPendingGroups((prev) => prev.filter((g) => g.id !== groupId));
      setPending((prev) => ({
        ...prev,
        groupsToApprove: Math.max(0, prev.groupsToApprove - 1),
      }));
    } catch (err) {
      console.error('AdminDashboard approve error:', err);
    } finally {
      setApprovingGroup(null);
    }
  };

  const queue = [
    {
      id: 'critical-tickets',
      icon: <AlertTriangle size={17} />,
      tone: 'error',
      title: 'Tickets críticos sem resposta',
      count: criticalTickets.length,
      action: 'Abrir suporte',
      to: '/admin/support',
    },
    {
      id: 'failed-payments',
      icon: <Wallet size={17} />,
      tone: 'error',
      title: 'Falhas de pagamento no mês',
      count: pending.failedPayments,
      action: 'Ver falhas',
      to: '/admin/billing/failures',
    },

    {
      id: 'open-tickets',
      icon: <Ticket size={17} />,
      tone: 'warning',
      title: 'Tickets abertos aguardando você',
      count: metrics.openTickets,
      action: 'Ver tickets',
      to: '/admin/support',
    },

    {
      id: 'waitlist',
      icon: <UserPlus size={17} />,
      tone: 'info',
      title: 'Pessoas na lista de espera de grupos',
      count: pending.waitlist,
      action: 'Ver lista',
      to: '/admin/interest',
    },
    {
      id: 'onboarding',
      icon: <Target size={17} />,
      tone: 'warning',
      title: 'Onboarding começado e não concluído',
      count: pending.onboardingPending,
      action: 'Ver onboarding',
      to: '/admin/onboarding',
    },
    {
      id: 'coupons',
      icon: <AlertTriangle size={17} />,
      tone: 'info',
      title: 'Cupons expirando em 7 dias',
      count: pending.couponsExpiring,
      action: 'Ver cupons',
      to: '/admin/coupons',
    },
  ].filter((item) => item.count > 0);

  const metricCards = [
    {
      icon: <UserPlus size={20} />,
      iconClass: 'users',
      label: 'Registros hoje',
      value: signups.day.toLocaleString('pt-BR'),
      sub: `${signups.subsDay} viraram assinante${signups.subsDay === 1 ? '' : 's'}`,
    },
    {
      icon: <UserPlus size={20} />,
      iconClass: 'subscriptions',
      label: 'Registros na semana',
      value: signups.week.toLocaleString('pt-BR'),
      sub: `${signups.subsWeek} viraram assinante${signups.subsWeek === 1 ? '' : 's'}`,
    },
    {
      icon: <UserPlus size={20} />,
      iconClass: 'revenue',
      label: 'Registros no mês',
      value: signups.month.toLocaleString('pt-BR'),
      sub: `${signups.converted} seguiram para a assinatura`,
    },
    {
      icon: <DollarSign size={20} />,
      iconClass: 'revenue',
      label: 'Receita do mês',
      value: formatCurrency(metrics.monthlyRevenue),
      sub: 'pagamentos confirmados',
    },
    {
      icon: <TrendingUp size={20} />,
      iconClass: 'profit',
      label: 'Lucro previsto',
      value: formatCurrency(metrics.expectedProfit),
      className: metrics.expectedProfit >= 0 ? 'positive' : 'negative',
      sub: 'receita − custos',
    },
    {
      icon: <CreditCard size={20} />,
      iconClass: 'subscriptions',
      label: 'Assinaturas',
      value: metrics.activeSubscriptions.toLocaleString('pt-BR'),
      sub: 'em vigor agora',
    },
    {
      icon: <Users size={20} />,
      iconClass: 'users',
      label: 'Usuários',
      value: metrics.totalUsers.toLocaleString('pt-BR'),
      sub: 'contas cadastradas',
    },
    {
      icon: <TrendingDown size={20} />,
      iconClass: 'costs',
      label: 'Custos SaaS',
      value: formatCurrency(metrics.saasCosts),
      sub: 'contas ativas',
    },
    {
      icon: <AlertTriangle size={20} />,
      iconClass: 'tickets',
      label: 'Tickets',
      value: metrics.openTickets.toLocaleString('pt-BR'),
      sub: 'abertos ou em curso',
    },
  ];

  return (
    <div className="fade-in admin-dashboard">
      {/* A fila vem antes dos números: é a pergunta que o operador abre o
          painel para responder. */}
      <section className="operator-queue" aria-labelledby="queue-title">
        <div className="queue-head">
          <h2 id="queue-title">Fila do operador</h2>
          {(queue.length > 0 || pendingGroups.length > 0) ? (
            <span className="queue-count">
              {queue.length + pendingGroups.length} pendência
              {queue.length + pendingGroups.length > 1 ? 's' : ''}
            </span>
          ) : (
            <span className="queue-count queue-count-ok">nada pendente</span>
          )}
        </div>

        {/* Grupos criados por usuário: o primeiro item da fila, com a
            aprovação na mão. O grupo já aparece no catálogo, mas ninguém
            paga nele até ser aprovado. */}
        {pendingGroups.length > 0 && (
          <div className="queue-groups">
            <div className="queue-groups-head">
              <span className="queue-groups-title">
                <CheckCircle2 size={16} />
                Grupos aguardando sua aprovação
              </span>
              <button
                type="button"
                className="queue-groups-see-all"
                onClick={() => navigate('/admin/platforms')}
              >
                Ver todos <ArrowRight size={14} />
              </button>
            </div>
            <ul className="queue-groups-list">
              {pendingGroups.map((group) => (
                <li key={group.id}>
                  <div className="queue-group-row">
                    <div className="queue-group-info">
                      <span className="queue-group-name">{group.name}</span>
                      <span className="queue-group-meta">
                        {group.service?.name || 'Serviço'}
                        {' · '}
                        {group.owner?.name || 'Usuário'}
                        {' · '}
                        {formatRelativeTime(group.created_at)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="queue-group-approve"
                      disabled={approvingGroup === group.id}
                      onClick={() => approveGroup(group.id)}
                    >
                      {approvingGroup === group.id ? 'Aprovando...' : 'Aprovar'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {queue.length === 0 && pendingGroups.length === 0 ? (
          <div className="queue-empty">
            <CheckCircle2 size={20} />
            <div>
              <strong>Nada esperando você agora.</strong>
              <span>Sem tickets críticos, sem falhas de pagamento e sem onboarding travado.</span>
            </div>
          </div>
        ) : (
          <ul className="queue-list">
            {queue.map((item) => (
              <li key={item.id}>
                <button className={`queue-item ${item.tone}`} onClick={() => navigate(item.to)}>
                  <span className="queue-item-icon" aria-hidden>{item.icon}</span>
                  <span className="queue-item-main">
                    <span className="queue-item-title">{item.title}</span>
                    <span className="queue-item-action">{item.action}</span>
                  </span>
                  <span className="queue-item-count">{item.count}</span>
                  <ArrowRight size={16} className="queue-item-arrow" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

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

      {openTickets.length > 0 && (
        <div className="support-block">
          <div className="panel-header">
            <h2>
              <AlertTriangle size={18} />
              Suporte
            </h2>
            <button className="support-see-all" onClick={() => navigate('/admin/support')}>
              Ver todos
            </button>
          </div>

          <ul className="support-list">
            {openTickets.slice(0, 6).map((ticket) => (
              <li key={ticket.id}>
                <button
                  className={`support-row priority-${ticket.priority || 'normal'}`}
                  onClick={() => navigate(`/admin/support/${ticket.id}`)}
                >
                  <span className="support-priority-dot" aria-hidden />
                  <span className="support-row-main">
                    <span className="support-row-subject">{ticket.subject}</span>
                    <span className="support-row-meta">
                      {ticket.user?.name || ticket.user?.email || 'Usuário'}
                      {' · '}
                      {CATEGORY_LABELS[ticket.category] || 'Geral'}
                      {' · '}
                      {formatRelativeTime(ticket.created_at)}
                    </span>
                  </span>
                  {ticket.priority && ticket.priority !== 'normal' && (
                    <span className={`badge priority-badge ${ticket.priority}`}>
                      {PRIORITY_LABELS[ticket.priority]}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="activity-section">
        <div className="activity-panel">
          <div className="panel-header">
            <h2>Atividade recente (24h)</h2>
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

        {/* Grupos por status: substitui o "Resumo rápido", que repetia o
            total de usuários que já está nos cards acima. */}
        <div className="stats-panel">
          <div className="panel-header">
            <h2>Grupos</h2>
            <button className="support-see-all" onClick={() => navigate('/admin/platforms')}>
              Ver todos
            </button>
          </div>
          <div className="stats-grid">
            <div className="stat-row">
              <span className="stat-label">
                <Activity size={16} /> Abertos
              </span>
              <span className="stat-value">{stats.groupsByStatus.open || 0}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">
                <CreditCard size={16} /> Formando
              </span>
              <span className="stat-value">{stats.groupsByStatus.forming || 0}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">
                <CheckCircle2 size={16} /> Fechados
              </span>
              <span className="stat-value">{stats.groupsByStatus.closed || 0}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">
                <Users size={16} /> Administradores
              </span>
              <span className="stat-value">{stats.usersByRole.admin || 0}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
