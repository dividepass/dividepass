import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, CheckCircle, AlertCircle, Eye } from 'lucide-react';
import { supabase } from '../../lib/supabase';

function Support() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('support_tickets')
        .select('*, user:user_id (id, name, email), messages: support_messages (count)')
        .order('created_at', { ascending: false });

      setTickets(data || []);
      setLoading(false);
    })();
  }, []);

  const statusConfig = {
    open: { label: 'Aberto', icon: AlertCircle, color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
    answered: { label: 'Respondido', icon: MessageSquare, color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
    closed: { label: 'Fechado', icon: CheckCircle, color: '#22C55E', bg: 'rgba(34,197,94,0.1)' },
  };

  const categoryLabels = {
    general: 'Geral', billing: 'Financeiro', credential: 'Credenciais',
    technical: 'Técnico', other: 'Outro',
  };

  const filtered = tickets.filter(t => {
    if (filter !== 'all' && t.status !== filter) return false;
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
    all: tickets.length,
    open: tickets.filter(t => t.status === 'open').length,
    answered: tickets.filter(t => t.status === 'answered').length,
    closed: tickets.filter(t => t.status === 'closed').length,
  };

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
            onClick={() => setFilter(tab.key)}
            className={`btn btn-primary btn-sm`}
            style={{ fontSize: '0.85rem' }}
          >
            {tab.label} ({counts[tab.key]})
          </button>
        ))}
      </div>

      <div className="admin-card table-responsive">
        <table className="invoice-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Usuário</th>
              <th>Assunto</th>
              <th>Categoria</th>
              <th>Status</th>
              <th>Data</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }}>Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Nenhum ticket encontrado</td></tr>
            ) : filtered.map(ticket => {
              const st = statusConfig[ticket.status] || statusConfig.open;
              const Icon = st.icon;
              return (
                <tr key={ticket.id}>
                  <td><strong>#{ticket.id.slice(0, 8)}</strong></td>
                  <td>{ticket.user?.name || ticket.user?.email || '—'}</td>
                  <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.subject}</td>
                  <td>{categoryLabels[ticket.category] || ticket.category}</td>
                  <td>
                    <span className="status-badge" style={{ background: st.bg, color: st.color, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Icon size={14} />
                      {st.label}
                    </span>
                  </td>
                  <td>{new Date(ticket.created_at).toLocaleDateString('pt-BR')}</td>
                  <td>
                    <Link to={`/admin/support/${ticket.id}`} className="btn btn-primary btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>
                      <Eye size={14} /> Ver
                    </Link>
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
