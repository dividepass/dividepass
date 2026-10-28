/**
 * Métricas de evolução da plataforma (admin).
 *
 * Módulo PURO: recebe as linhas cruas do Supabase e devolve séries prontas
 * para o gráfico. Sem query, sem React — assim as regras (qual bucket usar,
 * como a receita é somada, quando um custo entra) podem ser testadas sem
 * browser e sem banco, e a página e o teste leem a MESMA definição.
 *
 * PERÍODOS
 * --------
 * O bucket é sempre calculado no fuso LOCAL do navegador. O admin olhando
 * "hoje" precisa ver o dia em que o evento aconteceu para ele — o dia UTC
 * seria o dia anterior para tudo que aconteceu depois das 21h (UTC-3).
 *
 * SEMENTE (SEED)
 * --------------
 * O setup do banco grava linhas de exemplo com UUID placeholder
 * (dddddddd-dddd-..., cccccccc-..., 22222222-...). Elas NÃO são atividade
 * real: somá-las ao gráfico inflaria a evolução da plataforma com grupos e
 * usuários que ninguém criou. `isSeedId` filtra essas linhas.
 */

// O caminho vem com `.js` de propósito: é o que permite rodar este módulo
// direto no Node (ver `scripts/verify-evolution-metrics.mjs`) sem bundler.
import { getRecurrenceMonths } from './expenseRecurrence.js';

/* ================================================================== *
 * Períodos
 * ================================================================== */

export const PERIODS = [
  { key: 'day', label: 'Dia' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mês' },
];

export const DEFAULT_PERIOD = 'month';

/**
 * Granularidade do gráfico financeiro: sempre MÊS.
 *
 * Receita e custo são fatos mensais (a conta matriz é paga todo mês, a
 * despesa vence num dia do mês). Amortizar isso em dia/weekenderia
 * inventar precisão que o banco não tem.
 */
export const FINANCIAL_PERIOD = 'month';

/* ================================================================== *
 * Datas e buckets
 * ================================================================== */

const pad2 = (n) => String(n).padStart(2, '0');

export function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Semana ISO (1..53) e ano ISO da data, calculados no fuso local. */
export function isoWeekParts(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = (d.getDay() + 6) % 7; // 0 = segunda-feira
  d.setDate(d.getDate() - dayNum + 3); // quinta-feira desta semana
  const isoYear = d.getFullYear();

  const firstThursday = new Date(isoYear, 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);

  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { year: isoYear, week };
}

/** Chave do bucket: `YYYY-MM-DD` | `YYYY-Www` | `YYYY-MM`. */
export function bucketKey(value, period = DEFAULT_PERIOD) {
  const d = toDate(value);
  if (!d) return null;

  if (period === 'day') {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  if (period === 'week') {
    const { year, week } = isoWeekParts(d);
    return `${year}-W${pad2(week)}`;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** Primeiro instante (local) do bucket — usado no rótulo e no eixo. */
export function bucketStart(key, period = DEFAULT_PERIOD) {
  if (!key) return null;

  if (period === 'day') {
    return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
  }

  if (period === 'week') {
    const [yearPart, weekPart] = String(key).split('-W');
    const year = Number(yearPart);
    const week = Number(weekPart);
    if (!Number.isFinite(year) || !Number.isFinite(week)) return null;

    // A segunda-feira da semana ISO 1 é a segunda que contém o dia 4 de janeiro.
    const jan4 = new Date(year, 0, 4);
    const jan4Day = (jan4.getDay() + 6) % 7;
    const week1Monday = new Date(year, 0, 4 - jan4Day);
    return new Date(
      week1Monday.getFullYear(),
      week1Monday.getMonth(),
      week1Monday.getDate() + (week - 1) * 7
    );
  }

  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1);
}

/** Rótulo curto do bucket (eixo X). */
export function bucketLabel(key, period = DEFAULT_PERIOD) {
  const d = bucketStart(key, period);
  if (!d) return key;
  if (period === 'month') return `${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

/** Rótulo longo (tooltip e tabela). */
export function bucketLongLabel(key, period = DEFAULT_PERIOD) {
  const d = bucketStart(key, period);
  if (!d) return key;

  if (period === 'month') {
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }
  if (period === 'week') {
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
    return `Semana de ${d.getDate()}/${d.getMonth() + 1} a ${end.getDate()}/${end.getMonth() + 1}`;
  }
  return d.toLocaleDateString('pt-BR');
}

/**
 * Lista contínua de buckets entre duas datas.
 *
 * Sem isso o gráfico teria buracos: um mês sem movimento simplesmente
 * sumiria do eixo, e a linha "passaria" por cima do vazio.
 */
export function buildBucketRange(startValue, endValue, period = DEFAULT_PERIOD) {
  const start = toDate(startValue);
  const end = toDate(endValue);
  if (!start || !end || end.getTime() < start.getTime()) return [];

  const keys = [];
  const lastKey = bucketKey(end, period);
  let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let guard = 0;

  while (guard < 1200) {
    const key = bucketKey(cursor, period);
    if (key) keys.push(key);
    if (key === lastKey) break;

    if (period === 'month') {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    } else {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + (period === 'week' ? 7 : 1));
    }
    guard++;
  }

  return keys;
}

/* ================================================================== *
 * Semente (seed)
 * ================================================================== */

/** UUID em que os quatro grupos repetem o mesmo caractere hex. */
const SEED_ID = /^([0-9a-f])\1{7}-\1{4}-\1{4}-\1{4}-\1{12}$/;

/** A linha veio do setup (seed) e não representa atividade real? */
export function isSeedId(id) {
  return typeof id === 'string' && SEED_ID.test(id.toLowerCase());
}

/* ================================================================== *
 * Receita
 * ================================================================== */

/** Status de `payment_attempts` que significam "o dinheiro entrou". */
export const SUCCESSFUL_ATTEMPT_STATUSES = [
  'approved', 'paid', 'authorized', 'captured', 'completed',
  'done', 'success', 'succeeded', 'settled', 'confirmed',
];

export function isSuccessfulAttemptStatus(status) {
  if (!status) return false;
  const s = String(status).toLowerCase();
  if (SUCCESSFUL_ATTEMPT_STATUSES.includes(s)) return true;
  return s.startsWith('polled_succeeded') || s.startsWith('webhook_approved');
}

/**
 * Receita por bucket.
 *
 * Duas fontes, na mesma ordem de prioridade do painel (/admin):
 *
 *  1. `payments` com status `paid` — é a fonte canônica: a linha existe
 *     depois que o gateway confirmou.
 *  2. `payment_attempts` com status de sucesso — cobre o caso em que o
 *     gateway confirmou mas a linha em `payments` não foi gravada. Uma
 *     tentativa cuja transação já aparece em `payments` é DESCARTADA, senão
 *     a mesma cobrança entraria na linha duas vezes.
 *
 * A deduplicação é GLOBAL (não por mês): uma tentativa de setembro que só
 * virou pagamento em outubro não pode ser contada nos dois meses.
 *
 * @returns {Map<string, number>} bucket -> valor em BRL
 */
export function buildRevenueSeries({
  payments = [],
  attempts = [],
  buckets = [],
  period = FINANCIAL_PERIOD,
} = {}) {
  const revenue = new Map(buckets.map((k) => [k, 0]));
  const paidKeys = new Set();

  payments.forEach((payment) => {
    if (!payment) return;
    if (String(payment.status || '').toLowerCase() !== 'paid') return;
    if (isSeedId(payment.id)) return;

    const key = payment.transaction_code || null;
    if (key) {
      if (paidKeys.has(key)) return; // mesma transação gravada duas vezes
      paidKeys.add(key);
    }

    const bucket = bucketKey(payment.created_at, period);
    if (!bucket || !revenue.has(bucket)) return;
    revenue.set(bucket, revenue.get(bucket) + (Number(payment.amount) || 0));
  });

  const attemptKeys = new Set();

  attempts.forEach((attempt) => {
    if (!attempt || !isSuccessfulAttemptStatus(attempt.status)) return;
    if (isSeedId(attempt.id)) return;

    const key = attempt.gateway_transaction_id || attempt.external_reference || null;
    if (key) {
      if (paidKeys.has(key)) return;   // já contado como pagamento
      if (attemptKeys.has(key)) return; // mesma tentativa contada duas vezes
      attemptKeys.add(key);
    }

    const bucket = bucketKey(attempt.created_at, period);
    if (!bucket || !revenue.has(bucket)) return;
    revenue.set(bucket, revenue.get(bucket) + (Number(attempt.amount) || 0));
  });

  return revenue;
}

/* ================================================================== *
 * Custos
 * ================================================================== */

/**
 * Custos por bucket (sempre por MÊS).
 *
 * `master_accounts` = contas matriz. O SaaS compra essas contas (Netflix,
 * Spotify...) para revender. A conta entra no custo no mês em que foi criada
 * e sai quando deixa de estar ativa — o banco não guarda histórico de
 * status, então `updated_at` é o melhor proxy disponível para a desativação.
 *
 * `expenses` = despesas operacionais (hosting, marketing, gateway). As
 * recorrentes contam em todo mês da recorrência; as avulsas, no mês do
 * vencimento.
 *
 * @returns {{ saas: Map<string, number>, operating: Map<string, number> }}
 */
export function buildCostSeries({ masterAccounts = [], expenses = [], buckets = [] } = {}) {
  const saas = new Map(buckets.map((k) => [k, 0]));
  const operating = new Map(buckets.map((k) => [k, 0]));

  masterAccounts.forEach((account) => {
    if (!account || isSeedId(account.id)) return;
    const cost = Number(account.cost) || 0;
    if (!cost) return;

    const startKey = bucketKey(account.created_at, FINANCIAL_PERIOD);
    if (!startKey) return;

    const isActive = String(account.status || 'active').toLowerCase() === 'active';
    const endKey = isActive ? null : bucketKey(account.updated_at || account.created_at, FINANCIAL_PERIOD);

    buckets.forEach((bucket) => {
      if (bucket < startKey) return;
      if (endKey && bucket > endKey) return;
      saas.set(bucket, saas.get(bucket) + cost);
    });
  });

  expenses.forEach((expense) => {
    if (!expense || isSeedId(expense.id)) return;
    const amount = Number(expense.amount) || 0;
    if (!amount) return;

    if (expense.is_recurring) {
      const months = getRecurrenceMonths(
        expense.recurrence_day,
        expense.start_date || expense.due_date,
        expense.recurrence_end_date,
        expense.recurrence_count,
        expense.skipped_months
      );
      months.forEach((month) => {
        if (!operating.has(month)) return;
        operating.set(month, operating.get(month) + amount);
      });
      return;
    }

    const month = typeof expense.due_date === 'string' ? expense.due_date.slice(0, 7) : null;
    if (!month || !operating.has(month)) return;
    operating.set(month, operating.get(month) + amount);
  });

  return { saas, operating };
}

/* ================================================================== *
 * Evolução da base
 * ================================================================== */

/** Usuário final (não admin) e não-semente. */
export function isEndUser(user) {
  if (!user || isSeedId(user.id)) return false;
  if (!user.role) return true;
  return String(user.role).toLowerCase() === 'user';
}

/** Assinatura real (não-semente). */
export function isRealSubscription(subscription) {
  if (!subscription || isSeedId(subscription.id)) return false;
  if (subscription.user_id && isSeedId(subscription.user_id)) return false;
  return true;
}

/**
 * Evolução da base: novos registros, novas assinaturas, novos grupos e o
 * total acumulado de usuários.
 *
 * @returns {{
 *   newUsers: Map<string, number>,
 *   newSubscriptions: Map<string, number>,
 *   newGroups: Map<string, number>,
 *   totalUsers: Map<string, number>,
 * }}
 */
export function buildEvolutionSeries({
  users = [],
  subscriptions = [],
  groups = [],
  buckets = [],
  period = DEFAULT_PERIOD,
} = {}) {
  const newUsers = new Map(buckets.map((k) => [k, 0]));
  const newSubscriptions = new Map(buckets.map((k) => [k, 0]));
  const newGroups = new Map(buckets.map((k) => [k, 0]));

  users.forEach((user) => {
    if (!isEndUser(user)) return;
    const bucket = bucketKey(user.created_at, period);
    if (!bucket || !newUsers.has(bucket)) return;
    newUsers.set(bucket, newUsers.get(bucket) + 1);
  });

  subscriptions.forEach((subscription) => {
    if (!isRealSubscription(subscription)) return;
    const bucket = bucketKey(subscription.created_at, period);
    if (!bucket || !newSubscriptions.has(bucket)) return;
    newSubscriptions.set(bucket, newSubscriptions.get(bucket) + 1);
  });

  groups.forEach((group) => {
    if (!group || isSeedId(group.id)) return;
    const bucket = bucketKey(group.created_at, period);
    if (!bucket || !newGroups.has(bucket)) return;
    newGroups.set(bucket, newGroups.get(bucket) + 1);
  });

  // Total acumulado de usuários: a curva de evolução da plataforma.
  const totalUsers = new Map(buckets.map((k) => [k, 0]));
  let running = 0;
  buckets.forEach((bucket) => {
    running += newUsers.get(bucket) || 0;
    totalUsers.set(bucket, running);
  });

  return { newUsers, newSubscriptions, newGroups, totalUsers };
}

/* ================================================================== *
 * Resumos
 * ================================================================== */

/**
 * Resumo da base (registros e assinaturas).
 *
 * "novos no período" conta APENAS o ÚLTIMO bucket da faixa — é o mesmo
 * recorte do card "Registros no mês" do painel (/admin): se o gráfico
 * mostra 5 meses, "12 novos no mês" são os 12 do último mês, não os 12 dos
 * cinco meses somados.
 *
 * @returns {{
 *   totalUsers: number,
 *   newUsers: number,
 *   newSubscriptions: number,
 *   totalSubscriptions: number,
 *   activeSubscriptions: number,
 *   converted: number,
 *   conversionRate: number,
 * }}
 */
export function buildBaseSummary({
  users = [],
  subscriptions = [],
  buckets = [],
  period = DEFAULT_PERIOD,
} = {}) {
  const endUsers = users.filter(isEndUser);
  const realSubs = subscriptions.filter(isRealSubscription);
  const currentBucket = buckets[buckets.length - 1] || null;

  const usersInPeriod = currentBucket
    ? endUsers.filter((u) => bucketKey(u.created_at, period) === currentBucket)
    : [];
  const subsInPeriod = currentBucket
    ? realSubs.filter((s) => bucketKey(s.created_at, period) === currentBucket)
    : [];

  const subscriberIds = new Set(realSubs.map((s) => s.user_id).filter(Boolean));
  const converted = usersInPeriod.filter((u) => subscriberIds.has(u.id)).length;

  return {
    totalUsers: endUsers.length,
    newUsers: usersInPeriod.length,
    newSubscriptions: subsInPeriod.length,
    totalSubscriptions: realSubs.length,
    activeSubscriptions: realSubs.filter((s) => String(s.status || '').toLowerCase() === 'active').length,
    converted,
    conversionRate: usersInPeriod.length > 0 ? converted / usersInPeriod.length : 0,
  };
}

/**
 * Resumo financeiro: totais, último mês e linha de lucro.
 *
 * @returns {{
 *   totalRevenue: number,
 *   totalCost: number,
 *   totalProfit: number,
 *   lastMonthRevenue: number,
 *   lastMonthCost: number,
 *   lastMonthProfit: number,
 *   currentSaasCost: number,
 * }}
 */
export function buildFinancialSummary({ revenue, saas, operating, buckets = [] } = {}) {
  let totalRevenue = 0;
  let totalCost = 0;

  buckets.forEach((bucket) => {
    totalRevenue += revenue?.get(bucket) || 0;
    totalCost += (saas?.get(bucket) || 0) + (operating?.get(bucket) || 0);
  });

  const last = buckets[buckets.length - 1];
  const lastMonthRevenue = last ? revenue?.get(last) || 0 : 0;
  const lastMonthCost = last ? (saas?.get(last) || 0) + (operating?.get(last) || 0) : 0;

  // Custo SaaS corrente: o que o painel mostra em "Custos SaaS" (contas ativas).
  let currentSaasCost = 0;
  if (saas && buckets.length > 0) {
    // A última conta de cada conta matriz continua valendo; usamos a soma do
    // último bucket como aproximação do custo corrente.
    currentSaasCost = saas.get(last) || 0;
  }

  return {
    totalRevenue,
    totalCost,
    totalProfit: totalRevenue - totalCost,
    lastMonthRevenue,
    lastMonthCost,
    lastMonthProfit: lastMonthRevenue - lastMonthCost,
    currentSaasCost,
  };
}
