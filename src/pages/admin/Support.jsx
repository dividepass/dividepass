import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, CheckCircle, AlertCircle, Eye, Archive, ArchiveRestore } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

function Support() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('active');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);

  const loadTickets = useCallback(async () => {
    const { data } = await supabase
      .from('support_tickets')
      .select('*, user:user_id (id, name, email)')
      .order('created_at', { ascending: false });

    setTickets(data || []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadTickets();
      setLoading(false);
    })();
  }, [loadTickets]);

  const setArchived = async (ticket, archived) => {
    setBusyId(ticket.id);
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({
          archived,
          archived_at: archived ? new Date().toISOString() : null,
          archived_by: archived ? user?.id ?? null : null,
        })
        .eq('id', ticket.id);

      if (error) throw error;
      await loadTickets();
    } catch (err) {
      console.error('Falha ao arquivar ticket:', err);
      alert('Não foi possível arquivar o ticket.');
    } finally {
      setBusyId(null);
    }
  };

  const statusConfig = {
    open: { label: 'Aberto', icon: AlertCircle, color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
    answered: { label: 'Respondido', icon: MessageSquare, color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
    closed: { label: 'Fechado', icon: CheckCircle, color: '#22C55E', bg: 'rgba(34,197,94,0.1)' },
  };

  const categoryLabels = {
    general: 'Geral', billing: 'Financeiro', credential: 'Credenciais',
    technical: 'Técnico', other: 'Outro',
  };

  const priorityConfig = {
    high: { label: 'Alta', color: '#B45309', bg: 'rgba(245,158,11,0.15)' },
    critical: { label: 'Crítica', color: '#DC2626', bg: 'rgba(239,68,68,0.15)' },
  };

  // A aba define o universe; o filtro de status só se aplica nos tickets ativos.
  const inView = tickets.filter(t => view === 'archived' ? t.archived === true : t.archived !== true);

  const filtered = inView.filter(t => {
    if (view !== 'archived' && filter !== 'all' && t.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.subject.toLowerCase().includes(q) ||
        t.user?.name?.toLowerCase().includes(q) ||
        t.user?.email?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const counts = {
    all: inView.length,
    open: inView.filter(t => t.status === 'open').length,
    answered: inView.filter(t => t.status === 'answered').length,
    closed: inView.filter(t => t.status === 'closed').length,
  };

  const archivedCount = tickets.filter(t => t.archived === true).length;

  return (
    <div className="fade-in">
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <h1>Suporte e Tickets</h1>
        <input
          type="text"
          placeholder="Buscar..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--text-main)', minWidth: '200px' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: 'Todos' },
          { key: 'open', label: 'Abertos' },
          { key: 'answered', label: 'Respondidos' },
          { key: 'closed', label: 'Fechados' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => { setView('active'); setFilter(tab.key); }}
            className={`btn btn-sm ${view === 'active' && filter === tab.key ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.85rem' }}
          >
            {tab.label} ({counts[tab.key]})
          </button>
        ))}

        <button
          onClick={() => setView('archived')}
          className={`btn btn-sm ${view === 'archived' ? 'btn-primary' : 'btn-outline'}`}
          style={{ fontSize: '0.85rem', marginLeft: 'auto' }}
        >
          <Archive size={14} /> Arquivados ({archivedCount})
        </button>
      </div>

      {view === 'archived' && (
        <p style={{ margin: '-0.5rem 0 1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Tickets arquivados saem das contagens e do dashboard. O usuário continua enxergando o ticket dele.
        </p>
      )}

      <div className="admin-card table-responsive">
        <table className="invoice-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Usuário</th>
              <th>Assunto</th>
              <th>Categoria</th>
              <th>Urgência</th>
              <th>Status</th>
              <th>Data</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem' }}>Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Nenhum ticket encontrado</td></tr>
            ) : filtered.map(ticket => {
              const st = statusConfig[ticket.status] || statusConfig.open;
              const Icon = st.icon;
              return (
                <tr key={ticket.id}>
                  <td><strong>#{ticket.id.slice(0, 8)}</strong></td>
                  <td>{ticket.user?.name || ticket.user?.email || '—'}</td>
                  <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.subject}</td>
                  <td>{categoryLabels[ticket.category] || ticket.category || '—'}</td>
                  <td>
                    {priorityConfig[ticket.priority] ? (
                      <span
                        className="priority-badge"
                        style={{
                          background: priorityConfig[ticket.priority].bg,
                          color: priorityConfig[ticket.priority].color,
                        }}
                      >
                        {priorityConfig[ticket.priority].label}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className="status-badge" style={{ background: st.bg, color: st.color, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Icon size={14} />
                      {st.label}
                    </span>
                  </td>
                  <td>{new Date(ticket.created_at).toLocaleDateString('pt-BR')}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <Link to={`/admin/support/${ticket.id}`} className="btn btn-primary btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>
                        <Eye size={14} /> Ver
                      </Link>
                      <button
                        onClick={() => setArchived(ticket, !ticket.archived)}
                        disabled={busyId === ticket.id}
                        title={ticket.archived ? 'Restaurar ticket' : 'Arquivar ticket'}
                        className="btn btn-outline btn-sm"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                      >
                        {ticket.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                        {ticket.archived ? 'Restaurar' : 'Arquivar'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Support;
