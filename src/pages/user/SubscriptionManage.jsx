import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ChevronLeft,
  Calendar,
  RotateCcw,
  CreditCard,
  Ban,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Shield,
  ExternalLink,
  Clock,
  History,
  XCircle,
  User,
  DollarSign,
} from 'lucide-react';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import './SubscriptionManage.css';

function SubscriptionManage() {
  const { subscriptionId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { streamingServices, getActiveServices, currentUser, refresh, markCancelled } = useAppDataContext();

  const [cancelling, setCancelling] = useState(false);
  const [cancelledIds, setCancelledIds] = useState(new Set());
  const [billingHistory, setBillingHistory] = useState([]);
  const [cancelledSub, setCancelledSub] = useState(null);

  const activeServices = getActiveServices();
  const baseSubscription = activeServices.find(s => s.id === subscriptionId) || cancelledSub || null;
  const subscription = baseSubscription && cancelledIds.has(baseSubscription.id)
    ? { ...baseSubscription, status: 'cancelled' }
    : baseSubscription;

  useEffect(() => {
    if (!subscription) return;
    async function fetchBillingHistory() {
      const { data } = await supabase
        .from('billing_cycles')
        .select('id, amount, status, attempt_number, error_message, charge_date, completed_at, created_at')
        .eq('subscription_id', subscription.id)
        .order('charge_date', { ascending: false })
        .limit(12);
      setBillingHistory(data || []);
    }
    fetchBillingHistory();
  }, [subscription]);

  // If subscriptionId not found in active services, fetch directly (cancelled)
  useEffect(() => {
    if (!subscriptionId || activeServices.find(s => s.id === subscriptionId) || cancelledSub) return;
    let cancelled = false;

    const fetchCancelled = async () => {
      const { data } = await supabase
        .from('user_subscriptions')
        .select(`
          *,
          group:group_id (*, credential:group_credentials (*), profiles:group_profiles(*), owner:owner_id (id, name, avatar_url, role), members:group_members(*)),
          service:service_id (*)
        `)
        .eq('id', subscriptionId)
        .eq('user_id', user.id)
        .single();

      if (!cancelled && data) {
        setCancelledSub(data);
        setCancelledIds(prev => new Set([...prev, data.id]));
      }
    };

    fetchCancelled();
    return () => { cancelled = true; };
  }, [subscriptionId, activeServices, cancelledSub, user]);

  const handleCancel = async () => {
    if (!window.confirm('Tem certeza que deseja cancelar esta assinatura? Você perderá o acesso imediatamente.')) {
      return;
    }

    setCancelling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cancel-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ subscription_id: subscription.id, group_id: subscription.group.id }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Erro ao cancelar');

      // Remove from context IMMEDIATELY
      markCancelled(subscription.id);
      setCancelledIds(prev => new Set([...prev, subscription.id]));
      
      // Re-fetch in background
      refresh();
      
      // Redirect
      navigate('/dashboard');
    } catch (err) {
      alert('Erro ao cancelar assinatura: ' + err.message);
    } finally {
      setCancelling(false);
    }
  };

  if (!subscription) {
    return (
      <div className="fade-in subscription-manage-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ChevronLeft size={18} />
          Voltar
        </button>
        <div className="empty-state">
          <h2>Assinatura não encontrada</h2>
          <Link to="/dashboard/credentials" className="btn btn-primary">
            Ver Credenciais
          </Link>
        </div>
      </div>
    );
  }

  const service = streamingServices.find(s => s.id === subscription.service?.id);
  const { group } = subscription;
  const isActive = subscription.status === 'active';
  const nextChargeAt = subscription.next_charge_at;
  const cardLast4 = subscription.card_last4;
  const cardBrand = subscription.card_brand;
  const retryCount = subscription.retry_count || 0;
  const lastChargeAt = subscription.last_charge_at;

  // Owner info
  const owner = group?.owner;
  const ownerName = owner?.name || 'Administrador do grupo';

  // Fee breakdown
  const subscriptionAmount = parseFloat(subscription.amount || group?.price_per_slot || 0);
  const platformFeePercent = parseFloat(group?.platform_fee_percent || 3.95);
  const gatewayFeePercent = parseFloat(group?.gateway_fee_percent || 4.98);
  const platformFee = subscriptionAmount * (platformFeePercent / 100);
  const gatewayFee = subscriptionAmount * (gatewayFeePercent / 100);
  const netToOwner = subscriptionAmount - platformFee - gatewayFee;

  // Days until next charge
  const daysUntilCharge = nextChargeAt
    ? Math.ceil((new Date(nextChargeAt) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="fade-in subscription-manage-page">
      <button onClick={() => navigate(-1)} className="back-btn">
        <ChevronLeft size={18} />
        Voltar
      </button>

      <div className="page-header">
        <h1>Gerenciar Assinatura</h1>
        <p>Detalhes e opções da sua assinatura {service?.name}.</p>
      </div>

      <div className="sub-manage-card" style={{ '--service-color': service?.color || '#4F46E5' }}>
        <div className="sub-manage-header" style={{ backgroundColor: `${service?.color}15` }}>
          <div className="credential-service">
            <div className="credential-icon" style={{ backgroundColor: service?.color }}>
              {service?.icon_url ? (
                <img src={service.icon_url} alt={service.name} className="credential-icon-img" />
              ) : (
                service?.icon
              )}
            </div>
            <div>
              <h2 style={{ color: service?.color }}>{service?.full_name}</h2>
              <span className="modal-group-name">{group.name}</span>
            </div>
          </div>
          <div className={`sub-status-badge ${isActive ? 'active' : 'cancelled'}`}>
            {isActive ? <CheckCircle size={16} /> : <Ban size={16} />}
            {isActive ? 'Ativa' : 'Cancelada'}
          </div>
        </div>

        <div className="sub-manage-body">
          <div className="sub-detail-grid">
            <div className="sub-detail-item">
              <Calendar size={18} />
              <div>
                <span>Data de início</span>
                <strong>{new Date(subscription.started_at || subscription.created_at).toLocaleDateString('pt-BR')}</strong>
              </div>
            </div>
            <div className="sub-detail-item">
              <RotateCcw size={18} />
              <div>
                <span>Próxima cobrança</span>
                <strong>{nextChargeAt ? new Date(nextChargeAt).toLocaleDateString('pt-BR') : subscription.expires_at ? new Date(subscription.expires_at).toLocaleDateString('pt-BR') : 'Mensal'}</strong>
              </div>
            </div>
            <div className="sub-detail-item">
              <CreditCard size={18} />
              <div>
                <span>Valor mensal</span>
                <strong>R$ {parseFloat(subscription.amount || group.price_per_slot || 0).toFixed(2)}</strong>
              </div>
            </div>
            <div className="sub-detail-item">
              <Shield size={18} />
              <div>
                <span>Ciclo de cobrança</span>
                <strong>
                  {subscription.billing_cycle === 'days'
                    ? (subscription.group?.custom_cycle_label || `${subscription.custom_cycle_days || '?'} dias`)
                    : subscription.billing_cycle === 'custom'
                    ? (subscription.group?.custom_cycle_label || `${subscription.custom_cycle_months || '?'} meses`)
                    : ({ monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual', days: 'Dias' }[subscription.billing_cycle] || 'Mensal')
                  }
                </strong>
              </div>
            </div>
            {cardLast4 && (
              <div className="sub-detail-item">
                <CreditCard size={18} />
                <div>
                  <span>Cartão</span>
                  <strong>**** {cardLast4} {cardBrand ? `(${cardBrand})` : ''}</strong>
                </div>
              </div>
            )}
            {retryCount > 0 && (
              <div className="sub-detail-item">
                <AlertTriangle size={18} />
                <div>
                  <span>Tentativas falhas</span>
                  <strong className="text-warning">{retryCount}/3</strong>
                </div>
              </div>
            )}
            {lastChargeAt && (
              <div className="sub-detail-item">
                <Clock size={18} />
                <div>
                  <span>Último pagamento</span>
                  <strong>{new Date(lastChargeAt).toLocaleDateString('pt-BR')}</strong>
                </div>
              </div>
            )}
          </div>

          {/* Quem recebe */}
          <div className="sub-payment-info-card">
            <h3><User size={16} /> Quem recebe o pagamento</h3>
            <div className="payment-recipient">
              <div className="recipient-avatar">
                {owner?.avatar_url ? (
                  <img src={owner.avatar_url} alt={ownerName} />
                ) : (
                  <div className="recipient-initials">{ownerName.charAt(0).toUpperCase()}</div>
                )}
              </div>
              <div className="recipient-details">
                <strong>{ownerName}</strong>
                <span>Dono do grupo</span>
              </div>
            </div>
          </div>

          {/* Breakdown de taxas */}
          <div className="sub-payment-info-card">
            <h3><DollarSign size={16} /> Detalhamento do valor</h3>
            <div className="fee-breakdown">
              <div className="fee-row">
                <span>Valor total</span>
                <strong>R$ {subscriptionAmount.toFixed(2)}</strong>
              </div>
              <div className="fee-row fee-deduction">
                <span>Taxa da plataforma ({platformFeePercent}%)</span>
                <span>- R$ {platformFee.toFixed(2)}</span>
              </div>
              <div className="fee-row fee-deduction">
                <span>Taxa gateway ({gatewayFeePercent}%)</span>
                <span>- R$ {gatewayFee.toFixed(2)}</span>
              </div>
              <div className="fee-row fee-total">
                <span>Líquido para o dono</span>
                <strong>R$ {netToOwner.toFixed(2)}</strong>
              </div>
            </div>
          </div>

          {/* Próxima cobrança destacada */}
          {nextChargeAt && isActive && (
            <div className="sub-next-charge-highlight">
              <Calendar size={24} />
              <div>
                <span>Próxima cobrança em</span>
                <strong>{daysUntilCharge} {daysUntilCharge === 1 ? 'dia' : 'dias'}</strong>
                <span className="charge-date">{new Date(nextChargeAt).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</span>
              </div>
            </div>
          )}

          {billingHistory.length > 0 && (
            <div className="sub-billing-history">
              <h3><History size={16} /> Histórico de Cobranças</h3>
              <div className="billing-history-list">
                {billingHistory.map(item => (
                  <div key={item.id} className="billing-history-item">
                    <div className="billing-history-date">
                      {new Date(item.charge_date || item.created_at).toLocaleDateString('pt-BR')}
                    </div>
                    <div className="billing-history-info">
                      <span className="billing-history-amount">R$ {parseFloat(item.amount).toFixed(2)}</span>
                      <span className={`billing-history-status status-${item.status}`}>
                        {item.status === 'approved' ? (
                          <><CheckCircle size={12} /> Pago</>
                        ) : item.status === 'failed' ? (
                          <><XCircle size={12} /> {item.attempt_number > 1 ? `Tentativa ${item.attempt_number}` : 'Falhou'}</>
                        ) : (
                          <><Clock size={12} /> Pendente</>
                        )}
                      </span>
                    </div>
                    {item.status === 'failed' && item.error_message && (
                      <div className="billing-history-error">{item.error_message}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {service?.official_url && (
            <a
              href={service.official_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline btn-full sub-site-link"
            >
              <ExternalLink size={16} />
              Acessar site oficial
            </a>
          )}

          {isActive && (
            <div className="sub-danger-zone">
              <h3>Zona de perigo</h3>
              <p>Cancelar sua assinatura resultará na perda imediata de acesso às credenciais e ao grupo.</p>
              <button
                className="btn btn-danger btn-full"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Cancelando...
                  </>
                ) : (
                  <>
                    <Ban size={16} />
                    Cancelar Assinatura
                  </>
                )}
              </button>
            </div>
          )}

          {!isActive && (
            <div className="sub-cancelled-notice">
              <AlertTriangle size={20} />
              <p>Esta assinatura foi cancelada. Para acessar novamente, assine um novo grupo.</p>
              <Link to={`/dashboard/catalog/${service?.slug || service?.id}`} className="btn btn-primary">
                Ver Grupos Disponíveis
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SubscriptionManage;
