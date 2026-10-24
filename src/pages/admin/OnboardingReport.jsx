import { Fragment, useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  Search,
  TrendingUp,
  Share2,
  CheckCircle2,
  UserPlus,
  Info,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ONBOARDING_STEPS, labelForValue } from '../../lib/onboardingQuestions';
import './OnboardingReport.css';

const INTEREST_KIND_LABEL = {
  current: 'Plataformas que já usa',
  interested: 'Plataformas que quer dividir',
};

const INTEREST_QUESTIONS = ONBOARDING_STEPS.filter((s) => s.type === 'platforms');
const SCALAR_QUESTIONS = ONBOARDING_STEPS.filter((s) => s.type === 'single' && s.column);

// Rótulos curtos das colunas da tabela — a pergunta inteira fica no tooltip,
// porque "Quantas assinaturas você paga atualmente?" não cabe em um <th>.
const COLUMN_SHORT_LABEL = {
  subscriptions_count_band: 'Assinaturas',
  main_barrier: 'Maior barreira',
};

export default function OnboardingReport() {
  const [rows, setRows] = useState([]);
  const [interests, setInterests] = useState([]);
  const [invites, setInvites] = useState([]);
  const [incomplete, setIncomplete] = useState([]);
  const [services, setServices] = useState([]);
  const [funnel, setFunnel] = useState({ entered: 0, answered: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      /*
       * A coorte vem de QUEM RESPONDEU (user_onboarding_profiles), não de
       * users.onboarding_completed_at. A flag de conclusão não é gravada por
       * nenhum usuário hoje — usar ela como filtro deixava a página
       * inteiramente vazia, escondendo as respostas que existem no banco.
       */
      const [usersRes, profilesRes, interestsRes, invitesRes, servicesRes] = await Promise.all([
        // Select enxuto para não puxar email_verified e cpf de 100+ usuários à toa.
        supabase
          .from('users')
          .select('id, name, email, avatar_url, created_at, onboarding_started_at, onboarding_completed_at, onboarding_step'),
        supabase.from('user_onboarding_profiles').select('*'),
        supabase.from('user_onboarding_interests').select('*'),
        supabase.from('user_onboarding_invites').select('*'),
        // Para os ícones e cores das plataformas no gráfico.
        supabase.from('streaming_services').select('id, name, icon_url, color'),
      ]);

      if (cancelled) return;

      const users = usersRes.data || [];
      const answers = profilesRes.data || [];

      const answersByUser = Object.fromEntries(answers.map((a) => [a.user_id, a]));
      const invitesByUser = {};
      for (const inv of invitesRes.data || []) {
        (invitesByUser[inv.user_id] = invitesByUser[inv.user_id] || []).push(inv);
      }

      const started = users.filter((u) => u.onboarding_started_at);
      const completed = users.filter((u) => u.onboarding_completed_at);

      // Quem respondeu: tem linha de perfil e o usuário existe.
      const responders = users.filter((u) => answersByUser[u.id]);

      /*
       * "Entraram" é a união dos três sinais (início, conclusão, respostas
       * salvas). Cada sinal sozinho conta um recorte diferente do mesmo
       * público: há quem tenha concluído antes de existir o registro de
       * início, e há quem tenha deixado respostas sem concluir.
       */
      const enteredIds = new Set([
        ...started.map((u) => u.id),
        ...completed.map((u) => u.id),
        ...responders.map((u) => u.id),
      ]);

      setRows(
        responders.map((u) => ({
          ...u,
          answers: answersByUser[u.id] || null,
          invites: invitesByUser[u.id] || [],
        }))
      );

      // Abandonou de verdade: entrou no fluxo, não deixou respostas e não
      // concluiu. Quem concluiu sem perfil não abandonou — só não respondeu
      // nada que valesse gravacao.
      setIncomplete(
        started
          .filter((u) => !answersByUser[u.id] && !u.onboarding_completed_at)
          .map((u) => ({ ...u, invites: invitesByUser[u.id] || [] }))
      );

      setFunnel({
        entered: enteredIds.size,
        answered: responders.length,
        completed: completed.length,
      });

      setInterests(interestsRes.data || []);
      setInvites(invitesRes.data || []);
      setServices(servicesRes.data || []);
      setError('');
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  const interestsByUser = useMemo(() => {
    const map = {};
    for (const i of interests) {
      map[i.user_id] = map[i.user_id] || { current: [], interested: [] };
      map[i.user_id][i.kind]?.push(i);
    }
    return map;
  }, [interests]);

  // ── Agregações ─────────────────────────────────────────────────────────
  // Cada barra é um GROUP BY disfarçado. Trabalha por `column` porque é
  // isso que garante value único dentro da pergunta.

  const distribution = useMemo(() => {
    const out = [];

    for (const step of SCALAR_QUESTIONS) {
      const counts = new Map();
      let answered = 0;

      for (const row of rows) {
        const v = row.answers?.[step.column];
        if (v === null || v === undefined) continue;
        answered++;
        counts.set(v, (counts.get(v) || 0) + 1);
      }

      const items = step.options.map((opt) => ({
        label: opt.label,
        count: counts.get(opt.value) || 0,
      }));

      out.push({
        key: step.id,
        title: step.title,
        column: step.column,
        answered,
        items: sortDistribution(items),
      });
    }

    // "Já compartilha?" é sim/não, o passo não tem options.
    const sharesStep = ONBOARDING_STEPS.find((s) => s.column === 'already_shares');
    if (sharesStep) {
      const yes = rows.filter((r) => r.answers?.already_shares === true).length;
      const no = rows.filter((r) => r.answers?.already_shares === false).length;
      out.unshift({
        key: sharesStep.id,
        title: sharesStep.title,
        column: 'already_shares',
        answered: yes + no,
        items: sortDistribution([
          { label: 'Sim', count: yes },
          { label: 'Não', count: no },
        ]),
      });
    }

    // "Com quem" é múltipla escolha: uma resposta pode estar em várias barras.
    const sharesWithStep = ONBOARDING_STEPS.find((s) => s.column === 'shares_with');
    if (sharesWithStep) {
      const counts = new Map();
      let answered = 0;
      for (const row of rows) {
        const list = row.answers?.shares_with;
        if (!Array.isArray(list) || !list.length) continue;
        answered++;
        for (const v of list) counts.set(v, (counts.get(v) || 0) + 1);
      }
      out.push({
        key: sharesWithStep.id,
        title: sharesWithStep.title,
        column: 'shares_with',
        answered,
        items: sortDistribution(sharesWithStep.options.map((o) => ({ label: o.label, count: counts.get(o.value) || 0 }))),
      });
    }

    return out;
  }, [rows]);

  const platformRanking = useMemo(() => {
    const byKind = { current: new Map(), interested: new Map() };

    // platform_id -> serviço, para ícone e cor.
    const byId = Object.fromEntries(services.map((s) => [s.id, s]));

    for (const i of interests) {
      const bucket = byKind[i.kind];
      if (!bucket) continue;
      const svc = i.platform_id ? byId[i.platform_id] : null;
      const cur = bucket.get(i.platform_name) || {
        count: 0,
        custom: false,
        icon: svc?.icon_url || null,
        color: svc?.color || null,
      };
      cur.count++;
      cur.custom = cur.custom || i.is_custom;
      if (!cur.icon && svc?.icon_url) { cur.icon = svc.icon_url; cur.color = svc.color; }
      bucket.set(i.platform_name, cur);
    }

    return {
      current: [...byKind.current.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.count - a.count),
      interested: [...byKind.interested.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.count - a.count),
    };
  }, [interests, services]);

  // ── KPIs ───────────────────────────────────────────────────────────────
  const total = rows.length;
  const alreadyShares = rows.filter((r) => r.answers?.already_shares === true).length;
  const paysNothing = rows.filter((r) => r.answers?.subscriptions_count_band === 'nenhuma').length;

  const stats = [
    { label: 'Responderam o onboarding', value: total, icon: <CheckCircle2 size={18} />, tone: 'green' },
    { label: 'Já compartilha', value: alreadyShares, icon: <Share2 size={18} />, tone: 'purple' },
    { label: 'Pessoas indicadas', value: invites.length, icon: <UserPlus size={18} />, tone: 'red' },
    { label: 'Não paga assinatura', value: paysNothing, icon: <TrendingUp size={18} />, tone: 'orange' },
  ];

  // ── Lista ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.name || ''} ${r.email || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search]);

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando respostas...</p>
      </div>
    );
  }

  const funnelSteps = [
    { key: 'entered', label: 'Entraram no onboarding', value: funnel.entered },
    { key: 'answered', label: 'Deixaram respostas salvas', value: funnel.answered },
    { key: 'completed', label: 'Concluíram', value: funnel.completed },
  ];
  const funnelMax = Math.max(1, ...funnelSteps.map((s) => s.value));
  const dropNoAnswer = Math.max(0, funnel.entered - funnel.answered);
  const dropNoFinish = Math.max(0, funnel.answered - funnel.completed);

  return (
    <div className="fade-in onboarding-report">
      <div className="admin-header">
        <div>
          <h1>Onboarding e Qualificação</h1>
          <p className="page-subtitle">
            O que os novos usuários respondem no primeiro acesso
          </p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {total === 0 && funnel.entered === 0 ? (
        <div className="admin-card">
          <div className="empty-table">
            <p>Nenhum usuário entrou no onboarding ainda.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Funil: de onde o usuário entra até onde ele para. */}
          <section className="ob-funnel" aria-label="Funil do onboarding">
            {funnelSteps.map((step) => (
              <div className="ob-funnel-step" key={step.key}>
                <div className="ob-funnel-head">
                  <span className="ob-funnel-label">{step.label}</span>
                  <span className="ob-funnel-value">
                    {step.value}
                    {funnel.entered > 0 && (
                      <em>{Math.min(100, Math.round((step.value / funnel.entered) * 100))}%</em>
                    )}
                  </span>
                </div>
                <div className="ob-funnel-track">
                  <div
                    className="ob-funnel-fill"
                    style={{ width: `${(step.value / funnelMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}

            {(dropNoAnswer > 0 || dropNoFinish > 0) && (
              <p className="ob-funnel-note">
                <Info size={14} />
                {dropNoAnswer > 0 && `${plural(dropNoAnswer, 'pessoa entrou', 'pessoas entraram')} sem deixar resposta.`}
                {dropNoFinish > 0 && `${plural(dropNoFinish, 'pessoa respondeu', 'pessoas responderam')} e não concluíram.`}
              </p>
            )}
          </section>

          <div className="ob-report-stats">
            {stats.map((s) => (
              <div key={s.label} className={`ob-report-stat ${s.tone}`}>
                {s.icon}
                <div>
                  <span className="ob-report-stat-value">
                    {s.value}
                    {total > 0 && s.label !== 'Responderam o onboarding' && (
                      <em>{Math.round((s.value / total) * 100)}%</em>
                    )}
                  </span>
                  <span className="ob-report-stat-label">{s.label}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="ob-report-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'overview'}
              className={`ob-report-tab ${tab === 'overview' ? 'active' : ''}`}
              onClick={() => setTab('overview')}
            >
              Resumo
            </button>
            <button
              role="tab"
              aria-selected={tab === 'responses'}
              className={`ob-report-tab ${tab === 'responses' ? 'active' : ''}`}
              onClick={() => setTab('responses')}
            >
              Respostas ({total})
            </button>
            <button
              role="tab"
              aria-selected={tab === 'incomplete'}
              className={`ob-report-tab ${tab === 'incomplete' ? 'active' : ''}`}
              onClick={() => setTab('incomplete')}
            >
              Abandonaram ({incomplete.length})
            </button>
          </div>

          {tab === 'overview' && (
            <div className="charts-section">
              {distribution.map((q) => (
                <div className="chart-card" key={q.key}>
                  <div className="chart-header">
                    <h3>{q.title}</h3>
                    <span className="chart-total">{q.answered} respostas</span>
                  </div>
                  {q.answered === 0 ? (
                    <p className="ob-report-empty">Ninguém respondeu ainda.</p>
                  ) : (
                    <div className="chart-bars">
                      {q.items.map((item) => {
                        const pct = q.answered ? (item.count / q.answered) * 100 : 0;
                        return (
                          <div className="bar-row" key={item.label}>
                            <span className="bar-label">{item.label}</span>
                            <div className="bar-track">
                              <div className="bar-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="bar-value">
                              <span className="bar-count">{item.count}</span>
                              <span className="bar-pct">{pct.toFixed(0)}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}

              {INTEREST_QUESTIONS.map((step) => {
                const bucket = platformRanking[step.kind];
                const max = Math.max(1, ...bucket.map((b) => b.count));

                return (
                  <div className="chart-card" key={step.id}>
                    <div className="chart-header">
                      <h3>{step.title}</h3>
                      <span className="chart-total">{bucket.length} serviços</span>
                    </div>
                    {bucket.length === 0 ? (
                      <p className="ob-report-empty">Ninguém marcou plataforma nesta pergunta.</p>
                    ) : (
                      <div className="chart-bars">
                        {bucket.slice(0, 15).map((b) => (
                          <div className="bar-row" key={b.name}>
                            <span className="bar-label">
                              {b.icon ? (
                                <img src={b.icon} alt="" className="bar-icon" />
                              ) : (
                                <span className="bar-icon" style={{ background: b.color || '#4F46E5' }}>
                                  {b.name.charAt(0)}
                                </span>
                              )}
                              {b.name}
                              {b.custom && <em className="ob-custom-tag">outra</em>}
                            </span>
                            <div className="bar-track">
                              <div className="bar-fill" style={{ width: `${(b.count / max) * 100}%`, background: b.color || undefined }} />
                            </div>
                            <div className="bar-value">
                              <span className="bar-count">{b.count}</span>
                              <span className="bar-pct">
                                {total ? Math.round((b.count / total) * 100) : 0}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'responses' && (
            <div className="admin-card table-responsive">
              <div className="ob-report-toolbar">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="Buscar por nome ou e-mail..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <span className="ob-report-count">{filtered.length} de {total}</span>
              </div>

              <table className="history-table">
                <thead>
                  <tr>
                    <th>Usuário</th>
                    {SCALAR_QUESTIONS.map((s) => (
                      <th key={s.id} title={s.title}>
                        {COLUMN_SHORT_LABEL[s.column] || s.title}
                      </th>
                    ))}
                    <th title="Você já compartilha alguma assinatura digital com outras pessoas?">Já compartilha</th>
                    <th title="Com quem você compartilha suas assinaturas?">Com quem</th>
                    <th>Interesses</th>
                    <th>Convidaria</th>
                    <th aria-label="Expandir" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const mine = interestsByUser[row.id]?.interested || [];
                    const names = mine.map((m) => m.platform_name);

                    return (
                      <Fragment key={row.id}>
                        <tr>
                          <td>
                            <Link to={`/admin/users/${row.id}`} className="link-name">
                              {row.name || '—'}
                            </Link>
                            <span className="ob-cell-sub">{row.email}</span>
                          </td>
                          {SCALAR_QUESTIONS.map((s) => (
                            <td key={s.id}>
                              {row.answers?.[s.column]
                                ? labelForValue(s, row.answers[s.column])
                                : '—'}
                            </td>
                          ))}
                          <td>
                            {row.answers?.already_shares === true
                              ? 'Sim'
                              : row.answers?.already_shares === false
                                ? 'Não'
                                : '—'}
                          </td>
                          <td>
                            {(row.answers?.shares_with || []).length
                              ? row.answers.shares_with
                                  .map((v) => labelForValue(ONBOARDING_STEPS.find((s) => s.column === 'shares_with'), v))
                                  .join(', ')
                              : '—'}
                          </td>
                          <td>
                            {names.length ? (
                              <span className="ob-interest-cell">
                                <strong>{names.length}</strong>
                                {names.slice(0, 2).join(', ')}
                                {names.length > 2 && <em> +{names.length - 2}</em>}
                              </span>
                            ) : '—'}
                          </td>
                          <td>
                            {row.invites?.length ? (
                              <div className="ob-invite-cells">
                                {row.invites.map((iv) => (
                                  <a
                                    key={iv.id}
                                    href={`https://wa.me/${iv.phone}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ob-invite-chip"
                                    title={`Falar com ${iv.name} no WhatsApp`}
                                  >
                                    {iv.name}
                                  </a>
                                ))}
                              </div>
                            ) : '—'}
                          </td>
                          <td>
                            <button
                              className="ob-expand-btn"
                              onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                              aria-label={expanded === row.id ? 'Fechar respostas' : 'Ver todas as respostas'}
                              aria-expanded={expanded === row.id}
                            >
                              {expanded === row.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          </td>
                        </tr>

                        {expanded === row.id && (
                          <tr className="ob-detail-row">
                            <td colSpan={SCALAR_QUESTIONS.length + 6}>
                              <div className="ob-detail-grid">
                                {distribution.map((q) => {
                                  const value = row.answers?.[q.column];
                                  const isBool = q.column === 'already_shares';
                                  const isList = q.column === 'shares_with';
                                  const step = ONBOARDING_STEPS.find((s) => s.column === q.column);

                                  let text = '—';
                                  if (isBool) {
                                    text = value === true ? 'Sim' : value === false ? 'Não' : '—';
                                  } else if (isList && Array.isArray(value) && value.length) {
                                    text = value.map((v) => labelForValue(step, v)).join(', ');
                                  } else if (value !== null && value !== undefined && value !== '') {
                                    text = labelForValue(step, value);
                                  }

                                  return (
                                    <div className="ob-detail-item" key={q.key}>
                                      <span className="ob-detail-q">{q.title}</span>
                                      <span className="ob-detail-a">{text}</span>
                                    </div>
                                  );
                                })}

                                {mine.length > 0 && (
                                  <div className="ob-detail-item">
                                    <span className="ob-detail-q">Plataformas que quer dividir</span>
                                    <span className="ob-detail-a">{names.join(', ')}</span>
                                  </div>
                                )}

                                <div className="ob-detail-item">
                                  <span className="ob-detail-q">Plataformas que já usa</span>
                                  <span className="ob-detail-a">
                                    {(interestsByUser[row.id]?.current || []).map((m) => m.platform_name).join(', ') || '—'}
                                  </span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>

              {filtered.length === 0 && (
                <div className="empty-table"><p>Nenhum usuário encontrado.</p></div>
              )}
            </div>
          )}

          {tab === 'incomplete' && (
            <div className="admin-card table-responsive">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Usuário</th>
                    <th>Entrou no onboarding</th>
                    <th>Parou em</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {incomplete.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <Link to={`/admin/users/${u.id}`} className="link-name">
                          {u.name || '—'}
                        </Link>
                        <span className="ob-cell-sub">{u.email}</span>
                      </td>
                      <td>{u.onboarding_started_at ? formatRelativeTime(u.onboarding_started_at) : '—'}</td>
                      <td>{stepLabel(u.onboarding_step)}</td>
                      <td>
                        <Link to={`/admin/users/${u.id}`} className="btn btn-outline btn-sm">
                          Ver perfil
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {incomplete.length === 0 && (
                <div className="empty-table"><p>Todo mundo que entrou respondeu o questionário.</p></div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Concordância simples de número com o substantivo. */
function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Rótulo legível da etapa a partir do id salvo em users.onboarding_step. */
function stepLabel(stepId) {
  if (!stepId) return 'Antes da 1ª pergunta';
  const step = ONBOARDING_STEPS.find((s) => s.id === stepId);
  return step ? step.title : stepId;
}

/** "há Xmin/h/d" a partir de um timestamp. */function formatRelativeTime(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

/** Maior contagem primeiro, mas zadas no fim para não sumirem na lista. */
function sortDistribution(items) {
  return [...items].sort((a, b) => {
    if (a.count === 0 && b.count === 0) return 0;
    if (a.count === 0) return 1;
    if (b.count === 0) return -1;
    return b.count - a.count;
  });
}
