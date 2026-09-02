import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, CheckCircle, XCircle, History } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import './SubscriptionHistory.css';

function SubscriptionHistory() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!user) return;

    const fetchHistory = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('user_subscriptions')
        .select(`
          *,
          group:group_id (name, slug),
          service:service_id (name, full_name, icon_url, color)
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      setSubscriptions(data || []);
      setLoading(false);
    };

    fetchHistory();
  }, [user]);

  return (
    <div className="fade-in subscription-history-page">
      <button onClick={() => navigate(-1)} className="back-btn">
        <ChevronLeft size={18} />
        Voltar
      </button>

      <div className="page-header">
        <h1><History size={24} /> Histórico de Assinaturas</h1>
        <p>Todas as suas assinaturas, ativas e canceladas.</p>
      </div>

      {loading ? (
        <div className="empty-state">
          <p>Carregando...</p>
        </div>
      ) : subscriptions.length === 0 ? (
        <div className="empty-state">
          <History size={48} />
          <h2>Nenhuma assinatura encontrada</h2>
          <p>Você ainda não possui assinaturas ativas.</p>
          <button className="btn btn-primary" onClick={() => navigate('/dashboard/catalog')}>
            Ver catálogo de serviços
          </button>
        </div>
      ) : (
        <>
          <div className="history-filters">
            <button
              className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              Todas <span>{subscriptions.length}</span>
            </button>
            <button
              className={`filter-tab ${filter === 'active' ? 'active' : ''}`}
              onClick={() => setFilter('active')}
            >
              Ativas <span>{subscriptions.filter(s => s.status === 'active').length}</span>
            </button>
            <button
              className={`filter-tab ${filter === 'cancelled' ? 'active' : ''}`}
              onClick={() => setFilter('cancelled')}
            >
              Canceladas <span>{subscriptions.filter(s => s.status === 'cancelled').length}</span>
            </button>
          </div>

          <div className="history-list">
            {subscriptions.filter(sub => filter === 'all' || sub.status === filter).map(sub => (
            <div
              key={sub.id}
              className={`history-card ${sub.status}`}
              onClick={() => navigate(`/dashboard/subscription/${sub.id}`)}
            >
              <div className="history-icon" style={{ backgroundColor: sub.service?.color || '#4F46E5' }}>
                {sub.service?.icon_url ? (
                  <img src={sub.service.icon_url} alt={sub.service.name} className="history-icon-img" />
                ) : (
                  (sub.service?.name || '?')[0]
                )}
              </div>
              <div className="history-info">
                <h3>{sub.service?.full_name || sub.service?.name || 'Serviço'}</h3>
                <p>{sub.group?.name || 'Grupo'}</p>
                <span className="history-date">
                  Início: {new Date(sub.started_at || sub.created_at).toLocaleDateString('pt-BR')}
                </span>
              </div>
              <div className="history-right">
                <span className={`history-status ${sub.status}`}>
                  {sub.status === 'active' ? (
                    <><CheckCircle size={14} /> Ativa</>
                  ) : (
                    <><XCircle size={14} /> Cancelada</>
                  )}
                </span>
                <span className="history-amount">
                  R$ {parseFloat(sub.amount || 0).toFixed(2)}
                </span>
              </div>
            </div>
          ))}
          {subscriptions.filter(sub => filter === 'all' || sub.status === filter).length === 0 && (
            <div className="history-empty-filter">
              <p>Nenhuma assinatura {filter === 'active' ? 'ativa' : filter === 'cancelled' ? 'cancelada' : ''} encontrada.</p>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}

export default SubscriptionHistory;
