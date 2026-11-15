import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  DollarSign,
  ListChecks,
  RefreshCw,
  Tag,
  Target,
  Ticket,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getRecurrenceMonths } from '../../lib/expenseRecurrence';
import DrilldownModal from '../../components/DrilldownModal';
import EvolutionSection from './EvolutionSection';
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

/* Rótulo e tom de cada status de pagamento (enum payment_status). */
const PAYMENT_STATUS_LABELS = {
  paid: 'Pago',
  pending: 'Pendente',
  failed: 'Falhou',
  refunded: 'Estornado',
  cancelled: 'Cancelado',
};

const PAYMENT_STATUS_TONES = {
  paid: 'success',
  pending: 'warning',
  failed: 'error',
  refunded: 'info',
  cancelled: '',
};

const EXPENSE_CATEGORY_LABELS = {
  hosting: 'Hosting/Infra',
  api: 'APIs/Serviços',
  domain: 'Domínio/SSL',
  marketing: 'Marketing',
  tools: 'Ferramentas',
  personnel: 'Pessoal',
  payment: 'Gateway de pagamento',
  other: 'Outro',
};

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/* ────────────────────────────────────────────────────────────────────── *
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

const pad2 = (n) => String(n).padStart(2, '0');

const monthKey = (date = new Date()) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;

function startOfDayIso(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

function firstDayOfMonthIso(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString();
}

function lastDayOfMonthIso(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59).toISOString();
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value) || 0);
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

/* ────────────────────────────────────────────────────────────────────── *
 * Drill-downs — QUEM está atrás de cada contagem do painel.
 *
 * Cada card do painel com número clicable abre uma destas listas. As
 * linhas carregam links para o usuário (/admin/users/:id), o grupo
 * (/admin/groups/:id/manage) e o ticket (/admin/support/:id), e um bloco
 * expansível com os detalhes da transação. Tudo é carregado POR DEMANDA:
 * o carregamento inicial do painel não paga o preço de detalhes que
 * ninguém pediu.
 * ────────────────────────────────────────────────────────────────────── */

const userLink = (id) => (id ? { to: `/admin/users/${id}`, label: 'Usuário' } : null);
const groupLink = (id) => (id ? { to: `/admin/groups/${id}/manage`, label: 'Grupo' } : null);
const ticketLink = (id) => (id ? { to: `/admin/support/${id}`, label: 'Ticket' } : null);

function paymentToRow(p) {
  return {
    key: p.id,
    primary: p.user?.name || p.user?.email || 'Usuário',
    secondary: [
      p.user?.email,
      p.group?.name || 'Grupo removido',
      p.group?.service?.name,
      formatRelativeTime(p.created_at),
    ].filter(Boolean).join(' · '),
    links: [userLink(p.user?.id), groupLink(p.group?.id)].filter(Boolean),
    detail: [
      { label: 'Transação', value: p.transaction_code || '—' },
      { label: 'Método', value: p.method || '—' },
      { label: 'Gateway', value: p.gateway || '—' },
      { label: 'Criado em', value: formatDateTime(p.created_at) },
      { label: 'Pago em', value: p.paid_at ? formatDateTime(p.paid_at) : '—' },
    ],
    value: formatCurrency(p.amount),
    tone: PAYMENT_STATUS_TONES[p.status] || '',
    badge: PAYMENT_STATUS_LABELS[p.status] || p.status,
  };
}

async function loadPayments(from) {
  const { data, error } = await supabase
    .from('payments')
    .select(`
      id, amount, status, method, gateway, paid_at, created_at, transaction_code,
      user:user_id (id, name, email),
      group:group_id (id, name, service:service_id (id, name))
    `)
    .gte('created_at', from)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  return (data || []).map(paymentToRow);
}

/** Despesas que incidem no mês corrente — a mesma regra da Evolução. */
function expenseHitsCurrentMonth(expense, key) {
  if (expense.is_recurring) {
    const months = getRecurrenceMonths(
      expense.recurrence_day,
      expense.start_date || expense.due_date,
      expense.recurrence_end_date,
      expense.recurrence_count,
      expense.skipped_months
    );
    return months.includes(key);
  }
  return String(expense.due_date || '').slice(0, 7) === key;
}

const DRILLDOWNS = {
  'payments-today': {
    title: 'Pagamentos de hoje',
    description: 'Quem pagou hoje, em qual grupo e o status de cada transação.',
    footerTo: '/admin/billing',
    footerLabel: 'Ver financeiro completo',
    load: () => loadPayments(startOfDayIso()),
  },
  'payments-month': {
    title: `Pagamentos de ${MONTH_NAMES[new Date().getMonth()]}`,
    description: 'Todas as cobranças do mês — confirmadas, pendentes e falhadas.',
    footerTo: '/admin/billing',
    footerLabel: 'Ver financeiro completo',
    load: () => loadPayments(firstDayOfMonthIso()),
  },
  'costs-month': {
    title: 'Custos do mês',
    description: 'Contas matriz ativas e despesas que incidem neste mês.',
    footerTo: '/admin/expenses',
    footerLabel: 'Gerenciar despesas',
    load: async () => {
      const key = monthKey();
      const [accountsRes, expensesRes] = await Promise.all([
        supabase
          .from('master_accounts')
          .select('id, email, cost, status, due_day, service:service_id (id, name)')
          .eq('status', 'active'),
        supabase
          .from('expenses')
          .select('id, description, category, amount, is_recurring, recurrence_day, start_date, due_date, status'),
      ]);

      if (accountsRes.error) throw new Error(accountsRes.error.message);
      if (expensesRes.error) throw new Error(expensesRes.error.message);

      const accountRows = (accountsRes.data || []).map((account) => ({
        key: `acc-${account.id}`,
        primary: account.service?.name || 'Conta matriz',
        secondary: [account.email, `vence dia ${account.due_day || '—'}`].filter(Boolean).join(' · '),
        links: [],
        detail: [
          { label: 'Serviço', value: account.service?.name || '—' },
          { label: 'E-mail', value: account.email || '—' },
          { label: 'Custo mensal', value: formatCurrency(account.cost) },
          { label: 'Vencimento', value: `dia ${account.due_day || '—'}` },
          { label: 'Status', value: 'Ativa' },
        ],
        value: formatCurrency(account.cost),
        tone: 'info',
        badge: 'Conta matriz',
      }));

      const expenseRows = (expensesRes.data || [])
        .filter((expense) => expenseHitsCurrentMonth(expense, key))
        .map((expense) => ({
          key: `exp-${expense.id}`,
          primary: expense.description || 'Despesa',
          secondary: [
            EXPENSE_CATEGORY_LABELS[expense.category] || 'Outro',
            expense.is_recurring ? `recorrente · dia ${expense.recurrence_day || '—'}` : 'avulsa',
          ].join(' · '),
          links: [],
          detail: [
            { label: 'Categoria', value: EXPENSE_CATEGORY_LABELS[expense.category] || 'Outro' },
            { label: 'Valor', value: formatCurrency(expense.amount) },
            { label: 'Recorrência', value: expense.is_recurring ? `todo dia ${expense.recurrence_day || '—'}` : 'avulsa' },
            { label: 'Vencimento', value: expense.due_date || '—' },
            { label: 'Status', value: expense.status || '—' },
          ],
          value: formatCurrency(expense.amount),
          tone: 'warning',
          badge: 'Despesa',
        }));

      return [...accountRows, ...expenseRows];
    },
  },
  'signups-today': {
    title: 'Registros de hoje',
    description: 'Contas criadas hoje — e quem delas já virou assinante.',
    footerTo: '/admin/users',
    footerLabel: 'Ver todos os usuários',
    load: () => loadSignups(startOfDayIso()),
  },
  'signups-month': {
    title: 'Registros do mês',
    description: 'Contas criadas neste mês — e quem delas já virou assinante.',
    footerTo: '/admin/users',
    footerLabel: 'Ver todos os usuários',
    load: () => loadSignups(firstDayOfMonthIso()),
  },
  subscriptions: {
    title: 'Assinaturas ativas',
    description: 'Quem está pagando agora, em qual grupo e quanto.',
    footerTo: '/admin/subscriptions',
    footerLabel: 'Ver todas as assinaturas',
    load: async () => {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select(`
          id, amount, status, billing_cycle, next_charge_at, renewal_due_at, created_at,
          user:user_id (id, name, email),
          group:group_id (id, name, service:service_id (id, name))
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw new Error(error.message);

      return (data || []).map((sub) => ({
        key: sub.id,
        primary: sub.user?.name || sub.user?.email || 'Usuário',
        secondary: [
          sub.user?.email,
          sub.group?.name || 'sem grupo',
          sub.group?.service?.name,
        ].filter(Boolean).join(' · '),
        links: [userLink(sub.user?.id), groupLink(sub.group?.id)].filter(Boolean),
        detail: [
          { label: 'Valor', value: formatCurrency(sub.amount) },
          { label: 'Ciclo', value: sub.billing_cycle || '—' },
          { label: 'Próxima cobrança', value: sub.next_charge_at ? formatDateTime(sub.next_charge_at) : '—' },
          { label: 'Renovação', value: sub.renewal_due_at ? formatDateTime(sub.renewal_due_at) : '—' },
          { label: 'Desde', value: formatDateTime(sub.created_at) },
        ],
        value: formatCurrency(sub.amount),
        tone: 'success',
        badge: 'Ativa',
      }));
    },
  },
  'tickets-open': {
    title: 'Tickets abertos',
    description: 'Tickets aguardando resposta do admin.',
    footerTo: '/admin/support',
    footerLabel: 'Ver todos os tickets',
    load: () => loadTickets({ criticalOnly: false }),
  },
  'critical-tickets': {
    title: 'Tickets críticos',
    description: 'Prioridade crítica, ainda sem solução.',
    footerTo: '/admin/support',
    footerLabel: 'Ver todos os tickets',
    load: () => loadTickets({ criticalOnly: true }),
  },
  'failed-payments': {
    title: 'Falhas de pagamento no mês',
    description: 'Tentativas rejeitadas pelo gateway neste mês.',
    footerTo: '/admin/billing/failures',
    footerLabel: 'Ver falhas no financeiro',
    load: async () => {
      const { data, error } = await supabase
        .from('payment_attempts')
        .select(`
          id, amount, status, gateway, payment_method, error_message,
          gateway_transaction_id, external_reference, created_at,
          user:user_id (id, name, email),
          group:group_id (id, name)
        `)
        .in('status', ['polled_failed', 'webhook_rejected'])
        .gte('created_at', firstDayOfMonthIso())
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw new Error(error.message);

      return (data || []).map((attempt) => ({
        key: attempt.id,
        primary: attempt.user?.name || attempt.user?.email || 'Usuário',
        secondary: [
          attempt.user?.email,
          attempt.group?.name || 'sem grupo',
          formatRelativeTime(attempt.created_at),
        ].filter(Boolean).join(' · '),
        links: [userLink(attempt.user?.id), groupLink(attempt.group?.id)].filter(Boolean),
        detail: [
          { label: 'Gateway', value: attempt.gateway || '—' },
          { label: 'Método', value: attempt.payment_method || '—' },
          { label: 'Transação', value: attempt.gateway_transaction_id || attempt.external_reference || '—' },
          { label: 'Erro', value: attempt.error_message || '—' },
          { label: 'Quando', value: formatDateTime(attempt.created_at) },
        ],
        value: formatCurrency(attempt.amount),
        tone: 'error',
        badge: 'Falhou',
      }));
    },
  },
  'onboarding-pending': {
    title: 'Onboarding não concluído',
    description: 'Quem começou o onboarding e parou no meio do caminho.',
    footerTo: '/admin/onboarding',
    footerLabel: 'Ver relatório de onboarding',
    load: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, email, onboarding_step, onboarding_started_at, created_at')
        .not('onboarding_started_at', 'is', null)
        .is('onboarding_completed_at', null)
        .order('onboarding_started_at', { ascending: false })
        .limit(100);

      if (error) throw new Error(error.message);

      return (data || []).map((u) => ({
        key: u.id,
        primary: u.name || u.email || 'Usuário',
        secondary: `${u.email || 'sem e-mail'} · começou ${formatRelativeTime(u.onboarding_started_at)}`,
        links: [userLink(u.id)].filter(Boolean),
        detail: [
          { label: 'E-mail', value: u.email || '—' },
          { label: 'Etapa', value: u.onboarding_step != null ? `${u.onboarding_step}` : '—' },
          { label: 'Começou em', value: formatDateTime(u.onboarding_started_at) },
          { label: 'Cadastro', value: formatDateTime(u.created_at) },
        ],
        value: '',
        tone: 'warning',
        badge: 'Incompleto',
      }));
    },
  },
  waitlist: {
    title: 'Lista de espera de grupos',
    description: 'Quem quer entrar em um grupo que ainda tem vaga fechada.',
    footerTo: '/admin/interest',
    footerLabel: 'Ver lista completa',
    load: async () => {
      const { data, error } = await supabase
        .from('group_interest')
        .select(`
          id, message, created_at,
          user:user_id (id, name, email),
          group:group_id (id, name),
          service:service_id (id, name)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw new Error(error.message);

      return (data || []).map((entry) => ({
        key: entry.id,
        primary: entry.user?.name || entry.user?.email || 'Usuário',
        secondary: [
          entry.user?.email,
          entry.service?.name,
          entry.group?.name,
        ].filter(Boolean).join(' · '),
        links: [userLink(entry.user?.id), groupLink(entry.group?.id)].filter(Boolean),
        detail: [
          { label: 'Serviço', value: entry.service?.name || '—' },
          { label: 'Grupo', value: entry.group?.name || '—' },
          { label: 'Mensagem', value: entry.message || '—' },
          { label: 'Desde', value: formatDateTime(entry.created_at) },
        ],
        value: formatRelativeTime(entry.created_at),
        tone: 'info',
        badge: 'Em espera',
      }));
    },
  },
  'coupons-expiring': {
    title: 'Cupons expirando em 7 dias',
    description: 'Cupons ativos cuja validade termina em até 7 dias — ou já terminou.',
    footerTo: '/admin/coupons',
    footerLabel: 'Ver cupons',
    load: async () => {
      const now = new Date();
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('coupons')
        .select('id, code, discount_type, discount_value, expires_at')
        .eq('active', true)
        .not('expires_at', 'is', null)
        .lte('expires_at', in7Days)
        .order('expires_at', { ascending: true })
        .limit(50);

      if (error) throw new Error(error.message);

      return (data || []).map((coupon) => {
        const daysLeft = Math.ceil((new Date(coupon.expires_at) - now) / 86400000);
        const discount =
          coupon.discount_type === 'percentage'
            ? `${Number(coupon.discount_value || 0).toFixed(0)}% OFF`
            : `${formatCurrency(coupon.discount_value)} OFF`;

        return {
          key: coupon.id,
          primary: coupon.code || 'Cupom',
          secondary: `${discount} · expira ${formatDateTime(coupon.expires_at)}`,
          links: [],
          detail: [
            { label: 'Código', value: coupon.code || '—' },
            { label: 'Desconto', value: discount },
            { label: 'Expira em', value: formatDateTime(coupon.expires_at) },
          ],
          value: discount,
          tone: daysLeft < 0 ? 'error' : daysLeft <= 2 ? 'warning' : 'info',
          badge: daysLeft < 0 ? 'Expirado' : daysLeft === 0 ? 'Expira hoje' : `${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}`,
        };
      });
    },
  },
};

async function loadSignups(from) {
  const [usersRes, subsRes] = await Promise.all([
    supabase
      .from('users')
      .select('id, name, email, created_at')
      .eq('role', 'user')
      .gte('created_at', from)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('user_subscriptions')
      .select('user_id')
      .gte('created_at', from),
  ]);

  if (usersRes.error) throw new Error(usersRes.error.message);

  const subscriberIds = new Set((subsRes.data || []).map((s) => s.user_id));

  return (usersRes.data || []).map((u) => {
    const isSubscriber = subscriberIds.has(u.id);
    return {
      key: u.id,
      primary: u.name || u.email || 'Usuário',
      secondary: `${u.email || 'sem e-mail'} · registrou ${formatRelativeTime(u.created_at)}`,
      links: [userLink(u.id)].filter(Boolean),
      detail: [
        { label: 'E-mail', value: u.email || '—' },
        { label: 'Cadastro', value: formatDateTime(u.created_at) },
      ],
      value: '',
      tone: isSubscriber ? 'success' : '',
      badge: isSubscriber ? 'Assinante' : 'Sem assinatura',
    };
  });
}

async function loadTickets({ criticalOnly }) {
  let query = supabase
    .from('support_tickets')
    .select(`
      id, subject, category, priority, status, created_at,
      user:user_id (id, name, email)
    `)
    .eq('archived', false)
    .in('status', ['open', 'answered'])
    .order('created_at', { ascending: true })
    .limit(100);

  if (criticalOnly) {
    query = query.eq('priority', 'critical');
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data || []).map((ticket) => ({
    key: ticket.id,
    primary: ticket.subject || 'Ticket',
    secondary: [
      ticket.user?.name || ticket.user?.email,
      CATEGORY_LABELS[ticket.category] || 'Geral',
      formatRelativeTime(ticket.created_at),
    ].filter(Boolean).join(' · '),
    links: [userLink(ticket.user?.id), ticketLink(ticket.id)].filter(Boolean),
    detail: [
      { label: 'Status', value: ticket.status === 'open' ? 'Aberto' : 'Respondido' },
      { label: 'Prioridade', value: PRIORITY_LABELS[ticket.priority] || 'Normal' },
      { label: 'Categoria', value: CATEGORY_LABELS[ticket.category] || 'Geral' },
      { label: 'Criado em', value: formatDateTime(ticket.created_at) },
    ],
    value: '',
    tone: ticket.priority === 'critical' ? 'error' : ticket.priority === 'high' ? 'warning' : '',
    badge: PRIORITY_LABELS[ticket.priority] || 'Normal',
  }));
}

/* ────────────────────────────────────────────────────────────────────── *
 * Card de métrica
 * ────────────────────────────────────────────────────────────────────── */

function MetricCard({ card, onDrill, onNavigate }) {
  const clickable = Boolean(card.drill || card.to);

  const content = (
    <>
      <div className={`metric-icon ${card.tone}`} aria-hidden>
        {card.icon}
      </div>
      <div className="metric-info">
        <span className="metric-label">{card.label}</span>
        <span className={`metric-value ${card.valueClass || ''}`}>{card.value}</span>
        <span className="metric-sub">{card.sub}</span>
      </div>
      {clickable && <ChevronRight size={16} className="metric-go" aria-hidden />}
    </>
  );

  if (!clickable) {
    return <div className="metric-card">{content}</div>;
  }

  return (
    <button
      type="button"
      className="metric-card is-clickable"
      onClick={card.drill ? () => onDrill(card.drill) : () => onNavigate(card.to)}
      title={card.drillTitle || card.label}
    >
      {content}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────── *
 * Painel
 * ────────────────────────────────────────────────────────────────────── */

function AdminDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    totalUsers: 0,
    activeSubscriptions: 0,
    monthlyRevenue: 0,
    todayRevenue: 0,
    todayCount: 0,
    costs: 0,
    expectedProfit: 0,
    openTickets: 0,
  });

  /* Pagamentos do mês: o card mostra o total; o clique abre quem pagou,
     em qual grupo, quanto e com que status. */
  const [payments, setPayments] = useState([]);
  const [signups, setSignups] = useState({
    day: 0,
    week: 0,
    month: 0,
    subsDay: 0,
    converted: 0,
  });
  const [activities, setActivities] = useState([]);
  const [openTickets, setOpenTickets] = useState([]);
  const [criticalTickets, setCriticalTickets] = useState([]);
  const [pendingGroups, setPendingGroups] = useState([]);
  const [approvingGroup, setApprovingGroup] = useState(null);
  const [pending, setPending] = useState({
    failedPayments: 0,
    onboardingPending: 0,
    couponsExpiring: 0,
    groupsToApprove: 0,
    waitlist: 0,
  });

  /* Estado do drill-down aberto (linhas carregadas por demanda). */
  const [drill, setDrill] = useState(null);
  const [drillRows, setDrillRows] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState('');

  const fetchDashboard = useCallback(async () => {
    setLoading(true);

    try {
      const now = new Date();
      const firstDayOfMonth = firstDayOfMonthIso(now);
      const lastDayOfMonth = lastDayOfMonthIso(now);
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const startOfDay = startOfDayIso(now);
      // Início da semana (segunda) para o sub-texto dos registros do mês.
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
        expensesRes,
        paymentsTodayRes,
        ticketsRes,
        activityLogsRes,
        platformEventsRes,
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
        paymentsRes,
      ] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'user').maybeSingle().then(r => ({ ...r, count: r.count || 0 })),
        supabase.from('user_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active').maybeSingle().then(r => ({ ...r, count: r.count || 0 })),
        supabase.from('payments').select('amount, transaction_code, created_at').eq('status', 'paid').gte('created_at', firstDayOfMonth).lte('created_at', lastDayOfMonth),
        supabase.from('payment_attempts').select('amount, gateway_transaction_id, external_reference, status, created_at').gte('created_at', firstDayOfMonth).lte('created_at', lastDayOfMonth),
        supabase.from('master_accounts').select('cost').eq('status', 'active'),
        // Despesas do mês: fault-tolerant pela mesma razão — sem elas o
        // painel segue mostrando custo de contas matriz, só incompleto.
        supabase.from('expenses').select('id, amount, is_recurring, recurrence_day, start_date, due_date, recurrence_end_date, recurrence_count, skipped_months')
          .then(r => ({ data: r.data || [] }), () => ({ data: [] })),
        // Pagamentos de hoje: base do card "Receita de hoje". Fault-tolerant:
        // é dado novo do card — não pode derrubar métricas que já existiam.
        supabase.from('payments').select('amount, status, created_at').gte('created_at', startOfDay)
          .then(r => ({ data: r.data || [] }), () => ({ data: [] })),
        supabase.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'answered']).eq('archived', false).maybeSingle().then(r => ({ ...r, count: r.count || 0 })),
        supabase.from('activity_logs').select('id, action, description, created_at').gte('created_at', last24Hours).order('created_at', { ascending: false }).limit(10),
        supabase.from('platform_events').select('id, event_type, title, message, created_at').gte('created_at', last24Hours).order('created_at', { ascending: false }).limit(10),
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
        /* Pagamentos do mês, com quem pagou e em qual grupo. O "user" e o
           "group" vêm por join: sem eles o operador teria que abrir cada
           pagamento para descobrir de quem era. */
        supabase.from('payments').select(`
          id, amount, status, method, gateway, paid_at, created_at,
          transaction_code, user_id, group_id,
          user:user_id (id, name, email),
          group:group_id (id, name, service:service_id (id, name))
        `).gte('created_at', firstDayOfMonth).lte('created_at', lastDayOfMonth)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      const totalUsers = usersRes.count || 0;
      const activeSubscriptions = subsRes.count || 0;

      /* Receita do mês: payments "paid" + tentativas aprovadas que não
         viraram linha em payments (dedup por transação). */
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

      // Receita de hoje (status "paid").
      const todayPaid = (paymentsTodayRes.data || []).filter((p) => p.status === 'paid');
      const todayRevenue = todayPaid.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

      /* Custos do mês: contas matriz ativas + despesas que incidem no mês
         corrente (a mesma regra de recorrência da Evolução, do módulo
         compartilhado — nenhuma das duas telas inventa regra própria). */
      const saasCosts = (costsRes.data || []).reduce((sum, c) => sum + (Number(c.cost) || 0), 0);
      const currentMonth = monthKey(now);
      const expensesMonth = (expensesRes.data || [])
        .filter((expense) => expenseHitsCurrentMonth(expense, currentMonth))
        .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);

      const costs = saasCosts + expensesMonth;
      const expectedProfit = monthlyRevenue - costs;
      const openTickets = ticketsRes.count || 0;

      setMetrics({
        totalUsers,
        activeSubscriptions,
        monthlyRevenue,
        todayRevenue,
        todayCount: todayPaid.length,
        costs,
        expectedProfit,
        openTickets,
      });

      setPayments(paymentsRes.data || []);

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
        // Quem se registrou no mês E já tem assinatura.
        converted: newUsers.filter((u) => subUserIds.has(u.id)).length,
      });
    } catch (err) {
      console.error('AdminDashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  /**
   * Abre o drill-down de uma contagem: carrega a lista de quem está atrás
   * do número na hora do clique (por demanda, igual ao financeiro).
   */
  const openDrill = useCallback(async (key) => {
    const config = DRILLDOWNS[key];
    if (!config) return;

    setDrill({
      key,
      title: config.title,
      description: config.description,
      footerTo: config.footerTo,
      footerLabel: config.footerLabel,
    });
    setDrillRows([]);
    setDrillError('');
    setDrillLoading(true);

    try {
      const rows = await config.load();
      setDrillRows(rows);
    } catch (err) {
      console.error('Drilldown load error:', err);
      setDrillError(err.message || 'Falha ao carregar os detalhes.');
    } finally {
      setDrillLoading(false);
    }
  }, []);

  const closeDrill = useCallback(() => {
    setDrill(null);
    setDrillRows([]);
    setDrillError('');
  }, []);

  if (loading && metrics.totalUsers === 0 && !drill) {
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
   * Cada card abre o drill-down com QUEM está atrás da contagem.
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
      hint: 'ver tickets',
      drill: 'critical-tickets',
    },
    {
      id: 'failed-payments',
      icon: <Wallet size={17} />,
      tone: 'error',
      title: 'Falhas de pagamento no mês',
      count: pending.failedPayments,
      hint: 'ver tentativas',
      drill: 'failed-payments',
    },
    {
      id: 'open-tickets',
      icon: <Ticket size={17} />,
      tone: 'warning',
      title: 'Tickets abertos aguardando você',
      count: metrics.openTickets,
      hint: 'ver tickets',
      drill: 'tickets-open',
    },
    {
      id: 'onboarding',
      icon: <Target size={17} />,
      tone: 'warning',
      title: 'Onboarding começado e não concluído',
      count: pending.onboardingPending,
      hint: 'ver quem é',
      drill: 'onboarding-pending',
    },
    {
      id: 'waitlist',
      icon: <ListChecks size={17} />,
      tone: 'info',
      title: 'Pessoas na lista de espera de grupos',
      count: pending.waitlist,
      hint: 'ver quem é',
      drill: 'waitlist',
    },
    {
      id: 'coupons',
      icon: <Tag size={17} />,
      tone: 'info',
      title: 'Cupons expirando em 7 dias',
      count: pending.couponsExpiring,
      hint: 'ver cupons',
      drill: 'coupons-expiring',
    },
  ].filter((item) => item.count > 0);

  /* Resumo dos pagamentos do mês: o total é só o que está com status
     "paid". O sub do card mostra confirmados e pendentes. */
  const paymentsPaid = payments.filter((p) => p.status === 'paid');
  const paymentsPending = payments.filter((p) => p.status === 'pending');
  const queueTotal = queue.length + pendingGroups.length;

  const financeCards = [
    {
      icon: <DollarSign size={20} />,
      tone: 'economy',
      label: 'Receita de hoje',
      value: formatCurrency(metrics.todayRevenue),
      sub: `${metrics.todayCount} pagamento${metrics.todayCount === 1 ? '' : 's'} confirmado${metrics.todayCount === 1 ? '' : 's'}`,
      drill: 'payments-today',
      drillTitle: 'Ver quem pagou hoje',
    },
    {
      icon: <Wallet size={20} />,
      tone: 'primary',
      label: 'Receita do mês',
      value: formatCurrency(metrics.monthlyRevenue),
      sub: [
        `${paymentsPaid.length} confirmado${paymentsPaid.length === 1 ? '' : 's'}`,
        paymentsPending.length > 0 ? `${paymentsPending.length} pendente${paymentsPending.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · '),
      drill: 'payments-month',
      drillTitle: 'Ver quem pagou neste mês',
    },
    {
      icon: <TrendingDown size={20} />,
      tone: 'costs',
      label: 'Custos do mês',
      value: formatCurrency(metrics.costs),
      sub: 'contas matriz + despesas',
      drill: 'costs-month',
      drillTitle: 'Ver o que compõe o custo',
    },
    {
      icon: <TrendingUp size={20} />,
      tone: 'profit',
      label: 'Lucro previsto',
      value: formatCurrency(metrics.expectedProfit),
      valueClass: metrics.expectedProfit >= 0 ? 'positive' : 'negative',
      sub: 'receita − custos',
    },
  ];

  const growthCards = [
    {
      icon: <UserPlus size={20} />,
      tone: 'tech',
      label: 'Registros hoje',
      value: signups.day.toLocaleString('pt-BR'),
      sub: `${signups.subsDay} viraram assinante${signups.subsDay === 1 ? '' : 's'}`,
      drill: 'signups-today',
      drillTitle: 'Ver quem se registrou hoje',
    },
    {
      icon: <UserPlus size={20} />,
      tone: 'tech',
      label: 'Registros no mês',
      value: signups.month.toLocaleString('pt-BR'),
      sub: `${signups.week} na semana · ${signups.converted} seguiram para a assinatura`,
      drill: 'signups-month',
      drillTitle: 'Ver quem se registrou no mês',
    },
    {
      icon: <CreditCard size={20} />,
      tone: 'economy',
      label: 'Assinaturas ativas',
      value: metrics.activeSubscriptions.toLocaleString('pt-BR'),
      sub: 'em vigor agora',
      drill: 'subscriptions',
      drillTitle: 'Ver quem está assinando',
    },
    {
      icon: <Users size={20} />,
      tone: 'tech',
      label: 'Usuários',
      value: metrics.totalUsers.toLocaleString('pt-BR'),
      sub: 'contas cadastradas',
      to: '/admin/users',
      drillTitle: 'Abrir lista de usuários',
    },
  ];

  const todayLabel = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="fade-in admin-dashboard">
      <header className="dash-header">
        <div className="dash-header-info">
          <h1>Painel</h1>
          <p>
            <CalendarDays size={13} aria-hidden />
            {todayLabel}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline dash-refresh"
          onClick={fetchDashboard}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
          Atualizar
        </button>
      </header>

      {/* A fila vem antes dos números: é a pergunta que o operador abre o
          painel para responder. */}
      <section className="operator-queue" aria-labelledby="queue-title">
        <div className="queue-head">
          <h2 id="queue-title">Fila do operador</h2>
          {queueTotal > 0 ? (
            <span className="queue-count">
              {queueTotal} pendência{queueTotal > 1 ? 's' : ''}
            </span>
          ) : (
            <span className="queue-count queue-count-ok">nada pendente</span>
          )}
        </div>

        {/* Grupos criados por usuário: o primeiro item da fila, com a
            aprovação na mão. O nome do grupo leva ao gerenciamento dele. */}
        {pendingGroups.length > 0 && (
          <div className="queue-groups">
            <div className="queue-groups-head">
              <span className="queue-groups-title">
                <CheckCircle2 size={15} />
                Grupos aguardando sua aprovação
              </span>
              <button
                type="button"
                className="queue-see-all"
                onClick={() => navigate('/admin/platforms')}
              >
                Ver todas <ArrowRight size={13} />
              </button>
            </div>
            <ul className="queue-groups-list">
              {pendingGroups.map((group) => (
                <li key={group.id} className="queue-group-row">
                  <button
                    type="button"
                    className="queue-group-info"
                    onClick={() => navigate(`/admin/groups/${group.id}/manage`)}
                    title="Gerenciar grupo"
                  >
                    <span className="queue-group-name">{group.name}</span>
                    <span className="queue-group-meta">
                      {group.service?.name || 'Serviço'}
                      {' · '}
                      {group.owner?.name || 'Usuário'}
                      {' · '}
                      {formatRelativeTime(group.created_at)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="queue-group-approve"
                    disabled={approvingGroup === group.id}
                    onClick={() => approveGroup(group.id)}
                  >
                    {approvingGroup === group.id ? 'Aprovando...' : 'Aprovar'}
                  </button>
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
          <div className="queue-grid">
            {queue.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`queue-card ${item.tone}`}
                onClick={() => openDrill(item.drill)}
                title="Ver quem está atrás desta contagem"
              >
                <span className="queue-card-icon" aria-hidden>{item.icon}</span>
                <span className="queue-card-body">
                  <span className="queue-card-title">{item.title}</span>
                  <span className="queue-card-hint">{item.hint}</span>
                </span>
                <span className="queue-card-count">{item.count}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Financeiro ── contagem clicável = quem pagou / o que custa. */}
      <section className="dash-section" aria-label="Financeiro">
        <div className="dash-section-head">
          <h2>
            <Wallet size={15} aria-hidden />
            Financeiro
          </h2>
        </div>
        <div className="metrics-grid">
          {financeCards.map((card) => (
            <MetricCard key={card.label} card={card} onDrill={openDrill} onNavigate={navigate} />
          ))}
        </div>
      </section>

      {/* ── Crescimento ── */}
      <section className="dash-section" aria-label="Crescimento">
        <div className="dash-section-head">
          <h2>
            <TrendingUp size={15} aria-hidden />
            Crescimento
          </h2>
        </div>
        <div className="metrics-grid">
          {growthCards.map((card) => (
            <MetricCard key={card.label} card={card} onDrill={openDrill} onNavigate={navigate} />
          ))}
        </div>
      </section>

      {/* ── Evolução (antiga página /admin/evolution, agora embutida) ── */}
      <EvolutionSection />

      {/* ── Suporte + atividade ── */}
      <div className={`dash-lower ${openTickets.length > 0 ? 'has-support' : ''}`}>
        {openTickets.length > 0 && (
          <div className="support-block">
            <div className="panel-header">
              <h2>
                <AlertTriangle size={17} />
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
      </div>

      {/* Drill-down: a lista por trás da contagem clicada. */}
      {drill && (
        <DrilldownModal
          title={drill.title}
          description={drill.description}
          rows={drillRows}
          loading={drillLoading}
          error={drillError}
          footerTo={drill.footerTo}
          footerLabel={drill.footerLabel}
          onClose={closeDrill}
        />
      )}
    </div>
  );
}

export default AdminDashboard;
