import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Eye,
  EyeOff,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Shield,
  AlertTriangle,
  Calendar,
  RotateCcw,
  ScrollText,
  Loader2,
  ExternalLink,
  Settings,
  User,
  MessageCircle,
  CreditCard,
  X
} from 'lucide-react';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import {
  ACCESS_CANCELLED,
  ACCESS_OVERDUE,
  needsRenewalReminder,
  subscriptionAccessLabel,
  subscriptionAccessState,
  subscriptionRenewalDate,
} from '../../lib/subscriptionAccess';
import { formatDateBR } from '../../lib/dateFormat';
import GroupChat from '../../components/GroupChat';
import ContactAdminModal from '../../components/ContactAdminModal';
import SubscriptionRenewalModal from '../../components/SubscriptionRenewalModal';
import RenewalReminderCard from '../../components/RenewalReminderCard';
import EmailCodeSearch from '../../components/EmailCodeSearch';
import './ServiceCredentials.css';

function ServiceCredentials() {
  const { serviceId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const groupId = searchParams.get('group');
  const { user } = useAuth();
  const { streamingServices, getActiveServices, isSubscribedToService, refresh } = useAppDataContext();

  const [showCredentials, setShowCredentials] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [copiedField, setCopiedField] = useState(null);
  const [showPasswords, setShowPasswords] = useState({});

  const [paymentStatus, setPaymentStatus] = useState(null);
  const [showContactModal, setShowContactModal] = useState(false);

  const [verifiedAccess, setVerifiedAccess] = useState(null);
  const [verifyingAccess, setVerifyingAccess] = useState(true);

  // Assinatura que sustenta o acesso a este grupo (inclusive cancelada —
  // nesse caso ainda é possível reativar pagando de novo).
  const [accessSubscription, setAccessSubscription] = useState(null);
  const [accessBlocked, setAccessBlocked] = useState(false);
  // Distingue a assinatura atrasada (renovação em atraso) da assinatura
  // cancelada: o aviso de acesso bloqueado muda de texto.
  const [accessOverdue, setAccessOverdue] = useState(false);
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [showRenewal, setShowRenewal] = useState(false);

  const activeServices = getActiveServices();
  const service = streamingServices.find(s => s.id === serviceId || s.slug === serviceId);
  const isSubscribed = isSubscribedToService(serviceId);

  // Se group_id foi passado, usar ele; senão, pegar o primeiro da plataforma
  const activeService = groupId
    ? activeServices.find(item => (item.service.id === serviceId || item.service.slug === serviceId) && item.group.id === groupId)
    : activeServices.find(item => item.service.id === serviceId || item.service.slug === serviceId);

  // Bloquear o acesso quando a assinatura foi cancelada, a pessoa saiu do
  // grupo — ou, principalmente, quando a renovação venceu: a assinatura
  // continua "active" no banco, mas o período pago já acabou.
  useEffect(() => {
    const targetGroupId = groupId || activeService?.group?.id;
    if (!user || !targetGroupId) {
      setVerifyingAccess(false);
      return;
    }

    let cancelled = false;
    const verify = async () => {
      try {
        const [subRes, memberRes] = await Promise.all([
          supabase.from('user_subscriptions')
            .select('id, status, next_charge_at, renewal_due_at, expires_at, amount, billing_cycle, custom_cycle_days, custom_cycle_months, group_id')
            .eq('group_id', targetGroupId)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from('group_members')
            .select('status, payment_status')
            .eq('group_id', targetGroupId)
            .eq('user_id', user.id)
            .maybeSingle()
        ]);

        if (cancelled) return;

        const sub = subRes.data;
        const memberStatus = memberRes.data?.status;

        // Falha na consulta (inclusive a coluna `renewal_due_at` ainda não
        // existir no banco): BLOQUEAR o acesso. Sem conseguir ler a
        // assinatura não há como dizer que o período está pago — continuar
        // liberado entregaria credencial de assinatura vencida. O mesmo
        // fail-closed do `catch` abaixo.
        if (subRes.error || memberRes.error) {
          console.error(
            '[ServiceCredentials] Erro ao verificar assinatura/membro:',
            subRes.error || memberRes.error
          );
          setVerifiedAccess(false);
          return;
        }

        // Se os dados retornaram null (RLS bloqueia ou registro não existe), bloquear acesso
        if (!sub && !memberRes.data) {
          setVerifiedAccess(false);
          return;
        }

        // Saiu do grupo: sem caminho para reativar por aqui.
        // ('cancelled' é o que o cancelamento grava; 'left' e 'inactive' são
        // legados que também significam "fora do grupo".)
        if (memberStatus === 'cancelled' || memberStatus === 'left' || memberStatus === 'inactive') {
          setVerifiedAccess(false);
          setAccessBlocked(false);
          setAccessOverdue(false);
          return;
        }

        setAccessSubscription(sub || null);

        // Sem assinatura em si (membro do grupo sem registro de assinatura):
        // o acesso continua como antes, ligado à associação ao grupo.
        if (!sub) {
          setVerifiedAccess(true);
          setAccessBlocked(false);
          setAccessOverdue(false);
          return;
        }

        // O estado vem do módulo compartilhado: ativa, atrasada, pendente ou
        // cancelada — é a mesma regra que o painel e o backend aplicam.
        const accessState = subscriptionAccessState(sub);

        // Assinatura cancelada (carência vencida ou cancelada no banco): o
        // acesso está encerrado, mas a pessoa ainda está no grupo — dá para
        // reativar pagando de novo.
        if (accessState === ACCESS_CANCELLED) {
          setVerifiedAccess(false);
          setAccessBlocked(true);
          setAccessOverdue(false);
          return;
        }

        // Renovação vencida: a assinatura continua de pé, mas o período pago
        // acabou. As credenciais ficam bloqueadas até a regularização — e o
        // botão passa a exigir o pagamento.
        if (accessState === ACCESS_OVERDUE) {
          setVerifiedAccess(true);
          setAccessBlocked(true);
          setAccessOverdue(true);
          return;
        }

        // Em dia (ou pagamento ainda em aberto) → libera
        setVerifiedAccess(true);
        setAccessBlocked(false);
        setAccessOverdue(false);
      } catch (e) {
        console.error('[ServiceCredentials] verify error:', e);
        // Em caso de erro, BLOQUEAR acesso (fail-closed)
        setVerifiedAccess(false);
      } finally {
        if (!cancelled) setVerifyingAccess(false);
      }
    };

    verify();
    return () => { cancelled = true; };
  }, [user?.id, groupId, activeService?.group?.id]);

  // Verificar se o usuário ainda é membro ativo do grupo
  const isStillMember = activeService?.group?.members?.some(m => m.user_id === user?.id && m.status === 'active');

  // Se há múltiplos grupos para esta plataforma, listar todos
  const allGroupsForService = activeServices.filter(item => item.service.id === serviceId || item.service.slug === serviceId);

  useEffect(() => {
    if (!user || !activeService?.group?.id) return;
    let cancelled = false;

    const fetchPayment = async () => {
      const { data } = await supabase
        .from('group_members')
        .select('payment_status, subscription_deadline')
        .eq('group_id', activeService.group.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!cancelled) setPaymentStatus(data?.payment_status || 'active');
    };

    fetchPayment();
    return () => { cancelled = true; };
  }, [user, activeService?.group?.id]);

  const togglePassword = (index) => {
    setShowPasswords(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (!service) {
    return (
      <div className="fade-in credentials-page">
        <div className="empty-state">
          <h2>Serviço não encontrado</h2>
          <Link to="/dashboard/catalog" className="btn btn-primary">
            Explorar Catálogo
          </Link>
        </div>
      </div>
    );
  }

  // Pagamento de renovação — reaproveitado pelo aviso de acesso bloqueado e
  // pela tela de acesso negado.
  const renewalModal = (accessSubscription || activeService) ? (
    <SubscriptionRenewalModal
      key={showRenewal ? 'renewal-modal' : 'renewal-modal-closed'}
      open={showRenewal}
      subscription={accessSubscription || activeService}
      group={activeService?.group}
      amount={Number(accessSubscription?.amount || activeService?.amount || 0)}
      onClose={() => setShowRenewal(false)}
      onPaid={() => {
        setShowRenewal(false);
        setShowBlockedModal(false);
        setAccessBlocked(false);
        setVerifiedAccess(true);
        refresh?.();
      }}
    />
  ) : null;

  if (verifyingAccess) {
    return (
      <div className="fade-in credentials-page">
        <div className="empty-state">
          <Loader2 size={32} className="spin" />
          <p>Verificando acesso...</p>
        </div>
      </div>
    );
  }

  if (verifiedAccess === false) {
    return (
      <div className="fade-in credentials-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ChevronLeft size={18} />
          Voltar
        </button>
        <div className="access-denied">
          <AlertTriangle size={48} />
          <h2>Acesso Negado</h2>
          <p>
            {accessBlocked && accessSubscription
              ? `Sua assinatura do ${service.name} foi cancelada. Pague de novo para reativar o acesso.`
              : `Seu acesso ao ${service.name} foi encerrado. Sua assinatura foi cancelada ou você saiu do grupo.`}
          </p>
          <div className="access-denied-actions">
            {accessBlocked && accessSubscription && (
              <button className="btn btn-primary" onClick={() => setShowRenewal(true)}>
                <CreditCard size={16} /> Renovar assinatura
              </button>
            )}
            <Link to={`/dashboard/catalog/${service.slug || service.id}`} className="btn btn-primary">
              Ver Grupos Disponíveis
            </Link>
          </div>
        </div>
        {renewalModal}
      </div>
    );
  }

  // Multi-grupo: se tem mais de 1 assinatura ativa para esta plataforma e nenhum grupo selecionado, mostrar seletor
  if (allGroupsForService.length > 1 && !groupId) {
    return (
      <div className="fade-in credentials-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ChevronLeft size={18} />
          Voltar
        </button>
        <div className="page-header">
          <h1>Credenciais {service.name}</h1>
          <p>Você possui {allGroupsForService.length} grupos ativos. Selecione um para ver as credenciais.</p>
        </div>
        <div className="credentials-list">
          {allGroupsForService.map(({ service: svc, group }) => (
            <button
              key={group.id}
              className="credential-list-card"
              onClick={() => navigate(`/dashboard/credentials/${svc.slug || svc.id}?group=${group.id}`)}
              style={{ '--service-color': svc.color }}
            >
              <div className="credential-list-icon" style={{ backgroundColor: svc.color }}>
                {svc.icon}
              </div>
              <div className="credential-list-info">
                <h3>{group.name}</h3>
                <p>{group.credentials?.[0]?.profile_assignment || 'Credencial compartilhada'}</p>
              </div>
              <span className="credential-list-action">
                Acessar
                <ChevronRight size={18} />
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!isSubscribed || !activeService) {
    // Se há grupos mas nenhum foi selecionado, mostrar seletor
    if (allGroupsForService.length > 0 && !groupId) {
      return (
        <div className="fade-in credentials-page">
          <button onClick={() => navigate(-1)} className="back-btn">
            <ChevronLeft size={18} />
            Voltar
          </button>
          <div className="page-header">
            <h1>Credenciais {service.name}</h1>
            <p>Selecione o grupo para ver as credenciais.</p>
          </div>
          <div className="credentials-list">
            {allGroupsForService.map(({ service: svc, group }) => (
              <button
                key={group.id}
                className="credential-list-card"
                onClick={() => navigate(`/dashboard/credentials/${svc.slug || svc.id}?group=${group.id}`)}
                style={{ '--service-color': svc.color }}
              >
                <div className="credential-list-icon" style={{ backgroundColor: svc.color }}>
                  {svc.icon}
                </div>
                <div className="credential-list-info">
                  <h3>{group.name}</h3>
                  <p>{group.credentials?.[0]?.profile_assignment || 'Credencial compartilhada'}</p>
                </div>
                <span className="credential-list-action">
                  Acessar
                  <ChevronRight size={18} />
                </span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="fade-in credentials-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ChevronLeft size={18} />
          Voltar
        </button>
        <div className="access-denied">
          <AlertTriangle size={48} />
          <h2>Acesso Negado</h2>
          <p>
            Você não possui uma assinatura ativa do {service.name}. Assine um grupo para
            visualizar as credenciais.
          </p>
          <Link to={`/dashboard/catalog/${service.slug || service.id}`} className="btn btn-primary">
            Ver Grupos Disponíveis
          </Link>
        </div>
      </div>
    );
  }

  const { group } = activeService;
  const mainCredential = Array.isArray(group.credentials) && group.credentials.length > 0
    ? group.credentials[0]
    : null;
  const hasProfiles = mainCredential?.has_profiles;
  const myProfile = hasProfiles && group.profiles
    ? group.profiles.find(p => p.assigned_to === user?.id)
    : null;
  // A assinatura que define o acesso: a linha lida direto do banco tem
  // precedência (traz o status e o vencimento do ciclo atual).
  const renewalSubscription = accessSubscription || activeService;
  const renewalState = subscriptionAccessState(renewalSubscription);
  const renewalLabel = subscriptionAccessLabel(renewalSubscription);
  const renewalDate = subscriptionRenewalDate(renewalSubscription);
  const renewalAmount = Number(accessSubscription?.amount || activeService.amount || 0);

  return (
    <div key={serviceId} className="fade-in credentials-page">
      <button onClick={() => navigate(-1)} className="back-btn">
        <ChevronLeft size={18} />
        Voltar
      </button>

      <div className="page-header">
        <h1>Credenciais {service.name}</h1>
        <p>Dados de acesso do seu grupo {group.name}.</p>
      </div>

      {paymentStatus && paymentStatus !== 'active' && (
        <div className="access-blocked-card">
          <AlertTriangle size={32} />
          <h3>Acesso Bloqueado</h3>
          {paymentStatus === 'awaiting_entrance' && (
            <p>Pague a taxa de entrada para liberar seu acesso.</p>
          )}
          {paymentStatus === 'entrance_paid' && (
            <p>Taxa de Adesão confirmada! Pague a assinatura mensal para liberar o acesso.</p>
          )}
          {paymentStatus === 'awaiting_subscription' && (
            <p>Assinatura em processamento. Aguarde a confirmação.</p>
          )}
          {paymentStatus === 'expired' && (
            <p>O prazo de 12h expirou. Entre novamente no grupo para tentar novamente.</p>
          )}
          <Link to={`/checkout/${group.slug || group.id}`} className="btn btn-primary" style={{ marginTop: '1rem' }}>
            <CreditCard size={16} />
            Ir para Pagamento
          </Link>
        </div>
      )}

      {(!paymentStatus || paymentStatus === 'active') && (
      <div className="credential-card" style={{ '--service-color': service.color }}>
        <div className="credential-header" style={{ backgroundColor: `${service.color}15` }}>
          <div className="credential-service">
            <div className="credential-icon" style={{ backgroundColor: service.color }}>
              {service.icon_url ? (
                <img src={service.icon_url} alt={service.name} className="credential-icon-img" />
              ) : (
                service.icon
              )}
            </div>
            <div>
              <h2 style={{ color: service.color }}>{service.full_name}</h2>
              <div className="credential-subtitle">
                {service.description && (
                  <span className="credential-description">{service.description}</span>
                )}
                {service.official_url && (
                  <a
                    href={service.official_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="credential-site-link"
                  >
                    <ExternalLink size={13} />
                    Site oficial
                  </a>
                )}
              </div>
              {hasProfiles && (
                <span className="profile-badge">
                  {myProfile ? `Seu perfil: ${myProfile.profile_name}` : 'Perfil não atribuído'}
                </span>
              )}
            </div>
          </div>
          <div className="credential-header-actions">
            <button
              className="btn btn-primary access-credentials-btn"
              onClick={() => {
                // Assinatura vencida ou cancelada: o clique não revela nada —
                // abre o aviso e força a regularização.
                if (accessBlocked) {
                  setShowBlockedModal(true);
                  return;
                }
                setShowCredentials(!showCredentials);
              }}
            >
              <Shield size={18} />
              {showCredentials ? 'Ocultar Credenciais' : 'Acessar Credenciais'}
            </button>
            <button
              className={`btn btn-outline chat-toggle-btn ${showChat ? 'active' : ''}`}
              onClick={() => setShowChat(!showChat)}
            >
              <MessageCircle size={18} />
              Chat do Grupo
            </button>
          </div>
        </div>

        <div className="credential-body">
          {!showChat && group.rules && (
            <div className="credential-rules-highlight">
              <div className="rules-highlight-header">
                <ScrollText size={20} />
                <strong>Regras do Grupo</strong>
              </div>
              <p>{group.rules}</p>
            </div>
          )}

          {showCredentials && (
            <div className="credential-inline-viewer">
              {!mainCredential ? (
                <div className="no-credentials">
                  <AlertTriangle size={24} />
                  <p>As credenciais deste grupo não estão disponíveis para você agora.</p>
                  <p className="no-credentials-hint">
                    Elas podem ainda não ter sido configuradas pelo administrador, ou estar
                    vinculadas a outro membro do grupo. Fale com o administrador para resolver.
                  </p>
                  <button
                    type="button"
                    className="btn btn-outline no-credentials-btn"
                    onClick={() => setShowContactModal(true)}
                  >
                    <MessageCircle size={16} />
                    Falar com o administrador do grupo
                  </button>
                </div>
              ) : (
                <>
                  <div className="cred-section">
                    <h3>
                      <User size={16} />
                      {mainCredential.credential_type === 'link' ? 'Link de Acesso' :
                       mainCredential.credential_type === 'code' ? 'Código de Acesso' :
                       mainCredential.credential_type === 'custom' ? 'Instruções de Acesso' :
                       'Login Compartilhado'}
                    </h3>
                    {renderCredentialFields(mainCredential, 'main', showPasswords, togglePassword, copiedField, handleCopy)}
                  </div>

                  {hasProfiles && (
                    <div className="cred-section" style={{ marginTop: '1.25rem' }}>
                      <h3>
                        <User size={16} />
                        Seu Perfil Individual
                      </h3>
                      {myProfile ? (
                        <div className="cred-profile-card">
                          <div className="cred-profile-header">
                            <div className="cred-profile-dot" style={{ backgroundColor: service.color }} />
                            <h4>{myProfile.profile_name}</h4>
                          </div>
                          <div className="cred-field">
                            <label>Senha do Perfil</label>
                            <div className="cred-field-box">
                              <code>{showPasswords['profile'] ? myProfile.profile_password : '•'.repeat(8)}</code>
                              <div className="cred-actions">
                                <button className="cred-action-btn" onClick={() => togglePassword('profile')} title={showPasswords['profile'] ? 'Ocultar' : 'Mostrar'}>
                                  {showPasswords['profile'] ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                                <button className="cred-action-btn" onClick={() => handleCopy(myProfile.profile_password, 'profile')} title="Copiar">
                                  {copiedField === 'profile' ? <Check size={16} /> : <Copy size={16} />}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="no-credentials">
                          <AlertTriangle size={20} />
                          <p>Nenhum perfil foi atribuído a você ainda.</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              <div className="credentials-inline-footer">
                {(mainCredential?.credential_type || 'email_password') === 'link'
                  ? <p>Não compartilhe este link com pessoas de fora do grupo.</p>
                  : <p>Não compartilhe suas credenciais com ninguém.</p>
                }
              </div>
              {group.email_code_enabled && (
                <EmailCodeSearch
                  groupId={activeService?.group?.id}
                  serviceId={service?.id || null}
                  serviceName={service?.name || ''}
                  footer={(
                    <p className="email-delay-warning">
                      Os e-mails podem sofrer delay caso os servidores estejam com instabilidade.
                      {' '}
                      <button
                        type="button"
                        className="contact-admin-link"
                        onClick={() => setShowContactModal(true)}
                      >
                        Contatar administrador do grupo
                      </button>
                    </p>
                  )}
                />
              )}
            </div>
          )}

          {!showChat && (
            <>
              <div className="credential-meta-grid">
                <div className="credential-meta-item">
                  <Calendar size={18} />
                  <div>
                    <span>Ativada em</span>
                    <strong>{formatDateBR(activeService.started_at || activeService.created_at)}</strong>
                  </div>
                </div>
                <div className="credential-meta-item">
                  <RotateCcw size={18} />
                  <div>
                    <span>Renovação</span>
                    <strong>
                      {renewalDate
                        ? formatDateBR(renewalDate)
                        : ({
                          monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual',
                          custom: activeService.custom_cycle_months ? `${activeService.custom_cycle_months} meses` : 'Personalizado',
                          days: activeService.custom_cycle_days ? `${activeService.custom_cycle_days} dias` : 'Diário'
                        }[activeService.billing_cycle] || 'Mensal')}
                    </strong>
                    {/* Estado derivado da assinatura (mesma regra do painel). */}
                    <span className={`access-status-tag is-${renewalState}`}>{renewalLabel}</span>
                  </div>
                </div>
              </div>

              {/* Aviso de renovação: vence em breve ou já está atrasada. */}
              {needsRenewalReminder(renewalSubscription) && (
                <RenewalReminderCard
                  subscription={renewalSubscription}
                  group={group}
                  onRenew={() => setShowRenewal(true)}
                />
              )}

              <div className="credential-actions-row">
                <Link
                  to={`/dashboard/subscription/${activeService.id}`}
                  className="btn btn-sm btn-outline manage-sub-btn"
                >
                  <Settings size={15} />
                  Gerenciar assinatura
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {showChat && (
        <GroupChat groupId={group.id} />
      )}

      {/* Aviso de acesso bloqueado: a renovação em atraso impede o uso das
          credenciais até a regularização. */}
      {showBlockedModal && (
        <div className="ren-modal-overlay" onClick={() => setShowBlockedModal(false)}>
          <div className="ren-modal" onClick={(e) => e.stopPropagation()}>
            <button className="ren-modal-close" onClick={() => setShowBlockedModal(false)} aria-label="Fechar">
              <X size={20} />
            </button>
            <div className="ren-modal-header" style={{ color: '#F59E0B' }}>
              <AlertTriangle size={28} />
              <div>
                <h3>{accessOverdue ? 'Renovação em atraso' : 'Assinatura cancelada'}</h3>
                <p>{service.name} — {group.name}</p>
              </div>
            </div>
            <div className="ren-modal-body">
              <p className="ren-success-text">
                {accessOverdue ? (
                  <>
                    Você não tem acesso às credenciais porque a renovação venceu em{' '}
                    <strong>
                      {renewalDate ? formatDateBR(renewalDate) : '—'}
                    </strong>.
                    Regularize agora para voltar a usar o serviço normalmente.
                  </>
                ) : (
                  <>
                    Você não tem acesso às credenciais porque a sua assinatura do{' '}
                    <strong>{service.name}</strong> foi cancelada. Pague de novo para reativar
                    o acesso.
                  </>
                )}
              </p>

              <div className="ren-summary">
                <span>Total a pagar</span>
                <strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(renewalAmount)}</strong>
              </div>

              <button
                type="button"
                className="btn btn-primary ren-confirm-btn"
                onClick={() => { setShowBlockedModal(false); setShowRenewal(true); }}
              >
                <CreditCard size={16} /> Pagar assinatura
              </button>
              <button
                type="button"
                className="btn btn-outline ren-confirm-btn"
                onClick={() => setShowBlockedModal(false)}
              >
                Agora não
              </button>
            </div>
          </div>
        </div>
      )}

      {renewalModal}

      {showContactModal && (
        <ContactAdminModal
          groupId={group.id}
          groupName={group.name}
          isOfficial={group.is_official}
          onClose={() => setShowContactModal(false)}
        />
      )}
    </div>
  );
}

function renderCredentialFields(cred, key, showPasswords, togglePassword, copiedField, handleCopy) {
  const isVisible = showPasswords[key];
  const credType = cred.credential_type || 'email_password';

  if (credType === 'link' && cred.credential_url) {
    return (
      <>
        <div className="cred-field">
          <label>Link de Acesso</label>
          <div className="cred-field-box">
            <code style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{cred.credential_url}</code>
            <div className="cred-actions">
              <a href={cred.credential_url} target="_blank" rel="noopener noreferrer" className="cred-action-btn" title="Abrir link">
                <ExternalLink size={16} />
              </a>
              <button className="cred-action-btn" onClick={() => handleCopy(cred.credential_url, `url-${key}`)} title="Copiar link">
                {copiedField === `url-${key}` ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        </div>
        {cred.credential_notes && (
          <div className="cred-field">
            <label>Observações</label>
            <div className="cred-field-box">
              {cred.credential_notes.match(/^https?:\/\//) ? (
                <>
                  <a href={cred.credential_notes} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                    {cred.credential_notes}
                  </a>
                  <div className="cred-actions">
                    <a href={cred.credential_notes} target="_blank" rel="noopener noreferrer" className="cred-action-btn" title="Abrir link">
                      <ExternalLink size={16} />
                    </a>
                    <button className="cred-action-btn" onClick={() => handleCopy(cred.credential_notes, `notes-${key}`)} title="Copiar">
                      {copiedField === `notes-${key}` ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                </>
              ) : (
                <code>{cred.credential_notes}</code>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  if (credType === 'code') {
    return (
      <>
        <div className="cred-field">
          <label>Código de Acesso</label>
          <div className="cred-field-box">
            <code>{isVisible ? (cred.login_password || cred.credential_notes || '—') : '•'.repeat(Math.max(8, (cred.login_password || cred.credential_notes || '').length || 8))}</code>
            <div className="cred-actions">
              <button className="cred-action-btn" onClick={() => togglePassword(key)} title={isVisible ? 'Ocultar' : 'Mostrar'}>
                {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button className="cred-action-btn" onClick={() => handleCopy(cred.login_password || cred.credential_notes || '', `code-${key}`)} title="Copiar">
                {copiedField === `code-${key}` ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        </div>
        {cred.credential_notes && (
          <div className="cred-field">
            <label>Observações</label>
            <div className="cred-field-box">
              <code>{cred.credential_notes}</code>
            </div>
          </div>
        )}
      </>
    );
  }

  if (credType === 'custom') {
    const notesIsUrl = cred.credential_notes && cred.credential_notes.match(/^https?:\/\//);
    return (
      <div className="cred-field">
        <label>Instruções de Acesso</label>
        <div className="cred-field-box" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
          {notesIsUrl ? (
            <>
              <a href={cred.credential_notes} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                {cred.credential_notes}
              </a>
              <div className="cred-actions">
                <a href={cred.credential_notes} target="_blank" rel="noopener noreferrer" className="cred-action-btn" title="Abrir link">
                  <ExternalLink size={16} />
                </a>
                <button className="cred-action-btn" onClick={() => handleCopy(cred.credential_notes, `custom-${key}`)} title="Copiar">
                  {copiedField === `custom-${key}` ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </>
          ) : (
            <>
              <code>{cred.credential_notes || '—'}</code>
              {cred.credential_notes && (
                <button className="cred-action-btn" onClick={() => handleCopy(cred.credential_notes, `custom-${key}`)} title="Copiar">
                  {copiedField === `custom-${key}` ? <Check size={16} /> : <Copy size={16} />}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="cred-field">
        <label>E-mail de Login</label>
        <div className="cred-field-box">
          <code>{cred.login_email || '—'}</code>
          {cred.login_email && (
            <button className="cred-action-btn" onClick={() => handleCopy(cred.login_email, `email-${key}`)} title="Copiar">
              {copiedField === `email-${key}` ? <Check size={16} /> : <Copy size={16} />}
            </button>
          )}
        </div>
      </div>
      <div className="cred-field">
        <label>Senha</label>
        <div className="cred-field-box">
          <code>{isVisible ? cred.login_password : '•'.repeat(Math.max(8, cred.login_password?.length || 8))}</code>
          {cred.login_password && (
            <div className="cred-actions">
              <button className="cred-action-btn" onClick={() => togglePassword(key)} title={isVisible ? 'Ocultar' : 'Mostrar'}>
                {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button className="cred-action-btn" onClick={() => handleCopy(cred.login_password, `pass-${key}`)} title="Copiar">
                {copiedField === `pass-${key}` ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default ServiceCredentials;
