import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageSquare,
  RefreshCw,
  Search,
  CheckCircle2,
  Eye,
  RotateCcw,
  Trash2,
  Loader2,
  AlertTriangle,
  Mail,
  ChevronLeft,
  ChevronRight,
  Inbox,
  X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './FeedbackAdmin.css';

const PAGE_SIZE = 20;

const STATUS_META = {
  new: { label: 'Novo', className: 'new' },
  reviewed: { label: 'Revisado', className: 'reviewed' },
  done: { label: 'Concluído', className: 'done' },
};

const PAGE_LABELS = {
  dashboard: 'Dashboard',
};

/**
 * Limpa o termo de busca para não quebrar a sintaxe do filtro `or()` do
 * PostgREST (vírgula abre/fecha grupo, `*` e `%` são curingas).
 */
function sanitizeTerm(term) {
  return String(term || '')
    .replace(/[,()*.%_\\'"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `há ${days} d`;
  const months = Math.round(days / 30);
  return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
}

function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

/**
 * Aplica status + busca no builder do PostgREST.
 * `matchedUserIds` permite buscar pelo nome/e-mail do autor (a busca por
 * usuário acontece na tabela `users`, separada da listagem).
 */
function applyFilters(query, { status, term, matchedUserIds }) {
  let q = query;

  if (status && status !== 'all') {
    q = q.eq('status', status);
  }

  if (term) {
    const parts = [];
    if (matchedUserIds && matchedUserIds.length > 0) {
      parts.push(`user_id.in.(${matchedUserIds.join(',')})`);
    }
    parts.push(`message.ilike.*${term}*`);
    q = q.or(parts.join(','));
  }

  return q;
}

function FeedbackAdmin() {
  const [rows, setRows] = useState([]);
  const [userMap, setUserMap] = useState(new Map());
  const [counts, setCounts] = useState({ all: 0, new: 0, reviewed: 0, done: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [processing, setProcessing] = useState(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);

  const requestIdRef = useRef(0);

  // Debounce da busca: evita uma request por tecla digitada.
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchInput), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadFeedbacks = useCallback(async (pageIndex = 0) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');

    try {
      const term = sanitizeTerm(searchTerm);
      let matchedUserIds = [];

      if (term) {
        const { data: matched, error: matchError } = await supabase
          .from('users')
          .select('id')
          .or(`name.ilike.*${term}*,email.ilike.*${term}*`)
          .limit(50);

        if (matchError) throw matchError;
        matchedUserIds = (matched || []).map((u) => u.id);
      }

      const filters = { status: statusFilter, term, matchedUserIds };

      const listQuery = applyFilters(
        supabase
          .from('user_feedback')
          .select('id, user_id, message, page, status, created_at', { count: 'exact' }),
        filters
      );

      const { data, error: listError, count } = await listQuery
        .order('created_at', { ascending: false })
        .range(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE - 1);

      if (listError) throw listError;

      // Resolve o autor em uma segunda query: evita depender do nome exato da
      // constraint de FK para o embed do PostgREST.
      const ids = [...new Set((data || []).map((r) => r.user_id))];
      const nextUserMap = new Map();
      if (ids.length > 0) {
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, name, email')
          .in('id', ids);

        if (usersError) throw usersError;
        (users || []).forEach((u) => nextUserMap.set(u.id, u));
      }

      const countFor = async (status) => {
        const q = applyFilters(
          supabase.from('user_feedback').select('id', { count: 'exact', head: true }),
          { ...filters, status }
        );
        const { count: c, error: cErr } = await q;
        if (cErr) throw cErr;
        return c || 0;
      };

      const [all, newCount, reviewedCount, doneCount] = await Promise.all([
        countFor('all'),
        countFor('new'),
        countFor('reviewed'),
        countFor('done'),
      ]);

      // Uma resposta mais recente já substituiu esta.
      if (requestId !== requestIdRef.current) return;

      setRows(data || []);
      setUserMap(nextUserMap);
      setCounts({ all, new: newCount, reviewed: reviewedCount, done: doneCount });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err?.message || 'Não foi possível carregar os feedbacks.');
      setRows([]);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [searchTerm, statusFilter]);

  useEffect(() => {
    loadFeedbacks(page);
  }, [loadFeedbacks, page]);

  const handleStatusChange = async (id, nextStatus) => {
    setProcessing(id);
    setActionError('');
    try {
      const { error: updateError } = await supabase
        .from('user_feedback')
        .update({ status: nextStatus })
        .eq('id', id);

      if (updateError) throw updateError;
      await loadFeedbacks(page);
    } catch (err) {
      setActionError(`Não foi possível alterar o status: ${err?.message || 'erro desconhecido'}`);
    } finally {
      setProcessing(null);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este feedback definitivamente?')) return;
    setProcessing(id);
    setActionError('');
    try {
      const { error: deleteError } = await supabase
        .from('user_feedback')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      // Se apagou o último item da página, volta uma.
      const targetPage = rows.length === 1 && page > 0 ? page - 1 : page;
      if (targetPage !== page) setPage(targetPage);
      else await loadFeedbacks(page);
    } catch (err) {
      setActionError(`Não foi possível excluir: ${err?.message || 'erro desconhecido'}`);
    } finally {
      setProcessing(null);
    }
  };

  const handleRefresh = () => {
    loadFeedbacks(page);
  };

  const totalPages = Math.max(1, Math.ceil(counts.all / PAGE_SIZE));
  const isFiltered = statusFilter !== 'all' || sanitizeTerm(searchTerm).length > 0;

  const filterTabs = [
    { value: 'all', label: 'Todos', count: counts.all },
    { value: 'new', label: 'Novos', count: counts.new },
    { value: 'reviewed', label: 'Revisados', count: counts.reviewed },
    { value: 'done', label: 'Concluídos', count: counts.done },
  ];

  return (
    <div className="fade-in feedback-admin-page">
      <div className="admin-header feedback-admin-header">
        <div>
          <h1>Feedbacks</h1>
          <p className="page-subtitle">
            {counts.all === 0
              ? 'Nenhum feedback recebido ainda'
              : `${counts.all} ${counts.all === 1 ? 'feedback registrado' : 'feedbacks registrados'}${
                  counts.new > 0 ? ` · ${counts.new} novo${counts.new === 1 ? '' : 's'} sem ler` : ''
                }`}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={handleRefresh}
          disabled={loading}
        >
          {loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
          Atualizar
        </button>
      </div>

      {error && (
        <div className="error-banner feedback-admin-banner">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {actionError && (
        <div className="error-banner feedback-admin-banner">
          <AlertTriangle size={16} />
          <span>{actionError}</span>
          <button
            type="button"
            className="feedback-admin-banner-close"
            onClick={() => setActionError('')}
            aria-label="Fechar aviso"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="feedback-admin-toolbar">
        <div className="feedback-admin-tabs">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={`feedback-admin-tab ${statusFilter === tab.value ? 'active' : ''}`}
              onClick={() => {
                setStatusFilter(tab.value);
                setPage(0);
              }}
            >
              {tab.label}
              <span className="feedback-admin-tab-count">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="feedback-admin-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(0);
            }}
            placeholder="Buscar por mensagem, nome ou e-mail..."
            aria-label="Buscar feedbacks"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setPage(0);
              }}
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading-state feedback-admin-loading">
          <Loader2 size={32} className="spin" />
          <p>Carregando feedbacks...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state feedback-admin-empty">
          <Inbox size={44} />
          <h3>
            {isFiltered
              ? 'Nenhum feedback encontrado'
              : 'Nenhum feedback recebido ainda'}
          </h3>
          <p>
            {isFiltered
              ? 'Ajuste os filtros ou o termo da busca para ver outros registros.'
              : 'Quando um usuário enviar um feedback pelo dashboard, ele aparece aqui.'}
          </p>
          {!isFiltered && (
            <p className="feedback-admin-empty-hint">
              Se você já recebeu feedbacks e a lista continua vazia, a policy de
              admin pode não estar aplicada — rode{' '}
              <code>database/fix-feedback-admin-rls.sql</code>.
            </p>
          )}
        </div>
      ) : (
        <div className="feedback-admin-list">
          {rows.map((fb) => {
            const user = userMap.get(fb.user_id);
            const meta = STATUS_META[fb.status] || { label: fb.status, className: 'new' };
            const busy = processing === fb.id;

            return (
              <article key={fb.id} className={`feedback-admin-card ${meta.className}`}>
                <header className="feedback-admin-card-head">
                  <div className="feedback-admin-user">
                    <div className="feedback-admin-avatar">{initials(user?.name)}</div>
                    <div className="feedback-admin-user-info">
                      <strong>{user?.name || 'Usuário'}</strong>
                      {user?.email && (
                        <a href={`mailto:${user.email}`} className="feedback-admin-email">
                          <Mail size={12} aria-hidden />
                          {user.email}
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="feedback-admin-head-right">
                    <span className={`feedback-admin-status ${meta.className}`}>
                      {meta.label}
                    </span>
                    <div className="feedback-admin-date">
                      <time dateTime={fb.created_at} title={formatDateTime(fb.created_at)}>
                        {relativeTime(fb.created_at)}
                      </time>
                      <span>{formatDateTime(fb.created_at)}</span>
                    </div>
                  </div>
                </header>

                {fb.page && (
                  <div className="feedback-admin-origin">
                    <MessageSquare size={12} aria-hidden />
                    {PAGE_LABELS[fb.page] || fb.page}
                  </div>
                )}

                <p className="feedback-admin-message">{fb.message}</p>

                <footer className="feedback-admin-actions">
                  {fb.status !== 'new' && (
                    <button
                      type="button"
                      className="feedback-admin-btn"
                      onClick={() => handleStatusChange(fb.id, 'new')}
                      disabled={busy}
                    >
                      <RotateCcw size={14} />
                      Reabrir
                    </button>
                  )}
                  {fb.status === 'new' && (
                    <button
                      type="button"
                      className="feedback-admin-btn"
                      onClick={() => handleStatusChange(fb.id, 'reviewed')}
                      disabled={busy}
                    >
                      <Eye size={14} />
                      Marcar como revisado
                    </button>
                  )}
                  {fb.status !== 'done' && (
                    <button
                      type="button"
                      className="feedback-admin-btn done"
                      onClick={() => handleStatusChange(fb.id, 'done')}
                      disabled={busy}
                    >
                      <CheckCircle2 size={14} />
                      Concluir
                    </button>
                  )}
                  {user?.email && (
                    <a
                      className="feedback-admin-btn reply"
                      href={`mailto:${user.email}?subject=${encodeURIComponent(
                        'DividePass — seu feedback'
                      )}`}
                    >
                      <Mail size={14} />
                      Responder
                    </a>
                  )}

                  <button
                    type="button"
                    className="feedback-admin-btn delete"
                    onClick={() => handleDelete(fb.id)}
                    disabled={busy}
                    aria-label="Excluir feedback"
                  >
                    {busy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {!loading && rows.length > 0 && totalPages > 1 && (
        <div className="feedback-admin-pagination">
          <button
            type="button"
            className="feedback-admin-btn"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <ChevronLeft size={14} />
            Anterior
          </button>
          <span>
            Página {page + 1} de {totalPages}
          </span>
          <button
            type="button"
            className="feedback-admin-btn"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Próxima
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export default FeedbackAdmin;
