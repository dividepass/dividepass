import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChartColumn,
  ChevronDown,
  CreditCard,
  DollarSign,
  Layers,
  Loader2,
  RefreshCw,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import AdminChart from '../../components/AdminChart';
import { formatCurrencyCompact, formatCurrencyFull } from '../../lib/currencyFormat';
import {
  PERIODS,
  DEFAULT_PERIOD,
  FINANCIAL_PERIOD,
  buildBaseSummary,
  buildBucketRange,
  buildCostSeries,
  buildEvolutionSeries,
  buildFinancialSummary,
  buildRevenueSeries,
  bucketLabel,
  bucketLongLabel,
  isSeedId,
  toDate,
} from '../../lib/evolutionMetrics';
import './Evolution.css';

/**
 * EVOLUÇÃO DA PLATAFORMA — seção embutida no Painel (/admin).
 *
 * Era uma página própria (/admin/evolution); agora mora dentro do painel.
 * A página de resumo e a de evolução respondiam perguntas do mesmo
 * operador, separadas por um clique de menu — unificadas, o número e a
 * curva dele ficam na mesma tela.
 *
 * A seção é AUTOSSUFICIENTE: busca os próprios dados (histórico completo,
 * 7 tabelas, até 5.000 linhas) com o PRÓPRIO carregamento. O painel
 * renderiza rápido com as contagens do dia; a evolução preenche embaixo
 * quando chega. Toda a agregação mora em `lib/evolutionMetrics.js`
 * (módulo puro) — a mesma regra de receita/custo do painel financeiro.
 *
 * Layout:
 *  1. KPIs do período (novos registros, assinaturas, grupos, conversão);
 *  2. UM gráfico por métrica de crescimento — cada métrica na sua escala;
 *  3. o gráfico financeiro — receita em barras, custos e lucro em linha;
 *  4. a tabela de detalhe por período (fechada por padrão: quem quer o
 *     número exato abre; quem quer a tendência só olha o gráfico).
 */

/** Teto de buckets exibidos — acima disso o eixo X fica ilegível. */
const MAX_BUCKETS = { day: 120, week: 60, month: 36 };

/** Limite de linhas por query (o histórico inteiro cabe folgado por enquanto). */
const ROW_LIMIT = 5000;

/** Linhas da tabela de detalhe — no granularity "Dia" são 120 períodos. */
const TABLE_MAX_ROWS = 31;

const EMPTY_RAW = {
  users: [],
  subscriptions: [],
  payments: [],
  attempts: [],
  groups: [],
  masterAccounts: [],
  expenses: [],
};

function formatCount(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
}

function formatPercent(value) {
  return `${(Number(value) * 100).toFixed(1).replace('.', ',')}%`;
}

/** Data mais antiga entre as séries — é onde a curva da plataforma começa. */
function earliestDate(raw) {
  const candidates = [
    ...raw.users.map((item) => item.created_at),
    ...raw.subscriptions.map((item) => item.created_at),
    ...raw.groups.map((item) => item.created_at),
    ...raw.payments.map((item) => item.created_at),
  ].filter(Boolean);

  if (!candidates.length) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() - 30);
    return fallback;
  }

  return candidates.reduce((min, value) => {
    const date = toDate(value);
    return !date ? min : date < min ? date : min;
  }, new Date(candidates[0]));
}

/**
 * Cartão de gráfico de uma métrica só.
 *
 * O cabeçalho carrega o número do período, o gráfico carrega a série, e o
 * rodapé carrega o acumulado — sem sobrepor duas escalas no mesmo desenho.
 */
function MetricChartCard({
  title,
  subtitle,
  icon,
  accent,
  value,
  valueCaption,
  delta,
  data,
  labels,
  series,
  cumulative,
  cumulativeLabel,
  emptyMessage,
}) {
  return (
    <section className={`evo-card evo-card--${accent}`}>
      <header className="evo-card-head">
        <div className="evo-card-title">
          <span className="evo-card-icon">{icon}</span>
          <div>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
        </div>

        <div className="evo-card-figure">
          <strong>{value}</strong>
          <span>{valueCaption}</span>
        </div>
      </header>

      <div className="evo-card-body">
        <AdminChart
          data={data}
          labels={labels}
          height={210}
          series={series}
          showValues
          formatValue={formatCount}
          formatAxis={formatCount}
          emptyMessage={emptyMessage}
        />
      </div>

      <footer className="evo-card-foot">
        <span className="evo-card-stat">
          {cumulativeLabel} <strong>{cumulative}</strong>
        </span>
        {delta !== null && delta !== undefined && (
          <span className={`evo-delta ${delta >= 0 ? 'up' : 'down'}`}>
            {delta >= 0 ? '+' : ''}
            {delta.toFixed(0).replace('.', ',')}%
          </span>
        )}
      </footer>
    </section>
  );
}

function EvolutionSection() {
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [raw, setRaw] = useState(EMPTY_RAW);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);

  /**
   * Busca os dados. NÃO mexe em estado: devolve o resultado e deixa quem
   * chamou aplicar — o mesmo contrato do antigo botão "Atualizar".
   */
  const loadData = useCallback(async () => {
    const [
      usersRes,
      subsRes,
      paymentsRes,
      attemptsRes,
      groupsRes,
      masterRes,
      expensesRes,
    ] = await Promise.all([
      supabase.from('users').select('id, created_at, role').limit(ROW_LIMIT),
      supabase.from('user_subscriptions').select('id, user_id, created_at, status, amount').limit(ROW_LIMIT),
      supabase.from('payments').select('id, amount, status, created_at, transaction_code').limit(ROW_LIMIT),
      supabase
        .from('payment_attempts')
        .select('id, amount, status, created_at, gateway_transaction_id, external_reference')
        .limit(ROW_LIMIT),
      supabase.from('groups').select('id, name, created_at').limit(ROW_LIMIT),
      supabase.from('master_accounts').select('id, cost, status, created_at, updated_at').limit(ROW_LIMIT),
      supabase
        .from('expenses')
        .select(
          'id, amount, is_recurring, recurrence_day, start_date, due_date, recurrence_end_date, recurrence_count, skipped_months, status'
        )
        .limit(ROW_LIMIT),
    ]);

    // Uma tabela indisponível não pode derrubar o painel inteiro: cada série
    // é independente e o gráfico mostra o que conseguiu ler.
    // `payment_attempts` é OPCIONAL: só serve de reserva para a receita.
    const failures = [
      ['usuários', usersRes.error, false],
      ['assinaturas', subsRes.error, false],
      ['pagamentos', paymentsRes.error, false],
      ['tentativas de pagamento', attemptsRes.error, true],
      ['grupos', groupsRes.error, false],
      ['contas matriz', masterRes.error, false],
      ['despesas', expensesRes.error, false],
    ].filter(([, err]) => err);

    if (failures.length) {
      console.error('EvolutionSection fetch errors:', failures);
    }

    const sizes = [
      usersRes.data?.length,
      subsRes.data?.length,
      paymentsRes.data?.length,
      attemptsRes.data?.length,
      groupsRes.data?.length,
      masterRes.data?.length,
      expensesRes.data?.length,
    ];

    const essential = failures.filter(([, , optional]) => !optional).map(([name]) => name);
    const optional = failures.filter(([, , isOptional]) => isOptional).map(([name]) => name);

    return {
      payload: {
        users: usersRes.data || [],
        subscriptions: subsRes.data || [],
        payments: paymentsRes.data || [],
        attempts: attemptsRes.data || [],
        groups: groupsRes.data || [],
        masterAccounts: masterRes.data || [],
        expenses: expensesRes.data || [],
      },
      errorMessage: essential.length ? `Não foi possível ler: ${essential.join(', ')}.` : '',
      warningMessage: optional.length
        ? `Sem acesso a ${optional.join(', ')} — a receita pode não incluir cobranças que o gateway aprovou sem gerar pagamento.`
        : '',
      truncated: sizes.some((size) => size >= ROW_LIMIT),
    };
  }, []);

  const applyResult = useCallback((result) => {
    setRaw(result.payload);
    setError(result.errorMessage);
    setWarning(result.warningMessage);
    setTruncated(result.truncated);
  }, []);

  /** Carregamento inicial — independente do carregamento do painel. */
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const result = await loadData();
        if (alive) applyResult(result);
      } catch (err) {
        console.error('EvolutionSection fetch error:', err);
        if (alive) setError(err.message || 'Falha ao carregar os dados da evolução.');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [loadData, applyResult]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    setWarning('');

    try {
      const result = await loadData();
      applyResult(result);
    } catch (err) {
      console.error('EvolutionSection refresh error:', err);
      setError(err.message || 'Falha ao carregar os dados da evolução.');
    } finally {
      setLoading(false);
    }
  }, [loadData, applyResult]);

  /* --------------------------------------------------------------- *
   * Série 1 — evolução da base
   * --------------------------------------------------------------- */

  const evolution = useMemo(() => {
    const start = earliestDate(raw);
    const now = new Date();

    const allBuckets = buildBucketRange(start, now, period);
    const maxBuckets = MAX_BUCKETS[period] || 36;
    const buckets = allBuckets.slice(-maxBuckets);

    const series = buildEvolutionSeries({
      users: raw.users,
      subscriptions: raw.subscriptions,
      groups: raw.groups,
      buckets: allBuckets,
      period,
    });

    // O acumulado é calculado sobre a série inteira e só depois recortado:
    // assim a curva não "recomeça do zero" quando a janela é limitada.
    const chartData = buckets.map((bucket) => ({
      newUsers: series.newUsers.get(bucket) || 0,
      newSubscriptions: series.newSubscriptions.get(bucket) || 0,
      newGroups: series.newGroups.get(bucket) || 0,
      totalUsers: series.totalUsers.get(bucket) || 0,
    }));

    const summary = buildBaseSummary({
      users: raw.users,
      subscriptions: raw.subscriptions,
      buckets,
      period,
    });

    return {
      buckets,
      labels: buckets.map((bucket) => bucketLabel(bucket, period)),
      longLabels: buckets.map((bucket) => bucketLongLabel(bucket, period)),
      chartData,
      summary,
      trimmed: allBuckets.length > buckets.length,
    };
  }, [raw, period]);

  /* --------------------------------------------------------------- *
   * Série 2 — receita, custos e lucro (sempre por mês)
   * --------------------------------------------------------------- */

  const financial = useMemo(() => {
    const start = earliestDate(raw);
    const now = new Date();

    const buckets = buildBucketRange(start, now, FINANCIAL_PERIOD);
    const revenue = buildRevenueSeries({
      payments: raw.payments,
      attempts: raw.attempts,
      buckets,
    });
    const { saas, operating } = buildCostSeries({
      masterAccounts: raw.masterAccounts,
      expenses: raw.expenses,
      buckets,
    });

    const chartData = buckets.map((bucket) => {
      const saasCost = saas.get(bucket) || 0;
      const operatingCost = operating.get(bucket) || 0;
      const costs = saasCost + operatingCost;
      const monthRevenue = revenue.get(bucket) || 0;
      return {
        revenue: monthRevenue,
        costs,
        saas: saasCost,
        operating: operatingCost,
        profit: monthRevenue - costs,
      };
    });

    const summary = buildFinancialSummary({ revenue, saas, operating, buckets });

    return {
      buckets,
      labels: buckets.map((bucket) => bucketLabel(bucket, FINANCIAL_PERIOD)),
      longLabels: buckets.map((bucket) => bucketLongLabel(bucket, FINANCIAL_PERIOD)),
      chartData,
      summary,
    };
  }, [raw]);

  /* --------------------------------------------------------------- *
   * Comparativo com o período anterior
   * --------------------------------------------------------------- */

  const deltas = useMemo(() => {
    const buckets = evolution.buckets;
    if (buckets.length < 2) return { users: null, subscriptions: null, groups: null, revenue: null };

    const previous = buckets[buckets.length - 2];

    const countIn = (rows, dateField, bucketOf) =>
      rows.filter((row) => {
        if (!row || isSeedId(row.id)) return false;
        return bucketOf(row[dateField]) === previous;
      }).length;

    const prevUsers = countIn(
      raw.users.filter((user) => !user.role || String(user.role).toLowerCase() === 'user'),
      'created_at',
      (value) => buildBucketRange(value, value, period)[0]
    );

    const prevSubs = countIn(
      raw.subscriptions,
      'created_at',
      (value) => buildBucketRange(value, value, period)[0]
    );

    const prevGroups = countIn(
      raw.groups,
      'created_at',
      (value) => buildBucketRange(value, value, period)[0]
    );

    const prevRevenue = financial.chartData[financial.chartData.length - 2]?.revenue || 0;
    const currentRevenue = financial.chartData[financial.chartData.length - 1]?.revenue || 0;

    const variation = (now, before) => {
      if (!before) return now > 0 ? 100 : null;
      return ((now - before) / before) * 100;
    };

    return {
      users: variation(evolution.summary.newUsers, prevUsers),
      subscriptions: variation(evolution.summary.newSubscriptions, prevSubs),
      groups: variation(
        evolution.chartData[evolution.chartData.length - 1]?.newGroups || 0,
        prevGroups
      ),
      revenue: variation(currentRevenue, prevRevenue),
    };
  }, [evolution, financial, raw, period]);

  /* --------------------------------------------------------------- *
   * Render
   * --------------------------------------------------------------- */

  const periodPhrase = { day: 'hoje', week: 'na semana', month: 'no mês' }[period] || 'no mês';
  const periodWord = PERIODS.find((item) => item.key === period)?.label.toLowerCase() || 'mês';

  // Plural: "1 novo" / "12 novos"; "1 nova" / "6 novas".
  const plural = (count, singular, pluralForm) => `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;

  // KPIs de CRESCIMENTO (receita/custos/lucro já estão nos cards financeiros
  // do painel — repeti-los aqui seria eco, não informação).
  const kpis = [
    {
      icon: <UserPlus size={17} />,
      tone: 'primary',
      label: 'Novos registros',
      value: formatCount(evolution.summary.newUsers),
      sub: periodPhrase,
      delta: deltas.users,
    },
    {
      icon: <CreditCard size={17} />,
      tone: 'tech',
      label: 'Novas assinaturas',
      value: formatCount(evolution.summary.newSubscriptions),
      sub: periodPhrase,
      delta: deltas.subscriptions,
    },
    {
      icon: <Layers size={17} />,
      tone: 'action',
      label: 'Novos grupos',
      value: formatCount(evolution.chartData[evolution.chartData.length - 1]?.newGroups || 0),
      sub: periodPhrase,
      delta: deltas.groups,
    },
    {
      icon: <ChartColumn size={17} />,
      tone: 'economy',
      label: 'Conversão em assinatura',
      value: formatPercent(evolution.summary.conversionRate),
      sub: `${formatCount(evolution.summary.converted)} de ${formatCount(evolution.summary.newUsers)} registros ${periodPhrase}`,
    },
  ];

  const lastRow = evolution.chartData[evolution.chartData.length - 1] || {};

  return (
    <section className="evo-section" aria-labelledby="evo-section-title">
      <header className="evo-head evo-head--embedded">
        <div className="evo-head-title">
          <div>
            <h2 id="evo-section-title">Evolução</h2>
            <p>Novos usuários, assinaturas e a linha de receita e lucro</p>
          </div>
        </div>

        <div className="evo-head-actions">
          <div className="evo-period" role="group" aria-label="Período do gráfico de evolução">
            {PERIODS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={period === item.key ? 'active' : ''}
                onClick={() => setPeriod(item.key)}
                aria-pressed={period === item.key}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button className="btn btn-outline evo-refresh" onClick={refresh} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Atualizar
          </button>
        </div>
      </header>

      {error && (
        <div className="evo-banner evo-banner--error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {warning && (
        <div className="evo-banner evo-banner--warn">
          <AlertCircle size={16} />
          <span>{warning}</span>
        </div>
      )}

      {truncated && (
        <div className="evo-banner evo-banner--warn">
          <AlertCircle size={16} />
          <span>
            O histórico passou de {formatCount(ROW_LIMIT)} linhas em alguma tabela — os gráficos mostram os
            registros mais recentes.
          </span>
        </div>
      )}

      {loading ? (
        <div className="evo-loading">
          <Loader2 size={22} className="evo-loading-spin" />
          <span>Carregando evolução...</span>
        </div>
      ) : (
        <>
          {/* ---------------- KPIs do período ---------------- */}
          <div className="evo-kpis">
            {kpis.map((kpi) => (
              <div className="evo-kpi" key={kpi.label}>
                <span className={`evo-kpi-icon ${kpi.tone}`}>{kpi.icon}</span>
                <div className="evo-kpi-body">
                  <span className="evo-kpi-label">{kpi.label}</span>
                  <strong className="evo-kpi-value">{kpi.value}</strong>
                  <span className="evo-kpi-sub">
                    {kpi.sub}
                    {kpi.delta !== null && kpi.delta !== undefined && (
                      <em className={kpi.delta >= 0 ? 'up' : 'down'}>
                        {kpi.delta >= 0 ? '+' : ''}
                        {kpi.delta.toFixed(0).replace('.', ',')}% vs período anterior
                      </em>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* ---------------- Um gráfico por métrica de crescimento ---------------- */}
          <div className="evo-grid">
            <MetricChartCard
              title="Novos registros"
              subtitle={`Contas criadas por ${periodWord}`}
              icon={<UserPlus size={16} />}
              accent="primary"
              value={formatCount(evolution.summary.newUsers)}
              valueCaption={periodPhrase}
              delta={deltas.users}
              data={evolution.chartData}
              labels={evolution.labels}
              series={[{ key: 'newUsers', label: 'Novos registros', type: 'bar', color: 'var(--primary)' }]}
              cumulative={formatCount(lastRow.totalUsers)}
              cumulativeLabel="Total acumulado:"
              emptyMessage="Nenhum registro encontrado."
            />

            <MetricChartCard
              title="Novas assinaturas"
              subtitle={`Assinaturas criadas por ${periodWord}`}
              icon={<CreditCard size={16} />}
              accent="tech"
              value={formatCount(evolution.summary.newSubscriptions)}
              valueCaption={periodPhrase}
              delta={deltas.subscriptions}
              data={evolution.chartData}
              labels={evolution.labels}
              series={[
                { key: 'newSubscriptions', label: 'Novas assinaturas', type: 'bar', color: 'var(--tech)' },
              ]}
              cumulative={formatCount(evolution.summary.totalSubscriptions)}
              cumulativeLabel="Assinaturas no total:"
              emptyMessage="Nenhuma assinatura criada."
            />

            <MetricChartCard
              title="Novos grupos"
              subtitle={`Grupos abertos por ${periodWord}`}
              icon={<Layers size={16} />}
              accent="action"
              value={formatCount(lastRow.newGroups)}
              valueCaption={periodPhrase}
              delta={deltas.groups}
              data={evolution.chartData}
              labels={evolution.labels}
              series={[{ key: 'newGroups', label: 'Novos grupos', type: 'bar', color: 'var(--action)' }]}
              cumulative={formatCount(
                evolution.chartData.reduce((sum, row) => sum + (row.newGroups || 0), 0)
              )}
              cumulativeLabel="Grupos no total:"
              emptyMessage="Nenhum grupo criado."
            />
          </div>

          {/* ---------------- Gráfico financeiro ----------------
               * Receita e custos vivem em cartões separados de propósito: na
               * mesma escala, a barra de receita ficaria espremida contra a
               * linha de custos e não se veria nada. */}
          <div className="evo-grid evo-grid--finance">
            <section className="evo-card evo-card--economy">
              <header className="evo-card-head">
                <div className="evo-card-title">
                  <span className="evo-card-icon finance">
                    <DollarSign size={16} />
                  </span>
                  <div>
                    <h3>Receita mensal</h3>
                    <p>Cobranças confirmadas, mês a mês.</p>
                  </div>
                </div>

                <div className="evo-card-figure">
                  <strong>{formatCurrencyFull(financial.summary.lastMonthRevenue)}</strong>
                  <span>no mês</span>
                  {deltas.revenue !== null && deltas.revenue !== undefined && (
                    <em className={`evo-delta ${deltas.revenue >= 0 ? 'up' : 'down'}`}>
                      {deltas.revenue >= 0 ? '+' : ''}
                      {deltas.revenue.toFixed(0).replace('.', ',')}% vs mês passado
                    </em>
                  )}
                </div>
              </header>

              <div className="evo-card-body">
                <AdminChart
                  data={financial.chartData}
                  labels={financial.labels}
                  height={260}
                  formatValue={(value) => formatCurrencyFull(value)}
                  formatLabel={(value) => formatCurrencyCompact(value)}
                  formatAxis={(value) => formatCurrencyCompact(value)}
                  showValues
                  series={[{ key: 'revenue', label: 'Receita', type: 'bar', color: 'var(--economy)' }]}
                  emptyMessage="Nenhuma cobrança confirmada até agora."
                />
              </div>

              <footer className="evo-card-foot">
                <span className="evo-card-stat">
                  Acumulado <strong>{formatCurrencyFull(financial.summary.totalRevenue)}</strong>
                </span>
                <span className="evo-legend-item">
                  <i style={{ background: 'var(--economy)' }} /> Receita
                </span>
              </footer>
            </section>

            <section className="evo-card evo-card--wide">
              <header className="evo-card-head">
                <div className="evo-card-title">
                  <span className="evo-card-icon finance">
                    <Wallet size={16} />
                  </span>
                  <div>
                    <h3>Custos e lucro</h3>
                    <p>O que saiu do bolso e o que sobrou — na mesma escala.</p>
                  </div>
                </div>

                <div className="evo-card-figure">
                  <strong className={financial.summary.lastMonthProfit >= 0 ? 'up' : 'down'}>
                    {formatCurrencyFull(financial.summary.lastMonthProfit)}
                  </strong>
                  <span>lucro no mês</span>
                </div>
              </header>

              <div className="evo-card-body">
                <AdminChart
                  data={financial.chartData}
                  labels={financial.labels}
                  height={260}
                  formatValue={(value) => formatCurrencyFull(value)}
                  formatAxis={(value) => formatCurrencyCompact(value)}
                  series={[
                    { key: 'costs', label: 'Custos', type: 'line', color: 'var(--action)' },
                    { key: 'profit', label: 'Lucro', type: 'line', color: 'var(--primary)' },
                  ]}
                  emptyMessage="Nenhum custo registrado até agora."
                />
              </div>

              <footer className="evo-card-foot evo-card-foot--split">
                <span className="evo-card-stat">
                  Custos acumulados <strong>{formatCurrencyFull(financial.summary.totalCost)}</strong>
                </span>
                <span className="evo-card-stat">
                  Lucro acumulado{' '}
                  <strong className={financial.summary.totalProfit >= 0 ? 'up' : 'down'}>
                    {formatCurrencyFull(financial.summary.totalProfit)}
                  </strong>
                </span>
                <span className="evo-legend">
                  <span className="evo-legend-item">
                    <i style={{ background: 'var(--action)' }} /> Custos
                  </span>
                  <span className="evo-legend-item">
                    <i style={{ background: 'var(--primary)' }} /> Lucro
                  </span>
                </span>
              </footer>
            </section>
          </div>

          {/* ---------------- Tabela de detalhe (fechada por padrão) ----------------
              * O gráfico responde "qual a tendência"; a tabela responde "qual
              * o número exato de cada período". Quem quer exatidão abre. */}
          <button
            type="button"
            className="evo-table-toggle"
            onClick={() => setTableOpen((v) => !v)}
            aria-expanded={tableOpen}
          >
            <ChartColumn size={15} />
            Detalhe por período
            <ChevronDown size={15} className={tableOpen ? 'is-open' : ''} />
          </button>

          {tableOpen && (
            <section className="evo-card evo-card--wide evo-table-card">
              <div className="table-responsive">
                <table className="evo-table">
                  <thead>
                    <tr>
                      <th>Período</th>
                      <th>Novos registros</th>
                      <th>Novas assinaturas</th>
                      <th>Novos grupos</th>
                      <th>Total acumulado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evolution.chartData
                      .slice()
                      .reverse()
                      .slice(0, TABLE_MAX_ROWS)
                      .map((row, index) => {
                        const bucket = evolution.buckets[evolution.buckets.length - 1 - index];
                        return (
                          <tr key={bucket}>
                            <td>{evolution.longLabels[evolution.buckets.length - 1 - index]}</td>
                            <td>{formatCount(row.newUsers)}</td>
                            <td>{formatCount(row.newSubscriptions)}</td>
                            <td>{formatCount(row.newGroups)}</td>
                            <td className="evo-table-total">{formatCount(row.totalUsers)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              {evolution.chartData.length > TABLE_MAX_ROWS && (
                <p className="evo-note">
                  Mostrando os {TABLE_MAX_ROWS} períodos mais recentes da tabela — o gráfico acima traz
                  a série completa.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}

export default EvolutionSection;
