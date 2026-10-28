import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, CheckCircle, XCircle, AlertTriangle, Clock, History } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { formatDateBR } from '../../lib/dateFormat';
import {
  ACCESS_ACTIVE,
  ACCESS_CANCELLED,
  ACCESS_OVERDUE,
  ACCESS_PENDING,
  subscriptionAccessLabel,
  subscriptionAccessState,
  subscriptionRenewalDate,
} from '../../lib/subscriptionAccess';
import './SubscriptionHistory.css';

/* Ícone de cada estado: quem está no histórico vê os quatro. */
const STATE_ICONS = {
  [ACCESS_ACTIVE]: CheckCircle,
  [ACCESS_OVERDUE]: AlertTriangle,
  [ACCESS_PENDING]: Clock,
  [ACCESS_CANCELLED]: XCircle,
};

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

  /**
   * O histórico é a ÚNICA listagem que mostra assinatura cancelada.
   * O estado exibido é o derivado (mesma regra do resto do app): ativa,
   * atrasada, pendente ou cancelada — o `status` cru do banco é legado.
   */
  const decorated = useMemo(
    () => subscriptions.map(sub => ({
      sub,
      state: subscriptionAccessState(sub),
      label: subscriptionAccessLabel(sub),
    })),
    [subscriptions]
  );

  const countByState = (state) => decorated.filter(item => item.state === state).length;
  const filtered = filter === 'all' ? decorated : decorated.filter(item => item.state === filter);

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
              Todas <span>{decorated.length}</span>
            </button>
            <button
              className={`filter-tab ${filter === ACCESS_ACTIVE ? 'active' : ''}`}
              onClick={() => setFilter(ACCESS_ACTIVE)}
            >
              Ativas <span>{countByState(ACCESS_ACTIVE)}</span>
            </button>
            <button
              className={`filter-tab ${filter === ACCESS_OVERDUE ? 'active' : ''}`}
              onClick={() => setFilter(ACCESS_OVERDUE)}
            >
              Atrasadas <span>{countByState(ACCESS_OVERDUE)}</span>
            </button>
            <button
              className={`filter-tab ${filter === ACCESS_CANCELLED ? 'active' : ''}`}
              onClick={() => setFilter(ACCESS_CANCELLED)}
            >
              Canceladas <span>{countByState(ACCESS_CANCELLED)}</span>
            </button>
          </div>

          <div className="history-list">
            {filtered.map(({ sub, state, label }) => {
              const StateIcon = STATE_ICONS[state] || CheckCircle;
              // Cancelada não tem botão de renovar: o caminho passa a ser o
              // histórico. O que sobra é a data em que o ciclo acabou.
              const lastCycle = state === ACCESS_CANCELLED ? subscriptionRenewalDate(sub) : null;

              return (
                <div
                  key={sub.id}
                  className={`history-card ${state}`}
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
                      Início: {formatDateBR(sub.started_at || sub.created_at)}
                    </span>
                    {lastCycle && (
                      <span className="history-date">
                        Último ciclo: {formatDateBR(lastCycle)}
                      </span>
                    )}
                  </div>
                  <div className="history-right">
                    <span className={`history-status ${state}`}>
                      <StateIcon size={14} /> {label}
                    </span>
                    <span className="history-amount">
                      R$ {parseFloat(sub.amount || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="history-empty-filter">
                <p>
                  Nenhuma assinatura {filter === ACCESS_ACTIVE ? 'ativa' : filter === ACCESS_OVERDUE ? 'atrasada' : filter === ACCESS_CANCELLED ? 'cancelada' : ''} encontrada.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default SubscriptionHistory;
