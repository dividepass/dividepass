import {
  Activity, AlertTriangle, Ban, CheckCircle, CreditCard, DollarSign, Info,
  LogIn, Mail, RefreshCw, ShieldCheck, Siren, Trash2, UserMinus, UserPlus,
  Users, Wallet, XCircle,
} from 'lucide-react';

/* ---------------------------------------------------------------------------
 * Registro único de tipos de evento.
 *
 * Antes o tipo vivia espalhado em três lugares (filtros, ícones e classes de
 * cor) e três tipos reais — manual_info, manual_urgent e group_alert — ficavam
 * sem ícone, sem label e sem cor. Aqui o tipo vira um registro só.
 * ------------------------------------------------------------------------- */

/* Um tom de cor por tipo.
   blue   = ciclo de vida da conta
   green  = dinheiro entrando / ação liberada
   amber  = merece atenção
   red    = problema
   violet = cobrança
   cyan   = comunicação
   slate  = ruído de fundo */
export const EVENT_TONE = {
  user_registered: 'blue',
  user_login: 'slate',
  group_created: 'blue',
  group_approved: 'green',
  group_rejected: 'red',
  group_deleted: 'red',
  group_alert: 'amber',
  checkout_opened: 'violet',
  member_joined: 'green',
  member_left: 'slate',
  email_code_requested: 'cyan',
  payment: 'green',
  refund: 'violet',
  subscription_cancelled: 'amber',
  withdrawal_requested: 'amber',
  withdrawal_approved: 'green',
  withdrawal_rejected: 'red',
  manual_info: 'slate',
  manual_urgent: 'red',
  info: 'slate',
};

export const EVENT_META = {
  user_registered: { label: 'Cadastro', icon: UserPlus },
  user_login: { label: 'Login', icon: LogIn },
  group_created: { label: 'Grupo criado', icon: Users },
  group_approved: { label: 'Grupo aprovado', icon: CheckCircle },
  group_rejected: { label: 'Grupo recusado', icon: XCircle },
  group_deleted: { label: 'Grupo removido', icon: Trash2 },
  group_alert: { label: 'Alerta de grupo', icon: AlertTriangle },
  checkout_opened: { label: 'Checkout', icon: CreditCard },
  member_joined: { label: 'Entrada', icon: UserPlus },
  member_left: { label: 'Saída', icon: UserMinus },
  email_code_requested: { label: 'E-mail', icon: Mail },
  payment: { label: 'Pagamento', icon: DollarSign },
  refund: { label: 'Reembolso', icon: RefreshCw },
  subscription_cancelled: { label: 'Cancelamento', icon: Ban },
  withdrawal_requested: { label: 'Saque pedido', icon: Wallet },
  withdrawal_approved: { label: 'Saque aprovado', icon: CheckCircle },
  withdrawal_rejected: { label: 'Saque recusado', icon: XCircle },
  manual_info: { label: 'Manual', icon: Info },
  manual_urgent: { label: 'Urgente', icon: Siren },
  info: { label: 'Informativo', icon: Activity },
};

/* Filtros que abrem o registro bruto de eventos. */
export const LOG_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'user_login', label: 'Logins' },
  { value: 'email_code_requested', label: 'Códigos de e-mail' },
  { value: 'checkout_opened', label: 'Checkouts' },
  { value: 'group_alert', label: 'Alertas de grupo' },
  { value: 'manual_info', label: 'Manuais' },
  { value: 'manual_urgent', label: 'Urgentes' },
  { value: 'info', label: 'Informativos' },
];

export const LOG_FILTER_VALUES = LOG_FILTERS.map(f => f.value);

/* Filtros que abrem uma consulta de dados (tabela), não o registro bruto. */
export const TABLE_FILTERS = [
  { value: 'user_registered', label: 'Usuários', icon: Users },
  { value: 'group_approved', label: 'Grupos ativos', icon: CheckCircle },
  { value: 'group_created', label: 'Aguardando aprovação', icon: ShieldCheck },
  { value: 'group_rejected', label: 'Grupos recusados', icon: XCircle },
  { value: 'group_deleted', label: 'Grupos removidos', icon: Trash2 },
  { value: 'member_joined', label: 'Entradas', icon: UserPlus },
  { value: 'member_left', label: 'Saídas', icon: UserMinus },
  { value: 'payment', label: 'Pagamentos', icon: CreditCard },
  { value: 'withdrawal_requested', label: 'Saques', icon: Wallet },
  { value: 'refund', label: 'Reembolsos', icon: RefreshCw },
  { value: 'subscription_cancelled', label: 'Cancelamentos', icon: Ban },
];

/* Períodos offered no registro. */
export const PERIODS = [
  { value: '24h', label: '24 horas' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'all', label: 'Tudo' },
];

const PERIOD_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export function periodStart(period) {
  if (!PERIOD_MS[period]) return null;
  return new Date(Date.now() - PERIOD_MS[period]).toISOString();
}

const pad = (n) => String(n).padStart(2, '0');

/* 24/10 · 17:27:21 — compacto e alinhável. */
export function formatStamp(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} · ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatFullDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function formatRelative(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 0) return 'agora';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} meses`;
  return `${Math.floor(months / 12)} anos`;
}

export function dayKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'sem-data';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayLabel(key) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  if (key === today) return 'Hoje';
  if (key === yesterday) return 'Ontem';
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return 'Sem data';
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date
    .toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'short',
      ...(sameYear ? {} : { year: 'numeric' }),
    })
    .replace('.', '');
}

/* --------------------------------------------------------------------------
 * Leitura do metadata
 * ------------------------------------------------------------------------ */

const META_LABELS = {
  user_id: 'Usuário (id)',
  group_id: 'Grupo (id)',
  service_id: 'Serviço (id)',
  email: 'E-mail',
  name: 'Nome',
  amount: 'Valor',
  discount_amount: 'Desconto',
  gateway: 'Gateway',
  payment_type: 'Tipo de cobrança',
  transaction_id: 'Transação',
  billing_cycle: 'Ciclo',
  forced: 'Forçado',
};

const CYCLE_LABELS = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
  custom: 'Personalizado',
  days: 'Por dias',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatMetaValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (key === 'amount' || key === 'discount_amount') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }
    return String(value);
  }
  if (key === 'payment_type') {
    if (value === 'entrance') return 'Adesão';
    if (value === 'subscription') return 'Assinatura';
    return String(value);
  }
  if (key === 'billing_cycle') return CYCLE_LABELS[value] || String(value);
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

/* Transforma o metadata em uma lista chave/valor legível. */
export function metaEntries(meta) {
  if (!meta || typeof meta !== 'object') return [];
  return Object.entries(meta).map(([key, value]) => ({
    key,
    label: META_LABELS[key] || key.replace(/_/g, ' '),
    value: formatMetaValue(key, value),
    mono: UUID_RE.test(String(value)) || key.endsWith('_id') || key === 'transaction_id',
  }));
}

export function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
