import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, X, CheckCircle, XCircle, UserPlus, DollarSign, AlertTriangle, Clock, CreditCard } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import './AdminNotifications.css';

const EVENT_ICONS = {
  user_registered: <UserPlus size={16} />,
  group_created: <CheckCircle size={16} />,
  group_approved: <CheckCircle size={16} />,
  group_rejected: <XCircle size={16} />,
  group_deleted: <XCircle size={16} />,
  member_joined: <UserPlus size={16} />,
  member_left: <XCircle size={16} />,
  payment: <DollarSign size={16} />,
  subscription_cancelled: <CreditCard size={16} />,
  info: <Clock size={16} />,
};

const EVENT_LABELS = {
  user_registered: 'Novo Cadastro',
  group_created: 'Grupo Criado',
  group_approved: 'Grupo Aprovado',
  group_rejected: 'Grupo Recusado',
  group_deleted: 'Grupo Removido',
  member_joined: 'Novo Membro',
  member_left: 'Membro Saiu',
  payment: 'Pagamento',
  subscription_cancelled: 'Assinatura Cancelada',
  info: 'Informativo',
};

function AdminNotifications() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [urgentPopup, setUrgentPopup] = useState(null);
  const lastSeenAtRef = useRef(new Date());
  const processedIdsRef = useRef(new Set());
  const dropdownRef = useRef(null);

  const isUrgentPayment = useCallback((event) => {
    if (event.event_type !== 'payment') return false;
    const meta = event.metadata || {};
    const title = (event.title || '').toLowerCase();
    const message = (event.message || '').toLowerCase();
    return meta.status === 'failed'
      || meta.status === 'error'
      || meta.status === 'expired'
      || meta.status === 'cancelled'
      || meta.error
      || meta.webhook_failed
      || meta.urgent
      || title.includes('falha')
      || title.includes('erro')
      || title.includes('webhook')
      || message.includes('falha')
      || message.includes('erro')
      || message.includes('webhook');
  }, []);

  const fetchRecentEvents = useCallback(async () => {
    const { data } = await supabase
      .from('platform_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);

    if (data) {
      setEvents(data);
    }
  }, []);

  useEffect(() => {
    fetchRecentEvents();

    const channel = supabase
      .channel('admin-notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'platform_events',
      }, (payload) => {
        const event = payload.new;

        setEvents((prev) => {
          if (prev.some((e) => e.id === event.id)) return prev;
          return [event, ...prev].slice(0, 30);
        });

        if (isUrgentPayment(event) && !processedIdsRef.current.has(event.id)) {
          processedIdsRef.current.add(event.id);
          setUrgentPopup(event);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRecentEvents, isUrgentPayment]);

  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const unreadCount = events.filter(
    (e) => new Date(e.created_at) > lastSeenAtRef.current
  ).length;

  const formatTime = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'agora';
    if (diffMin < 60) return `${diffMin}min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d`;
  };

  const handleViewAll = () => {
    setIsOpen(false);
    navigate('/admin/events');
  };

  const handleDismissUrgent = () => {
    setUrgentPopup(null);
  };

  const handleUrgentAction = () => {
    setUrgentPopup(null);
    navigate('/admin/events');
  };

  const recentEvents = events.slice(0, 15);

  return (
    <>
      <div className="notif-bell-wrapper" ref={dropdownRef}>
        <button
          className={`notif-bell-btn ${urgentPopup ? 'notif-bell-urgent' : ''}`}
          onClick={() => {
            setIsOpen(!isOpen);
            if (!isOpen) lastSeenAtRef.current = new Date();
          }}
          title="Notificações"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
        </button>

        {isOpen && (
          <div className="notif-dropdown">
            <div className="notif-dropdown-header">
              <span>Notificações</span>
              <button className="notif-close-btn" onClick={() => setIsOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="notif-list">
              {recentEvents.length === 0 ? (
                <div className="notif-empty">Nenhuma notificação</div>
              ) : (
                recentEvents.map((event) => (
                  <div
                    key={event.id}
                    className={`notif-item ${isUrgentPayment(event) ? 'notif-item-urgent' : ''}`}
                    onClick={() => {
                      setIsOpen(false);
                      navigate('/admin/events');
                    }}
                  >
                    <div className={`notif-icon notif-icon-${event.event_type}`}>
                      {EVENT_ICONS[event.event_type] || <Clock size={16} />}
                    </div>
                    <div className="notif-content">
                      <div className="notif-title">
                        {EVENT_LABELS[event.event_type] || event.title}
                      </div>
                      <div className="notif-message">{event.message}</div>
                      <div className="notif-time">{formatTime(event.created_at)}</div>
                    </div>
                    {isUrgentPayment(event) && (
                      <AlertTriangle size={14} className="notif-urgent-icon" />
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="notif-dropdown-footer">
              <button className="notif-view-all" onClick={handleViewAll}>
                Ver todos os eventos
              </button>
            </div>
          </div>
        )}
      </div>

      {urgentPopup && (
        <div className="urgent-overlay" onClick={handleDismissUrgent}>
          <div className="urgent-modal" onClick={(e) => e.stopPropagation()}>
            <div className="urgent-header">
              <AlertTriangle size={24} className="urgent-icon" />
              <h3>Pagamento com Problema</h3>
            </div>
            <div className="urgent-body">
              <p className="urgent-message">{urgentPopup.message}</p>
              <div className="urgent-details">
                <div className="urgent-detail-row">
                  <span>Tipo:</span>
                  <span>{urgentPopup.title}</span>
                </div>
                <div className="urgent-detail-row">
                  <span>Horário:</span>
                  <span>{new Date(urgentPopup.created_at).toLocaleString('pt-BR')}</span>
                </div>
                {urgentPopup.metadata && (
                  <div className="urgent-detail-row">
                    <span>Detalhes:</span>
                    <span className="urgent-meta">
                      {JSON.stringify(urgentPopup.metadata, null, 2)}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="urgent-footer">
              <button className="urgent-btn-secondary" onClick={handleDismissUrgent}>
                Dispensar
              </button>
              <button className="urgent-btn-primary" onClick={handleUrgentAction}>
                Verificar Agora
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AdminNotifications;
