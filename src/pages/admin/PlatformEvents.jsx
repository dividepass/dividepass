import { useState, useEffect } from 'react';
import {
  Loader2, Activity, Trash2, CreditCard, UserPlus, UserMinus,
  CheckCircle, XCircle, DollarSign, RefreshCw, Search, Users,
  Wallet, ArrowDownRight, User, Settings, Tag, AlertTriangle, Clock, Mail,
  Eye, ExternalLink
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import './PlatformEvents.css';

const EVENT_TYPES = [
  { value: 'all', label: 'Todos' },
  { value: 'group_approved', label: 'Grupos Ativos', isList: true },
  { value: 'user_registered', label: 'Cadastros' },
  { value: 'user_login', label: 'Logins' },
  { value: 'group_created', label: 'Grupos Criados' },
  { value: 'group_rejected', label: 'Grupos Recusados' },
  { value: 'group_deleted', label: 'Grupos Removidos' },
  { value: 'checkout_opened', label: 'Checkouts Abertos' },
  { value: 'member_joined', label: 'Membros Ingressaram' },
  { value: 'member_left', label: 'Membros Saíram' },
  { value: 'email_code_requested', label: 'Códigos Solicitados' },
  { value: 'payment', label: 'Pagamentos' },
  { value: 'subscription_cancelled', label: 'Assinaturas Canceladas' },
  { value: 'withdrawal_requested', label: 'Saques Solicitados' },
  { value: 'withdrawal_approved', label: 'Saques Aprovados' },
  { value: 'withdrawal_rejected', label: 'Saques Recusados' },
  { value: 'refund', label: 'Reembolsos' },
  { value: 'info', label: 'Informativos' },
];

const EVENT_ICONS = {
  user_registered: <User size={14} />,
  user_login: <User size={14} />,
  group_created: <Users size={14} />,
  group_deleted: <Trash2 size={14} />,
  group_approved: <CheckCircle size={14} />,
  group_rejected: <XCircle size={14} />,
  checkout_opened: <CreditCard size={14} />,
  subscription_cancelled: <CreditCard size={14} />,
  member_joined: <UserPlus size={14} />,
  member_left: <UserMinus size={14} />,
  email_code_requested: <Mail size={14} />,
  payment: <DollarSign size={14} />,
  refund: <RefreshCw size={14} />,
  info: <Activity size={14} />,
  withdrawal_requested: <Wallet size={14} />,
  withdrawal_approved: <CheckCircle size={14} />,
  withdrawal_rejected: <XCircle size={14} />,
};

function PlatformEvents() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [deletedGroups, setDeletedGroups] = useState([]);
  const [membersList, setMembersList] = useState([]);
  const [paymentsList, setPaymentsList] = useState([]);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [withdrawalsList, setWithdrawalsList] = useState([]);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState(null);
  const [refundsList, setRefundsList] = useState([]);
  const [selectedRefund, setSelectedRefund] = useState(null);
  const [cancelledSubs, setCancelledSubs] = useState([]);
  const [selectedCancelledSub, setSelectedCancelledSub] = useState(null);
  const [memberCounts, setMemberCounts] = useState({});
  const [services, setServices] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [paymentsActionLoading, setPaymentsActionLoading] = useState(false);
  const [modalSuccess, setModalSuccess] = useState('');
  const [modalError, setModalError] = useState('');
  const [modalInfo, setModalInfo] = useState('');

  const isGroupsList = filter === 'group_approved';
  const isUsersList = filter === 'user_registered';
  const isCreatedGroupsList = filter === 'group_created';
  const isRejectedGroupsList = filter === 'group_rejected';
  const isDeletedGroupsList = filter === 'group_deleted';
  const isMembersList = filter === 'member_joined' || filter === 'member_left';
  const isPaymentsList = filter === 'payment';
  const isWithdrawalsList = filter === 'withdrawal_requested';
  const isRefundsList = filter === 'refund';
  const isCancelledSubsList = filter === 'subscription_cancelled';
  const isGroupsTable = isGroupsList || isCreatedGroupsList || isRejectedGroupsList;

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);

      if (isGroupsList) {
        const { data: groupsData, error } = await supabase
          .from('groups')
          .select(`
            *,
            owner:owner_id (id, name, email),
            service:service_id (id, name, icon_url, color)
          `)
          .eq('approval_status', 'approved')
          .eq('status', 'open')
          .order('created_at', { ascending: false });

        if (!cancelled && !error) {
          setGroups(groupsData || []);
          const svcMap = {};
          (groupsData || []).forEach(g => {
            if (g.service) svcMap[g.service.id] = g.service;
          });
          setServices(svcMap);
        }
      } else if (isCreatedGroupsList) {
        const { data: groupsData, error } = await supabase
          .from('groups')
          .select(`
            *,
            owner:owner_id (id, name, email),
            service:service_id (id, name, icon_url, color)
          `)
          .eq('approval_status', 'pending')
          .order('created_at', { ascending: false });

        if (!cancelled && !error) {
          setGroups(groupsData || []);
          const svcMap = {};
          (groupsData || []).forEach(g => {
            if (g.service) svcMap[g.service.id] = g.service;
          });
          setServices(svcMap);
        }
      } else if (isRejectedGroupsList) {
        const { data: groupsData, error } = await supabase
          .from('groups')
          .select(`
            *,
            owner:owner_id (id, name, email),
            service:service_id (id, name, icon_url, color)
          `)
          .eq('approval_status', 'rejected')
          .order('created_at', { ascending: false });

        if (!cancelled && !error) {
          setGroups(groupsData || []);
          const svcMap = {};
          (groupsData || []).forEach(g => {
            if (g.service) svcMap[g.service.id] = g.service;
          });
          setServices(svcMap);
        }
      } else if (isDeletedGroupsList) {
        const { data: eventsData, error } = await supabase
          .from('platform_events')
          .select('*')
          .eq('event_type', 'group_deleted')
          .order('created_at', { ascending: false })
          .limit(100);

        if (!cancelled && !error) {
          const parsed = (eventsData || []).map(ev => {
            try {
              const meta = typeof ev.metadata === 'string' ? JSON.parse(ev.metadata) : ev.metadata;
              return { ...ev, parsed_meta: meta };
            } catch { return { ...ev, parsed_meta: {} }; }
          });

          const creatorIds = [...new Set(parsed.map(e => e.created_by).filter(Boolean))];
          const { data: creators } = creatorIds.length
            ? await supabase.from('users').select('id, name, email').in('id', creatorIds)
            : { data: [] };
          const creatorMap = {};
          (creators || []).forEach(u => creatorMap[u.id] = u);

          const enriched = parsed.map(ev => ({ ...ev, user: creatorMap[ev.created_by] || null }));
          setDeletedGroups(enriched);
        }
      } else if (isUsersList) {
        const { data: usersData, error } = await supabase
          .from('users')
          .select('*')
          .order('created_at', { ascending: false });

        if (!cancelled && !error) {
          setUsers(usersData || []);

          const counts = {};
          for (const u of (usersData || []).slice(0, 50)) {
            const { count } = await supabase
              .from('group_members')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', u.id)
              .eq('status', 'active');
            counts[u.id] = count || 0;
          }
          if (!cancelled) setMemberCounts(counts);
        }
      } else if (isMembersList) {
        const { data: eventsData, error } = await supabase
          .from('platform_events')
          .select('*')
          .eq('event_type', filter)
          .order('created_at', { ascending: false })
          .limit(100);

        if (!cancelled && !error && eventsData?.length) {
          const parsed = eventsData.map(ev => {
            try {
              const meta = typeof ev.metadata === 'string' ? JSON.parse(ev.metadata) : (ev.metadata || {});
              return { ...ev, parsed_meta: meta };
            } catch { return { ...ev, parsed_meta: {} }; }
          });

          // Resolve user and group info in batch
          const userIds = [...new Set(parsed.map(e => e.parsed_meta?.user_id).filter(Boolean))];
          const groupIds = [...new Set(parsed.map(e => e.parsed_meta?.group_id).filter(Boolean))];

          const [usersRes, groupsRes] = await Promise.all([
            userIds.length ? supabase.from('users').select('id, name, email').in('id', userIds) : { data: [] },
            groupIds.length ? supabase.from('groups').select('id, name, photo_url, slug').in('id', groupIds) : { data: [] },
          ]);

          const userMap = {};
          (usersRes.data || []).forEach(u => userMap[u.id] = u);
          const groupMap = {};
          (groupsRes.data || []).forEach(g => groupMap[g.id] = g);

          const combined = parsed.map(ev => ({
            ...ev,
            user: userMap[ev.parsed_meta?.user_id] || null,
            group: groupMap[ev.parsed_meta?.group_id] || null,
          }));

          if (!cancelled) setMembersList(combined);
        } else if (!cancelled) {
          setMembersList([]);
        }
      } else if (isPaymentsList) {
        const { data: paymentsData, error } = await supabase
          .from('payment_attempts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200);

        if (!cancelled && !error && paymentsData?.length) {
          const userIds = [...new Set(paymentsData.map(p => p.user_id).filter(Boolean))];
          const groupIds = [...new Set(paymentsData.map(p => p.group_id).filter(Boolean))];

          const [usersRes, groupsRes] = await Promise.all([
            userIds.length ? supabase.from('users').select('id, name, email').in('id', userIds) : { data: [] },
            groupIds.length ? supabase.from('groups').select('id, name, slug').in('id', groupIds) : { data: [] },
          ]);

          const userMap = {};
          (usersRes.data || []).forEach(u => userMap[u.id] = u);
          const groupMap = {};
          (groupsRes.data || []).forEach(g => groupMap[g.id] = g);

          const combined = paymentsData.map(p => ({
            ...p,
            user: userMap[p.user_id] || null,
            group: groupMap[p.group_id] || null,
          }));

          if (!cancelled) setPaymentsList(combined);
        } else if (!cancelled) {
          setPaymentsList([]);
        }
      } else if (isWithdrawalsList) {
        const { data: withdrawalsData, error } = await supabase
          .from('wallet_withdrawals')
          .select('*')
          .order('requested_at', { ascending: false })
          .limit(200);

        if (!cancelled && !error && withdrawalsData?.length) {
          const userIds = [...new Set(withdrawalsData.map(w => w.user_id).filter(Boolean))];
          const processorIds = [...new Set(withdrawalsData.map(w => w.processed_by).filter(Boolean))];

          const allIds = [...new Set([...userIds, ...processorIds])];
          const { data: usersData } = allIds.length
            ? await supabase.from('users').select('id, name, email').in('id', allIds)
            : { data: [] };

          const userMap = {};
          (usersData || []).forEach(u => userMap[u.id] = u);

          const combined = withdrawalsData.map(w => ({
            ...w,
            user: userMap[w.user_id] || null,
            processor: userMap[w.processed_by] || null,
          }));

          if (!cancelled) setWithdrawalsList(combined);
        } else if (!cancelled) {
          setWithdrawalsList([]);
        }
      } else if (isRefundsList) {
        const { data: refundsData, error } = await supabase
          .from('payment_attempts')
          .select('*')
          .or('status.eq.refunded,payment_type.eq.refund')
          .order('created_at', { ascending: false })
          .limit(200);

        if (!cancelled && !error && refundsData?.length) {
          const userIds = [...new Set(refundsData.map(r => r.user_id).filter(Boolean))];
          const groupIds = [...new Set(refundsData.map(r => r.group_id).filter(Boolean))];

          const [usersRes, groupsRes] = await Promise.all([
            userIds.length ? supabase.from('users').select('id, name, email').in('id', userIds) : { data: [] },
            groupIds.length ? supabase.from('groups').select('id, name, slug').in('id', groupIds) : { data: [] },
          ]);

          const userMap = {};
          (usersRes.data || []).forEach(u => userMap[u.id] = u);
          const groupMap = {};
          (groupsRes.data || []).forEach(g => groupMap[g.id] = g);

          const combined = refundsData.map(r => ({
            ...r,
            user: userMap[r.user_id] || null,
            group: groupMap[r.group_id] || null,
          }));

          if (!cancelled) setRefundsList(combined);
        } else if (!cancelled) {
          setRefundsList([]);
        }
      } else if (isCancelledSubsList) {
        const { data: subsData, error } = await supabase
          .from('user_subscriptions')
          .select('*')
          .eq('status', 'cancelled')
          .order('updated_at', { ascending: false })
          .limit(200);

        if (!cancelled && !error && subsData?.length) {
          const userIds = [...new Set(subsData.map(s => s.user_id).filter(Boolean))];
          const groupIds = [...new Set(subsData.map(s => s.group_id).filter(Boolean))];

          const [usersRes, groupsRes] = await Promise.all([
            userIds.length ? supabase.from('users').select('id, name, email').in('id', userIds) : { data: [] },
            groupIds.length ? supabase.from('groups').select('id, name, slug, owner_id').in('id', groupIds) : { data: [] },
          ]);

          const userMap = {};
          (usersRes.data || []).forEach(u => userMap[u.id] = u);
          const groupMap = {};
          (groupsRes.data || []).forEach(g => groupMap[g.id] = g);

          const combined = subsData.map(s => ({
            ...s,
            user: userMap[s.user_id] || null,
            group: groupMap[s.group_id] || null,
          }));

          if (!cancelled) setCancelledSubs(combined);
        } else if (!cancelled) {
          setCancelledSubs([]);
        }
      } else {
        let query = supabase
          .from('platform_events')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200);

        if (filter !== 'all') {
          query = query.eq('event_type', filter);
        }

        const { data, error } = await query;
        if (!cancelled && !error) {
          const parsed = (data || []).map(ev => {
            try {
              const meta = typeof ev.metadata === 'string' ? JSON.parse(ev.metadata) : (ev.metadata || {});
              return { ...ev, parsed_meta: meta };
            } catch { return { ...ev, parsed_meta: {} }; }
          });

          const userIds = [...new Set(parsed.map(e => e.parsed_meta?.user_id || e.created_by).filter(Boolean))];
          const groupIds = [...new Set(parsed.map(e => e.parsed_meta?.group_id).filter(Boolean))];

          const [usersRes, groupsRes] = await Promise.all([
            userIds.length ? supabase.from('users').select('id, name, email').in('id', userIds) : { data: [] },
            groupIds.length ? supabase.from('groups').select('id, name, slug, owner_id').in('id', groupIds) : { data: [] },
          ]);

          const userMap = {};
          (usersRes.data || []).forEach(u => userMap[u.id] = u);
          const groupMap = {};
          (groupsRes.data || []).forEach(g => groupMap[g.id] = g);

          const enriched = parsed.map(ev => ({
            ...ev,
            user: userMap[ev.parsed_meta?.user_id || ev.created_by] || null,
            group: groupMap[ev.parsed_meta?.group_id] || null,
          }));

          setEvents(enriched);
        }
      }

      setLoading(false);
    };

    fetchData();
    return () => { cancelled = true; };
  }, [filter]);

  const filteredEvents = events.filter(ev => {
    if (!search) return true;
    const q = search.toLowerCase();
    const meta = ev.parsed_meta || {};
    return (
      ev.title?.toLowerCase().includes(q) ||
      ev.message?.toLowerCase().includes(q) ||
      ev.event_type?.toLowerCase().includes(q) ||
      ev.created_by?.toLowerCase().includes(q) ||
      meta.user_id?.toLowerCase().includes(q) ||
      meta.group_id?.toLowerCase().includes(q) ||
      meta.group_name?.toLowerCase().includes(q) ||
      meta.gateway?.toLowerCase().includes(q) ||
      meta.email?.toLowerCase().includes(q) ||
      String(meta.amount)?.includes(q)
    );
  });

  const filteredGroups = groups.filter(g => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      g.name?.toLowerCase().includes(q) ||
      g.owner?.name?.toLowerCase().includes(q) ||
      g.owner?.email?.toLowerCase().includes(q) ||
      g.slug?.toLowerCase().includes(q)
    );
  });

  const filteredDeletedGroups = deletedGroups.filter(ev => {
    if (!search) return true;
    const q = search.toLowerCase();
    const meta = ev.parsed_meta || {};
    return (
      ev.title?.toLowerCase().includes(q) ||
      ev.message?.toLowerCase().includes(q) ||
      meta.group_name?.toLowerCase().includes(q)
    );
  });

  const filteredMembers = membersList.filter(m => {
    if (!search) return true;
    const q = search.toLowerCase();
    const meta = m.parsed_meta || {};
    return (
      m.user?.name?.toLowerCase().includes(q) ||
      m.user?.email?.toLowerCase().includes(q) ||
      m.group?.name?.toLowerCase().includes(q) ||
      meta.amount?.toString().includes(q)
    );
  });

  const filteredPayments = paymentsList.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.user?.name?.toLowerCase().includes(q) ||
      p.user?.email?.toLowerCase().includes(q) ||
      p.group?.name?.toLowerCase().includes(q) ||
      p.gateway?.toLowerCase().includes(q) ||
      p.status?.toLowerCase().includes(q) ||
      p.gateway_transaction_id?.toLowerCase().includes(q)
    );
  });

  const filteredWithdrawals = withdrawalsList.filter(w => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      w.user?.name?.toLowerCase().includes(q) ||
      w.user?.email?.toLowerCase().includes(q) ||
      w.status?.toLowerCase().includes(q) ||
      w.payment_method?.toLowerCase().includes(q) ||
      w.notes?.toLowerCase().includes(q)
    );
  });

  const filteredRefunds = refundsList.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.user?.name?.toLowerCase().includes(q) ||
      r.user?.email?.toLowerCase().includes(q) ||
      r.group?.name?.toLowerCase().includes(q) ||
      r.gateway?.toLowerCase().includes(q) ||
      r.status?.toLowerCase().includes(q) ||
      r.gateway_transaction_id?.toLowerCase().includes(q)
    );
  });

  const filteredCancelledSubs = cancelledSubs.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.user?.name?.toLowerCase().includes(q) ||
      s.user?.email?.toLowerCase().includes(q) ||
      s.group?.name?.toLowerCase().includes(q)
    );
  });

  const filteredUsers = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.phone?.toLowerCase().includes(q)
    );
  });

  const formatTime = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);

    if (diffMin < 1) return 'Agora';
    if (diffMin < 60) return `${diffMin}min atrás`;
    if (diffH < 24) return `${diffH}h atrás`;
    if (diffD < 7) return `${diffD}d atrás`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const formatFullDate = (dateStr) => {
    return new Date(dateStr).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  const getMetadataSummary = (metadata) => {
    if (!metadata) return null;
    try {
      const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      const items = [];
      if (meta.amount) items.push(`R$ ${Number(meta.amount).toFixed(2)}`);
      if (meta.group_name) items.push(meta.group_name);
      if (meta.payment_type) items.push(meta.payment_type === 'entrance' ? 'Adesão' : 'Assinatura');
      if (meta.gateway) items.push(meta.gateway);
      if (meta.reason) items.push(meta.reason);
      if (meta.email) items.push(meta.email);
      return items.length > 0 ? items.join(' · ') : null;
    } catch { return null; }
  };

  const getGroupMembers = async (groupId) => {
    const { count } = await supabase
      .from('group_members')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId)
      .eq('status', 'active');
    return count || 0;
  };

  const cycleLabel = (cycle) => ({
    monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual', custom: 'Personalizado', days: 'Dias'
  }[cycle] || cycle || '—');

  return (
    <div className="fade-in platform-events-page">
      <div className="pe-header">
        <div>
          <h1><Activity size={24} /> {
            isGroupsList ? 'Grupos Ativos' :
            isCreatedGroupsList ? 'Grupos Criados' :
            isRejectedGroupsList ? 'Grupos Recusados' :
            isDeletedGroupsList ? 'Grupos Removidos' :
            isUsersList ? 'Usuários Cadastrados' :
            isMembersList ? (filter === 'member_joined' ? 'Membros Ingressaram' : 'Membros Saíram') :
            isPaymentsList ? 'Pagamentos' :
            isWithdrawalsList ? 'Saques Solicitados' :
            isRefundsList ? 'Reembolsos' :
            isCancelledSubsList ? 'Assinaturas Canceladas' :
            'Eventos da Plataforma'
          }</h1>
          <p style={{ color: '#9ca3af', marginTop: 4 }}>
            {isGroupsList
              ? `${filteredGroups.length} grupo${filteredGroups.length !== 1 ? 's' : ''} ativo${filteredGroups.length !== 1 ? 's' : ''}`
              : isCreatedGroupsList
              ? `${filteredGroups.length} grupo${filteredGroups.length !== 1 ? 's' : ''} pendente${filteredGroups.length !== 1 ? 's' : ''}`
              : isRejectedGroupsList
              ? `${filteredGroups.length} grupo${filteredGroups.length !== 1 ? 's' : ''} recusado${filteredGroups.length !== 1 ? 's' : ''}`
              : isDeletedGroupsList
              ? `${filteredDeletedGroups.length} grupo${filteredDeletedGroups.length !== 1 ? 's' : ''} removido${filteredDeletedGroups.length !== 1 ? 's' : ''}`
              : isUsersList
              ? `${filteredUsers.length} usuário${filteredUsers.length !== 1 ? 's' : ''} cadastrado${filteredUsers.length !== 1 ? 's' : ''}`
              : isMembersList
              ? `${filteredMembers.length} ${filter === 'member_joined' ? 'entrada' : 'saída'}${filteredMembers.length !== 1 ? 's' : ''}`
              : isPaymentsList
              ? `${filteredPayments.length} transaç${filteredPayments.length !== 1 ? 'ões' : 'ão'}`
              : isWithdrawalsList
              ? `${filteredWithdrawals.length} saque${filteredWithdrawals.length !== 1 ? 's' : ''}`
              : isRefundsList
              ? `${filteredRefunds.length} reembolso${filteredRefunds.length !== 1 ? 's' : ''}`
              : isCancelledSubsList
              ? `${filteredCancelledSubs.length} assinatura${filteredCancelledSubs.length !== 1 ? 's' : ''} cancelada${filteredCancelledSubs.length !== 1 ? 's' : ''}`
              : `${filteredEvents.length} evento${filteredEvents.length !== 1 ? 's' : ''} encontrado${filteredEvents.length !== 1 ? 's' : ''}`
            }
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="pe-search">
        <Search size={18} />
        <input
          type="text"
          placeholder={
            isGroupsTable ? 'Buscar por nome, slug, proprietário...' :
            isDeletedGroupsList ? 'Buscar por nome do grupo...' :
            isUsersList ? 'Buscar por nome, email, telefone...' :
            isMembersList ? 'Buscar por usuário, grupo...' :
            isPaymentsList ? 'Buscar por usuário, grupo, gateway, status...' :
            isWithdrawalsList ? 'Buscar por usuário, status, método...' :
            isRefundsList ? 'Buscar por usuário, grupo, gateway...' :
            isCancelledSubsList ? 'Buscar por usuário, grupo...' :
            'Buscar eventos...'
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filters */}
      <div className="pe-filters">
        {EVENT_TYPES.map(et => (
          <button
            key={et.value}
            className={`pe-filter-btn ${filter === et.value ? 'active' : ''}`}
            onClick={() => { setFilter(et.value); setSearch(''); }}
          >
            {EVENT_ICONS[et.value]}
            {et.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="pe-loading">
          <Loader2 size={20} className="spin" />
          Carregando...
        </div>
      ) : isGroupsTable ? (
        /* ==================== GROUPS TABLE (Ativos / Criados / Recusados) ==================== */
        filteredGroups.length === 0 ? (
          <div className="pe-empty">
            <Users size={48} />
            <p>Nenhum grupo encontrado.</p>
          </div>
        ) : (
          <div className="admin-card table-responsive">
            <table className="groups-list-table">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Proprietário</th>
                  <th>Status</th>
                  <th>Plano</th>
                  <th>Ciclo</th>
                  <th>Preço</th>
                  <th>Adesão</th>
                  <th>Slug</th>
                  <th>Criado em</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.map(group => (
                  <tr key={group.id}>
                    <td>
                      <div className="group-name-cell">
                        {group.photo_url ? (
                          <img src={group.photo_url} alt="" className="group-thumb" />
                        ) : (
                          <div className="group-thumb-placeholder" style={{ background: group.service?.color || '#4F46E5' }}>
                            {group.name?.[0]?.toUpperCase() || '?'}
                          </div>
                        )}
                        <div>
                          <strong>{group.name}</strong>
                          {group.is_official && <span className="official-badge">Oficial</span>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="owner-cell">
                        <span>{group.owner?.name || '—'}</span>
                        <small>{group.owner?.email || '—'}</small>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${group.approval_status === 'approved' ? 'active' : group.approval_status === 'rejected' ? 'rejected' : 'pending'}`}>
                        {group.approval_status === 'approved' ? 'Ativo' : group.approval_status === 'rejected' ? 'Recusado' : 'Pendente'}
                      </span>
                    </td>
                    <td>
                      <span className="plan-badge">
                        {group.plan_type || 'Personalizado'}
                      </span>
                    </td>
                    <td>{cycleLabel(group.billing_cycle)}</td>
                    <td>
                      <strong>R$ {Number(group.price_per_slot || 0).toFixed(2)}</strong>
                      <small>/mês</small>
                    </td>
                    <td>
                      {group.has_entrance_fee ? (
                        <span className="entrance-badge">R$ {Number(group.entrance_fee || 0).toFixed(2)}</span>
                      ) : (
                        <span style={{ color: '#6b7280' }}>Grátis</span>
                      )}
                    </td>
                    <td>
                      <code className="slug-code">#{group.slug || '—'}</code>
                    </td>
                    <td>
                      <span className="date-cell">
                        {group.created_at ? new Date(group.created_at).toLocaleDateString('pt-BR') : '—'}
                      </span>
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button
                          className="action-btn"
                          onClick={() => navigate(`/admin/groups/${group.id}/edit`)}
                          title="Editar grupo"
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : isDeletedGroupsList ? (
        /* ==================== DELETED GROUPS LIST ==================== */
        filteredDeletedGroups.length === 0 ? (
          <div className="pe-empty">
            <Trash2 size={48} />
            <p>Nenhum grupo removido encontrado.</p>
          </div>
        ) : (
          <div className="admin-card table-responsive">
            <table className="groups-list-table">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Removido por</th>
                  <th>Assinaturas canceladas</th>
                  <th>Membros notificados</th>
                  <th>Data da remoção</th>
                </tr>
              </thead>
              <tbody>
                {filteredDeletedGroups.map(ev => {
                  const meta = ev.parsed_meta || {};
                  const creator = ev.user || null;
                  return (
                    <tr key={ev.id}>
                      <td>
                        <div className="group-name-cell">
                          <div className="group-thumb-placeholder" style={{ background: '#EF4444' }}>
                            <Trash2 size={16} />
                          </div>
                          <div>
                            <a className="pe-link" onClick={() => meta.group_id && navigate(`/admin/groups/${meta.group_id}/edit`)} title="Ver grupo">
                              {meta.group_name || ev.title}
                            </a>
                            <small style={{ color: '#9ca3af', display: 'block' }}>ID: {meta.group_id?.substring(0, 8) || '—'}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {creator ? (
                          <a className="pe-link" onClick={() => navigate(`/admin/users/${creator.id}`)} title="Ver usuário">
                            {creator.name || creator.email || ev.created_by?.substring(0, 8) + '...'}
                          </a>
                        ) : (
                          <span>{ev.created_by ? ev.created_by.substring(0, 8) + '...' : '—'}</span>
                        )}
                      </td>
                      <td>
                        <span className="status-badge" style={{ background: '#450a0a', color: '#fca5a5' }}>
                          {meta.subscriptions_cancelled || 0} cancelada(s)
                        </span>
                      </td>
                      <td>{meta.members_notified || 0}</td>
                      <td>
                        <span className="date-cell">
                          {ev.created_at ? new Date(ev.created_at).toLocaleString('pt-BR') : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : isUsersList ? (
        /* ==================== USERS LIST ==================== */
        filteredUsers.length === 0 ? (
          <div className="pe-empty">
            <Users size={48} />
            <p>Nenhum usuário encontrado.</p>
          </div>
        ) : (
          <div className="admin-card table-responsive">
            <table className="groups-list-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Telefone</th>
                  <th>Grupos</th>
                  <th>Cadastro</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div className="group-name-cell">
                        <div className="group-thumb-placeholder" style={{ background: '#4F46E5' }}>
                          {(u.name || u.email || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <a className="pe-link" onClick={() => navigate(`/admin/users/${u.id}`)} title="Ver usuário">
                            {u.name || '—'}
                          </a>
                          <small style={{ color: '#9ca3af', display: 'block' }}>{u.email}</small>
                        </div>
                      </div>
                    </td>
                    <td>{u.phone || '—'}</td>
                    <td>
                      <span className="plan-badge">{memberCounts[u.id] || 0} grupo(s)</span>
                    </td>
                    <td>
                      <span className="date-cell">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—'}
                      </span>
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button
                          className="action-btn"
                          onClick={() => navigate(`/admin/users/${u.id}`)}
                          title="Ver usuário"
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : isMembersList ? (
        /* ==================== MEMBERS JOINED/LEFT LIST ==================== */
        filteredMembers.length === 0 ? (
          <div className="pe-empty">
            <UserPlus size={48} />
            <p>Nenhum registro encontrado.</p>
          </div>
        ) : (
          <div className="admin-card table-responsive">
            <table className="groups-list-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Grupo</th>
                  <th>Valor pago</th>
                  <th>Gateway</th>
                  <th>{filter === 'member_joined' ? 'Ingressou em' : 'Saiu em'}</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map(m => {
                  const meta = m.parsed_meta || {};
                  return (
                    <tr key={m.id}>
                      <td>
                        <div className="group-name-cell">
                          <div className="group-thumb-placeholder" style={{ background: '#10B981' }}>
                            {(m.user?.name || m.user?.email || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <a className="pe-link" onClick={() => m.user?.id && navigate(`/admin/users/${m.user.id}`)} title="Ver usuário">
                              {m.user?.name || '—'}
                            </a>
                            <small style={{ color: '#9ca3af', display: 'block' }}>{m.user?.email || '—'}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="group-name-cell">
                          {m.group?.photo_url ? (
                            <img src={m.group.photo_url} alt="" className="group-thumb" />
                          ) : (
                            <div className="group-thumb-placeholder" style={{ background: '#4F46E5' }}>
                              {m.group?.name?.[0]?.toUpperCase() || '?'}
                            </div>
                          )}
                          <div>
                            <a className="pe-link" onClick={() => m.group?.id && navigate(`/admin/groups/${m.group.id}/edit`)} title="Ver grupo">
                              {m.group?.name || '—'}
                            </a>
                            {m.group?.slug && <small style={{ color: '#9ca3af', display: 'block' }}>#{m.group.slug}</small>}
                          </div>
                        </div>
                      </td>
                      <td>
                        {meta.amount ? (
                          <strong>R$ {Number(meta.amount).toFixed(2)}</strong>
                        ) : <span style={{ color: '#6b7280' }}>—</span>}
                      </td>
                      <td>
                        {meta.gateway ? (
                          <span className="plan-badge">{meta.gateway}</span>
                        ) : <span style={{ color: '#6b7280' }}>—</span>}
                      </td>
                      <td>
                        <span className="date-cell">
                          {m.created_at ? new Date(m.created_at).toLocaleString('pt-BR') : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : isPaymentsList ? (
        /* ==================== PAYMENTS TABLE ==================== */
        filteredPayments.length === 0 ? (
          <div className="pe-empty">
            <DollarSign size={48} />
            <p>Nenhuma transação encontrada.</p>
          </div>
        ) : (
          <div className="admin-card table-responsive">
            <table className="groups-list-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Grupo</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Desconto</th>
                  <th>Gateway</th>
                  <th>Status</th>
                  <th>Data</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div className="group-name-cell">
                        <div className="group-thumb-placeholder" style={{ background: '#4F46E5' }}>
                          {(p.user?.name || p.user?.email || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <a className="pe-link" onClick={() => p.user?.id && navigate(`/admin/users/${p.user.id}`)} title="Ver usuário">
                            {p.user?.name || '—'}
                          </a>
                          <small style={{ color: '#9ca3af', display: 'block' }}>{p.user?.email || '—'}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="group-name-cell">
                        <div className="group-thumb-placeholder" style={{ background: '#10B981' }}>
                          {p.group?.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <a className="pe-link" onClick={() => p.group?.id && navigate(`/admin/groups/${p.group.id}/edit`)} title="Ver grupo">
                            {p.group?.name || '—'}
                          </a>
                          {p.group?.slug && <small style={{ color: '#9ca3af', display: 'block' }}>#{p.group.slug}</small>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="plan-badge">
                        {p.payment_type === 'entrance' ? 'Taxa de Adesão' : p.payment_type === 'subscription' ? 'Assinatura' : p.payment_type || '—'}
                      </span>
                    </td>
                    <td>
                      <strong>R$ {Number(p.amount || 0).toFixed(2)}</strong>
                      {p.original_amount > 0 && p.original_amount !== p.amount && (
                        <small style={{ color: '#9ca3af', display: 'block' }}>Original: R$ {Number(p.original_amount).toFixed(2)}</small>
                      )}
                    </td>
                    <td>
                      {p.discount_amount > 0 ? (
                        <span style={{ color: '#10B981', fontWeight: 600 }}>-R$ {Number(p.discount_amount).toFixed(2)}</span>
                      ) : (
                        <span style={{ color: '#6b7280' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className="plan-badge">{p.gateway || '—'}</span>
                    </td>
                    <td>
                      <span className={`status-badge ${p.status === 'approved' || p.status === 'confirmed' ? 'active' : p.status === 'failed' || p.status === 'refunded' ? 'rejected' : 'pending'}`}>
                        {p.status === 'approved' ? 'Aprovado' : p.status === 'confirmed' ? 'Confirmado' : p.status === 'created' ? 'Criado' : p.status === 'pending' ? 'Pendente' : p.status === 'failed' ? 'Falhou' : p.status === 'refunded' ? 'Reembolsado' : p.status || '—'}
                      </span>
                    </td>
                    <td>
                      <span className="date-cell">
                        {p.created_at ? new Date(p.created_at).toLocaleString('pt-BR') : '—'}
                      </span>
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button
                          className="action-btn"
                          onClick={() => setSelectedPayment(p)}
                          title="Ver detalhes"
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : isWithdrawalsList ? (
        /* ==================== WITHDRAWALS TABLE ==================== */
        filteredWithdrawals.length === 0 ? (
          <div className="pe-empty">
            <Wallet size={48} />
            <p>Nenhum saque encontrado.</p>
          </div>
        ) : (
          <div className="admin-card table-responsive">
            <table className="groups-list-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Valor</th>
                  <th>Método</th>
                  <th>Status</th>
                  <th>Observações</th>
                  <th>Solicitado em</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredWithdrawals.map(w => (
                  <tr key={w.id}>
                    <td>
                      <div className="group-name-cell">
                        <div className="group-thumb-placeholder" style={{ background: '#4F46E5' }}>
                          {(w.user?.name || w.user?.email || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <strong>{w.user?.name || '—'}</strong>
                          <small style={{ color: '#9ca3af', display: 'block' }}>{w.user?.email || '—'}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong style={{ fontSize: 16, color: '#10B981' }}>R$ {Number(w.amount || 0).toFixed(2)}</strong>
                    </td>
                    <td>
                      <span className="plan-badge">{w.payment_method || '—'}</span>
                    </td>
                    <td>
                      <span className={`status-badge ${w.status === 'completed' ? 'active' : w.status === 'rejected' ? 'rejected' : 'pending'}`}>
                        {w.status === 'pending' ? 'Pendente' : w.status === 'processing' ? 'Processando' : w.status === 'completed' ? 'Pago' : w.status === 'rejected' ? 'Recusado' : w.status || '—'}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: '#9ca3af', fontSize: 13 }}>{w.notes ? (w.notes.length > 40 ? w.notes.substring(0, 40) + '...' : w.notes) : '—'}</span>
                    </td>
                    <td>
                      <span className="date-cell">
                        {w.requested_at ? new Date(w.requested_at).toLocaleString('pt-BR') : '—'}
                      </span>
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button
                          className="action-btn"
                          onClick={() => setSelectedWithdrawal(w)}
                          title="Ver detalhes"
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : isRefundsList ? (
        /* ==================== REFUNDS TABLE ==================== */
        filteredRefunds.length === 0 ? (
          <div className="pe-empty">
            <RefreshCw size={48} />
            <p>Nenhum reembolso encontrado.</p>
          </div>
        ) : (
          <div className="admin-card table-responsive">
            <table className="groups-list-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Grupo</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Gateway</th>
                  <th>Status</th>
                  <th>Data</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredRefunds.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div className="group-name-cell">
                        <div className="group-thumb-placeholder" style={{ background: '#EF4444' }}>
                          {(r.user?.name || r.user?.email || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <a className="pe-link" onClick={() => r.user?.id && navigate(`/admin/users/${r.user.id}`)} title="Ver usuário">
                            {r.user?.name || '—'}
                          </a>
                          <small style={{ color: '#9ca3af', display: 'block' }}>{r.user?.email || '—'}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="group-name-cell">
                        <div className="group-thumb-placeholder" style={{ background: '#4F46E5' }}>
                          {r.group?.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <a className="pe-link" onClick={() => r.group?.id && navigate(`/admin/groups/${r.group.id}/edit`)} title="Ver grupo">
                            {r.group?.name || '—'}
                          </a>
                          {r.group?.slug && <small style={{ color: '#9ca3af', display: 'block' }}>#{r.group.slug}</small>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="plan-badge">
                        {r.payment_type === 'entrance' ? 'Taxa de Adesão' : r.payment_type === 'subscription' ? 'Assinatura' : r.payment_type === 'refund' ? 'Reembolso' : r.payment_type || '—'}
                      </span>
                    </td>
                    <td>
                      <strong style={{ color: '#EF4444' }}>-R$ {Number(r.amount || 0).toFixed(2)}</strong>
                    </td>
                    <td>
                      <span className="plan-badge">{r.gateway || '—'}</span>
                    </td>
                    <td>
                      <span className={`status-badge ${r.status === 'refunded' ? 'rejected' : 'pending'}`}>
                        {r.status === 'refunded' ? 'Reembolsado' : r.status === 'failed' ? 'Falhou' : r.status || '—'}
                      </span>
                    </td>
                    <td>
                      <span className="date-cell">
                        {r.created_at ? new Date(r.created_at).toLocaleString('pt-BR') : '—'}
                      </span>
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button
                          className="action-btn"
                          onClick={() => setSelectedRefund(r)}
                          title="Ver detalhes"
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : isCancelledSubsList ? (
        /* ==================== CANCELLED SUBS TABLE ==================== */
        filteredCancelledSubs.length === 0 ? (
          <div className="pe-empty">
            <CreditCard size={48} />
            <p>Nenhuma assinatura cancelada encontrada.</p>
          </div>
        ) : (
          <div className="admin-card table-responsive">
            <table className="groups-list-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Grupo</th>
                  <th>Plano</th>
                  <th>Valor</th>
                  <th>Desconto</th>
                  <th>Cancelado em</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredCancelledSubs.map(s => (
                  <tr key={s.id}>
                    <td>
                      <div className="group-name-cell">
                        <div className="group-thumb-placeholder" style={{ background: '#EF4444' }}>
                          {(s.user?.name || s.user?.email || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <a className="pe-link" onClick={() => s.user?.id && navigate(`/admin/users/${s.user.id}`)} title="Ver usuário">
                            {s.user?.name || '—'}
                          </a>
                          <small style={{ color: '#9ca3af', display: 'block' }}>{s.user?.email || '—'}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="group-name-cell">
                        <div className="group-thumb-placeholder" style={{ background: '#4F46E5' }}>
                          {s.group?.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <a className="pe-link" onClick={() => s.group?.id && navigate(`/admin/groups/${s.group.id}/edit`)} title="Ver grupo">
                            {s.group?.name || '—'}
                          </a>
                          {s.group?.slug && <small style={{ color: '#9ca3af', display: 'block' }}>#{s.group.slug}</small>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="plan-badge">{s.plan_type || '—'}</span>
                    </td>
                    <td>
                      <strong>R$ {Number(s.amount || 0).toFixed(2)}</strong>
                      {s.original_amount > 0 && s.original_amount !== s.amount && (
                        <small style={{ color: '#9ca3af', display: 'block' }}>Original: R$ {Number(s.original_amount).toFixed(2)}</small>
                      )}
                    </td>
                    <td>
                      {s.discount_amount > 0 ? (
                        <span style={{ color: '#10B981', fontWeight: 600 }}>-R$ {Number(s.discount_amount).toFixed(2)}</span>
                      ) : (
                        <span style={{ color: '#6b7280' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className="date-cell">
                        {s.updated_at ? new Date(s.updated_at).toLocaleString('pt-BR') : '—'}
                      </span>
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button
                          className="action-btn"
                          onClick={() => setSelectedCancelledSub(s)}
                          title="Ver detalhes"
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        /* ==================== EVENTS LIST ==================== */
        filteredEvents.length === 0 ? (
          <div className="pe-empty">
            <Activity size={48} />
            <p>Nenhum evento encontrado.</p>
          </div>
        ) : (
          <div className="pe-list">
            {filteredEvents.map(ev => {
              const metaSummary = getMetadataSummary(ev.parsed_meta || ev.metadata);
              const meta = ev.parsed_meta || {};
              return (
                <div key={ev.id} className="pe-card">
                  <div className={`pe-card-icon pe-badge-${ev.event_type}`}>
                    {EVENT_ICONS[ev.event_type] || <Activity size={14} />}
                  </div>
                  <div className="pe-card-content">
                    <div className="pe-card-header">
                      <span className="pe-card-title">{ev.title}</span>
                      <span className="pe-card-time" title={formatFullDate(ev.created_at)}>
                        {formatTime(ev.created_at)}
                      </span>
                    </div>
                    {ev.message && (
                      <p className="pe-card-message">
                        {ev.user && ev.message.includes(ev.user.name || '__none__') ? (
                          <>
                            {ev.message.split(ev.user.name).map((part, i) => (
                              <span key={i}>
                                {part}
                                {i < ev.message.split(ev.user.name).length - 1 && (
                                  <a className="pe-link" onClick={() => navigate(`/admin/users/${ev.user.id}`)} title="Ver usuário">{ev.user.name}</a>
                                )}
                              </span>
                            ))}
                          </>
                        ) : ev.user ? (
                          <>
                            {ev.message.split(new RegExp(`(${ev.user.name}|${ev.user.email})`, 'gi')).map((part, i) => {
                              const isUser = part === ev.user.name || part.toLowerCase() === ev.user.email?.toLowerCase();
                              return isUser ? (
                                <a key={i} className="pe-link" onClick={() => navigate(`/admin/users/${ev.user.id}`)} title="Ver usuário">{part}</a>
                              ) : (
                                <span key={i}>{part}</span>
                              );
                            })}
                          </>
                        ) : ev.message}
                      </p>
                    )}
                    <div className="pe-card-footer">
                      <span className={`pe-badge pe-badge-${ev.event_type}`}>
                        {ev.event_type?.replace(/_/g, ' ')}
                      </span>
                      {ev.group && (
                        <a className="pe-link pe-link-group" onClick={() => navigate(`/admin/groups/${ev.group.id}/edit`)} title="Ver grupo">
                          {ev.group.name}
                        </a>
                      )}
                      {meta.amount && (
                        <span className="pe-meta-summary">R$ {Number(meta.amount).toFixed(2)}</span>
                      )}
                      {meta.payment_type && (
                        <span className="pe-meta-summary">{meta.payment_type === 'entrance' ? 'Adesão' : 'Assinatura'}</span>
                      )}
                      {meta.discount_amount > 0 && (
                        <span className="pe-meta-summary pe-meta-discount">-R$ {Number(meta.discount_amount).toFixed(2)}</span>
                      )}
                      {meta.gateway && (
                        <span className="pe-meta-summary">{meta.gateway}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Payment Detail Viewer */}
      {selectedPayment && (
        <div className="pe-viewer-overlay" onClick={() => setSelectedPayment(null)}>
          <div className="pe-viewer-panel" onClick={e => e.stopPropagation()}>
            <div className="pe-viewer-header">
              <h3><DollarSign size={20} /> Detalhes da Transação</h3>
              <button className="pe-viewer-close" onClick={() => setSelectedPayment(null)}>×</button>
            </div>
            <div className="pe-viewer-body">
              <div className="pe-detail-grid">
                <div className="pe-detail-item">
                  <label>Status</label>
                  <span className={`status-badge ${selectedPayment.status === 'approved' || selectedPayment.status === 'confirmed' ? 'active' : selectedPayment.status === 'failed' || selectedPayment.status === 'refunded' ? 'rejected' : 'pending'}`}>
                    {selectedPayment.status === 'approved' ? 'Aprovado' : selectedPayment.status === 'confirmed' ? 'Confirmado' : selectedPayment.status === 'created' ? 'Criado' : selectedPayment.status === 'pending' ? 'Pendente' : selectedPayment.status === 'failed' ? 'Falhou' : selectedPayment.status === 'refunded' ? 'Reembolsado' : selectedPayment.status || '—'}
                  </span>
                </div>
                <div className="pe-detail-item">
                  <label>Tipo</label>
                  <span>{selectedPayment.payment_type === 'entrance' ? 'Taxa de Adesão' : selectedPayment.payment_type === 'subscription' ? 'Assinatura' : selectedPayment.payment_type || '—'}</span>
                </div>
                <div className="pe-detail-item">
                  <label>Valor</label>
                  <span style={{ fontSize: 20, fontWeight: 700, color: '#10B981' }}>R$ {Number(selectedPayment.amount || 0).toFixed(2)}</span>
                </div>
                {selectedPayment.original_amount > 0 && selectedPayment.original_amount !== selectedPayment.amount && (
                  <div className="pe-detail-item">
                    <label>Valor Original</label>
                    <span style={{ textDecoration: 'line-through', color: '#9ca3af' }}>R$ {Number(selectedPayment.original_amount).toFixed(2)}</span>
                  </div>
                )}
                {selectedPayment.discount_amount > 0 && (
                  <div className="pe-detail-item">
                    <label>Desconto</label>
                    <span style={{ color: '#10B981', fontWeight: 600 }}>-R$ {Number(selectedPayment.discount_amount).toFixed(2)}</span>
                  </div>
                )}

                <div className="pe-detail-divider" />

                <div className="pe-detail-item">
                  <label>Usuário</label>
                  <a className="pe-link" onClick={() => selectedPayment.user?.id && navigate(`/admin/users/${selectedPayment.user.id}`)} title="Ver perfil">
                    {selectedPayment.user?.name || '—'} ({selectedPayment.user?.email || '—'})
                  </a>
                </div>
                <div className="pe-detail-item">
                  <label>Grupo</label>
                  <a className="pe-link" onClick={() => selectedPayment.group?.id && navigate(`/admin/groups/${selectedPayment.group.id}/edit`)} title="Ver grupo">
                    {selectedPayment.group?.name || '—'} {selectedPayment.group?.slug ? `(#${selectedPayment.group.slug})` : ''}
                  </a>
                </div>
                <div className="pe-detail-item">
                  <label>Gateway</label>
                  <span><span className="plan-badge">{selectedPayment.gateway || '—'}</span></span>
                </div>
                <div className="pe-detail-item">
                  <label>Método</label>
                  <span>{selectedPayment.payment_method === 'pix' ? 'PIX' : selectedPayment.payment_method === 'credit_card' ? 'Cartão de Crédito' : selectedPayment.payment_method === 'boleto' ? 'Boleto' : selectedPayment.payment_method || '—'}</span>
                </div>

                <div className="pe-detail-divider" />

                <div className="pe-detail-item">
                  <label>ID Transação Gateway</label>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>{selectedPayment.gateway_transaction_id || '—'}</span>
                </div>
                <div className="pe-detail-item">
                  <label>Referência Externa</label>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>{selectedPayment.external_reference || '—'}</span>
                </div>
                {selectedPayment.coupon_id && (
                  <div className="pe-detail-item">
                    <label>Cupom Utilizado</label>
                    <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{selectedPayment.coupon_id.substring(0, 8)}...</span>
                  </div>
                )}
                {selectedPayment.error_message && (
                  <div className="pe-detail-item">
                    <label>Erro</label>
                    <span style={{ color: '#EF4444' }}>{selectedPayment.error_message}</span>
                  </div>
                )}

                <div className="pe-detail-divider" />

                <div className="pe-detail-item">
                  <label>Criado em</label>
                  <span>{selectedPayment.created_at ? formatFullDate(selectedPayment.created_at) : '—'}</span>
                </div>
                <div className="pe-detail-item">
                  <label>Atualizado em</label>
                  <span>{selectedPayment.updated_at ? formatFullDate(selectedPayment.updated_at) : '—'}</span>
                </div>

                {selectedPayment.gateway_response && Object.keys(selectedPayment.gateway_response).length > 0 && (
                  <>
                    <div className="pe-detail-divider" />
                    <div className="pe-detail-item" style={{ gridColumn: '1 / -1' }}>
                      <label>Resposta do Gateway (JSON)</label>
                      <pre style={{ background: '#f1f5f9', padding: 12, borderRadius: 8, fontSize: 12, fontFamily: 'monospace', overflow: 'auto', maxHeight: 200, marginTop: 6, color: '#1e293b', border: '1px solid #e2e8f0' }}>
                        {JSON.stringify(selectedPayment.gateway_response, null, 2)}
                      </pre>
                    </div>
                  </>
                )}
              </div>
              {(selectedPayment.status !== 'approved' && selectedPayment.status !== 'confirmed') && (
                <div style={{ marginTop: 16, padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      className="pe-btn"
                      onClick={async () => {
                        if (!selectedPayment.gateway_transaction_id && !selectedPayment.id) return;
                        setPaymentsActionLoading(true);
                        setModalSuccess('');
                        setModalError('');
                        setModalInfo('');
                        try {
                          const { data: { session } } = await supabase.auth.getSession();
                          const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/force-confirm-payment`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                            body: JSON.stringify({
                              payment_id: selectedPayment.id,
                              transaction_id: selectedPayment.gateway_transaction_id,
                              group_id: selectedPayment.group?.id,
                              user_id: selectedPayment.user?.id,
                              payment_type: selectedPayment.payment_type,
                            }),
                          });
                          const result = await resp.json();
                          if (result.confirmed) {
                            setModalSuccess('Pagamento confirmado com sucesso!');
                            setSelectedPayment({ ...selectedPayment, status: 'approved' });
                          } else {
                            setModalError(result.error || `Status no gateway: ${result.iopay_status || 'desconhecido'}`);
                          }
                          if (result.iopay_status) {
                            setModalInfo(`Status IOPay: ${result.iopay_status}`);
                          }
                        } catch (err) {
                          setModalError(err.message);
                        } finally {
                          setPaymentsActionLoading(false);
                        }
                      }}
                      disabled={paymentsActionLoading}
                    >
                      {paymentsActionLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      Verificar no Gateway
                    </button>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      Consulta o status real no IOPay e tenta confirmar o pagamento.
                    </span>
                  </div>
                  {modalSuccess && <div className="pe-success-banner" style={{ marginTop: 10 }}>{modalSuccess}</div>}
                  {modalError && <div className="pe-error-banner" style={{ marginTop: 10 }}>{modalError}</div>}
                  {modalInfo && <div style={{ marginTop: 10, padding: '6px 10px', background: '#f1f5f9', borderRadius: 6, fontSize: 12, color: '#475569', border: '1px solid #e2e8f0' }}>{modalInfo}</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Withdrawal Detail Modal */}
      {selectedWithdrawal && (
        <div className="pe-modal-overlay" onClick={() => setSelectedWithdrawal(null)}>
          <div className="pe-modal" onClick={e => e.stopPropagation()}>
            <div className="pe-modal-header">
              <h3><Wallet size={20} /> Detalhes do Saque</h3>
              <button className="pe-modal-close" onClick={() => setSelectedWithdrawal(null)}>×</button>
            </div>
            <div className="pe-modal-body">
              <div className="pe-detail-grid">
                <div className="pe-detail-item">
                  <label>Status</label>
                  <span className={`status-badge ${selectedWithdrawal.status === 'completed' ? 'active' : selectedWithdrawal.status === 'rejected' ? 'rejected' : 'pending'}`}>
                    {selectedWithdrawal.status === 'pending' ? 'Pendente' : selectedWithdrawal.status === 'processing' ? 'Processando' : selectedWithdrawal.status === 'completed' ? 'Pago' : selectedWithdrawal.status === 'rejected' ? 'Recusado' : selectedWithdrawal.status || '—'}
                  </span>
                </div>
                <div className="pe-detail-item">
                  <label>Valor Solicitado</label>
                  <span style={{ fontSize: 20, fontWeight: 700, color: '#10B981' }}>R$ {Number(selectedWithdrawal.amount || 0).toFixed(2)}</span>
                </div>

                <div className="pe-detail-divider" />

                <div className="pe-detail-item">
                  <label>Usuário</label>
                  <a className="pe-link" onClick={() => selectedWithdrawal.user?.id && navigate(`/admin/users/${selectedWithdrawal.user.id}`)} title="Ver perfil">
                    {selectedWithdrawal.user?.name || '—'} ({selectedWithdrawal.user?.email || '—'})
                  </a>
                </div>
                <div className="pe-detail-item">
                  <label>Método de Pagamento</label>
                  <span>{selectedWithdrawal.payment_method || '—'}</span>
                </div>
                {selectedWithdrawal.payment_details && (
                  <div className="pe-detail-item">
                    <label>Dados de Pagamento</label>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>{selectedWithdrawal.payment_details}</span>
                  </div>
                )}

                <div className="pe-detail-divider" />

                {selectedWithdrawal.processed_by && (
                  <div className="pe-detail-item">
                    <label>Processado por</label>
                    <span>{selectedWithdrawal.processor?.name || '—'} ({selectedWithdrawal.processor?.email || '—'})</span>
                  </div>
                )}
                {selectedWithdrawal.notes && (
                  <div className="pe-detail-item" style={{ gridColumn: '1 / -1' }}>
                    <label>Observações</label>
                    <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{selectedWithdrawal.notes}</span>
                  </div>
                )}

                <div className="pe-detail-divider" />

                <div className="pe-detail-item">
                  <label>Solicitado em</label>
                  <span>{selectedWithdrawal.requested_at ? formatFullDate(selectedWithdrawal.requested_at) : '—'}</span>
                </div>
                <div className="pe-detail-item">
                  <label>Processado em</label>
                  <span>{selectedWithdrawal.processed_at ? formatFullDate(selectedWithdrawal.processed_at) : '—'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Refund Detail Modal */}
      {selectedRefund && (
        <div className="pe-modal-overlay" onClick={() => setSelectedRefund(null)}>
          <div className="pe-modal" onClick={e => e.stopPropagation()}>
            <div className="pe-modal-header">
              <h3><RefreshCw size={20} /> Detalhes do Reembolso</h3>
              <button className="pe-modal-close" onClick={() => setSelectedRefund(null)}>×</button>
            </div>
            <div className="pe-modal-body">
              <div className="pe-detail-grid">
                <div className="pe-detail-item">
                  <label>Status</label>
                  <span className="status-badge rejected">
                    {selectedRefund.status === 'refunded' ? 'Reembolsado' : selectedRefund.status === 'failed' ? 'Falhou' : selectedRefund.status || '—'}
                  </span>
                </div>
                <div className="pe-detail-item">
                  <label>Valor Reembolsado</label>
                  <span style={{ fontSize: 20, fontWeight: 700, color: '#EF4444' }}>-R$ {Number(selectedRefund.amount || 0).toFixed(2)}</span>
                </div>

                <div className="pe-detail-divider" />

                <div className="pe-detail-item">
                  <label>Usuário</label>
                  <a className="pe-link" onClick={() => selectedRefund.user?.id && navigate(`/admin/users/${selectedRefund.user.id}`)} title="Ver perfil">
                    {selectedRefund.user?.name || '—'} ({selectedRefund.user?.email || '—'})
                  </a>
                </div>
                <div className="pe-detail-item">
                  <label>Grupo</label>
                  <a className="pe-link" onClick={() => selectedRefund.group?.id && navigate(`/admin/groups/${selectedRefund.group.id}/edit`)} title="Ver grupo">
                    {selectedRefund.group?.name || '—'} {selectedRefund.group?.slug ? `(#${selectedRefund.group.slug})` : ''}
                  </a>
                </div>
                <div className="pe-detail-item">
                  <label>Tipo Original</label>
                  <span>{selectedRefund.payment_type === 'entrance' ? 'Taxa de Adesão' : selectedRefund.payment_type === 'subscription' ? 'Assinatura' : selectedRefund.payment_type === 'refund' ? 'Reembolso' : selectedRefund.payment_type || '—'}</span>
                </div>
                <div className="pe-detail-item">
                  <label>Gateway</label>
                  <span><span className="plan-badge">{selectedRefund.gateway || '—'}</span></span>
                </div>

                <div className="pe-detail-divider" />

                <div className="pe-detail-item">
                  <label>ID Transação Gateway</label>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>{selectedRefund.gateway_transaction_id || '—'}</span>
                </div>
                <div className="pe-detail-item">
                  <label>Referência Externa</label>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>{selectedRefund.external_reference || '—'}</span>
                </div>
                {selectedRefund.error_message && (
                  <div className="pe-detail-item" style={{ gridColumn: '1 / -1' }}>
                    <label>Erro</label>
                    <span style={{ color: '#EF4444' }}>{selectedRefund.error_message}</span>
                  </div>
                )}

                <div className="pe-detail-divider" />

                <div className="pe-detail-item">
                  <label>Criado em</label>
                  <span>{selectedRefund.created_at ? formatFullDate(selectedRefund.created_at) : '—'}</span>
                </div>
                <div className="pe-detail-item">
                  <label>Atualizado em</label>
                  <span>{selectedRefund.updated_at ? formatFullDate(selectedRefund.updated_at) : '—'}</span>
                </div>

                {selectedRefund.gateway_response && Object.keys(selectedRefund.gateway_response).length > 0 && (
                  <>
                    <div className="pe-detail-divider" />
                    <div className="pe-detail-item" style={{ gridColumn: '1 / -1' }}>
                      <label>Resposta do Gateway (JSON)</label>
                      <pre style={{ background: '#1e293b', padding: 12, borderRadius: 8, fontSize: 12, fontFamily: 'monospace', overflow: 'auto', maxHeight: 200, marginTop: 6, color: '#e2e8f0' }}>
                        {JSON.stringify(selectedRefund.gateway_response, null, 2)}
                      </pre>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancelled Sub Detail Modal */}
      {selectedCancelledSub && (
        <div className="pe-modal-overlay" onClick={() => setSelectedCancelledSub(null)}>
          <div className="pe-modal" onClick={e => e.stopPropagation()}>
            <div className="pe-modal-header">
              <h3><CreditCard size={20} /> Detalhes da Assinatura Cancelada</h3>
              <button className="pe-modal-close" onClick={() => setSelectedCancelledSub(null)}>×</button>
            </div>
            <div className="pe-modal-body">
              <div className="pe-detail-grid">
                <div className="pe-detail-item">
                  <label>Status</label>
                  <span className="status-badge rejected">Cancelada</span>
                </div>
                <div className="pe-detail-item">
                  <label>Valor</label>
                  <span style={{ fontSize: 20, fontWeight: 700 }}>R$ {Number(selectedCancelledSub.amount || 0).toFixed(2)}</span>
                </div>

                <div className="pe-detail-divider" />

                <div className="pe-detail-item">
                  <label>Usuário</label>
                  <a className="pe-link" onClick={() => selectedCancelledSub.user?.id && navigate(`/admin/users/${selectedCancelledSub.user.id}`)} title="Ver perfil">
                    {selectedCancelledSub.user?.name || '—'} ({selectedCancelledSub.user?.email || '—'})
                  </a>
                </div>
                <div className="pe-detail-item">
                  <label>Grupo</label>
                  <a className="pe-link" onClick={() => selectedCancelledSub.group?.id && navigate(`/admin/groups/${selectedCancelledSub.group.id}/edit`)} title="Ver grupo">
                    {selectedCancelledSub.group?.name || '—'} {selectedCancelledSub.group?.slug ? `(#${selectedCancelledSub.group.slug})` : ''}
                  </a>
                </div>
                <div className="pe-detail-item">
                  <label>Plano</label>
                  <span>{selectedCancelledSub.plan_type || '—'}</span>
                </div>
                <div className="pe-detail-item">
                  <label>Ciclo</label>
                  <span>{cycleLabel(selectedCancelledSub.billing_cycle)}</span>
                </div>

                {selectedCancelledSub.discount_amount > 0 && (
                  <>
                    <div className="pe-detail-divider" />
                    <div className="pe-detail-item">
                      <label>Desconto Aplicado</label>
                      <span style={{ color: '#10B981', fontWeight: 600 }}>-R$ {Number(selectedCancelledSub.discount_amount).toFixed(2)}</span>
                    </div>
                    {selectedCancelledSub.original_amount > 0 && (
                      <div className="pe-detail-item">
                        <label>Valor Original</label>
                        <span style={{ textDecoration: 'line-through', color: '#9ca3af' }}>R$ {Number(selectedCancelledSub.original_amount).toFixed(2)}</span>
                      </div>
                    )}
                    {selectedCancelledSub.coupon_id && (
                      <div className="pe-detail-item">
                        <label>Cupom Utilizado</label>
                        <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{selectedCancelledSub.coupon_id.substring(0, 8)}...</span>
                      </div>
                    )}
                  </>
                )}

                <div className="pe-detail-divider" />

                {selectedCancelledSub.card_id && (
                  <div className="pe-detail-item">
                    <label>Cartão</label>
                    <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{selectedCancelledSub.card_id}</span>
                  </div>
                )}
                {selectedCancelledSub.gateway && (
                  <div className="pe-detail-item">
                    <label>Gateway</label>
                    <span><span className="plan-badge">{selectedCancelledSub.gateway}</span></span>
                  </div>
                )}

                <div className="pe-detail-divider" />

                <div className="pe-detail-item">
                  <label>Criado em</label>
                  <span>{selectedCancelledSub.created_at ? formatFullDate(selectedCancelledSub.created_at) : '—'}</span>
                </div>
                <div className="pe-detail-item">
                  <label>Cancelado em</label>
                  <span>{selectedCancelledSub.updated_at ? formatFullDate(selectedCancelledSub.updated_at) : '—'}</span>
                </div>
                {selectedCancelledSub.next_charge_at && (
                  <div className="pe-detail-item">
                    <label>Próxima cobrança (antes do cancelamento)</label>
                    <span>{formatFullDate(selectedCancelledSub.next_charge_at)}</span>
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

export default PlatformEvents;
