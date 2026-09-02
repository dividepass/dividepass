import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Headphones, Plus, MessageSquare, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import './Support.css';

function Support() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from('support_tickets')
        .select('*, messages: support_messages (count)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (!cancelled) {
        setTickets(data || []);
        setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [user]);

  const statusConfig = {
    open: { label: 'Aberto', icon: AlertCircle, color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
    answered: { label: 'Respondido', icon: MessageSquare, color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
    closed: { label: 'Fechado', icon: CheckCircle, color: '#22C55E', bg: 'rgba(34,197,94,0.1)' },
  };

  const categoryLabels = {
    general: 'Geral',
    billing: 'Financeiro',
    credential: 'Credenciais',
    technical: 'Técnico',
    other: 'Outro',
  };

  return (
    <div className="fade-in support-page">
      <div className="page-header">
        <div className="page-header-left">
          <Headphones size={24} />
          <div>
            <h1>Suporte</h1>
            <p>Abra tickets e acompanhe suas solicitações.</p>
          </div>
        </div>
        <Link to="/dashboard/support/new" className="btn btn-primary">
          <Plus size={18} />
          Novo Ticket
        </Link>
      </div>

      {loading ? (
        <div className="loading-state"><p>Carregando...</p></div>
      ) : tickets.length === 0 ? (
        <div className="empty-state">
          <Headphones size={48} />
          <h3>Nenhum ticket</h3>
          <p>Precisa de ajuda? Abra um ticket de suporte.</p>
          <Link to="/dashboard/support/new" className="btn btn-primary">
            <Plus size={18} />
            Criar Ticket
          </Link>
        </div>
      ) : (
        <div className="tickets-list">
          {tickets.map(ticket => {
            const st = statusConfig[ticket.status] || statusConfig.open;
            const Icon = st.icon;
            return (
              <Link to={`/dashboard/support/${ticket.id}`} key={ticket.id} className="ticket-card">
                <div className="ticket-card-left">
                  <div className="ticket-icon" style={{ background: st.bg, color: st.color }}>
                    <Icon size={20} />
                  </div>
                  <div className="ticket-info">
                    <h3>{ticket.subject}</h3>
                    <span className="ticket-category">{categoryLabels[ticket.category] || ticket.category}</span>
                    <span className="ticket-date">
                      <Clock size={12} />
                      {new Date(ticket.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                </div>
                <div className="ticket-card-right">
                  <span className="ticket-status-badge" style={{ background: st.bg, color: st.color }}>
                    {st.label}
                  </span>
                  <span className="ticket-msg-count">
                    <MessageSquare size={14} />
                    {ticket.messages?.[0]?.count || 0}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Support;
