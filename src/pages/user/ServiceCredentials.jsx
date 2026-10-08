import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Eye,
  EyeOff,
  Copy,
  Check,
  ChevronLeft,
  Shield,
  AlertTriangle,
  Calendar,
  RotateCcw,
  ScrollText,
  Mail,
  Loader2,
  Clock,
  ExternalLink,
  Settings,
  User,
  MessageCircle,
  CreditCard
} from 'lucide-react';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { logPlatformEvent } from '../../lib/platformEventLogger';
import GroupChat from '../../components/GroupChat';
import ContactAdminModal from '../../components/ContactAdminModal';
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

  const [verificationCode, setVerificationCode] = useState(null);
  const [fetchingCode, setFetchingCode] = useState(false);
  const [codeMessage, setCodeMessage] = useState('');
  const [sensitiveWarning, setSensitiveWarning] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [manualAction, setManualAction] = useState(null); // { url, message, type }

  const [verifiedAccess, setVerifiedAccess] = useState(null);
  const [verifyingAccess, setVerifyingAccess] = useState(true);

  const activeServices = getActiveServices();
  const service = streamingServices.find(s => s.id === serviceId || s.slug === serviceId);
  const isSubscribed = isSubscribedToService(serviceId);

  // Se group_id foi passado, usar ele; senão, pegar o primeiro da plataforma
  const activeService = groupId
    ? activeServices.find(item => (item.service.id === serviceId || item.service.slug === serviceId) && item.group.id === groupId)
    : activeServices.find(item => item.service.id === serviceId || item.service.slug === serviceId);

  // Bloquear acesso APENAS quando assinatura foi cancelada ou membro saiu do grupo
  useEffect(() => {
    if (!user || !activeService?.id || !activeService?.group?.id) {
      setVerifyingAccess(false);
      return;
    }

    let cancelled = false;
    const verify = async () => {
      try {
        const [subRes, memberRes] = await Promise.all([
          supabase.from('user_subscriptions')
            .select('status')
            .eq('id', activeService.id)
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase.from('group_members')
            .select('status')
            .eq('group_id', activeService.group.id)
            .eq('user_id', user.id)
            .maybeSingle()
        ]);

        if (cancelled) return;

        const subStatus = subRes.data?.status;
        const memberStatus = memberRes.data?.status;

        // Se os dados retornaram null (RLS bloqueia ou registro não existe), bloquear acesso
        if (!subRes.data && !memberRes.data) {
          setVerifiedAccess(false);
          return;
        }

        // Bloqueia se cancelado, saiu, ou se o subscription não existe mais
        if (subStatus === 'cancelled' || memberStatus === 'cancelled' || memberStatus === 'left' || (!subStatus && subRes.data === null)) {
          setVerifiedAccess(false);
          return;
        }

        // Em qualquer outro caso (active, first_attempt, pending, erro, etc.) → libera
        setVerifiedAccess(true);
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
  }, [user?.id, activeService?.id, activeService?.group?.id]);

  // Verificar se o usuário ainda é membro ativo do grupo
  const isStillMember = activeService?.group?.members?.some(m => m.user_id === user?.id && m.status === 'active');

  // Se há múltiplos grupos para esta plataforma, listar todos
  const allGroupsForService = activeServices.filter(item => item.service.id === serviceId || item.service.slug === serviceId);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown > 0]);

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



  const handleFetchCode = async () => {
    if (!activeService?.group?.id) return;
    if (cooldown > 0) return;

    if (user?.id) {
      void logPlatformEvent({
        event_type: 'email_code_requested',
        title: 'Código solicitado',
        message: `${user.user_metadata?.name || user.email || 'Usuário'} clicou para buscar o código de ${service?.name || 'acesso'}.`,
        metadata: {
          user_id: user.id,
          group_id: activeService.group.id,
          service_id: service?.id || null,
        },
        created_by: user.id,
      });
    }

    setFetchingCode(true);
    setCodeMessage('');
    setVerificationCode(null);
    setSensitiveWarning(null);
    setManualAction(null);
    setCooldown(40);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://lasoouwboxspstqvjbsv.supabase.co';
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_wEPiY05_TmJVND5a6D812g_9Mw-_LXR';

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      let res;
      try {
        res = await fetch(
          `${supabaseUrl}/functions/v1/fetch-email-code`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'apikey': supabaseKey,
            },
            body: JSON.stringify({ group_id: activeService.group.id }),
            signal: controller.signal,
          }
        );
      } finally {
        clearTimeout(timeoutId);
      }

      // A função pode ser encerrada por timeout e devolver corpo vazio.
      const rawBody = await res.text();
      let json = null;
      if (rawBody.trim()) {
        try {
          json = JSON.parse(rawBody);
        } catch {
          json = null;
        }
      }

      if (!json) {
        setCodeMessage(
          res.status === 504 || res.status === 403 || res.status === 408
            ? 'O servidor demorou demais para responder. Aguarde alguns segundos e busque novamente.'
            : `O servidor não retornou uma resposta válida (HTTP ${res.status}). Tente novamente.`
        );
        return;
      }

      if (!res.ok) {
        setCodeMessage(json.error || `Erro ${res.status}: falha ao buscar código`);
        return;
      }

      if (json.sensitive) {
        setSensitiveWarning({
          message: json.sensitiveMessage,
          type: json.sensitiveType,
          sender: json.sender || '',
          subject: json.subject || '',
          received_at: json.received_at || new Date().toISOString(),
        });
        setVerificationCode(null);
        setCodeMessage('');
      } else if (json.requires_manual_action) {
        // Netflix ou outro serviço que exige clique no link (ex.: "Sim, fui eu")
        setManualAction({
          url: json.manual_action_url,
          message: json.message || 'Este serviço enviou uma confirmação em vez de um código. Clique no botão abaixo para ativar o acesso.',
          note: json.manual_action_note || '',
          label: json.manual_action_label || 'Abrir e confirmar',
          details: json.manual_action_details || null,
          type: json.manual_action_type || 'generic',
          sender: json.sender || '',
          subject: json.subject || '',
          received_at: json.received_at || new Date().toISOString(),
        });
        setVerificationCode(null);
        setCodeMessage('');
        setSensitiveWarning(null);
      } else if (json.code) {
        setVerificationCode({
          code: json.code,
          sender: json.sender || '',
          subject: json.subject || '',
          source_url: json.source_url || '',
          received_at: json.received_at || new Date().toISOString(),
        });
        setCodeMessage('');
        setSensitiveWarning(null);
        setManualAction(null);
      } else {
        setCodeMessage(json.message || 'Nenhum código encontrado');
        setSensitiveWarning(null);
        setManualAction(null);
      }
    } catch (err) {
      const isAbort = err?.name === 'AbortError';
      setCodeMessage(
        isAbort
          ? 'A busca demorou demais e foi cancelada. Aguarde alguns segundos e tente novamente.'
          : `Erro ao conectar: ${err?.message || 'falha de comunicação'}`
      );
    } finally {
      setFetchingCode(false);
    }
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
            Seu acesso ao {service.name} foi encerrado. Sua assinatura foi cancelada ou você saiu do grupo.
          </p>
          <Link to={`/dashboard/catalog/${service.slug || service.id}`} className="btn btn-primary">
            Ver Grupos Disponíveis
          </Link>
        </div>
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
              onClick={() => setShowCredentials(!showCredentials)}
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
                  <p>Nenhuma credencial foi configurada para este grupo ainda.</p>
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
                <div className="verification-code-section">
                  <div className="verification-code-header">
                    <Mail size={20} />
                    <div>
                      <h3>Código de Verificação</h3>
                      <p>Busque o código mais recente enviado para a conta compartilhada.</p>
                    </div>
                  </div>

                  <button
                    className="btn btn-primary fetch-code-btn"
                    onClick={handleFetchCode}
                    disabled={fetchingCode || cooldown > 0}
                  >
                    {fetchingCode ? (
                      <>
                        <Loader2 size={16} className="spin" />
                        Buscando...
                      </>
                    ) : cooldown > 0 ? (
                      <>
                        <Mail size={16} />
                        Buscar Código ({cooldown}s)
                      </>
                    ) : (
                      <>
                        <Mail size={16} />
                        Buscar Código
                      </>
                    )}
                  </button>

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

                  {verificationCode && (
                    <div className="verification-code-result">
                      <div className="code-display">
                        <code className="code-value">{verificationCode.code}</code>
                        <button
                          className="cred-action-btn"
                          onClick={() => handleCopy(verificationCode.code, 'verification-code')}
                          title="Copiar código"
                        >
                          {copiedField === 'verification-code' ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                      </div>
                      <div className="code-meta">
                        {verificationCode.sender && (
                          <span>Enviado por: <strong>{verificationCode.sender}</strong></span>
                        )}
                        {verificationCode.subject && (
                          <span>Assunto: {verificationCode.subject}</span>
                        )}
                        {verificationCode.source_url && (
                          <span>
                            Código obtido via{' '}
                            <a href={verificationCode.source_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
                              link de verificação
                            </a>{' '}
                            <ExternalLink size={12} style={{ verticalAlign: 'middle' }} />
                          </span>
                        )}
                        <span className="code-timestamp">
                          <Clock size={14} />
                          Recebido: {new Date(verificationCode.received_at).toLocaleString('pt-BR')}
                        </span>
                      </div>
                    </div>
                  )}

                  {sensitiveWarning && (
                    <div className="verification-code-result sensitive-warning">
                      <div className="sensitive-icon">
                        <Shield size={24} />
                      </div>
                      <div className="sensitive-content">
                        <span className="sensitive-label">PIN de Segurança Detectado</span>
                        <span className="sensitive-message">{sensitiveWarning.message}</span>
                        {sensitiveWarning.sender && (
                          <span className="sensitive-meta">Enviado por: <strong>{sensitiveWarning.sender}</strong></span>
                        )}
                        <span className="code-timestamp">
                          <Clock size={14} />
                          Recebido: {new Date(sensitiveWarning.received_at).toLocaleString('pt-BR')}
                        </span>
                      </div>
                    </div>
                  )}

                  {codeMessage && (
                    <div className="verification-code-empty">
                      <AlertTriangle size={18} />
                      <span>{codeMessage}</span>
                    </div>
                  )}

                  {manualAction && (
                    <div className="manual-action-card">
                      <div className="manual-action-content">
                        <span className="manual-action-title">
                          {manualAction.type === 'confirm_household' || manualAction.type === 'netflix_verify_link'
                            ? 'Confirmação necessária'
                            : 'Ação necessária'}
                        </span>
                        <span className="manual-action-desc">
                          {manualAction.message}
                        </span>
                        {manualAction.details?.requester && (
                          <div className="manual-action-details">
                            <span className="manual-action-detail">
                              <span className="manual-action-detail-label">Solicitado por</span>
                              <strong>{manualAction.details.requester}</strong>
                            </span>
                            {manualAction.details.device && (
                              <span className="manual-action-detail">
                                <span className="manual-action-detail-label">Aparelho</span>
                                <strong>{manualAction.details.device}</strong>
                              </span>
                            )}
                            {manualAction.details.when && (
                              <span className="manual-action-detail">
                                <span className="manual-action-detail-label">Quando</span>
                                <strong>{manualAction.details.when}</strong>
                              </span>
                            )}
                          </div>
                        )}
                        <a
                          href={manualAction.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-primary manual-action-btn"
                        >
                          <ExternalLink size={16} />
                          {manualAction.label}
                        </a>
                        <p className="manual-action-hint">
                          {manualAction.note || 'Abra o link em uma nova aba e conclua a ação para liberar o acesso.'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
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
                    <strong>{new Date(activeService.started_at || activeService.created_at).toLocaleDateString('pt-BR')}</strong>
                  </div>
                </div>
                <div className="credential-meta-item">
                  <RotateCcw size={18} />
                  <div>
                    <span>Renovação</span>
                    <strong>{activeService.expires_at ? new Date(activeService.expires_at).toLocaleDateString('pt-BR') : ({
                      monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual',
                      custom: activeService.custom_cycle_months ? `${activeService.custom_cycle_months} meses` : 'Personalizado',
                      days: activeService.custom_cycle_days ? `${activeService.custom_cycle_days} dias` : 'Diário'
                    }[activeService.billing_cycle] || 'Mensal')}</strong>
                  </div>
                </div>
              </div>

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
