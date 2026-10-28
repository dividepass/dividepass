import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, CalendarDays, Check, ChevronDown, Copy, Loader2, Search, X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  EVENT_META, EVENT_TONE, PERIODS,
  dayKey, dayLabel, formatFullDate, formatRelative, formatStamp,
  metaEntries, parseMetadata, periodStart,
} from './eventLogMeta';
import './EventLog.css';

const PAGE_SIZE = 120;
/* Com busca ativa carregamos o período inteiro para que o resultado seja completo. */
const SEARCH_LIMIT = 2000;
/* Na ficha do usuário o volume é pequeno: carregamos tudo de uma vez para a
   contagem e a ordenação serem exatas, sem paginação pela metade. */
const USER_LIMIT = 2000;

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default function EventLog({ type = 'all', search: searchProp = '', period: periodProp = 'all', counts, userId }) {
  const navigate = useNavigate();

  /* Com `userId` o log vira a ficha de um usuário: ele carrega a própria
     busca e o próprio período, porque na página do usuário não existe a
     barra de controles do painel de eventos. */
  const isUserScope = Boolean(userId);
  const [localSearch, setLocalSearch] = useState('');
  const [localPeriod, setLocalPeriod] = useState('all');
  const search = isUserScope ? localSearch : searchProp;
  const period = isUserScope ? localPeriod : periodProp;

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [truncated, setTruncated] = useState(false);

  const userMapRef = useRef({});
  const groupMapRef = useRef({});

  /* ------------------------------ consultas ------------------------------ */
  const fetchRows = useCallback(async (from, size) => {
    const since = periodStart(period);

    /* Ficha do usuário: só os eventos ligados a ele. */
    if (userId) {
      /* Caminho preferencial: a função do banco lê o metadata nos dois
         formatos em que ele é gravado (objeto jsonb e texto jsonb) e
         devolve o log já filtrado. */
      try {
        const rpc = await supabase.rpc('admin_user_events', {
          p_user_id: userId,
          p_since: since,
          p_limit: USER_LIMIT,
        });
        if (!rpc.error && Array.isArray(rpc.data)) {
          const list = rpc.data.map(ev => ({ ...ev, parsed_meta: parseMetadata(ev.metadata) }));
          return { rows: list, count: list.length, truncated: list.length >= USER_LIMIT };
        }
      } catch {
        /* função ainda não aplicada no banco — segue para a consulta direta */
      }

      const build = () => {
        let q = supabase
          .from('platform_events')
          .select('*')
          .order('created_at', { ascending: false });
        if (since) q = q.gte('created_at', since);
        return q;
      };

      /* Caminho principal: o próprio usuário disparou o evento. */
      const primary = await build().eq('created_by', userId).limit(USER_LIMIT);
      if (primary.error) throw primary.error;

      /* Caminho secundário: eventos em que o usuário aparece no metadata
         (criados por outra sessão, por exemplo). O operador `->>` do
         PostgREST pode ser recusado — nesse caso seguimos só com o caminho
         principal, sem quebrar a tela. */
      let secondary = [];
      try {
        const res = await build().eq('metadata->>user_id', userId).limit(USER_LIMIT);
        if (!res.error && res.data) secondary = res.data;
      } catch {
        /* o banco recusou o filtro por metadata */
      }

      const merged = new Map();
      [...(primary.data || []), ...secondary].forEach(ev => {
        if (ev?.id && !merged.has(ev.id)) merged.set(ev.id, ev);
      });

      const list = [...merged.values()]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .map(ev => ({ ...ev, parsed_meta: parseMetadata(ev.metadata) }));

      return { rows: list, count: list.length, truncated: list.length >= USER_LIMIT };
    }

    let query = supabase
      .from('platform_events')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + size - 1);

    if (type !== 'all') query = query.eq('event_type', type);

    if (since) query = query.gte('created_at', since);

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      rows: (data || []).map(ev => ({ ...ev, parsed_meta: parseMetadata(ev.metadata) })),
      count: count ?? (data || []).length,
    };
  }, [type, period, userId]);

  /* Enriquece com usuário e grupo — um lote por página, nunca N+1. */
  const enrich = useCallback(async (parsed) => {
    const userIds = [...new Set(parsed.map(e => e.parsed_meta?.user_id || e.created_by).filter(Boolean))];
    const groupIds = [...new Set(parsed.map(e => e.parsed_meta?.group_id).filter(Boolean))];

    const missingUsers = userIds.filter(id => !userMapRef.current[id]);
    const missingGroups = groupIds.filter(id => !groupMapRef.current[id]);

    const [usersRes, groupsRes] = await Promise.all([
      missingUsers.length
        ? supabase.from('users').select('id, name, email').in('id', missingUsers)
        : Promise.resolve({ data: [] }),
      missingGroups.length
        ? supabase.from('groups').select('id, name, slug').in('id', missingGroups)
        : Promise.resolve({ data: [] }),
    ]);

    (usersRes.data || []).forEach(u => { userMapRef.current[u.id] = u; });
    (groupsRes.data || []).forEach(g => { groupMapRef.current[g.id] = g; });

    return parsed.map(ev => ({
      ...ev,
      user: userMapRef.current[ev.parsed_meta?.user_id || ev.created_by] || null,
      group: groupMapRef.current[ev.parsed_meta?.group_id] || null,
    }));
  }, []);

  /* Na ficha do usuário a busca é local (a lista inteira já está em
     memória), então digitar não pode disparar nova consulta. No painel a
     busca recarrega o período inteiro, para o resultado ser completo. */
  const searchKey = isUserScope ? '' : search;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setExpandedId(null);
      try {
        const { rows: raw, count, truncated: cut } = await fetchRows(0, search ? SEARCH_LIMIT : PAGE_SIZE);
        const enriched = await enrich(raw);
        if (cancelled) return;
        setRows(enriched);
        setTotal(count);
        setTruncated(Boolean(cut));
      } catch {
        if (!cancelled) {
          setRows([]);
          setTotal(0);
          setTruncated(false);
        }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [fetchRows, enrich, searchKey]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const from = rows.length;
      const { rows: raw } = await fetchRows(from, PAGE_SIZE);
      const enriched = await enrich(raw);
      setRows(prev => [...prev, ...enriched]);
    } catch {
      /* mantém a lista atual */
    } finally {
      setLoadingMore(false);
    }
  };

  /* ------------------------------- leitura ------------------------------- */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter(ev => {
      const haystack = [
        ev.title, ev.message, ev.event_type, ev.created_by,
        ev.user?.name, ev.user?.email, ev.group?.name, ev.group?.slug,
        JSON.stringify(ev.parsed_meta || {}),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search]);

  const dayGroups = useMemo(() => {
    const map = new Map();
    for (const ev of visible) {
      const key = dayKey(ev.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      label: dayLabel(key),
      items,
    }));
  }, [visible]);

  const copyEvent = async (ev) => {
    const payload = JSON.stringify({
      id: ev.id,
      event_type: ev.event_type,
      title: ev.title,
      message: ev.message,
      created_at: ev.created_at,
      created_by: ev.created_by,
      metadata: ev.parsed_meta,
    }, null, 2);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const area = document.createElement('textarea');
        area.value = payload;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setCopiedId(ev.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      /* clipboard bloqueado pelo navegador */
    }
  };

  const renderMessage = (ev) => {
    if (!ev.message) return null;
    const user = ev.user;
    if (!user) return ev.message;

    const alts = [user.name, user.email].filter(Boolean).map(escapeRe);
    if (!alts.length) return ev.message;

    let pattern;
    try {
      pattern = new RegExp(`(${alts.join('|')})`, 'gi');
    } catch {
      return ev.message;
    }

    return ev.message.split(pattern).map((part, i) => {
      const isUser = alts.some(a => a.toLowerCase() === part.toLowerCase());
      if (!isUser) return <span key={i}>{part}</span>;
      return (
        <a
          key={i}
          className="pe-link"
          onClick={(e) => { e.stopPropagation(); navigate(`/admin/users/${user.id}`); }}
          title="Ver usuário"
        >
          {part}
        </a>
      );
    });
  };

  const hasMore = rows.length < total;

  /* -------------------------------- render -------------------------------- */
  return (
    <div className="ev-root">
      {/* --------------------- busca e período (ficha do usuário) --------------------- */}
      {isUserScope && (
        <div className="ev-toolbar">
          <div className="ev-search">
            <Search size={16} />
            <input
              type="text"
              placeholder="Buscar nos eventos deste usuário..."
              value={search}
              onChange={(e) => setLocalSearch(e.target.value)}
            />
            {search && (
              <button className="ev-search-clear" onClick={() => setLocalSearch('')} aria-label="Limpar busca">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="ev-period" role="group" aria-label="Período">
            {PERIODS.map(p => (
              <button
                key={p.value}
                className={period === p.value ? 'active' : ''}
                onClick={() => setLocalPeriod(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------ contagem ------------------------------ */}
      <div className="ev-stats">
        <span className="ev-stats-main">
          {search.trim() ? (
            <>
              <strong>{visible.length}</strong> resultado{visible.length !== 1 ? 's' : ''} para <em>“{search.trim()}”</em>
            </>
          ) : isUserScope ? (
            <>
              <strong>{visible.length}</strong> evento{visible.length !== 1 ? 's' : ''} deste usuário
            </>
          ) : (
            <>
              <strong>{visible.length}</strong> evento{visible.length !== 1 ? 's' : ''} exibido{visible.length !== 1 ? 's' : ''}
            </>
          )}
        </span>
        <span className="ev-stats-sub">
          {isUserScope
            ? `${total} no histórico${truncated ? ` · mostrando os ${USER_LIMIT} mais recentes` : ''}`
            : `${total} no período · ${counts?.total ?? total} no histórico`}
        </span>
      </div>

      {/* ------------------------------- lista -------------------------------- */}
      {loading && rows.length === 0 ? (
        <div className="pe-loading">
          <Loader2 size={20} className="spin" />
          Carregando eventos...
        </div>
      ) : visible.length === 0 ? (
        <div className="pe-empty">
          <Activity size={40} />
          <p>
            {search.trim()
              ? `Nenhum evento corresponde a “${search.trim()}”.`
              : isUserScope
                ? 'Nenhum evento registrado para este usuário.'
                : 'Nenhum evento registrado neste período.'}
          </p>
        </div>
      ) : (
        <div className="ev-days">
          {dayGroups.map(group => (
            <section className="ev-day" key={group.key}>
              <header className="ev-day-head">
                <CalendarDays size={13} />
                <span className="ev-day-label">{group.label}</span>
                <span className="ev-day-count">{group.items.length}</span>
              </header>

              <div className="ev-day-items">
                {group.items.map(ev => {
                  const meta = ev.parsed_meta || {};
                  const tone = EVENT_TONE[ev.event_type] || 'slate';
                  const Icon = EVENT_META[ev.event_type]?.icon || Activity;
                  const typeLabel = EVENT_META[ev.event_type]?.label || ev.event_type?.replace(/_/g, ' ');
                  const open = expandedId === ev.id;
                  const entries = metaEntries(meta);

                  return (
                    <article className={`ev-row ${open ? 'is-open' : ''}`} key={ev.id}>
                      <div
                        className="ev-row-main"
                        role="button"
                        tabIndex={0}
                        aria-expanded={open}
                        onClick={() => setExpandedId(open ? null : ev.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setExpandedId(open ? null : ev.id);
                          }
                        }}
                      >
                        <span className={`ev-icon ev-tone-${tone}`}><Icon size={14} /></span>

                        <span className="ev-row-text">
                          <span className="ev-row-title">{ev.title}</span>
                          {ev.message && <span className="ev-row-message">{renderMessage(ev)}</span>}

                          <span className="ev-row-chips">
                            <span className={`ev-type-chip ev-tone-${tone}`}>{typeLabel}</span>
                            {meta.amount !== undefined && meta.amount !== null && (
                              <span className="ev-fmt">R$ {Number(meta.amount).toFixed(2)}</span>
                            )}
                            {meta.discount_amount > 0 && (
                              <span className="ev-fmt is-discount">-R$ {Number(meta.discount_amount).toFixed(2)}</span>
                            )}
                            {meta.payment_type && (
                              <span className="ev-fmt">{meta.payment_type === 'entrance' ? 'Adesão' : 'Assinatura'}</span>
                            )}
                            {meta.gateway && <span className="ev-fmt">{meta.gateway}</span>}
                            {ev.group && <span className="ev-fmt">{ev.group.name}</span>}
                            {ev.user?.email && <span className="ev-fmt">{ev.user.email}</span>}
                          </span>
                        </span>

                        <span className="ev-row-time">
                          <time title={formatFullDate(ev.created_at)}>{formatStamp(ev.created_at)}</time>
                          <em>{formatRelative(ev.created_at)}</em>
                        </span>

                        <ChevronDown size={15} className="ev-row-caret" />
                      </div>

                      {open && (
                        <div className="ev-row-detail">
                          <div className="ev-detail-grid">
                            {entries.map(entry => (
                              <div className="ev-detail-item" key={entry.key}>
                                <label>{entry.label}</label>
                                <span className={entry.mono ? 'is-mono' : ''}>{entry.value}</span>
                              </div>
                            ))}

                            <div className="ev-detail-item">
                              <label>Data e hora</label>
                              <span>{formatFullDate(ev.created_at)}</span>
                            </div>
                            <div className="ev-detail-item">
                              <label>ID do evento</label>
                              <span className="is-mono">{ev.id}</span>
                            </div>
                          </div>

                          <div className="ev-detail-actions">
                            {ev.user && !isUserScope && (
                              <>
                                <button
                                  className="ev-ghost-btn"
                                  onClick={() => navigate(`/admin/users/${ev.user.id}`)}
                                >
                                  Ver usuário
                                </button>
                                <button
                                  className="ev-ghost-btn"
                                  onClick={() => navigate(`/admin/users/${ev.user.id}?tab=events`)}
                                  title="Abrir o log de eventos deste usuário"
                                >
                                  Ver logs
                                </button>
                              </>
                            )}
                            {ev.group && (
                              <button
                                className="ev-ghost-btn"
                                onClick={() => navigate(`/admin/groups/${ev.group.id}/edit`)}
                              >
                                Ver grupo
                              </button>
                            )}
                            <button className="ev-ghost-btn" onClick={() => copyEvent(ev)}>
                              {copiedId === ev.id ? <Check size={13} /> : <Copy size={13} />}
                              {copiedId === ev.id ? 'Copiado' : 'Copiar JSON'}
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {hasMore && (
        <div className="ev-more-wrap">
          <button className="ev-more-btn" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 size={15} className="spin" /> : <ChevronDown size={15} />}
            {loadingMore
              ? 'Carregando...'
              : `Carregar mais ${Math.min(PAGE_SIZE, total - rows.length)} eventos`}
          </button>
          <span className="ev-more-hint">
            {rows.length} de {total} carregados
          </span>
        </div>
      )}
    </div>
  );
}
