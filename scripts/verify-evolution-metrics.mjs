/**
 * Verificação das regras de agregação da tela de Evolução.
 *
 *   node scripts/verify-evolution-metrics.mjs
 *
 * O módulo `src/lib/evolutionMetrics.js` é PURO (sem React, sem Supabase),
 * então dá para conferir a matemática do gráfico sem browser e sem banco —
 * que é justamente o ponto de ele ser um módulo separado.
 *
 * As datas são construídas em hora LOCAL (o bucket do gráfico é local):
 * `new Date(2026, 5, 16)` é 16/06/2026 na meia-noite de quem roda o teste.
 */

import { pathToFileURL } from 'node:url';
import path from 'node:path';

const metrics = await import(
  pathToFileURL(path.resolve('src/lib/evolutionMetrics.js')).href
);
const recurrence = await import(
  pathToFileURL(path.resolve('src/lib/expenseRecurrence.js')).href
);

const {
  bucketKey,
  bucketLabel,
  buildBucketRange,
  buildRevenueSeries,
  buildCostSeries,
  buildEvolutionSeries,
  buildBaseSummary,
  buildFinancialSummary,
  isSeedId,
  isSuccessfulAttemptStatus,
} = metrics;
const { getRecurrenceMonths } = recurrence;

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}\n      esperado: ${e}\n      obtido:   ${a}`);
  }
}

/* ------------------------------------------------------------------ *
 * 1. Buckets
 * ------------------------------------------------------------------ */

const june16 = new Date(2026, 5, 16, 10, 30); // 16/06/2026 10:30 local

check('bucketKey dia', bucketKey(june16, 'day'), '2026-06-16');
check('bucketKey mes', bucketKey(june16, 'month'), '2026-06');
check('bucketKey semana (16/06/2026 = semana ISO 25)', bucketKey(june16, 'week'), '2026-W25');
check('bucketLabel dia', bucketLabel('2026-06-16', 'day'), '16/06');
check('bucketLabel mes', bucketLabel('2026-06', 'month'), '06/26');

// Janeiro de 2026: a semana ISO 1 começa em 29/12/2025.
check('bucketKey semana no limite do ano', bucketKey(new Date(2026, 0, 1, 9), 'week'), '2026-W01');
check('bucketKey semana em dezembro', bucketKey(new Date(2025, 11, 31, 9), 'week'), '2026-W01');

// A faixa não pode ter buracos: um mês sem movimento precisa continuar no eixo.
const range = buildBucketRange(new Date(2026, 3, 1), new Date(2026, 6, 1), 'month');
check('buildBucketRange sem buracos', range, ['2026-04', '2026-05', '2026-06', '2026-07']);

const dailyRange = buildBucketRange(new Date(2026, 5, 30), new Date(2026, 6, 3), 'day');
check('buildBucketRange diario', dailyRange, ['2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03']);

// Cada dia de uma semana cai no MESMO bucket semanal.
// 29/06/2026 e uma segunda-feira: 29, 30/06 e 01/07 pertencem a mesma semana.
const weekBuckets = new Set(
  [29, 30].map((day) => bucketKey(new Date(2026, 5, day, 15), 'week'))
);
const nextWeekBucket = bucketKey(new Date(2026, 6, 1, 15), 'week');
check('semana agrupa os 3 dias', weekBuckets.size, 1);
check('01/07/2026 continua na mesma semana', nextWeekBucket, [...weekBuckets][0]);
// 28/06/2026 e domingo: fecha a semana W26 (que comecou em 22/06).
check('domingo fecha a semana anterior', bucketKey(new Date(2026, 5, 28, 15), 'week'), '2026-W26');

/* ------------------------------------------------------------------ *
 * 2. Semente (seed)
 * ------------------------------------------------------------------ */

check('seed detectado (dddddddd)', isSeedId('dddddddd-dddd-dddd-dddd-dddddddddddd'), true);
check('seed detectado (22222222)', isSeedId('22222222-2222-2222-2222-222222222222'), true);
check('uuid real nao e seed', isSeedId('6b75cf33-d7da-49b6-b66a-79392e762381'), false);

/* ------------------------------------------------------------------ *
 * 3. Receita
 * ------------------------------------------------------------------ */

const revenueBuckets = ['2026-06', '2026-07'];

const revenue = buildRevenueSeries({
  buckets: revenueBuckets,
  payments: [
    { id: 'p1', status: 'paid', amount: 100, created_at: '2026-06-10T12:00:00Z', transaction_code: 'TX1' },
    { id: 'p2', status: 'pending', amount: 999, created_at: '2026-06-11T12:00:00Z', transaction_code: 'TX2' },
    { id: 'p3', status: 'paid', amount: 30, created_at: '2026-07-02T12:00:00Z', transaction_code: 'TX3' },
  ],
  attempts: [
    // Mesma transacao de um pagamento ja contabilizado: NAO pode somar de novo.
    { id: 'a1', status: 'approved', amount: 100, created_at: '2026-06-11T12:00:00Z', gateway_transaction_id: 'TX1' },
    // Tentativa sem pagamento correspondente: conta.
    { id: 'a2', status: 'polled_succeeded', amount: 50, created_at: '2026-07-05T12:00:00Z', gateway_transaction_id: 'TX9' },
    // Falha: nao conta.
    { id: 'a3', status: 'polled_failed', amount: 80, created_at: '2026-07-06T12:00:00Z', gateway_transaction_id: 'TX8' },
  ],
});

check('receita de junho (100 do pagamento, tentativa duplicada ignorada)', revenue.get('2026-06'), 100);
check('receita de julho (30 + 50 da tentativa)', revenue.get('2026-07'), 80);

// Deduplicacao global: tentativa de junho que so virou pagamento em julho.
const crossMonth = buildRevenueSeries({
  buckets: revenueBuckets,
  payments: [
    { id: 'p1', status: 'paid', amount: 100, created_at: '2026-07-02T12:00:00Z', transaction_code: 'TX1' },
  ],
  attempts: [
    { id: 'a1', status: 'approved', amount: 100, created_at: '2026-06-11T12:00:00Z', gateway_transaction_id: 'TX1' },
  ],
});
check('mesma transacao nao entra em dois meses', [crossMonth.get('2026-06'), crossMonth.get('2026-07')], [0, 100]);

check('status de tentativa bem-sucedida', isSuccessfulAttemptStatus('webhook_approved'), true);
check('status de tentativa malsucedida', isSuccessfulAttemptStatus('webhook_rejected'), false);

/* ------------------------------------------------------------------ *
 * 4. Custos
 * ------------------------------------------------------------------ */

const costs = buildCostSeries({
  buckets: revenueBuckets,
  masterAccounts: [
    // Conta ativa: entra no custo e continua.
    { id: 'm1', cost: 45, status: 'active', created_at: '2026-06-01T12:00:00Z', updated_at: '2026-06-01T12:00:00Z' },
    // Conta desativada em junho: so conta em junho.
    { id: 'm2', cost: 30, status: 'inactive', created_at: '2026-06-01T12:00:00Z', updated_at: '2026-06-20T12:00:00Z' },
  ],
  expenses: [
    // Despesa avulsa: conta no mes do vencimento.
    { id: 'e1', amount: 20, is_recurring: false, due_date: '2026-07-10' },
    // Despesa recorrente de dia 31: NAO pode pular fevereiro.
    {
      id: 'e2', amount: 7, is_recurring: true, recurrence_day: 31, start_date: '2026-01-31',
      recurrence_count: 6, skipped_months: [],
    },
  ],
});

check('custo SaaS de junho (45 + 30)', costs.saas.get('2026-06'), 75);
check('custo SaaS de julho (so a conta ativa)', costs.saas.get('2026-07'), 45);
check('despesa avulsa em julho', costs.operating.get('2026-07'), 20);
check('despesa recorrente conta os 6 meses (fevereiro incluido)', costs.operating.get('2026-06'), 7);
// A recorrente de 6 ocorrencias vai de janeiro a junho: nao cria mes fora da faixa.
check('despesa recorrente nao cria mes fora da faixa', costs.operating.has('2026-05'), false);
check('despesa recorrente para em junho (limite de 6)', costs.operating.has('2026-07') && costs.operating.get('2026-07') === 20, true);

/* ------------------------------------------------------------------ *
 * 5. Recorrencia isolada
 * ------------------------------------------------------------------ */

check(
  'recorrencia dia 31 nao pula fevereiro',
  getRecurrenceMonths(31, '2026-01-31', null, 6, []),
  ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
);

check(
  'recorrencia respeita mes pulado',
  getRecurrenceMonths(10, '2026-01-10', null, 4, ['2026-03']),
  ['2026-01', '2026-02', '2026-04']
);

check(
  'recorrencia para na data final',
  getRecurrenceMonths(15, '2026-01-15', '2026-03-20', 12, []),
  ['2026-01', '2026-02', '2026-03']
);

/* ------------------------------------------------------------------ *
 * 6. Evolucao da base
 * ------------------------------------------------------------------ */

const evolutionBuckets = ['2026-06', '2026-07'];
const evolution = buildEvolutionSeries({
  buckets: evolutionBuckets,
  period: 'month',
  users: [
    { id: 'u1', role: 'user', created_at: '2026-06-02T12:00:00Z' },
    { id: 'u2', role: 'user', created_at: '2026-06-20T12:00:00Z' },
    { id: 'u3', role: 'user', created_at: '2026-07-03T12:00:00Z' },
    { id: 'adm1', role: 'admin', created_at: '2026-06-02T12:00:00Z' },
    { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', role: 'user', created_at: '2026-06-02T12:00:00Z' },
  ],
  subscriptions: [
    { id: 's1', user_id: 'u1', status: 'active', created_at: '2026-06-03T12:00:00Z' },
    { id: 's2', user_id: 'u3', status: 'active', created_at: '2026-07-04T12:00:00Z' },
  ],
  groups: [
    { id: 'g1', created_at: '2026-07-10T12:00:00Z' },
    { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', created_at: '2026-07-10T12:00:00Z' },
  ],
});

check('novos usuarios em junho (admin e seed fora)', evolution.newUsers.get('2026-06'), 2);
check('novos usuarios em julho', evolution.newUsers.get('2026-07'), 1);
check('novas assinaturas em junho', evolution.newSubscriptions.get('2026-06'), 1);
check('novos grupos em julho (seed fora)', evolution.newGroups.get('2026-07'), 1);
check('total acumulado em junho', evolution.totalUsers.get('2026-06'), 2);
check('total acumulado em julho', evolution.totalUsers.get('2026-07'), 3);

/* ------------------------------------------------------------------ *
 * 7. Resumos
 * ------------------------------------------------------------------ */

const baseSummary = buildBaseSummary({
  users: [
    { id: 'u1', role: 'user', created_at: '2026-06-02T12:00:00Z' },
    { id: 'u2', role: 'user', created_at: '2026-06-20T12:00:00Z' },
    { id: 'u3', role: 'user', created_at: '2026-07-03T12:00:00Z' },
  ],
  subscriptions: [
    { id: 's1', user_id: 'u1', status: 'active', created_at: '2026-06-03T12:00:00Z' },
    { id: 's2', user_id: 'u3', status: 'active', created_at: '2026-07-04T12:00:00Z' },
  ],
  buckets: evolutionBuckets,
  period: 'month',
});

check('total de usuarios (sem admin/seed)', baseSummary.totalUsers, 3);
check('assinaturas ativas', baseSummary.activeSubscriptions, 2);
// "novos no periodo" = SOMENTE o ultimo bucket (julho), como o card
// "Registros no mes" do painel — nao a soma dos 5 meses do grafico.
check('novos usuarios no ultimo periodo', baseSummary.newUsers, 1);
check('novas assinaturas no ultimo periodo', baseSummary.newSubscriptions, 1);
check('conversao: dos 3 registros de julho, 1 virou assinante', baseSummary.converted, 1);
check('taxa de conversao do ultimo periodo', baseSummary.conversionRate, 1);

const financial = buildFinancialSummary({
  revenue,
  saas: costs.saas,
  operating: costs.operating,
  buckets: revenueBuckets,
});

check('receita total', financial.totalRevenue, 180);
check('custo total (jun 75+7, jul 45+20)', financial.totalCost, 147);
check('lucro total', financial.totalProfit, 33);
check('lucro do ultimo mes', financial.lastMonthProfit, 15);

/* ------------------------------------------------------------------ */

console.log(`\n${passed} passaram, ${failed} falharam.`);
process.exit(failed === 0 ? 0 : 1);
