import { useState, useEffect, useMemo } from 'react';
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
  MessageCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ONBOARDING_STEPS, categoryLabel, labelForValue } from '../../lib/onboardingQuestions';
import { phoneToWhatsApp } from '../../lib/maskPhone';
import { buildLeadWhatsappUrl } from '../../lib/leadWhatsapp';
import InvitesSheet from './InvitesSheet';
import './OnboardingReport.css';

const INTEREST_QUESTIONS = ONBOARDING_STEPS.filter((s) => s.type === 'platforms');
const SCALAR_QUESTIONS = ONBOARDING_STEPS.filter((s) => s.type === 'single' && s.column);

/* "Nenhuma destas" é uma resposta, não uma plataforma. O gate oferece a
   opção e o usuário pode digitar "nenhuma" no campo livre — nos dois casos
   não faz sentido contar isso como plataforma usada ou desejada. */
const NONE_ANSWER = /^(nenhuma|nenhum|nada|sem)\b/i;
const isNoneAnswer = (name) => NONE_ANSWER.test((name || '').trim());

/* Rótulo curto da pergunta, para a ficha da resposta. A pergunta inteira
   aparece logo abaixo, então aqui cabe só o substantivo. */
const ANSWER_CHIP_LABEL = {
  subscriptions_count_band: 'Assinaturas',
  main_barrier: 'Maior barreira',
  already_shares: 'Já compartilha',
  shares_with: 'Compartilha com',
};

/* Mensagem de WhatsApp para o lead: o texto é o do dono, com os campos
   [nome_cliente] e [nomes_das_plataformas] preenchidos. */

export default function OnboardingReport() {
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [interests, setInterests] = useState([]);
  const [invites, setInvites] = useState([]);
  const [incomplete, setIncomplete] = useState([]);
  const [services, setServices] = useState([]);
  const [funnel, setFunnel] = useState({ entered: 0, answered: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [expanded, setExpanded] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

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
          .select('id, name, email, phone, avatar_url, created_at, onboarding_started_at, onboarding_completed_at, onboarding_step, lead_source, lead_source_other'),
        supabase.from('user_onboarding_profiles').select('*'),
        supabase.from('user_onboarding_interests').select('*'),
        supabase.from('user_onboarding_invites').select('*'),
        // Para os ícones, as cores e a CATEGORIA das plataformas no gráfico.
        supabase.from('streaming_services').select('id, name, icon_url, color, category'),
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

      /* A lista completa de usuários, e não só os que responderam: quem
         indicou alguém pode não ter deixado resposta salva, e a sheet
         precisa mostrar quem indicou cada contato. */
      setUsers(users);

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

  /* "Onde nos encontraram" — a origem do lead (etapa 4 do /register).
     Vem de users.lead_source, não das respostas do onboarding: a pergunta
     é feita no cadastro, antes do onboarding. Conta TODOS os usuários que
     responderam, e não só quem respondeu o onboarding. */
  const leadSourceChart = useMemo(() => {
    const counts = new Map();
    let answered = 0;

    for (const row of users) {
      const src = (row.lead_source || '').trim();
      if (!src) continue;
      answered++;

      // "Outro" traz o texto digitado pela pessoa — vira o rótulo da barra.
      const detalhe = src === 'Outro' && row.lead_source_other
        ? `Outro: ${String(row.lead_source_other).trim().slice(0, 28)}`
        : src;

      counts.set(detalhe, (counts.get(detalhe) || 0) + 1);
    }

    const items = [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));

    return { answered, items };
  }, [users]);

  const servicesById = useMemo(
    () => Object.fromEntries(services.map((s) => [s.id, s])),
    [services]
  );

  /* Plataforma digitada à mão não tem platform_id. Boa parte é só o mesmo
     serviço com outra grafia ("Apple music" x "Apple Music", "Duolingo" x
     "DuoLingo", "TotalPass" x "Totalpass") — casar pelo nome devolve a
     categoria e o ícone, e a plataforma entra no card certo. */
  const servicesByName = useMemo(() => {
    const map = {};
    for (const s of services) map[(s.name || '').trim().toLowerCase()] = s;
    return map;
  }, [services]);

  const resolveService = (interest) => {
    if (interest.platform_id && servicesById[interest.platform_id]) {
      return servicesById[interest.platform_id];
    }
    return servicesByName[(interest.platform_name || '').trim().toLowerCase()] || null;
  };

  /*
   * Um bucket por PERGUNTA, não por "kind".
   *
   * O banco guarda a resposta com `kind` ('current'/'interested') e o id do
   * serviço, mas não guarda em qual pergunta o usuário marcou. Os 4 cards de
   * interesse dividiam o mesmo bucket 'interested' — por isso o card de
   * "filmes e séries" mostrava Spotify, ChatGPT e DuoLingo junto.
   *
   * A categoria do serviço (streaming_services.category) é o que amarra a
   * plataforma à pergunta: cada card de interesse só aceita as categorias
   * declaradas no passo. "Plataformas que já usa" é a exceção — essa pergunta
   * realmente cobre todas as categorias.
   */
  const platformRanking = useMemo(() => {
    const buckets = {};
    const answeredBy = {};
    for (const step of INTEREST_QUESTIONS) {
      buckets[step.id] = new Map();
      answeredBy[step.id] = new Set();
    }

    const customInterested = new Map();

    for (const i of interests) {
      if (isNoneAnswer(i.platform_name)) continue;

      const svc = resolveService(i);
      const category = svc?.category || null;
      const isCustom = !!i.is_custom && !svc;
      // Chave pelo nome canônico do serviço: "TotalPass" e "Totalpass" são a
      // mesma plataforma e não podem virar duas barras.
      const key = svc?.name || i.platform_name;

      const targets = INTEREST_QUESTIONS.filter((step) => {
        if (step.kind !== i.kind) return false;
        if (i.kind === 'current') return true; // "já usa" aceita tudo
        if (!category) return false; // plataforma livre não tem categoria
        return step.categories.includes(category);
      });

      if (targets.length === 0) {
        // Digitada à mão numa pergunta de interesse: não dá para saber em
        // qual das quatro ela foi marcada. Fica à parte, no card "Outras".
        if (i.kind === 'interested') {
          const cur = customInterested.get(key) || { count: 0, custom: true, icon: svc?.icon_url || null, color: svc?.color || null };
          cur.count++;
          customInterested.set(key, cur);
        }
        continue;
      }

      for (const step of targets) {
        const bucket = buckets[step.id];
        const cur = bucket.get(key) || {
          count: 0,
          custom: isCustom,
          icon: svc?.icon_url || null,
          color: svc?.color || null,
          category,
        };
        cur.count++;
        if (!cur.icon && svc?.icon_url) { cur.icon = svc.icon_url; cur.color = svc.color; }
        bucket.set(key, cur);
        answeredBy[step.id].add(i.user_id);
      }
    }

    const toList = (map) => [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));

    return {
      byStep: Object.fromEntries(Object.entries(buckets).map(([id, m]) => [id, toList(m)])),
      answeredBy: Object.fromEntries(Object.entries(answeredBy).map(([id, s]) => [id, s.size])),
      custom: toList(customInterested),
    };
  }, [interests, servicesById, servicesByName]);

  /* Plataformas de um usuário, agrupadas por categoria. */
  const groupByCategory = (list) => {
    const map = new Map();
    for (const item of list) {
      if (isNoneAnswer(item.platform_name)) continue;
      const svc = resolveService(item);
      const key = svc?.category || 'outras';
      if (!map.has(key)) {
        map.set(key, { key, label: categoryLabel(svc?.category), items: [] });
      }
      const name = svc?.name || item.platform_name;
      if (map.get(key).items.some((p) => p.name === name)) continue;
      map.get(key).items.push({
        name,
        icon: svc?.icon_url || null,
        color: svc?.color || null,
        custom: !!item.is_custom && !svc,
      });
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  };

  // ── KPIs ───────────────────────────────────────────────────────────────
  const total = rows.length;
  const alreadyShares = rows.filter((r) => r.answers?.already_shares === true).length;
  const paysNothing = rows.filter((r) => r.answers?.subscriptions_count_band === 'nenhuma').length;

  const stats = [
    { label: 'Responderam o onboarding', value: total, icon: <CheckCircle2 size={18} />, tone: 'green' },
    { label: 'Já compartilha', value: alreadyShares, icon: <Share2 size={18} />, tone: 'purple' },
    { label: 'Pessoas indicadas', value: invites.length, icon: <UserPlus size={18} />, tone: 'red', action: 'invites' },
    { label: 'Não paga assinatura', value: paysNothing, icon: <TrendingUp size={18} />, tone: 'orange' },
  ];

  /* Quem indicou cada contato — a sheet agrupa por essa pessoa. */
  const usersById = useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, u])),
    [users]
  );

  // ── Lista ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    const list = rows.filter((r) => {
      if (!q) return true;
      const mine = interestsByUser[r.id] || { current: [], interested: [] };
      const haystack = [
        r.name,
        r.email,
        ...mine.interested.map((i) => i.platform_name),
        ...mine.current.map((i) => i.platform_name),
        ...(r.invites || []).map((iv) => iv.name),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });

    const sorted = [...list];
    if (sort === 'name') {
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
    } else if (sort === 'platforms') {
      const count = (r) => (interestsByUser[r.id]?.interested || []).length;
      sorted.sort((a, b) => count(b) - count(a));
    } else {
      const when = (r) => new Date(r.answers?.created_at || r.created_at || 0).getTime();
      sorted.sort((a, b) => when(b) - when(a));
    }
    return sorted;
  }, [rows, search, sort, interestsByUser]);

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
            {stats.map((s) => {
              const content = (
                <>
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
                  {s.action === 'invites' && <ChevronRight size={16} className="ob-report-stat-chevron" />}
                </>
              );

              /* O card de indicações abre a sheet com a lista completa. */
              if (s.action === 'invites') {
                return (
                  <button
                    type="button"
                    key={s.label}
                    className={`ob-report-stat ${s.tone} is-clickable`}
                    onClick={() => setSheetOpen(true)}
                    aria-haspopup="dialog"
                  >
                    {content}
                  </button>
                );
              }

              return (
                <div key={s.label} className={`ob-report-stat ${s.tone}`}>
                  {content}
                </div>
              );
            })}
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
              {/* De onde vieram as pessoas — primeira pergunta de negócio,
                  antes das respostas de qualificação. */}
              <div className="chart-card">
                <div className="chart-header">
                  <h3>Onde nos encontraram</h3>
                  <span className="chart-total">{leadSourceChart.answered} respostas</span>
                </div>
                {leadSourceChart.answered === 0 ? (
                  <p className="ob-report-empty">Ninguém respondeu ainda.</p>
                ) : (
                  <div className="chart-bars">
                    {leadSourceChart.items.map((item) => {
                      const pct = leadSourceChart.answered ? (item.count / leadSourceChart.answered) * 100 : 0;
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
                const bucket = platformRanking.byStep[step.id] || [];
                const answered = platformRanking.answeredBy[step.id] || 0;
                const max = Math.max(1, ...bucket.map((b) => b.count));
                // Só o card que junta várias categorias precisa dizer de qual
                // categoria é cada plataforma — nos outros, o próprio título
                // já responde.
                const showCategory = (step.categories?.length || 0) > 1;

                return (
                  <div className="chart-card" key={step.id}>
                    <div className="chart-header">
                      <h3>{step.title}</h3>
                      <span className="chart-total">
                        {answered ? `${answered} responderam · ${bucket.length} plataforma${bucket.length !== 1 ? 's' : ''}` : 'sem respostas'}
                      </span>
                    </div>
                    {bucket.length === 0 ? (
                      <p className="ob-report-empty">
                        {step.kind === 'current'
                          ? 'Ninguém marcou plataforma nesta pergunta.'
                          : `Ninguém marcou ${categoryLabel(step.categories?.[0]).toLowerCase()} nesta pergunta.`}
                      </p>
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
                              {showCategory && b.category && (
                                <em className="ob-category-tag">{categoryLabel(b.category)}</em>
                              )}
                            </span>
                            <div className="bar-track">
                              <div className="bar-fill" style={{ width: `${(b.count / max) * 100}%`, background: b.color || undefined }} />
                            </div>
                            <div className="bar-value">
                              <span className="bar-count">{b.count}</span>
                              <span className="bar-pct">
                                {answered ? Math.round((b.count / answered) * 100) : 0}%
                              </span>
                            </div>
                          </div>
                        ))}
                        {bucket.length > 15 && (
                          <p className="ob-report-empty">+{bucket.length - 15} outras plataformas</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {platformRanking.custom.length > 0 && (
                <div className="chart-card">
                  <div className="chart-header">
                    <h3>Outras plataformas citadas</h3>
                    <span className="chart-total">
                      {platformRanking.custom.length} digitada{platformRanking.custom.length !== 1 ? 's' : ''} à mão
                    </span>
                  </div>
                  <p className="ob-report-empty">
                    Foram marcadas em uma das perguntas de interesse, mas não dá para dizer em qual —
                    a resposta não guarda a pergunta de origem.
                  </p>
                  <div className="chart-bars">
                    {platformRanking.custom.map((b) => (
                      <div className="bar-row" key={b.name}>
                        <span className="bar-label">
                          {b.icon ? (
                            <img src={b.icon} alt="" className="bar-icon" />
                          ) : (
                            <span className="bar-icon" style={{ background: b.color || '#64748B' }}>{b.name.charAt(0)}</span>
                          )}
                          {b.name}
                        </span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${(b.count / Math.max(1, ...platformRanking.custom.map((x) => x.count))) * 100}%`, background: b.color || '#64748B' }} />
                        </div>
                        <div className="bar-value">
                          <span className="bar-count">{b.count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'responses' && (
            <div className="ob-responses">
              <div className="ob-report-toolbar">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="Buscar por nome, e-mail ou plataforma..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar respostas">
                  <option value="recent">Mais recentes</option>
                  <option value="platforms">Mais plataformas</option>
                  <option value="name">Nome (A–Z)</option>
                </select>
                <span className="ob-report-count">{filtered.length} de {total}</span>
              </div>

              {filtered.length === 0 ? (
                <div className="admin-card empty-table"><p>Nenhum usuário encontrado.</p></div>
              ) : (
                <div className="ob-response-list">
                  {filtered.map((row) => {
                    const mine = interestsByUser[row.id]?.interested || [];
                    const theirs = interestsByUser[row.id]?.current || [];
                    const open = expanded === row.id;
                    const wanted = groupByCategory(mine);
                    const used = groupByCategory(theirs);

                    const chips = [];
                    const bandStep = ONBOARDING_STEPS.find((s) => s.column === 'subscriptions_count_band');
                    if (bandStep && row.answers?.subscriptions_count_band) {
                      chips.push({
                        label: ANSWER_CHIP_LABEL.subscriptions_count_band,
                        value: labelForValue(bandStep, row.answers.subscriptions_count_band),
                      });
                    }
                    if (row.answers?.already_shares !== null && row.answers?.already_shares !== undefined) {
                      chips.push({
                        label: ANSWER_CHIP_LABEL.already_shares,
                        value: row.answers.already_shares ? 'Sim' : 'Não',
                      });
                    }
                    const sharesStep = ONBOARDING_STEPS.find((s) => s.column === 'shares_with');
                    const withList = row.answers?.shares_with;
                    if (Array.isArray(withList) && withList.length) {
                      chips.push({
                        label: ANSWER_CHIP_LABEL.shares_with,
                        value: withList.map((v) => labelForValue(sharesStep, v)).join(', '),
                      });
                    }
                    const barrierStep = ONBOARDING_STEPS.find((s) => s.column === 'main_barrier');
                    if (row.answers?.main_barrier) {
                      chips.push({
                        label: ANSWER_CHIP_LABEL.main_barrier,
                        value: labelForValue(barrierStep, row.answers.main_barrier),
                      });
                    }

                    /* Botão de WhatsApp: o texto do dono já vem pronto, com o
                       nome da pessoa e as plataformas que ela marcou. */
                    const quer = wanted.flatMap((g) => g.items.map((p) => p.name));
                    const usa = used.flatMap((g) => g.items.map((p) => p.name));
                    const plataformas = quer.length ? quer : usa;
                    const waHref = buildLeadWhatsappUrl(row.phone, row.name, plataformas);

                    return (
                      <article className={`ob-response ${open ? 'is-open' : ''}`} key={row.id}>
                        <header className="ob-response-head">
                          {row.avatar_url ? (
                            <img className="ob-response-avatar" src={row.avatar_url} alt="" />
                          ) : (
                            <span className="ob-response-avatar is-initials">
                              {(row.name || row.email || '?').charAt(0).toUpperCase()}
                            </span>
                          )}
                          <div className="ob-response-who">
                            <Link to={`/admin/users/${row.id}`} className="link-name">
                              {row.name || '—'}
                            </Link>
                            <span className="ob-response-mail">{row.email}</span>
                          </div>
                          <span className="ob-response-time">
                            {relativeTime(row.answers?.created_at || row.created_at)}
                          </span>
                          {waHref && (
                            <a
                              className="ob-whatsapp-btn"
                              href={waHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Chamar ${row.name || row.email} no WhatsApp`}
                            >
                              <MessageCircle size={14} />
                              WhatsApp
                            </a>
                          )}
                          <button
                            className="ob-expand-btn"
                            onClick={() => setExpanded(open ? null : row.id)}
                            aria-label={open ? 'Fechar respostas' : 'Ver todas as respostas'}
                            aria-expanded={open}
                          >
                            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        </header>

                        {chips.length > 0 && (
                          <div className="ob-response-chips">
                            {chips.map((c) => (
                              <span className="ob-chip" key={c.label}>
                                <b>{c.label}</b>
                                {c.value}
                              </span>
                            ))}
                          </div>
                        )}

                        {(wanted.length > 0 || used.length > 0) && (
                          <div className="ob-response-groups">
                            {wanted.length > 0 && (
                              <div className="ob-group-block">
                                <span className="ob-group-title">Quer dividir</span>
                                {wanted.map((g) => (
                                  <div className="ob-platform-group" key={g.key}>
                                    <span className="ob-platform-group-label">{g.label}</span>
                                    <div className="ob-platform-list">
                                      {g.items.map((p) => (
                                        <span className="ob-platform-chip" key={p.name}>
                                          {p.icon ? (
                                            <img src={p.icon} alt="" />
                                          ) : (
                                            <span className="ob-platform-initial" style={{ background: p.color || '#4F46E5' }}>
                                              {p.name.charAt(0)}
                                            </span>
                                          )}
                                          {p.name}
                                          {p.custom && <em className="ob-custom-tag">outra</em>}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {used.length > 0 && (
                              <div className="ob-group-block">
                                <span className="ob-group-title">Já usa</span>
                                {used.map((g) => (
                                  <div className="ob-platform-group" key={g.key}>
                                    <span className="ob-platform-group-label">{g.label}</span>
                                    <div className="ob-platform-list">
                                      {g.items.map((p) => (
                                        <span className="ob-platform-chip is-muted" key={p.name}>
                                          {p.icon ? (
                                            <img src={p.icon} alt="" />
                                          ) : (
                                            <span className="ob-platform-initial" style={{ background: p.color || '#64748B' }}>
                                              {p.name.charAt(0)}
                                            </span>
                                          )}
                                          {p.name}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {row.invites?.length > 0 && (
                          <div className="ob-group-block">
                            <span className="ob-group-title">Convidaria</span>
                            <div className="ob-platform-list">
                              {row.invites.map((iv) => {
                                /* O número vem sem o código do país — o link
                                   do WhatsApp precisa dele para funcionar. */
                                const waNumber = phoneToWhatsApp(iv.phone);
                                if (!waNumber) {
                                  return (
                                    <span key={iv.id} className="ob-invite-chip is-static">
                                      {iv.name}
                                    </span>
                                  );
                                }
                                return (
                                  <a
                                    key={iv.id}
                                    href={`https://wa.me/${waNumber}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ob-invite-chip"
                                    title={`Falar com ${iv.name} no WhatsApp`}
                                  >
                                    <MessageCircle size={12} />
                                    {iv.name}
                                  </a>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {open && (
                          <div className="ob-detail-grid">
                            {row.lead_source && (
                              <div className="ob-detail-item">
                                <span className="ob-detail-q">Onde nos encontraram</span>
                                <span className="ob-detail-a">
                                  {row.lead_source}
                                  {row.lead_source === 'Outro' && row.lead_source_other
                                    ? ` — ${row.lead_source_other}`
                                    : ''}
                                </span>
                              </div>
                            )}

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

                            {row.answers?.main_barrier_other && (
                              <div className="ob-detail-item">
                                <span className="ob-detail-q">Outra barreira</span>
                                <span className="ob-detail-a">{row.answers.main_barrier_other}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
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

      {sheetOpen && (
        <InvitesSheet
          invites={invites}
          usersById={usersById}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

/** Concordância simples de número com o substantivo. */
function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** "agora", "3 h atrás", "12/out" — o tempo relativo sozinho perde a data. */
function relativeTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min atrás`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} h atrás`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} d atrás`;

  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : '2-digit',
  });
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
