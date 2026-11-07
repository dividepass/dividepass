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
  RefreshCw,
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
import GroupRules from '../../components/GroupRules';
import ContactAdminModal from '../../components/ContactAdminModal';
import SubscriptionRenewalModal from '../../components/SubscriptionRenewalModal';
import RenewalReminderCard from '../../components/RenewalReminderCard';
import EmailCodeSearch from '../../components/EmailCodeSearch';
import ManagedEmailCard from '../../components/ManagedEmailCard';
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
  // O dono pode desligar o chat do grupo. A coluna `chat_enabled` ainda pode
  // nao existir no banco (migration) — nesse caso o chat continua liberado.
  const [chatEnabled, setChatEnabled] = useState(true);
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
  // A CONSULTA de acesso falhou (rede/banco). Isso NÃO é "acesso negado":
  // a tela mostra "não foi possível verificar" com botão de tentar de novo.
  // Negar por causa de um erro passageiro trancava fora quem tinha pago.
  const [accessCheckError, setAccessCheckError] = useState(false);
  // Contador que refaz a verificação (usado pelo botão "Tentar de novo").
  const [accessRetry, setAccessRetry] = useState(0);

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
            .select('status, payment_status, subscription_deadline')
            .eq('group_id', targetGroupId)
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle()
        ]);

        if (cancelled) return;

        const sub = subRes.data;
        const member = memberRes.data;
        const memberStatus = member?.status;

        // ── FALHA DE CONSULTA: NÃO É "ACESSO NEGADO" ────────────────────
        // Erro de rede/banco (inclusive coluna nova que ainda não existe)
        // não diz nada sobre o pagamento. Negar aqui trancava fora quem
        // tinha pago, e a tela acusava a pessoa ("saiu do grupo") — o que
        // é mentira. Agora é "não foi possível verificar" + tentar de novo.
        if (subRes.error || memberRes.error) {
          console.error(
            '[ServiceCredentials] Erro ao verificar assinatura/membro:',
            subRes.error || memberRes.error
          );
          setAccessCheckError(true);
          setVerifiedAccess(null);
          setAccessSubscription(null);
          setAccessBlocked(false);
          setAccessOverdue(false);
          return;
        }
        setAccessCheckError(false);

        // ── A ASSINATURA É A FONTE DA VERDADE DO ACESSO ────────────────────
        //
        // O vínculo em `group_members` é um espelho do grupo; a assinatura é
        // o que a pessoa PAGOU. Quando os dois discordam, quem manda é o
        // pagamento.
        //
        // BUG CORRIGIDO (01/11/2026): antes, um vínculo com status legado
        // ('cancelled'/'left'/'inactive') negava o acesso na hora, sem olhar
        // a assinatura — mesmo com a assinatura ativa e o período pago até
        // janeiro/2027. O resultado era a tela "Acesso Negado" para gente que
        // tinha pago (a Carol e a Maysa, por exemplo). Agora a assinatura vem
        // primeiro: quem pagou tem acesso, mesmo que o espelho do grupo ainda
        // esteja defasado.
        if (sub) {
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
            setAccessSubscription(sub);
            return;
          }

          // Renovação vencida: a assinatura continua de pé, mas o período pago
          // acabou. As credenciais ficam bloqueadas até a regularização — e o
          // botão passa a exigir o pagamento.
          if (accessState === ACCESS_OVERDUE) {
            setVerifiedAccess(true);
            setAccessBlocked(true);
            setAccessOverdue(true);
            setAccessSubscription(sub);
            return;
          }

          // Em dia (ou pagamento ainda em aberto) → libera.
          setVerifiedAccess(true);
          setAccessBlocked(false);
          setAccessOverdue(false);
          setAccessSubscription(sub);
          return;
        }

        // ── SEM ASSINATURA: O PAGAMENTO NO VÍNCULO MANDA ───────────────
        //
        // Há grupos em que o vínculo existe e está PAGO (o espelho tem
        // `payment_status = 'active'` e prazo vigente) mas a linha de
        // `user_subscriptions` não existe ou não está visível. O painel e
        // o cron já tratam isso como membro ativo — a tela de credenciais
        // precisa usar a MESMA regra, senão quem pagou fica trancado fora
        // com um "Acesso Negado" que não faz sentido.
        //
        // (Regra do banco: pagamento ativo + prazo ainda vigente = membro
        // ATIVO. O `status` legado do espelho — 'inactive'/'cancelled' — é
        // lixo de um fluxo antigo e NÃO pode custar o acesso de quem pagou.)
        const pagamentoAtivo = member?.payment_status === 'active';
        const espelhoAtivo = memberStatus === 'active';
        const prazo = member?.subscription_deadline
          ? new Date(member.subscription_deadline).getTime()
          : null;
        const prazoVigente = prazo !== null && prazo > Date.now();
        const prazoVencido = prazo !== null && prazo <= Date.now();

        // Pagou e o período vale → entra.
        // Pagou e a data "paga até" NÃO foi gravada no vínculo (falta de dado,
        // não falta de pagamento) → entra, desde que o espelho esteja ativo.
        // Período vencido sem assinatura → o acesso está encerrado.
        if (pagamentoAtivo && (prazoVigente || (prazo === null && espelhoAtivo))) {
          setVerifiedAccess(true);
          setAccessBlocked(false);
          setAccessOverdue(false);
          setAccessSubscription(null);
          return;
        }

        if (pagamentoAtivo && prazoVencido) {
          // Pagou, mas o período acabou: mostra o aviso de renovação.
          setVerifiedAccess(false);
          setAccessBlocked(true);
          setAccessOverdue(true);
          setAccessSubscription(null);
          return;
        }

        // Saiu do grupo (ou nunca teve assinatura aqui): sem caminho para
        // reativar por esta tela. O aviso é objetivo — e a tela oferece o
        // grupo que ela TEM (quando existe), em vez de só accusar.
        setVerifiedAccess(false);
        setAccessBlocked(false);
        setAccessOverdue(false);
        setAccessSubscription(null);
      } catch (e) {
        console.error('[ServiceCredentials] verify error:', e);
        // Erro inesperado também NÃO é "acesso negado".
        setAccessCheckError(true);
        setVerifiedAccess(null);
      } finally {
        if (!cancelled) setVerifyingAccess(false);
      }
    };

    verify();
    return () => { cancelled = true; };
  }, [user?.id, groupId, activeService?.group?.id, accessRetry]);

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

  /* O grupo pode ter o chat desligado pelo dono. A coluna `chat_enabled`
     entra por migration — se ela ainda nao existir no banco a query falha e
     o chat continua liberado (comportamento antigo). */
  useEffect(() => {
    const targetGroupId = activeService?.group?.id;
    if (!targetGroupId) return undefined;
    let cancelled = false;

    const fetchChatFlag = async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('id, chat_enabled')
        .eq('id', targetGroupId)
        .maybeSingle();
      if (cancelled || error || !data) return;
      setChatEnabled(data.chat_enabled !== false);
    };

    fetchChatFlag();
    return () => { cancelled = true; };
  }, [activeService?.group?.id]);

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

  if (accessCheckError) {
    // Erro passageiro de rede/banco. A pessoa NÃO perdeu o acesso — e a tela
    // não pode dizer que perdeu (foi exatamente esse aviso que assustou a
    // cliente em 02/11/2026).
    return (
      <div className="fade-in credentials-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ChevronLeft size={18} />
          Voltar
        </button>
        <div className="access-denied">
          <RefreshCw size={48} />
          <h2>Não foi possível verificar</h2>
          <p>
            Não conseguimos conferir seu acesso ao {service.name} agora. Isso não significa que
            sua assinatura foi cancelada — tente de novo em instantes.
          </p>
          <div className="access-denied-actions">
            <button className="btn btn-primary" onClick={() => setAccessRetry(r => r + 1)}>
              <RefreshCw size={16} /> Tentar de novo
            </button>
            <Link to={`/dashboard/catalog/${service.slug || service.id}`} className="btn btn-primary">
              Ver Grupos Disponíveis
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (verifiedAccess === false) {
    // Os grupos que ELA tem para este serviço. Quando o link aponta para um
    // grupo que não é dela, a saída é o grupo certo — não uma acusação.
    const meusGrupos = activeServices.filter(
      item => item.service.id === serviceId || item.service.slug === serviceId
    );
    const grupoCerto = meusGrupos.find(item => item.group.id === groupId) || meusGrupos[0];

    const mensagem = accessBlocked && accessSubscription
      ? `Sua assinatura do ${service.name} foi cancelada. Pague de novo para reativar o acesso.`
      : accessBlocked
        ? `O período pago do ${service.name} acabou. Renove para voltar a usar as credenciais.`
        : `Você não tem assinatura ativa do ${service.name} neste grupo.`;

    return (
      <div className="fade-in credentials-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ChevronLeft size={18} />
          Voltar
        </button>
        <div className="access-denied">
          <AlertTriangle size={48} />
          <h2>Acesso Negado</h2>
          <p>{mensagem}</p>
          <div className="access-denied-actions">
            {accessBlocked && accessSubscription && (
              <button className="btn btn-primary" onClick={() => setShowRenewal(true)}>
                <CreditCard size={16} /> Renovar assinatura
              </button>
            )}
            {grupoCerto && (
              <Link
                to={`/dashboard/credentials/${grupoCerto.service.slug || grupoCerto.service.id}?group=${grupoCerto.group.id}`}
                className="btn btn-primary"
              >
                Abrir meu grupo {grupoCerto.group.name ? `· ${grupoCerto.group.name}` : ''}
              </Link>
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

  // ── Qual credencial é a MINHA? ────────────────────────────────────────
  // Um grupo pode ter VÁRIAS credenciais (o UNIQUE de group_id foi dropado):
  // a conta compartilhada dos grupos comuns e, nos grupos "Via Parceiro"
  // (revenda Pulse Coding), uma conta PRIVADA por cliente.
  //
  // Pegar `credentials[0]` mostrava a conta de OUTRO cliente. A ordem
  // correta é: primeiro a credencial atribuída a mim; se não houver nenhuma
  // atribuída, cai na primeira sem atribuição (a credencial compartilhada).
  const credenciais = Array.isArray(group.credentials) ? group.credentials : [];
  const minhaCredencial = credenciais.find(c => c.assigned_to && c.assigned_to === user?.id) || null;
  const mainCredential = minhaCredencial || credenciais.find(c => !c.assigned_to) || credenciais[0] || null;
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
            {chatEnabled && (
              <button
                className={`btn btn-outline chat-toggle-btn ${showChat ? 'active' : ''}`}
                onClick={() => setShowChat(!showChat)}
              >
                <MessageCircle size={18} />
                Chat do Grupo
              </button>
            )}
          </div>
        </div>

        <div className="credential-body">
          {!showChat && group.rules && (
            <div className="credential-rules-highlight">
              <div className="rules-highlight-header">
                <ScrollText size={20} />
                <strong>Regras do Grupo</strong>
              </div>
              <GroupRules rules={group.rules} />
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
              {/* E-mail gerenciado pela DividePass: o endereco do grupo e o
                  passo a passo para trocar o e-mail da conta da plataforma.
                  Nao aparece quando o grupo nao tem caixa gerenciada. */}
              <ManagedEmailCard
                groupId={activeService?.group?.id}
                serviceName={service?.name || ''}
              />
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

      {showChat && chatEnabled && (
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
