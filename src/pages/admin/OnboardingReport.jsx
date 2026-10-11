import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Search, TrendingUp, Share2, CheckCircle2, UserPlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ONBOARDING_STEPS, labelForValue } from '../../lib/onboardingQuestions';
import './OnboardingReport.css';

const INTEREST_KIND_LABEL = {
  current: 'Plataformas que já usa',
  interested: 'Plataformas que quer dividir',
};

const INTEREST_QUESTIONS = ONBOARDING_STEPS.filter((s) => s.type === 'platforms');
const SCALAR_QUESTIONS = ONBOARDING_STEPS.filter((s) => s.type === 'single' && s.column);

export default function OnboardingReport() {
  const [rows, setRows] = useState([]);
  const [interests, setInterests] = useState([]);
  const [invites, setInvites] = useState([]);
  const [incomplete, setIncomplete] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      // Só o completed_at vem do perfil; as respostas estão em user_onboarding_profiles.
      // Select enxuto para não puxar email_verified e cpf de 100+ usuários à toa.
      const [profilesRes, interestsRes, invitesRes, incompleteRes, servicesRes] = await Promise.all([
        supabase
          .from('users')
          .select('id, name, email, avatar_url, created_at, onboarding_completed_at')
          .not('onboarding_completed_at', 'is', null),
        supabase.from('user_onboarding_interests').select('*'),
        supabase.from('user_onboarding_invites').select('*'),
        // Quem começou mas não terminou: started_at preenchido, completed_at nulo.
        supabase
          .from('users')
          .select('id, name, email, onboarding_step, onboarding_started_at')
          .not('onboarding_started_at', 'is', null)
          .is('onboarding_completed_at', null),
        // Para os ícones e cores das plataformas no gráfico.
        supabase.from('streaming_services').select('id, name, icon_url, color'),
      ]);

      if (cancelled) return;

      const users = profilesRes.data || [];

      const { data: answers } = await supabase.from('user_onboarding_profiles').select('*');
      if (cancelled) return;

      const answersByUser = Object.fromEntries((answers || []).map((a) => [a.user_id, a]));
      const invitesByUser = {};
      for (const inv of invitesRes.data || []) {
        (invitesByUser[inv.user_id] = invitesByUser[inv.user_id] || []).push(inv);
      }

      setRows(users.map((u) => ({
        ...u,
        answers: answersByUser[u.id] || null,
        invites: invitesByUser[u.id] || [],
      })));
      setInterests(interestsRes.data || []);
      setInvites(invitesRes.data || []);
      setIncomplete(incompleteRes.data || []);
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
    { label: 'Onboarding concluído', value: total, icon: <CheckCircle2 size={18} />, tone: 'green' },
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

      {total === 0 ? (
        <div className="admin-card">
          <div className="empty-table">
            <p>Nenhum usuário concluiu o onboarding ainda.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="ob-report-stats">
            {stats.map((s) => (
              <div key={s.label} className={`ob-report-stat ${s.tone}`}>
                {s.icon}
                <div>
                  <span className="ob-report-stat-value">
                    {s.value}
                    {total > 0 && s.label !== 'Onboarding concluído' && (
                      <em>{Math.round((s.value / total) * 100)}%</em>
                    )}
                  </span>
                  <span className="ob-report-stat-label">{s.label}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="ob-report-tabs">
            <button
              className={`ob-report-tab ${tab === 'overview' ? 'active' : ''}`}
              onClick={() => setTab('overview')}
            >
              Resumo
            </button>
            <button
              className={`ob-report-tab ${tab === 'responses' ? 'active' : ''}`}
              onClick={() => setTab('responses')}
            >
              Respostas ({total})
            </button>
            <button
              className={`ob-report-tab ${tab === 'incomplete' ? 'active' : ''}`}
              onClick={() => setTab('incomplete')}
            >
              Não concluíram ({incomplete.length})
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
                      <h3>{INTEREST_KIND_LABEL[step.kind]}</h3>
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
              </div>

              <table className="history-table">
                <thead>
                  <tr>
                    <th>Usuário</th>
                    {SCALAR_QUESTIONS.slice(0, 3).map((s) => (
                      <th key={s.id}>{s.title.slice(0, 28)}...</th>
                    ))}
                    <th>Já compartilha</th>
                    <th>Com quem</th>
                    <th>Top interesse</th>
                    <th>Convidaria</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const mine = interestsByUser[row.id]?.interested || [];
                    const top = mine.slice().sort((a, b) => a.platform_name.localeCompare(b.platform_name))[0];

                    return (
                      <tr key={row.id}>
                        <td>
                          <Link to={`/admin/users/${row.id}`} className="link-name">
                            {row.name || '—'}
                          </Link>
                          <span style={{ display: 'block', fontSize: '0.78em', color: 'var(--text-muted)' }}>
                            {row.email}
                          </span>
                        </td>
                        {SCALAR_QUESTIONS.slice(0, 3).map((s) => (
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
                        <td>{top ? top.platform_name : '—'}</td>
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
                      </tr>
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
                    <th>Parou em</th>
                    <th>Começou há</th>
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
                        <span style={{ display: 'block', fontSize: '0.78em', color: 'var(--text-muted)' }}>
                          {u.email}
                        </span>
                      </td>
                      <td>{stepLabel(u.onboarding_step)}</td>
                      <td>{u.onboarding_started_at ? formatRelativeTime(u.onboarding_started_at) : '—'}</td>
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
                <div className="empty-table"><p>Ninguém abandonou o onboarding.</p></div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Rótulo legível da etapa a partir do id salvo em users.onboarding_step. */
function stepLabel(stepId) {
  if (!stepId) return '—';
  const step = ONBOARDING_STEPS.find((s) => s.id === stepId);
  return step ? step.title : stepId;
}

/** "há Xmin/h/d" a partir de um timestamp. */
function formatRelativeTime(dateStr) {
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