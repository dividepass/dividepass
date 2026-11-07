import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Save, Plus, Trash2, CheckCircle, X, Info, UserPlus, UserMinus, Camera, RefreshCw, AlertTriangle, Tv, Crown, Eye, KeyRound, QrCode, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import NotificationComposerCard from '../../components/NotificationComposerCard';
import { simulatePrice, brl } from '../../lib/platformFee';
import { hasAdsColumnAvailable, isMissingHasAdsColumn } from '../../lib/groupHasAds';
import { visibilityColumnAvailable, isMissingVisibilityColumn } from '../../lib/groupVisibility';
import {
  subscriptionStatusColumnAvailable, isMissingSubscriptionStatusColumn,
  groupStatusForSubscription, SUBSCRIPTION_ACTIVE, SUBSCRIPTION_PENDING,
} from '../../lib/groupSubscription';
import { chatColumnAvailable, isMissingChatColumn } from '../../lib/groupChat';
import {
  buildGroupName, fetchPlansForService, maxSlotsFor,
  pricePerSlot, suggestedGroupTotal, slotPriceOutOfRange, planSlotRangeText,
} from '../../lib/platformPlans';
import { unmaskPixKey } from '../../lib/pixKeyMask';
import { DEFAULT_RULE_TEXT, rulesSummary } from '../../lib/groupRuleTypes';
import AdsToggle from '../../components/AdsToggle';

import WizardSteps from '../../components/group-creation/WizardSteps';
import PlatformSearchStep from '../../components/group-creation/PlatformSearchStep';
import PlanSelectionStep from '../../components/group-creation/PlanSelectionStep';
import SlotsStep from '../../components/group-creation/SlotsStep';
import SubscriptionStatusStep from '../../components/group-creation/SubscriptionStatusStep';
import VisibilityStep from '../../components/group-creation/VisibilityStep';
import BillingStep from '../../components/group-creation/BillingStep';
import RuleTypesField from '../../components/group-creation/RuleTypesField';
import CredentialsStep from '../../components/group-creation/CredentialsStep';
import PaymentStep from '../../components/group-creation/PaymentStep';
import SummaryStep from '../../components/group-creation/SummaryStep';

import './GroupForm.css';

/**
 * TRILHA DE 6 ETAPAS — a mesma do wizard do usuário
 * (/dashboard/my-groups/create). Mudar uma etapa aqui é mudar lá também.
 */
const WIZARD_STEPS = [
  { key: 'plataforma', title: 'Plataforma', icon: Tv },
  { key: 'plano', title: 'Plano', icon: Crown },
  { key: 'grupo', title: 'Grupo', icon: Eye },
  { key: 'credenciais', title: 'Credenciais', icon: KeyRound },
  { key: 'pagamentos', title: 'Pagamentos', icon: QrCode },
  { key: 'resumo', title: 'Resumo', icon: ShieldCheck },
];

const WIZARD_COPY = {
  plataforma: {
    title: 'Qual plataforma o grupo vai compartilhar?',
    desc: 'É o serviço cujas credenciais os membros vão usar.',
  },
  plano: {
    title: 'Qual é o tipo de conta que o dono tem a assinatura?',
    desc: 'Escolha o plano da plataforma — é ele que define o limite de vagas e o valor do grupo.',
  },
  grupo: {
    title: 'Como o grupo vai ser?',
    desc: 'Escolha quem pode entrar e escreva as regras do grupo (opcional).',
  },
  credenciais: {
    title: 'Como os membros acessam a conta?',
    desc: 'Os membros acessam a conta por aqui — você pode mudar depois.',
  },
  pagamentos: {
    title: 'Como os membros vão pagar?',
    desc: 'Ciclos de cobrança, chave PIX e o valor que cada membro paga.',
  },
  resumo: {
    title: 'Confirme e crie o grupo',
    desc: 'Confira os dados e aceite as políticas para publicar o grupo.',
  },
};

function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="toast-success">
      <CheckCircle size={18} />
      <span>{message}</span>
      <button onClick={onClose}><X size={14} /></button>
    </div>
  );
}

/**
 * Limpa o termo da busca de usuário antes de montar o filtro do PostgREST.
 *
 * O valor vai entre aspas duplas (`"termo"`), mas aspas e barras invertidas
 * fecham o valor, e `,` / `)` fecham a condição do `or(...)`. Trocar esses
 * caracteres por espaço mantém a busca funcionando sem permitir que o termo
 * altere o filtro.
 */
function sanitizeOwnerTerm(term) {
  return String(term || '').replace(/["\\,()]/g, ' ').trim();
}

/**
 * Campos do grupo que dependem de migration: se o banco ainda nao conhece a
 * coluna, a gravacao e refeita sem ela (o front degrada com elegancia).
 *
 * @returns {{payload: object, missing: string[]}|null}
 */
function stripMissingGroupColumns(payload, error) {
  const next = { ...payload };
  const missing = [];

  const optional = [
    { field: 'has_ads', test: isMissingHasAdsColumn },
    { field: 'visibility', test: isMissingVisibilityColumn },
    { field: 'subscription_status', test: isMissingSubscriptionStatusColumn },
    { field: 'chat_enabled', test: isMissingChatColumn },
  ];

  optional.forEach(({ field, test }) => {
    if (field in next && test(error)) {
      delete next[field];
      missing.push(field);
    }
  });

  return missing.length ? { payload: next, missing } : null;
}

function GroupForm() {
  const { user } = useAuth();
  const { groupId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isEditing = !!groupId;

  const [services, setServices] = useState([]);
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [usage, setUsage] = useState({});
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardError, setWizardError] = useState('');
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
  const [hasVisibilityColumn, setHasVisibilityColumn] = useState(false);
  const [hasSubscriptionColumn, setHasSubscriptionColumn] = useState(false);
  const [hasChatColumn, setHasChatColumn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  const [formData, setFormData] = useState({
    service_id: '',
    name: '',
    price_per_slot: '',
    price_total: '',
    available_cycles: ['monthly'],
    cycle_discount: 0,
    max_size: 4,
    has_slot_limit: true,
    has_entrance_fee: false,
    entrance_fee: '',
    rules: DEFAULT_RULE_TEXT,
    tags: '',
    verified: false,
    status: 'open',
    visibility: 'public',
    // Status da assinatura da conta do serviço: 'active' (ja assinou) ou
    // 'pending' (vai assinar quando o grupo fechar).
    subscription_status: SUBSCRIPTION_ACTIVE,
    // Chat do grupo (troca de mensagens entre os membros).
    chat_enabled: true,
    custom_cycle_months: '',
    custom_cycle_label: '',
    custom_cycle_days: '',
  });

  const [ownerId, setOwnerId] = useState('');
  const [ownerQuery, setOwnerQuery] = useState('');
  const [ownerResults, setOwnerResults] = useState([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [currentOwnerName, setCurrentOwnerName] = useState('');
  const [ownerSearched, setOwnerSearched] = useState(false);
  /* O campo de dono aparece na CRIAÇÃO também: às vezes o grupo é criado pelo
     admin mas o dono real é outra pessoa. Em edição começa fechado (mostra o
     dono atual) e abre no clique em "Trocar" — sem zerar o owner_id. */
  const [ownerPicking, setOwnerPicking] = useState(!isEditing);
  const [originalOwnerId, setOriginalOwnerId] = useState('');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [credentialType, setCredentialType] = useState('email_password');
  const [credentialUrl, setCredentialUrl] = useState('');
  const [credentialNotes, setCredentialNotes] = useState('');
  const [hasProfiles, setHasProfiles] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [members, setMembers] = useState([]);
  /* Atribuicao da credencial: `assigned_to = NULL` = compartilhada com todo
     membro ativo. Com valor, a policy de leitura so libera a linha para
     aquele usuario — os outros veem "credenciais nao disponiveis". */
  const [credentialId, setCredentialId] = useState('');
  const [credentialAssignedTo, setCredentialAssignedTo] = useState('');
  const [sharingCredential, setSharingCredential] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  const PLAN_TYPES = [
    'Conta Individual', 'Conta Padrão', 'Conta Premium', 'Conta VIP',
    'Conta Go', 'Conta Light', 'Conta Enterprise', 'Conta Team',
    'Conta PRO', 'Conta PRO+', 'Conta PLUS', 'Conta MAX',
    'Conta Educação', 'Conta Duo', 'Conta Família',
  ];
  const [planType, setPlanType] = useState('');
  const [planTypeCustom, setPlanTypeCustom] = useState('');
  const [customPlanActive, setCustomPlanActive] = useState(false);
  /* A conta compartilhada tem anúncios? null = ainda não informado.
     Só entra no payload quando a coluna has_ads existir no banco
     (migration database/add-group-has-ads.sql). */
  const [hasAds, setHasAds] = useState(null);
  const [hasAdsColumn, setHasAdsColumn] = useState(true);

  /* Plano da plataforma (service_plans) vinculado ao grupo. Define o teto de
     preco e a quantidade maxima de membros do grupo. */
  const [planId, setPlanId] = useState('');
  /* Chave PIX do grupo — mesma coluna (`groups.pix_key`) usada pelo wizard
     do usuario. */
  const [pixKey, setPixKey] = useState('');
  const [pixType, setPixType] = useState('cpf');
  const [hasPixColumn, setHasPixColumn] = useState(true);

  const [emailCodeEnabled, setEmailCodeEnabled] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [emailImapServer, setEmailImapServer] = useState('');
  const [emailImapPort, setEmailImapPort] = useState(993);
  const [emailImapUser, setEmailImapUser] = useState('');
  const [emailImapPassword, setEmailImapPassword] = useState('');
  const [emailAllowedSenders, setEmailAllowedSenders] = useState('');
  const [emailBlockedSubjects, setEmailBlockedSubjects] = useState('');
  const [emailCodePatterns, setEmailCodePatterns] = useState('');
  const [emailBodyKeywords, setEmailBodyKeywords] = useState('');
  const [emailSubjectIncludes, setEmailSubjectIncludes] = useState('');
  const [emailAiEnabled, setEmailAiEnabled] = useState(false);

  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [groupAlertTitle, setGroupAlertTitle] = useState('Aviso do grupo');
  const [groupAlertMessage, setGroupAlertMessage] = useState('');
  const [groupAlertChannels, setGroupAlertChannels] = useState(['in_app', 'push']);
  const [sendingGroupAlert, setSendingGroupAlert] = useState(false);

  const priceSimulation = useMemo(() => {
    return simulatePrice(formData.price_per_slot);
  }, [formData.price_per_slot]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleCycleToggle = (cycle) => {
    setFormData(prev => {
      const current = prev.available_cycles || [];
      const updated = current.includes(cycle)
        ? current.filter(c => c !== cycle)
        : [...current, cycle];
      return { ...prev, available_cycles: updated.length > 0 ? updated : current };
    });
  };

  const handleProfileChange = (index, field, value) => {
    setProfiles(prev => prev.map((p, i) =>
      i === index ? { ...p, [field]: value } : p
    ));
  };

  const addProfile = () => {
    setProfiles(prev => [...prev, { profile_name: '', profile_password: '' }]);
  };

  const removeProfile = (index) => {
    setProfiles(prev => prev.filter((_, i) => i !== index));
  };

  /*
   * Busca do dono do grupo.
   *
   * O wildcard do PostgREST é `*` (NÃO `%`), e o valor precisa ir entre aspas
   * duplas: `or=(name.ilike."*termo*",email.ilike."*termo*")`.
   * Com `%` a query inteira quebra com HTTP 500 (foi o que acontecia antes),
   * e sem aspas um termo com `)` ou `,` altera o filtro — daí a limpeza.
   *
   * A limpeza do estado fica no onChange (evento do usuário); aqui só a
   * consulta com debounce.
   */
  useEffect(() => {
    const term = ownerQuery.trim();
    const safe = sanitizeOwnerTerm(term);
    if (term.length < 2 || !safe) return;

    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id, name, email')
          .or(`name.ilike."*${safe}*",email.ilike."*${safe}*"`)
          .limit(8);
        if (error) {
          console.error('[GroupForm] owner search error:', error);
          setOwnerResults([]);
        } else {
          setOwnerResults(data || []);
        }
      } catch (err) {
        console.error('[GroupForm] owner search error:', err);
        setOwnerResults([]);
      } finally {
        setOwnerLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [ownerQuery]);

  const handleAddMember = async () => {
    if (!newMemberEmail.trim() || !groupId) return;
    setAddingMember(true);
    try {
      const { data: targetUser, error: findError } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('email', newMemberEmail.trim())
        .single();

      if (findError || !targetUser) {
        alert('Usuário não encontrado com este e-mail.');
        return;
      }

      const existingMember = members.find(m => m.user_id === targetUser.id);
      if (existingMember) {
        alert('Este usuário já é membro do grupo.');
        return;
      }

      const { error: insertError } = await supabase
        .from('group_members')
        .insert({
          group_id: groupId,
          user_id: targetUser.id,
          status: 'active',
        });

      if (insertError) throw insertError;

      setMembers(prev => [...prev, {
        user_id: targetUser.id,
        created_at: new Date().toISOString(),
        user: { id: targetUser.id, name: targetUser.name, email: targetUser.email },
      }]);
      setNewMemberEmail('');
      setToast('Membro adicionado com sucesso!');
    } catch (err) {
      alert('Erro ao adicionar membro: ' + err.message);
    } finally {
      setAddingMember(false);
    }
  };

  const handleSyncMembers = async () => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ group_id: groupId }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const { data: updatedMembers } = await supabase
        .from('group_members')
        .select('user_id, status, payment_status, created_at, user:user_id (id, name, email)')
        .eq('group_id', groupId)
        .order('created_at');
      setMembers(updatedMembers || []);
      setToast(`Sincronizado! ${data.synced || 0} membro(s) adicionado(s), ${data.already_ok || 0} já estavam OK.`);
    } catch (e) {
      alert('Erro ao sincronizar: ' + e.message);
    }
    setSyncing(false);
  };

  const handleRemoveMember = async (userId) => {
    if (!window.confirm('Tem certeza que deseja remover este membro do grupo?')) return;
    try {
      const { error } = await supabase
        .from('group_members')
        .update({ status: 'cancelled', left_at: new Date().toISOString() })
        .eq('group_id', groupId)
        .eq('user_id', userId);

      if (error) throw error;

      setMembers(prev => prev.filter(m => m.user_id !== userId));
      setToast('Membro removido com sucesso!');
    } catch (err) {
      alert('Erro ao remover membro: ' + err.message);
    }
  };

  const getMemberOrder = (userId) => {
    const idx = members.findIndex(m => m.user_id === userId);
    return idx >= 0 ? idx + 1 : null;
  };

  /* Quem esta com a credencial atribuida. A policy de leitura do banco so
     libera a linha para o proprio dono do `assigned_to`; os demais membros
     veem "credenciais nao disponiveis" mesmo com a credencial configurada. */
  const assignedMember = credentialAssignedTo
    ? members.find(m => m.user_id === credentialAssignedTo)
    : null;
  const assignedMemberName = assignedMember
    ? (assignedMember.user?.name || assignedMember.user?.email || 'membro do grupo')
    : 'um membro que não está mais na lista';

  /* Zera o `assigned_to` e devolve a credencial para o estado compartilhado:
     todo membro ativo do grupo volta a enxergar. */
  const handleShareCredential = async () => {
    if (!groupId || !credentialId) return;
    setSharingCredential(true);
    try {
      const { error } = await supabase
        .from('group_credentials')
        .update({ assigned_to: null, updated_at: new Date().toISOString() })
        .eq('id', credentialId);

      if (error) throw error;

      setCredentialAssignedTo('');
      setToast('Credencial compartilhada com todos os membros do grupo.');
    } catch (err) {
      setError('Erro ao compartilhar a credencial: ' + err.message);
    } finally {
      setSharingCredential(false);
    }
  };

  const groupAlertMembers = members.filter(m => m.status === 'active' || m.status === 'pending');

  const handleSendGroupAlert = async () => {
    if (!groupId || !isEditing) return;
    const title = groupAlertTitle.trim();
    const message = groupAlertMessage.trim();

    if (!title || !message) {
      setError('Preencha o título e a mensagem do alerta.');
      return;
    }

    if (groupAlertMembers.length === 0) {
      setError('Este grupo não possui membros para receber o alerta.');
      return;
    }

    if (!groupAlertChannels.length) {
      setError('Selecione pelo menos um canal de envio.');
      return;
    }

    setSendingGroupAlert(true);
    setError('');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Você precisa estar logado.');

      /* Cada canal marcado dispara o seu próprio fluxo no back. */
      const channels = [...groupAlertChannels];

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          audience: { type: 'group', group_id: groupId },
          title,
          message,
          channels,
          event_type: 'group_alert',
          url: `/dashboard/groups/${groupId}`,
          metadata: { group_id: groupId, source: 'admin_group_form', channels },
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || 'Erro ao enviar alerta');
      }

      setGroupAlertMessage('');
      setToast(`Alerta enviado para ${data.recipients || groupAlertMembers.length} membro(s).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingGroupAlert(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        if (!cancelled) setLoading(true);

        const [servicesRes, groupRes, credsRes, profilesRes, membersRes, mailboxRes, usageRes] = await Promise.all([
          supabase.from('streaming_services').select('id, name, full_name, icon, icon_url, color, slug, pinned, featured, status, max_group_size').order('name'),
          isEditing
            ? supabase.from('groups').select('*, owner:owner_id (id, name, email)').eq('id', groupId).single()
            : Promise.resolve({ data: null }),
          isEditing
            ? supabase.from('group_credentials').select('*').eq('group_id', groupId).maybeSingle()
            : Promise.resolve({ data: null }),
          isEditing
            ? supabase.from('group_profiles').select('*, assigned_user:assigned_to (id, name, email)').eq('group_id', groupId).order('created_at')
            : Promise.resolve({ data: null }),
          isEditing
            ? supabase.from('group_members').select('user_id, status, payment_status, created_at, user:user_id (id, name, email)').eq('group_id', groupId).order('created_at')
            : Promise.resolve({ data: null }),
          // A credencial IMAP foi movida para `group_mailboxes` (RLS por admin).
          isEditing
            ? supabase.from('group_mailboxes').select('*').eq('group_id', groupId).maybeSingle()
            : Promise.resolve({ data: null }),
          // contagem de grupos por plataforma (ordem "mais usadas" na etapa 1)
          supabase.from('groups').select('service_id').limit(2000),
        ]);

        if (servicesRes.error) throw servicesRes.error;
        if (!cancelled) setServices(servicesRes.data || []);

        // A coluna has_ads entra por migration (database/add-group-has-ads.sql).
        // Antes dela existir, o seletor fica oculto e o campo não é gravado —
        // assim o admin nunca toma erro 42703 ao salvar o grupo.
        if (!cancelled) setHasAdsColumn(await hasAdsColumnAvailable());

        // A coluna visibility (database/add-platform-plans-and-group-visibility.sql)
        // e a pix_key (database/add-group-pix.sql) sao opcionais: o front
        // detecta se existem antes de mandar no payload.
        if (!cancelled) {
          setHasVisibilityColumn(await visibilityColumnAvailable());
          const pixProbe = await supabase.from('groups').select('id, pix_key').limit(1);
          setHasPixColumn(!pixProbe.error);
          // As colunas subscription_status e chat_enabled entram pela mesma
          // migration da visibility — o front detecta antes de mandar no payload.
          setHasSubscriptionColumn(await subscriptionStatusColumnAvailable());
          setHasChatColumn(await chatColumnAvailable());
        }

        // Quantos grupos cada plataforma tem — as mais usadas ficam no topo
        // da lista da etapa 1.
        if (!cancelled && usageRes?.data) {
          const counts = {};
          usageRes.data.forEach((g) => {
            if (!g.service_id) return;
            counts[g.service_id] = (counts[g.service_id] || 0) + 1;
          });
          setUsage(counts);
        }

        if (isEditing && !cancelled) {
          setMembers(membersRes.data || []);
        }

        if (isEditing) {
          if (groupRes.error) throw groupRes.error;
          const group = groupRes.data;
          if (group) {
            setOwnerId(group.owner_id || '');
            setOriginalOwnerId(group.owner_id || '');
            setCurrentOwnerName(group.owner?.name || group.owner?.email || '');
            setFormData({
              service_id: group.service_id || '',
              name: group.name || '',
              price_per_slot: group.price_per_slot || '',
              available_cycles: group.available_cycles || [group.billing_cycle || 'monthly'],
              cycle_discount: group.cycle_discount || 0,
              max_size: group.max_size || 4,
              has_slot_limit: group.has_slot_limit !== false,
              has_entrance_fee: group.has_entrance_fee || false,
              entrance_fee: group.entrance_fee || '',
              rules: group.rules || '',
              tags: Array.isArray(group.tags) ? group.tags.join(', ') : '',
              verified: group.verified || false,
              status: group.status || 'open',
              visibility: group.visibility || 'public',
              subscription_status: group.subscription_status || SUBSCRIPTION_ACTIVE,
              chat_enabled: group.chat_enabled === false ? false : true,
              custom_cycle_months: group.custom_cycle_months || '',
              custom_cycle_label: group.custom_cycle_label || '',
              custom_cycle_days: group.custom_cycle_days || '',
            });
            if (group.photo_url) setPhotoPreview(group.photo_url);
            if (group.plan_id) setPlanId(group.plan_id);
            if (group.pix_key) setPixKey(group.pix_key);
            if (group.pix_type) setPixType(group.pix_type);
            if (group.plan_type) { setPlanType(group.plan_type); setCustomPlanActive(false); }
            if (group.plan_type_custom) { setPlanTypeCustom(group.plan_type_custom); setCustomPlanActive(true); }
            setHasAds(group.has_ads === true ? true : (group.has_ads === false ? false : null));
          }

          if (credsRes.data) {
            setLoginEmail(credsRes.data.login_email || '');
            setLoginPassword(credsRes.data.login_password || '');
            setCredentialType(credsRes.data.credential_type || 'email_password');
            setCredentialUrl(credsRes.data.credential_url || '');
            setCredentialNotes(credsRes.data.credential_notes || '');
            setHasProfiles(credsRes.data.has_profiles || false);
            setCredentialId(credsRes.data.id || '');
            setCredentialAssignedTo(credsRes.data.assigned_to || '');
          }

          if (group) {
            setEmailCodeEnabled(group.email_code_enabled || false);
          }

          // Configuracao de e-mail/IMAP vive em `group_mailboxes`.
          if (mailboxRes.data) {
            const mb = mailboxRes.data;
            setEmailAddress(mb.email_address || '');
            setEmailImapServer(mb.email_imap_server || '');
            setEmailImapPort(mb.email_imap_port || 993);
            setEmailImapUser(mb.email_imap_user || '');
            setEmailImapPassword(mb.email_imap_password || '');
            setEmailAllowedSenders(
              Array.isArray(mb.email_allowed_senders)
                ? mb.email_allowed_senders.join('\n')
                : ''
            );
            setEmailBlockedSubjects(
              Array.isArray(mb.email_blocked_subjects)
                ? mb.email_blocked_subjects.join('\n')
                : ''
            );
            setEmailCodePatterns(
              Array.isArray(mb.email_code_patterns)
                ? mb.email_code_patterns.join('\n')
                : ''
            );
            setEmailBodyKeywords(
              Array.isArray(mb.email_body_keywords)
                ? mb.email_body_keywords.join('\n')
                : ''
            );
            setEmailSubjectIncludes(
              Array.isArray(mb.email_subject_includes)
                ? mb.email_subject_includes.join('\n')
                : ''
            );
            setEmailAiEnabled(mb.email_ai_enabled || false);
          }

          if (profilesRes.data && profilesRes.data.length > 0) {
            setProfiles(profilesRes.data.map(p => ({
              id: p.id,
              profile_name: p.profile_name || '',
              profile_password: p.profile_password || '',
              assigned_to: p.assigned_to || null,
              assigned_user: p.assigned_user || null,
            })));
          }
        } else if (servicesRes.data?.length > 0) {
          // Na criacao a plataforma NAO e escolhida automaticamente: o admin
          // busca, clica e confirma no popup da etapa 1. Se a URL veio com
          // ?service=..., ela fica pré-selecionada (o admin só confirma).
          const preselectedService = searchParams.get('service');
          if (preselectedService && servicesRes.data.some(s => s.id === preselectedService)) {
            setFormData(prev => ({ ...prev, service_id: preselectedService }));
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [groupId, isEditing, searchParams]);

  useEffect(() => {
    // Planos da plataforma (service_plans): o grupo pode ser vinculado a um
    // plano da plataforma, que define o teto de preco e o limite de vagas.
    let cancelled = false;
    if (!formData.service_id) return undefined;
    fetchPlansForService(formData.service_id).then((list) => {
      if (cancelled) return;
      setPlans(list);
      setPlansLoading(false);
    });
    return () => { cancelled = true; };
  }, [formData.service_id]);

  useEffect(() => {
    // As taxas nao vem mais de app_settings: a margem da plataforma segue a
    // regra de faixas (src/lib/platformFee.js), definida pelo preco MENSAL.
    // O fetch das configurações do painel foi removido junto com o estado
    // `settings` (nada mais lia esse valor).
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    // Na criação, todas as etapas precisam estar válidas — inclusive o aceite
    // das políticas, que é o que autoriza a publicar o grupo.
    if (!isEditing) {
      const msg = validateWizardStep(WIZARD_STEPS.length - 1);
      if (msg) {
        setWizardError(msg);
        setError(msg);
        setSaving(false);
        return;
      }
    }

    try {
      const platform = services.find(s => s.id === formData.service_id) || null;
      const selectedPlan = plans.find(p => p.id === planId) || null;

      const groupPayload = {
        service_id: formData.service_id,
        // Nome automatico quando o admin nao digita: [plataforma] + [plano]
        // ou [plataforma] + [id do grupo].
        name: (formData.name || '').trim() || buildGroupName({ platform, plan: selectedPlan, groupId }),
        // Na criação, o preço por vaga é o total do grupo dividido pelas vagas.
        // Na edição, o admin edita o preço por vaga direto.
        price_per_slot: isEditing
          ? parseFloat(formData.price_per_slot)
          : (pricePerSlot(formData.price_total, formData.max_size)
            || parseFloat(formData.price_per_slot)
            || 0.01),
        billing_cycle: formData.available_cycles[0] || 'monthly',
        available_cycles: formData.available_cycles,
        cycle_discount: parseFloat(formData.cycle_discount || 0),
        max_size: formData.has_slot_limit ? parseInt(formData.max_size, 10) : null,
        has_slot_limit: formData.has_slot_limit,
        has_entrance_fee: formData.has_entrance_fee,
        entrance_fee: formData.has_entrance_fee ? parseFloat(formData.entrance_fee || 0) : 0,
        rules: formData.rules || null,
        tags: formData.tags
          ? formData.tags.split(',').map(t => t.trim()).filter(Boolean)
          : [],
        verified: !!formData.verified,
        // Grupo com assinatura pendente nasce em FORMACAO (status 'forming').
        status: groupStatusForSubscription(formData.subscription_status, formData.status),
        // Dono escolhido no formulário; sem escolha, o admin logado.
        // (NUNCA null: grupo sem dono não tem quem receba o repasse.)
        owner_id: ownerId || user?.id || null,
        email_code_enabled: emailCodeEnabled,
        email_code_method: emailCodeEnabled ? 'imap' : null,
        custom_cycle_months: formData.available_cycles.includes('custom') ? parseInt(formData.custom_cycle_months) || null : null,
        custom_cycle_label: formData.available_cycles.includes('custom') ? formData.custom_cycle_label || null : null,
        custom_cycle_days: formData.available_cycles.includes('days') ? parseInt(formData.custom_cycle_days) || null : null,
        plan_type: customPlanActive ? null : (planType || null),
        plan_type_custom: customPlanActive ? (planTypeCustom || null) : null,
        ...(hasAdsColumn ? { has_ads: hasAds } : {}),
        // Vínculo com o plano da plataforma (define teto de preço e vagas).
        ...(planId ? { plan_id: planId } : {}),
        // Grupo público ou privado (entra só por convite/link).
        ...(hasVisibilityColumn ? { visibility: formData.visibility || 'public' } : {}),
        // Status da assinatura da conta do serviço ('active' | 'pending').
        ...(hasSubscriptionColumn
          ? { subscription_status: formData.subscription_status || SUBSCRIPTION_ACTIVE }
          : {}),
        // Chat do grupo (troca de mensagens entre os membros).
        ...(hasChatColumn ? { chat_enabled: formData.chat_enabled !== false } : {}),
        // Chave PIX de pagamento.
        ...(hasPixColumn && pixKey ? { pix_key: unmaskPixKey(pixKey, pixType), pix_type: pixType } : {}),
        // Grupo criado pelo painel admin já nasce aprovado: a fila de aprovação
        // é para grupos que o USUÁRIO criou. Ao editar, o status de aprovação
        // não é tocado (aprovar é ação explícita na tela de grupos).
        ...(isEditing ? {} : { approval_status: 'approved', approved_at: new Date().toISOString() }),
      };

      let groupIdResult = groupId;

      if (isEditing) {
        let { error: updateError } = await supabase
          .from('groups')
          .update(groupPayload)
          .eq('id', groupId);
        if (updateError) {
          // o banco ainda nao tem alguma das colunas novas: refaz sem o campo
          const retry = stripMissingGroupColumns(groupPayload, updateError);
          if (retry) {
            retry.missing.forEach((field) => {
              if (field === 'has_ads') setHasAdsColumn(false);
              if (field === 'visibility') setHasVisibilityColumn(false);
              if (field === 'subscription_status') setHasSubscriptionColumn(false);
              if (field === 'chat_enabled') setHasChatColumn(false);
            });
            const again = await supabase.from('groups').update(retry.payload).eq('id', groupId);
            updateError = again.error;
          }
        }
        if (updateError) throw updateError;
      } else {
        let { data: newGroup, error: insertError } = await supabase
          .from('groups')
          .insert(groupPayload)
          .select('id')
          .single();
        if (insertError) {
          const retry = stripMissingGroupColumns(groupPayload, insertError);
          if (retry) {
            retry.missing.forEach((field) => {
              if (field === 'has_ads') setHasAdsColumn(false);
              if (field === 'visibility') setHasVisibilityColumn(false);
              if (field === 'subscription_status') setHasSubscriptionColumn(false);
              if (field === 'chat_enabled') setHasChatColumn(false);
            });
            const again = await supabase.from('groups').insert(retry.payload).select('id').single();
            newGroup = again.data;
            insertError = again.error;
          }
        }
        if (insertError) throw insertError;
        groupIdResult = newGroup.id;

        const shortSlug = newGroup.id.slice(0, 6).toUpperCase();
        // Sem plano vinculado o nome automatico usa o id curto do grupo.
        const finalName = (formData.name || '').trim()
          || buildGroupName({ platform, plan: selectedPlan, groupId: newGroup.id });
        const { error: slugError } = await supabase
          .from('groups')
          .update({ slug: shortSlug, name: finalName })
          .eq('id', newGroup.id);
        if (slugError) throw slugError;
      }

      // Configuracao de e-mail/IMAP em `group_mailboxes` (tabela separada com
      // RLS por admin — a credencial nao pode mais ser lida por anonimo).
      if (emailCodeEnabled) {
        const mailboxPayload = {
          group_id: groupIdResult,
          email_address: emailAddress || null,
          verification_email: null,
          email_imap_server: emailImapServer || null,
          email_imap_port: emailImapPort || 993,
          email_imap_user: emailImapUser || null,
          email_imap_password: emailImapPassword || null,
          email_allowed_senders: emailAllowedSenders.split('\n').map(s => s.trim()).filter(Boolean),
          email_blocked_subjects: emailBlockedSubjects.split('\n').map(s => s.trim()).filter(Boolean),
          email_code_patterns: emailCodePatterns.split('\n').map(s => s.trim()).filter(Boolean),
          email_body_keywords: emailBodyKeywords.split('\n').map(s => s.trim()).filter(Boolean),
          email_subject_includes: emailSubjectIncludes.split('\n').map(s => s.trim()).filter(Boolean),
          email_ai_enabled: emailAiEnabled,
        };

        const { error: mailboxError } = await supabase
          .from('group_mailboxes')
          .upsert(mailboxPayload, { onConflict: 'group_id' });
        if (mailboxError) throw mailboxError;
      }

      if (photoFile) {
        const ext = photoFile.name.split('.').pop();
        const photoPath = `${groupIdResult}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('group-covers')
          .upload(photoPath, photoFile, { upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('group-covers').getPublicUrl(photoPath);
        await supabase.from('groups').update({ photo_url: urlData.publicUrl }).eq('id', groupIdResult);
      } else if (!photoPreview && isEditing) {
        await supabase.from('groups').update({ photo_url: null }).eq('id', groupIdResult);
      }

      if (loginEmail || loginPassword || credentialType !== 'email_password' || credentialUrl) {
        const credPayload = {
          group_id: groupIdResult,
          login_email: loginEmail || null,
          login_password: loginPassword || null,
          credential_type: credentialType,
          credential_url: credentialUrl || null,
          credential_notes: credentialNotes || null,
          has_profiles: hasProfiles,
        };

        const { data: existingCred } = await supabase
          .from('group_credentials')
          .select('id')
          .eq('group_id', groupIdResult)
          .maybeSingle();

        if (existingCred) {
          const { error: credError } = await supabase
            .from('group_credentials')
            .update(credPayload)
            .eq('id', existingCred.id);
          if (credError) throw credError;
        } else {
          const { error: credError } = await supabase
            .from('group_credentials')
            .insert(credPayload);
          if (credError) throw credError;
        }
      }

      if (hasProfiles) {
        const validProfiles = profiles.filter(p => p.profile_name || p.profile_password);
        const existingIds = validProfiles.filter(p => p.id).map(p => p.id);

        if (isEditing && existingIds.length > 0) {
          for (const p of validProfiles.filter(p => p.id)) {
            const { error } = await supabase
              .from('group_profiles')
              .update({ profile_name: p.profile_name, profile_password: p.profile_password, assigned_to: p.assigned_to || null })
              .eq('id', p.id);
            if (error) throw error;
          }

          const { error: delError } = await supabase
            .from('group_profiles')
            .delete()
            .eq('group_id', groupIdResult)
            .not('id', 'in', `(${existingIds.length > 0 ? existingIds.join(',') : '00000000-0000-0000-0000-000000000000'})`);
          if (delError) throw delError;
        } else if (isEditing) {
          const { error: delError } = await supabase
            .from('group_profiles')
            .delete()
            .eq('group_id', groupIdResult);
          if (delError) throw delError;
        }

        const newProfiles = validProfiles.filter(p => !p.id);
        if (newProfiles.length > 0) {
          const { error: profError } = await supabase
            .from('group_profiles')
            .insert(newProfiles.map(p => ({
              group_id: groupIdResult,
              profile_name: p.profile_name,
              profile_password: p.profile_password,
              assigned_to: p.assigned_to || null,
            })));
          if (profError) throw profError;
        }
      } else if (isEditing) {
        await supabase.from('group_profiles').delete().eq('group_id', groupIdResult);
      }

      const ownerChanged = isEditing && !!ownerId && !!originalOwnerId && ownerId !== originalOwnerId;

      // Grupo novo nasce aprovado e visível: avisa quem estava esperando vaga
      // nesse serviço. Best-effort — falhar no aviso não bloqueia o cadastro.
      if (!isEditing) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-service-watchers`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ group_id: groupIdResult }),
          });
        } catch (notifyErr) {
          console.warn('[notify-service-watchers] Não foi possível avisar a lista de espera:', notifyErr);
        }
      }

      setToast(
        ownerChanged
          ? `Grupo atualizado! Dono alterado para ${currentOwnerName}.`
          : isEditing
            ? 'Grupo atualizado com sucesso!'
            : 'Grupo criado com sucesso!'
      );
      setTimeout(() => navigate('/admin/groups'), 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  /* Busca do dono do grupo (admin). Compartilhado entre o form antigo
     (edicao) e o wizard (criacao). */
  const handleOwnerSearchChange = (value) => {
    setOwnerQuery(value);
    const term = value.trim();
    if (term.length < 2 || !sanitizeOwnerTerm(term)) {
      setOwnerResults([]);
      setOwnerSearched(false);
      setOwnerLoading(false);
    } else {
      setOwnerLoading(true);
      setOwnerSearched(true);
    }
  };

  const selectOwner = (u) => {
    setOwnerId(u.id);
    setCurrentOwnerName(u.name || u.email);
    setOwnerQuery('');
    setOwnerResults([]);
    setOwnerSearched(false);
    setOwnerPicking(false);
  };

  /* ---------------------------------------------------------------- wizard */
  const wizardPlatform = useMemo(
    () => services.find(s => s.id === formData.service_id) || null,
    [services, formData.service_id],
  );
  const wizardPlan = useMemo(
    () => plans.find(p => p.id === planId) || null,
    [plans, planId],
  );

  const wizardStepInfo = WIZARD_STEPS[wizardStep] || WIZARD_STEPS[0];
  const WizardStepIcon = wizardStepInfo.icon;

  const wizardBillingValue = {
    available_cycles: (formData.available_cycles || []).filter(c => c !== 'custom' && c !== 'days'),
    custom_cycle_enabled: (formData.available_cycles || []).includes('custom'),
    custom_cycle_months: formData.custom_cycle_months || 2,
    custom_cycle_label: formData.custom_cycle_label || '',
    days_cycle_enabled: (formData.available_cycles || []).includes('days'),
    days_cycle_days: formData.custom_cycle_days || 15,
    days_cycle_label: formData.custom_cycle_label || '',
    rules: formData.rules || '',
  };

  const applyWizardBilling = (patch) => {
    const next = { ...wizardBillingValue, ...patch };
    const cycles = [...next.available_cycles];
    if (next.custom_cycle_enabled) cycles.push('custom');
    if (next.days_cycle_enabled) cycles.push('days');
    setFormData(prev => ({
      ...prev,
      available_cycles: cycles,
      custom_cycle_months: next.custom_cycle_months,
      custom_cycle_label: next.custom_cycle_label,
      custom_cycle_days: next.days_cycle_days,
      rules: next.rules,
    }));
  };

  /* O painel admin guarda o codigo em `login_password` e o link em
     `credential_url`; o componente compartilhado usa um campo unico
     (`credential_extra`). Esta ponte traduz um no outro. */
  const wizardCredentialValue = {
    credential_type: credentialType,
    login_email: loginEmail,
    login_password: credentialType === 'code' ? '' : loginPassword,
    credential_extra: credentialType === 'link' || credentialType === 'invite'
      ? credentialUrl
      : (credentialType === 'code' ? loginPassword : (credentialType === 'custom' ? credentialNotes : '')),
    credential_notes: credentialType === 'custom' ? '' : credentialNotes,
  };

  const applyWizardCredential = (patch) => {
    const next = { ...wizardCredentialValue, ...patch };
    setCredentialType(next.credential_type);
    setLoginEmail(next.login_email);
    setLoginPassword(next.credential_type === 'code' ? next.credential_extra : next.login_password);
    setCredentialUrl(
      (next.credential_type === 'link' || next.credential_type === 'invite') ? next.credential_extra : '',
    );
    setCredentialNotes(next.credential_type === 'custom' ? next.credential_extra : next.credential_notes);
  };

  const applyWizardPlan = (patch) => {
    if (patch.plan_id !== undefined) {
      setPlanId(patch.plan_id);
      const plan = plans.find(p => p.id === patch.plan_id);
      if (plan) {
        setPlanType(plan.name);
        setPlanTypeCustom('');
        setCustomPlanActive(false);
        const maxSlots = maxSlotsFor(plan, wizardPlatform);
        // Total do grupo: valor sugerido do plano (por pessoa) x vagas; sem
        // sugestao, o preco oficial do plano + 8%.
        // Plano sem max_members nao impoe vagas: o total usa as vagas do
        // grupo (ou o padrao), senao o preco por pessoa sai errado.
        const slots = plan.max_members
          ? maxSlots
          : (parseInt(formData.max_size, 10) || 4);
        setFormData(prev => ({
          ...prev,
          price_total: String(suggestedGroupTotal(plan, slots)),
          max_size: plan.max_members ? maxSlots : prev.max_size,
          has_slot_limit: true,
        }));
      }
    }
    if (patch.plan_type !== undefined) {
      setPlanType(patch.plan_type);
      setCustomPlanActive(false);
      /* Texto livre (plataforma SEM planos cadastrados) nao pode conviver com
         um plano escolhido. Mas o clique num plano tambem manda plan_type —
         nesse caso o plan_id manda e nao pode ser limpo, senao o plano
         selecionado some na hora e a etapa nunca libera. */
      if (patch.plan_type && patch.plan_id === undefined) setPlanId('');
    }
    if (patch.plan_type_custom !== undefined) setPlanTypeCustom(patch.plan_type_custom);
    if (patch.custom_plan_active !== undefined) {
      setCustomPlanActive(patch.custom_plan_active);
      if (patch.custom_plan_active) {
        setPlanType('');
        setPlanId('');
      }
    }
    if (patch.has_ads !== undefined) setHasAds(patch.has_ads);
  };

  const validateWizardStep = (stepIndex) => {
    switch (stepIndex) {
      /* 1. PLATAFORMA */
      case 0:
        if (!formData.service_id) return 'Escolha a plataforma do grupo.';
        return '';

      /* 2. PLANO — plano/tipo de conta + vagas + status da assinatura */
      case 1:
        if (plansLoading) return 'Carregando os planos da plataforma...';
        if (plans.length > 0) {
          if (!planId) return 'Escolha o plano da plataforma que o grupo vai usar.';
        } else {
          if (!customPlanActive && !planType) return 'Escolha o tipo de conta ou use "Personalizado".';
          if (customPlanActive && !planTypeCustom.trim()) return 'Escreva o tipo de conta personalizado.';
        }
        if (!formData.max_size || formData.max_size < 1) return 'Informe quantas vagas o grupo vai abrir.';
        if (wizardPlan?.max_members && formData.max_size > wizardPlan.max_members) {
          return `Este plano permite até ${wizardPlan.max_members} vaga(s).`;
        }
        // Status da assinatura: sempre tem um valor valido (o padrao e "ja
        // assinei"), entao nao bloqueia a criacao.
        if (!formData.subscription_status) return 'Escolha se o dono já assinou a conta ou vai assinar depois.';
        return '';

      /* 3. GRUPO — visibilidade (as regras do grupo sao opcionais) */
      case 2:
        if (!formData.visibility) return 'Escolha se o grupo é público ou privado.';
        return '';

      /* 4. CREDENCIAIS */
      case 3:
        if (credentialType === 'email_password' && !loginEmail.trim()) return 'Informe o e-mail de acesso.';
        if (credentialType !== 'email_password' && !wizardCredentialValue.credential_extra.trim()) {
          return 'Informe a credencial de acesso.';
        }
        return '';

      /* 5. PAGAMENTOS — ciclos + valor do grupo */
      case 4: {
        if (!wizardBillingValue.available_cycles.length
          && !wizardBillingValue.custom_cycle_enabled
          && !wizardBillingValue.days_cycle_enabled) {
          return 'Escolha ao menos um ciclo de cobrança.';
        }
        if (wizardBillingValue.custom_cycle_enabled && !wizardBillingValue.custom_cycle_label.trim()) {
          return 'Dê um nome ao ciclo personalizado.';
        }
        if (wizardBillingValue.days_cycle_enabled && !wizardBillingValue.days_cycle_label.trim()) {
          return 'Dê um nome ao ciclo de dias.';
        }
        const total = parseFloat(formData.price_total);
        if (!(total > 0)) return 'Informe o valor total do grupo.';
        const perSlot = pricePerSlot(total, formData.max_size);
        // SEM PISO DE VALOR: esta é a tela do ADMIN da plataforma. Ele
        // controla os grupos e pode criar/ajustar qualquer valor por vaga —
        // o piso de R$ 5,00 vale para o usuário comum, não para o admin.
        // (O banco nunca recusou preço baixo: só impõe price_per_slot > 0.)
        // TETO DO PLANO (por pessoa): fora da faixa o grupo não é criado.
        if (wizardPlan) {
          const range = slotPriceOutOfRange(wizardPlan, perSlot);
          if (range.outOfRange) {
            const faixa = planSlotRangeText(wizardPlan, (v) => `R$ ${brl(v)}`);
            return `O valor por pessoa (R$ ${brl(perSlot)}) está fora da faixa do plano "${wizardPlan.name}" (${faixa}). Ajuste o valor total.`;
          }
        }
        return '';
      }

      /* 6. RESUMO — politicas */
      case 5:
        if (!policiesAccepted) return 'Aceite as políticas para criar o grupo.';
        return '';

      default:
        return '';
    }
  };

  const handleWizardNext = () => {
    const msg = validateWizardStep(wizardStep);
    setWizardError(msg);
    if (msg) return;
    setWizardStep(Math.min(wizardStep + 1, WIZARD_STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleWizardBack = () => {
    setWizardError('');
    setWizardStep(Math.max(wizardStep - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const wizardSummaryItems = [
    { label: 'Plataforma', value: wizardPlatform?.full_name || wizardPlatform?.name || '—' },
    {
      label: 'Nome do grupo',
      value: (formData.name || '').trim() || buildGroupName({ platform: wizardPlatform, plan: wizardPlan, groupId }),
    },
    {
      label: 'Plano',
      value: wizardPlan?.name || (customPlanActive ? planTypeCustom : (planType || '—')),
    },
    { label: 'Vagas', value: `${formData.max_size || 1} membro(s)` },
    {
      label: 'Status da assinatura',
      value: formData.subscription_status === SUBSCRIPTION_PENDING
        ? 'Vou assinar (grupo fica em formação)'
        : 'Já assinei (conta ativa)',
    },
    { label: 'Chat do grupo', value: formData.chat_enabled === false ? 'Desligado' : 'Ligado' },
    { label: 'Visibilidade', value: formData.visibility === 'private' ? 'Privado (só convite/link)' : 'Público' },
    { label: 'Ciclos', value: (formData.available_cycles || []).join(', ') || '—' },
    { label: 'Regrinhas', value: rulesSummary(formData.rules) },
    { label: 'PIX', value: pixKey ? `${pixKey} (${pixType})` : '—' },
    { label: 'Taxa de entrada', value: formData.has_entrance_fee ? `R$ ${brl(parseFloat(formData.entrance_fee || 0))}` : 'Sem taxa' },
    { label: 'Total do grupo', value: `R$ ${brl(parseFloat(formData.price_total) || 0)}` },
    { label: 'Cada membro paga', value: `R$ ${brl(pricePerSlot(formData.price_total, formData.max_size))} / mês` },
    { label: 'Dono', value: currentOwnerName || ownerId?.slice(0, 8) || '—' },
  ];

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando...</p>
      </div>
    );
  }

  return (
    <div className="fade-in group-form-page">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <button onClick={() => navigate('/admin/groups')} className="back-btn">
        <ArrowLeft size={18} />
        Voltar para Grupos
      </button>

      <div className="admin-header">
        <h1>{isEditing ? 'Editar Grupo' : 'Novo Grupo'}</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handleSubmit} className="group-form-card">
        {!isEditing ? (
          <>
            <div className="admin-wizard-steps">
              <WizardSteps
                steps={WIZARD_STEPS}
                current={wizardStep}
                onNavigate={(i) => {
                  if (i <= wizardStep) { setWizardError(''); setWizardStep(i); }
                }}
              />
            </div>

            <div className="wizard-card">
              <div className="wizard-card-head">
                <span className="wizard-eyebrow">
                  <WizardStepIcon size={16} /> Etapa {wizardStep + 1} de {WIZARD_STEPS.length}
                </span>
                <h2>{WIZARD_COPY[wizardStepInfo.key].title}</h2>
                <p className="section-desc">{WIZARD_COPY[wizardStepInfo.key].desc}</p>
              </div>

              <div className="wizard-card-body">
                {/* ------------------------------------------------ 1. PLATAFORMA */}
                {wizardStep === 0 && (
                  <PlatformSearchStep
                    services={services.filter(s => s.status !== 'inactive')}
                    usage={usage}
                    selectedId={formData.service_id}
                    onConfirm={(service) => {
                      setFormData(prev => ({
                        ...prev,
                        service_id: service.id,
                        // trocar de plataforma zera o plano e o preco (o teto muda junto)
                        price_total: '',
                        max_size: 4,
                        has_slot_limit: false,
                      }));
                      setPlans([]);
                      setPlansLoading(true);
                      setPlanId('');
                      setPlanType('');
                      setPlanTypeCustom('');
                      setCustomPlanActive(false);
                      setWizardError('');
                      /* Confirmar a plataforma ja leva para os planos dela — o
                         mesmo movimento do wizard do usuario. */
                      setWizardStep(1);
                    }}
                  />
                )}

                {/* --------------------- 2. PLANO (tipo de conta) + VAGAS + ASSINATURA */}
                {wizardStep === 1 && (
                  <>
                    {plansLoading ? (
                      <div className="loading-state">
                        <Loader2 size={28} className="spin" />
                        <p>Carregando os planos da plataforma...</p>
                      </div>
                    ) : (
                      <PlanSelectionStep
                        plans={plans}
                        value={{
                          plan_id: planId,
                          plan_type: planType,
                          plan_type_custom: planTypeCustom,
                          custom_plan_active: customPlanActive,
                          has_ads: hasAds,
                        }}
                        onChange={applyWizardPlan}
                        hasAdsColumn={hasAdsColumn}
                      />
                    )}

                    {!plansLoading && (
                      <>
                        <SlotsStep
                          value={{ slots: formData.max_size || 1 }}
                          onChange={(patch) => setFormData(prev => {
                            const slots = patch.slots;
                            const next = { ...prev, max_size: slots, has_slot_limit: true };
                            /* O total que veio do plano acompanha o numero de vagas
                               (o dono nao editou o valor) — senao mudar as vagas
                               empurraria o preco por pessoa para fora da faixa do
                               plano. */
                            if (wizardPlan) {
                              const before = suggestedGroupTotal(wizardPlan, prev.max_size);
                              if (!prev.price_total || Number(prev.price_total) === before) {
                                next.price_total = String(suggestedGroupTotal(wizardPlan, slots));
                              }
                            }
                            return next;
                          })}
                          plan={wizardPlan}
                          service={wizardPlatform}
                        />

                        <SubscriptionStatusStep
                          value={formData.subscription_status}
                          onChange={(v) => setFormData(prev => ({
                            ...prev,
                            subscription_status: v,
                            // "Vou assinar" deixa o grupo em formacao; voltando para
                            // "ja assinei" o status volta a ser aberto.
                            status: v === SUBSCRIPTION_PENDING
                              ? 'forming'
                              : (prev.status === 'forming' ? 'open' : prev.status),
                          }))}
                        />
                      </>
                    )}
                  </>
                )}

                {/* ---------------------------------- 3. GRUPO: VISIBILIDADE + REGRAS */}
                {wizardStep === 2 && (
                  <>
                    <VisibilityStep
                      value={formData.visibility}
                      onChange={(v) => setFormData(prev => ({ ...prev, visibility: v }))}
                    />

                    {/* As REGRAS do grupo (opcional) ocupam o lugar que era da
                        descrição do grupo. */}
                    <RuleTypesField
                      value={formData.rules || ''}
                      onChange={(patch) => setFormData(prev => ({ ...prev, rules: patch.rules }))}
                    />
                  </>
                )}

                {/* ------------------------------------------------ 4. CREDENCIAIS */}
                {wizardStep === 3 && (
                  <CredentialsStep
                    value={{ ...wizardCredentialValue, chat_enabled: formData.chat_enabled }}
                    onChange={(patch) => {
                      if (patch.chat_enabled !== undefined) {
                        setFormData(prev => ({ ...prev, chat_enabled: patch.chat_enabled }));
                      }
                      applyWizardCredential(patch);
                    }}
                  />
                )}

                {/* ------------------------------------------------- 5. PAGAMENTOS */}
                {wizardStep === 4 && (
                  <>
                    <BillingStep
                      value={wizardBillingValue}
                      onChange={applyWizardBilling}
                    />

                    <PaymentStep
                      value={{
                        pix_key: pixKey,
                        pix_type: pixType,
                        entrance_fee: formData.has_entrance_fee ? formData.entrance_fee : 0,
                        price_total: formData.price_total,
                        slots: formData.max_size || 1,
                      }}
                      onChange={(patch) => {
                        if (patch.pix_key !== undefined) setPixKey(patch.pix_key);
                        if (patch.pix_type !== undefined) setPixType(patch.pix_type);
                        if (patch.entrance_fee !== undefined) {
                          setFormData(prev => ({ ...prev, entrance_fee: patch.entrance_fee }));
                        }
                        if (patch.price_total !== undefined) {
                          setFormData(prev => ({ ...prev, price_total: patch.price_total }));
                        }
                      }}
                      plan={wizardPlan}
                      hasPixColumn={hasPixColumn}
                    />
                  </>
                )}

                {/* ---------------------------------------------------- 6. RESUMO */}
                {wizardStep === 5 && (
                  <>
                    <SummaryStep
                      items={wizardSummaryItems}
                      policiesAccepted={policiesAccepted}
                      onPoliciesChange={setPoliciesAccepted}
                      notice="Grupos criados pelo painel admin já nascem aprovados e não passam pela fila de aprovação."
                    />

                    <section className="form-section admin-wizard-extras">
                      <h2>Opções administrativas</h2>
                      <p className="section-desc">
                        Configurações que só o admin define. O dono é quem recebe os repasses.
                      </p>

                      <div className="form-grid">
                        <div className="form-group">
                          <label>Status</label>
                          <select name="status" value={formData.status} onChange={handleChange}>
                            <option value="open">Aberto</option>
                            <option value="forming">Formando</option>
                            <option value="closed">Fechado</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Tags (separadas por vírgula)</label>
                          <input name="tags" value={formData.tags} onChange={handleChange} placeholder="Ex: 4k, sem anúncios" />
                        </div>
                        <div className="form-group checkbox-group">
                          <label>
                            <input type="checkbox" name="verified" checked={formData.verified} onChange={handleChange} />
                            Grupo verificado (DividePass)
                          </label>
                        </div>
                        <div className="form-group">
                          <label>Nome do grupo (opcional)</label>
                          <input
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="Gerado automaticamente"
                          />
                          <small className="field-hint">
                            Vazio = nome automático: [plataforma] + [plano] ou [plataforma] + [id].
                          </small>
                        </div>
                      </div>

                      <div className="toggle-section">
                        <label className="toggle-label">
                          <input
                            type="checkbox"
                            checked={formData.has_entrance_fee}
                            onChange={e => setFormData(prev => ({ ...prev, has_entrance_fee: e.target.checked }))}
                          />
                          <span className="toggle-switch" />
                          <span className="toggle-text">
                            <strong>Cobrar valor de entrada?</strong>
                            <small>Valor único pago na primeira vez + assinatura.</small>
                          </span>
                        </label>
                      </div>

                      {formData.has_entrance_fee && (
                        <div className="form-group">
                          <label>Valor de entrada (R$) *</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            name="entrance_fee"
                            value={formData.entrance_fee}
                            onChange={handleChange}
                          />
                        </div>
                      )}

                      <div className="form-group">
                        <label>Criado por (dono do grupo)</label>
                        {ownerId && !ownerPicking ? (
                          <div className="owner-current">
                            <div className="owner-current-info">
                              <strong>{currentOwnerName || `${ownerId.slice(0, 8)}...`}</strong>
                              <small>{ownerId === user?.id ? 'você' : 'dono atual do grupo'}</small>
                            </div>
                            <button type="button" className="btn btn-sm" onClick={() => setOwnerPicking(true)}>
                              Trocar
                            </button>
                          </div>
                        ) : (
                          <div className="owner-picker">
                            <div className="owner-search">
                              <input
                                type="text"
                                value={ownerQuery}
                                onChange={(e) => handleOwnerSearchChange(e.target.value)}
                                placeholder="Buscar por nome ou e-mail..."
                                disabled={ownerLoading}
                              />
                              {ownerLoading && <Loader2 size={15} className="spin owner-search-spinner" />}
                            </div>
                            {ownerSearched && ownerResults.length === 0 && !ownerLoading && (
                              <p className="owner-empty">Nenhum usuário encontrado</p>
                            )}
                            {ownerResults.length > 0 && (
                              <div className="owner-results">
                                {ownerResults.map((u) => (
                                  <button
                                    key={u.id}
                                    type="button"
                                    className="owner-result"
                                    onClick={() => selectOwner(u)}
                                  >
                                    <strong>{u.name || 'Sem nome'}</strong>
                                    <span>{u.email}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <small className="field-hint">
                          {ownerId
                            ? 'O dono recebe os pagamentos na carteira e gerencia o grupo.'
                            : 'Busque para colocar outra pessoa como dona. Sem escolha, o grupo fica com você.'}
                        </small>
                      </div>
                    </section>
                  </>
                )}
              </div>

              {wizardError && <div className="wizard-step-error">{wizardError}</div>}

              <div className="wizard-foot">
                <div className="wizard-foot-left">
                  {wizardStep > 0 && (
                    <button type="button" className="btn btn-outline" onClick={handleWizardBack}>
                      <ArrowLeft size={16} /> Voltar
                    </button>
                  )}
                </div>
                <div className="wizard-foot-right">
                  {wizardStep < WIZARD_STEPS.length - 1 && (
                    <button type="button" className="btn btn-primary" onClick={handleWizardNext}>
                      Continuar
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
        <section className="form-section">
          <h2>Dados do Grupo</h2>

          <div className="form-grid">
            <div className="form-group">
              <label>Plataforma *</label>
              <select name="service_id" value={formData.service_id} onChange={handleChange} required>
                <option value="">Selecione</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.full_name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Nome do grupo *</label>
              <input name="name" value={formData.name} onChange={handleChange} placeholder="Netflix - Grupo A" required />
            </div>

            <div className="form-group">
              <label>Foto do grupo</label>
              <div className="group-photo-upload">
                {photoPreview ? (
                  <div className="photo-preview">
                    <img src={photoPreview} alt="Preview" />
                    <button type="button" className="photo-remove" onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}>✕</button>
                  </div>
                ) : (
                  <label className="photo-placeholder">
                    <Camera size={24} />
                    <span>Adicionar foto</span>
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setPhotoFile(file);
                          setPhotoPreview(URL.createObjectURL(file));
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>Tipo de Conta / Plano</label>
              <div className="plan-type-grid">
                {PLAN_TYPES.map(pt => (
                  <button
                    key={pt}
                    type="button"
                    className={`plan-type-btn ${!customPlanActive && planType === pt ? 'active' : ''}`}
                    onClick={() => { setPlanType(pt); setCustomPlanActive(false); }}
                  >
                    {pt}
                  </button>
                ))}
                <button
                  type="button"
                  className={`plan-type-btn custom ${customPlanActive ? 'active' : ''}`}
                  onClick={() => { setCustomPlanActive(true); setPlanType(''); }}
                >
                  Personalizado
                </button>
              </div>
              {customPlanActive && (
                <input
                  type="text"
                  className="plan-type-custom-input"
                  value={planTypeCustom}
                  onChange={e => setPlanTypeCustom(e.target.value)}
                  placeholder="Digite o tipo de conta personalizado"
                  style={{ marginTop: '0.5rem' }}
                />
              )}
            </div>

            {plans.length > 0 && (
              <div className="form-group">
                <label>Plano da plataforma</label>
                <select
                  value={planId}
                  onChange={e => {
                    const value = e.target.value;
                    setPlanId(value);
                    const plan = plans.find(x => x.id === value);
                    if (plan) {
                      setPlanType(plan.name);
                      setPlanTypeCustom('');
                      setCustomPlanActive(false);
                    }
                  }}
                >
                  <option value="">Sem vínculo de plano</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — R$ {brl(p.official_price)}
                    </option>
                  ))}
                </select>
                <small className="field-hint">
                  O plano define o teto de preço e o limite de vagas do grupo.
                </small>
              </div>
            )}

            {hasVisibilityColumn && (
              <div className="form-group">
                <label>Visibilidade</label>
                <select name="visibility" value={formData.visibility} onChange={handleChange}>
                  <option value="public">Público — aparece no catálogo</option>
                  <option value="private">Privado — só por convite ou link</option>
                </select>
              </div>
            )}

            {hasSubscriptionColumn && (
              <div className="form-group">
                <label>Status da assinatura</label>
                <select
                  name="subscription_status"
                  value={formData.subscription_status || SUBSCRIPTION_ACTIVE}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    subscription_status: e.target.value,
                    // "Vou assinar" deixa o grupo em formacao; voltando para
                    // "ja assinei" o status volta a ser aberto.
                    status: e.target.value === SUBSCRIPTION_PENDING
                      ? 'forming'
                      : (prev.status === 'forming' ? 'open' : prev.status),
                  }))}
                >
                  <option value={SUBSCRIPTION_ACTIVE}>Já assinei — a conta está ativa</option>
                  <option value={SUBSCRIPTION_PENDING}>Vou assinar — quando o grupo fechar</option>
                </select>
                <small className="field-hint">
                  Com "Vou assinar" o grupo fica em formação (status 'forming') até o dono confirmar a assinatura.
                </small>
              </div>
            )}

            {hasChatColumn && (
              <div className="form-group">
                <label>Chat do grupo</label>
                <select
                  name="chat_enabled"
                  value={formData.chat_enabled === false ? 'false' : 'true'}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    chat_enabled: e.target.value === 'true',
                  }))}
                >
                  <option value="true">Ligado — membros trocam mensagens</option>
                  <option value="false">Desligado — sem chat no grupo</option>
                </select>
              </div>
            )}

            {hasAdsColumn && (
              <div className="form-group ads-field">
                <label>A conta compartilhada tem anúncios?</label>
                <AdsToggle
                  value={hasAds}
                  onChange={setHasAds}
                  hint="Aparece como selo no card do grupo: 'Sem anúncios' (verde) ou 'Com anúncios' (âmbar). Com 'Não mostrar' o grupo fica sem selo."
                />
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Preço por vaga (R$) *</label>
            <input
              type="number"
              step="0.01"
              min={0}
              name="price_per_slot"
              value={formData.price_per_slot}
              onChange={handleChange}
              required
            />
            <small className="field-hint">
              {wizardPlan
                ? `O plano ${wizardPlan.name} permite de R$ ${brl(wizardPlan.min_price || 0)}${wizardPlan.max_price ? ` a R$ ${brl(wizardPlan.max_price)}` : ''} por pessoa.`
                : 'Admin da plataforma: sem valor mínimo por vaga.'}
            </small>
          </div>

          {formData.price_per_slot > 0 && (
            <div className="price-simulation">
              <div className="sim-header">
                <Info size={16} />
                <span>Simulação de recebimento</span>
              </div>
              <div className="sim-grid">
                <div className="sim-row sim-row-charged">
                  <span>Valor cobrado por pessoa</span>
                  <span>R$ {brl(priceSimulation.price)}</span>
                </div>
                <div className="sim-row sim-row-platform">
                  <span>Valor da plataforma</span>
                  <strong>R$ {brl(priceSimulation.platformFee)}</strong>
                </div>
                <div className="sim-row sim-row-total">
                  <span>Você recebe</span>
                  <strong>R$ {brl(priceSimulation.net)}</strong>
                </div>
              </div>
            </div>
          )}

          <div className="form-group">
            <label>Ciclos de cobrança disponíveis *</label>
            <p className="section-desc" style={{ marginBottom: '0.75rem' }}>
              Selecione quais formas de pagamento o usuário poderá escolher.
            </p>
            <div className="cycles-grid">
              {[
                { value: 'monthly', label: 'Mensal' },
                { value: 'quarterly', label: 'Trimestral' },
                { value: 'semiannual', label: 'Semestral' },
                { value: 'annual', label: 'Anual' },
                { value: 'days', label: 'Dias' },
                { value: 'custom', label: 'Personalizado' },
              ].map(opt => (
                <label key={opt.value} className={`cycle-check ${formData.available_cycles.includes(opt.value) ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={formData.available_cycles.includes(opt.value)}
                    onChange={() => handleCycleToggle(opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>

            {formData.available_cycles.includes('custom') && (
              <div className="form-grid" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Meses do ciclo personalizado *</label>
                  <input type="number" min="1" max="60"
                    value={formData.custom_cycle_months || ''}
                    onChange={e => setFormData(prev => ({ ...prev, custom_cycle_months: parseInt(e.target.value) || '' }))}
                    placeholder="Ex: 4"
                  />
                </div>
                <div className="form-group">
                  <label>Label do ciclo</label>
                  <input type="text"
                    value={formData.custom_cycle_label || ''}
                    onChange={e => setFormData(prev => ({ ...prev, custom_cycle_label: e.target.value }))}
                    placeholder="Ex: 4 Meses"
                  />
                </div>
              </div>
            )}

            {formData.available_cycles.includes('days') && (
              <div className="form-grid" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Quantidade de dias do ciclo *</label>
                  <input type="number" min="1" max="365"
                    value={formData.custom_cycle_days || ''}
                    onChange={e => setFormData(prev => ({ ...prev, custom_cycle_days: parseInt(e.target.value) || '' }))}
                    placeholder="Ex: 15"
                  />
                </div>
                <div className="form-group">
                  <label>Label do ciclo</label>
                  <input type="text"
                    value={formData.custom_cycle_label || ''}
                    onChange={e => setFormData(prev => ({ ...prev, custom_cycle_label: e.target.value }))}
                    placeholder="Ex: 15 Dias"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Desconto do ciclo (%)</label>
            <input type="number" step="0.01" min="0" max="100" name="cycle_discount" value={formData.cycle_discount} onChange={handleChange} />
          </div>

          <div className="toggle-section">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={formData.has_entrance_fee}
                onChange={e => setFormData(prev => ({ ...prev, has_entrance_fee: e.target.checked }))}
              />
              <span className="toggle-switch" />
              <span className="toggle-text">
                <strong>Cobrar valor de entrada?</strong>
                <small>Valor único pago na primeira vez + assinatura. Próximos ciclos somente assinatura.</small>
              </span>
            </label>
          </div>

          {formData.has_entrance_fee && (
            <div className="form-group">
              <label>Valor de entrada (R$) *</label>
              <input type="number" step="0.01" min="0" name="entrance_fee" value={formData.entrance_fee} onChange={handleChange} required={formData.has_entrance_fee} />
              <small className="field-hint">Cobrado apenas na primeira vez que o membro entra no grupo</small>
            </div>
          )}

          <div className="toggle-section">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={formData.has_slot_limit}
                onChange={e => setFormData(prev => ({ ...prev, has_slot_limit: e.target.checked }))}
              />
              <span className="toggle-switch" />
              <span className="toggle-text">
                <strong>Tem limite de vagas?</strong>
                <small>Quando ativado, define um limite de membros no grupo</small>
              </span>
            </label>
          </div>

          {formData.has_slot_limit && (
            <div className="form-group">
              <label>Limite de vagas *</label>
              <input type="number" min="1" name="max_size" value={formData.max_size} onChange={handleChange} required={formData.has_slot_limit} />
            </div>
          )}

          <div className="form-group">
            <label>Regras do grupo</label>
            <RuleTypesField
              value={formData.rules}
              onChange={(patch) => setFormData(prev => ({ ...prev, ...patch }))}
            />
          </div>

          <div className="form-group">
            <label>Tags (separadas por vírgula)</label>
            <input name="tags" value={formData.tags} onChange={handleChange} placeholder="Ex: 4k, ultrahd, sem anúncios" />
          </div>

          <div className="form-inline">
            <div className="form-group">
              <label>Status</label>
              <select name="status" value={formData.status} onChange={handleChange}>
                <option value="open">Aberto</option>
                <option value="forming">Formando</option>
                <option value="closed">Fechado</option>
              </select>
            </div>
            <div className="form-group checkbox-group">
              <label>
                <input type="checkbox" name="verified" checked={formData.verified} onChange={handleChange} />
                Grupo verificado (DividePass)
              </label>
            </div>
          </div>

          <div className="form-group">
            <label>Criado por (dono do grupo)</label>

            {ownerId && !ownerPicking && (
              <div className="owner-current">
                <div className="owner-current-info">
                  <strong>{currentOwnerName || `${ownerId.slice(0, 8)}...`}</strong>
                  <small>
                    {ownerId === user?.id ? 'você' : 'dono atual do grupo'}
                  </small>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => setOwnerPicking(true)}>
                  Trocar
                </button>
              </div>
            )}

            {(ownerPicking || !ownerId) && (
              <div className="owner-picker">
                <div className="owner-search">
                  <input
                    type="text"
                    value={ownerQuery}
                    onChange={(e) => handleOwnerSearchChange(e.target.value)}
                    placeholder="Buscar por nome ou e-mail..."
                    disabled={ownerLoading}
                  />
                  {ownerLoading && <Loader2 size={15} className="spin owner-search-spinner" />}
                </div>

                {ownerSearched && ownerResults.length === 0 && !ownerLoading && (
                  <p className="owner-empty">Nenhum usuário encontrado</p>
                )}

                {ownerResults.length > 0 && (
                  <div className="owner-results">
                    {ownerResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className="owner-result"
                        onClick={() => {
                          setOwnerId(u.id);
                          setCurrentOwnerName(u.name || u.email);
                          setOwnerQuery('');
                          setOwnerResults([]);
                          setOwnerSearched(false);
                          setOwnerPicking(false);
                        }}
                      >
                        <strong>{u.name || 'Sem nome'}</strong>
                        <span>{u.email}</span>
                      </button>
                    ))}
                  </div>
                )}

                {ownerId && (
                  <button
                    type="button"
                    className="owner-cancel"
                    onClick={() => {
                      setOwnerPicking(false);
                      setOwnerQuery('');
                      setOwnerResults([]);
                      setOwnerSearched(false);
                    }}
                  >
                    Cancelar
                  </button>
                )}
              </div>
            )}

            <small className="field-hint">
              {ownerId
                ? 'O dono recebe os pagamentos na carteira e gerencia o grupo.'
                : 'Busque para colocar outra pessoa como dona. Sem escolha, o grupo fica com você.'}
            </small>
          </div>
        </section>

        <section className="form-section">
          <h2>Credenciais de Acesso</h2>
          <p className="section-desc">
            Configure as credenciais de acesso ao serviço. Compartilhadas entre todos os membros do grupo.
          </p>

          {credentialId && (
            <div className={`cred-assignment ${credentialAssignedTo ? 'is-locked' : 'is-shared'}`}>
              {credentialAssignedTo ? (
                <>
                  <AlertTriangle size={16} />
                  <div className="cred-assignment-text">
                    <strong>Credencial vinculada a {assignedMemberName}.</strong>
                    <span>
                      Nesse estado, so essa pessoa enxerga o acesso — os outros membros do grupo
                      veem "credenciais nao disponiveis". Compartilhe para liberar para todo mundo.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={handleShareCredential}
                    disabled={sharingCredential}
                  >
                    {sharingCredential ? 'Compartilhando...' : 'Compartilhar com todos'}
                  </button>
                </>
              ) : (
                <>
                  <CheckCircle size={16} />
                  <div className="cred-assignment-text">
                    <strong>Credencial compartilhada com todo membro ativo do grupo.</strong>
                    <span>Todos do grupo veem o mesmo acesso.</span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="form-grid">
            <div className="form-group">
              <label>Tipo de credencial</label>
              <select value={credentialType} onChange={e => setCredentialType(e.target.value)}>
                <option value="email_password">E-mail + Senha</option>
                <option value="link">Link de Acesso</option>
                <option value="code">Código / Convite</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>
          </div>

          {credentialType === 'email_password' && (
            <div className="form-grid">
              <div className="form-group">
                <label>E-mail de acesso</label>
                <input
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  placeholder="conta@plataforma.com"
                />
              </div>
              <div className="form-group">
                <label>Senha de acesso</label>
                <input
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  type="text"
                />
              </div>
            </div>
          )}

          {credentialType === 'link' && (
            <div className="form-grid">
              <div className="form-group">
                <label>Link de acesso</label>
                <input
                  value={credentialUrl}
                  onChange={e => setCredentialUrl(e.target.value)}
                  placeholder="https://..."
                  type="url"
                />
                <small style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                  Link compartilhado que os membros usarão para acessar o serviço
                </small>
              </div>
              <div className="form-group">
                <label>Observações (opcional)</label>
                <input
                  value={credentialNotes}
                  onChange={e => setCredentialNotes(e.target.value)}
                  placeholder="Instruções adicionais ou URL de referência..."
                />
              </div>
            </div>
          )}

          {credentialType === 'code' && (
            <div className="form-grid">
              <div className="form-group">
                <label>Código de acesso / Convite</label>
                <input
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="Código ou link de convite"
                  type="text"
                />
              </div>
            </div>
          )}

          {credentialType === 'custom' && (
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Texto da credencial</label>
                <textarea
                  value={credentialNotes}
                  onChange={e => setCredentialNotes(e.target.value)}
                  placeholder="Descreva como os membros devem acessar o serviço..."
                  rows={4}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>
            </div>
          )}

          {credentialType !== 'email_password' && credentialType !== 'link' && (
            <div className="form-grid">
              <div className="form-group">
                <label>Observações (opcional)</label>
                <input
                  value={credentialNotes}
                  onChange={e => setCredentialNotes(e.target.value)}
                  placeholder="Instruções adicionais para os membros"
                />
              </div>
            </div>
          )}

          <div className="toggle-section">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={hasProfiles}
                onChange={e => {
                  setHasProfiles(e.target.checked);
                  if (e.target.checked && profiles.length === 0) {
                    setProfiles([{ profile_name: '', profile_password: '' }]);
                  }
                }}
              />
              <span className="toggle-switch" />
              <span className="toggle-text">
                <strong>Esta plataforma usa perfis individuais para membros</strong>
                <small>Ex: Netflix, Disney+ — cada membro recebe um perfil/tela com senha própria</small>
              </span>
            </label>
          </div>

          {hasProfiles && (
            <div className="profiles-section">
              <div className="section-header-row">
                <div>
                  <h3>Perfis / Telas</h3>
                  <p className="section-desc">
                    Cada membro que entrar no grupo receberá automaticamente um perfil.
                  </p>
                </div>
                <button type="button" className="btn btn-sm btn-primary" onClick={addProfile}>
                  <Plus size={16} />
                  Adicionar Perfil
                </button>
              </div>

              {profiles.map((profile, index) => {
                const memberOrder = profile.assigned_to ? getMemberOrder(profile.assigned_to) : null;
                const assignedMember = members.find(m => m.user_id === profile.assigned_to);
                const usedMemberIds = profiles.filter(p => p.assigned_to && p !== profile).map(p => p.assigned_to);
                return (
                  <div key={index} className="profile-entry">
                    <div className="profile-entry-header">
                      <h4>Perfil / Tela {index + 1}</h4>
                      <div className="profile-entry-badges">
                        {memberOrder ? (
                          <span className="assigned-badge">
                            Membro #{memberOrder} — {profile.assigned_user?.name || profile.assigned_user?.email || assignedMember?.user?.name || assignedMember?.user?.email}
                          </span>
                        ) : (
                          <span className="available-badge">Disponível</span>
                        )}
                        {profiles.length > 1 && (
                          <button type="button" className="btn-icon danger" onClick={() => removeProfile(index)} title="Remover">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="form-grid cred-fields">
                      <div className="form-group">
                        <label>Nome do Perfil</label>
                        <input
                          value={profile.profile_name}
                          onChange={e => handleProfileChange(index, 'profile_name', e.target.value)}
                          placeholder="Ex: Perfil 1, Tela João"
                        />
                      </div>
                      <div className="form-group">
                        <label>Senha do Perfil</label>
                        <input
                          value={profile.profile_password}
                          onChange={e => handleProfileChange(index, 'profile_password', e.target.value)}
                          placeholder="Senha específica do perfil"
                          type="text"
                        />
                      </div>
                      <div className="form-group">
                        <label>Vincular ao Membro</label>
                        <select
                          value={profile.assigned_to || ''}
                          onChange={e => handleProfileChange(index, 'assigned_to', e.target.value || null)}
                        >
                          <option value="">Não vinculado</option>
                          {members.map((m, mIdx) => (
                            <option
                              key={m.user_id}
                              value={m.user_id}
                              disabled={usedMemberIds.includes(m.user_id)}
                            >
                              Membro #{mIdx + 1} — {m.user?.name || m.user?.email || m.user_id}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}

              <button type="button" className="add-profile-inline-btn" onClick={addProfile}>
                <Plus size={18} />
                Adicionar novo perfil / tela
              </button>
            </div>
          )}
        </section>

        <section className="form-section">
          <h2>Busca de Código por E-mail (Opcional)</h2>
          <p className="section-desc">
            Quando habilitado, os membros do grupo poderão buscar códigos de verificação diretamente pela DividePass, sem precisar acessar o e-mail da conta.
          </p>

          <div className="toggle-section" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={emailCodeEnabled}
                onChange={e => setEmailCodeEnabled(e.target.checked)}
              />
              <span className="toggle-switch" />
              <span className="toggle-text">
                <strong>Habilitar busca de códigos por e-mail</strong>
                <small>Os membros poderão buscar códigos de verificação enviados para este e-mail</small>
              </span>
            </label>
          </div>

          {emailCodeEnabled && (
            <div style={{ marginTop: '1.25rem' }}>
              <div>
                <div className="form-grid">
                    <div className="form-group">
                      <label>E-mail da conta</label>
                      <input
                        value={emailAddress}
                        onChange={e => setEmailAddress(e.target.value)}
                        placeholder="conta@plataforma.com"
                      />
                    </div>
                    <div className="form-group">
                      <label>Servidor IMAP</label>
                      <input
                        value={emailImapServer}
                        onChange={e => setEmailImapServer(e.target.value)}
                        placeholder="imap.zoho.com"
                      />
                    </div>
                  </div>

                  <div className="form-grid">
                    <div className="form-group">
                      <label>Usuário IMAP</label>
                      <input
                        value={emailImapUser}
                        onChange={e => setEmailImapUser(e.target.value)}
                        placeholder="conta@plataforma.com"
                      />
                    </div>
                    <div className="form-group">
                      <label>Senha IMAP / App Password</label>
                      <input
                        type="text"
                        value={emailImapPassword}
                        onChange={e => setEmailImapPassword(e.target.value)}
                        placeholder="Senha ou App Password"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Porta IMAP</label>
                    <input
                      type="number"
                      value={emailImapPort}
                      onChange={e => setEmailImapPort(parseInt(e.target.value, 10) || 993)}
                      placeholder="993"
                      style={{ maxWidth: '120px' }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Remetentes permitidos (um por linha)</label>
                    <p className="section-desc" style={{ marginBottom: '0.5rem' }}>
                      Apenas e-mails destes remetentes serão processados. Se vazio, todos são aceitos.
                    </p>
                    <textarea
                      rows={3}
                      value={emailAllowedSenders}
                      onChange={e => setEmailAllowedSenders(e.target.value)}
                      placeholder={"netflix.com\nno-reply@netflix.com\ndisneyplus.com"}
                      style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Assuntos bloqueados (um por linha)</label>
                    <p className="section-desc" style={{ marginBottom: '0.5rem' }}>
                      E-mails com assuntos contendo estes termos serão ignorados.
                    </p>
                    <textarea
                      rows={3}
                      value={emailBlockedSubjects}
                      onChange={e => setEmailBlockedSubjects(e.target.value)}
                      placeholder={"password\nrecuperação\nredefinição\nsegurança"}
                      style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Assuntos permitidos (um por linha)</label>
                    <p className="section-desc" style={{ marginBottom: '0.5rem' }}>
                      Apenas e-mails cujo assunto contém estes termos serão processados. Se vazio, todos são aceitos.
                    </p>
                    <textarea
                      rows={3}
                      value={emailSubjectIncludes}
                      onChange={e => setEmailSubjectIncludes(e.target.value)}
                      placeholder={"verify\ncode\ncódigo\naccess\nverificação"}
                      style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Palavras-chave no corpo do e-mail (um por linha)</label>
                    <p className="section-desc" style={{ marginBottom: '0.5rem' }}>
                      Se o e-mail contiver estas palavras e também tiver dígitos, o código será extraído. Útil para plataformas que não seguem padrões padrão.
                    </p>
                    <textarea
                      rows={3}
                      value={emailBodyKeywords}
                      onChange={e => setEmailBodyKeywords(e.target.value)}
                      placeholder={"verificação\nverification\naccess code\ncódigo de acesso"}
                      style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Padrões regex de extração (um por linha)</label>
                    <p className="section-desc" style={{ marginBottom: '0.5rem' }}>
                      Regex customizados para este grupo. Use <code>(\d{'{4,8}'})</code> para capturar o código. Exemplo: <code>code[:\s]*(\d{'{6}'})</code>
                    </p>
                    <textarea
                      rows={3}
                      value={emailCodePatterns}
                      onChange={e => setEmailCodePatterns(e.target.value)}
                      placeholder={"code[:\\s]*(\\d{6})\npin[:\\s]*(\\d{4})"}
                      style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div className="toggle-section" style={{ marginTop: '0.5rem' }}>
                    <label className="toggle-label">
                      <input
                        type="checkbox"
                        checked={emailAiEnabled}
                        onChange={e => setEmailAiEnabled(e.target.checked)}
                      />
                      <span className="toggle-switch" />
                      <span className="toggle-text">
                        <strong>Usar IA para extração (Groq)</strong>
                        <small>Quando os padrões regex não encontram código, a IA tenta ler o e-mail inteligentemente. Requer <code>GROQ_API_KEY</code> no Supabase Secrets.</small>
                      </span>
                    </label>
                  </div>
                </div>
            </div>
          )}
        </section>

        {isEditing && (
          <section className="form-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2>Membros do Grupo</h2>
                <p className="section-desc">
                  {members.length} membro(s) neste grupo ({members.filter(m => m.status === 'active').length} ativo(s), {members.filter(m => m.status === 'pending').length} pendente(s)). Você pode adicionar ou remover membros manualmente.
                </p>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleSyncMembers} disabled={syncing}>
                {syncing ? <><Loader2 size={14} className="spin" /> Sincronizando...</> : <><RefreshCw size={14} /> Sincronizar Assinaturas</>}
              </button>
            </div>

            <NotificationComposerCard
              title={groupAlertTitle}
              setTitle={setGroupAlertTitle}
              message={groupAlertMessage}
              setMessage={setGroupAlertMessage}
              channels={groupAlertChannels}
              setChannels={setGroupAlertChannels}
              onSubmit={handleSendGroupAlert}
              loading={sendingGroupAlert || groupAlertMembers.length === 0}
              error={error}
              titleLabel="Enviar alerta para o grupo"
              description={`Envia uma notificação para ${groupAlertMembers.length} membro(s) deste grupo.`}
              recipientsLabel={`${groupAlertMembers.length} destinatário(s)`}
              scopeBadge="Somente este grupo"
              submitLabel="Enviar alerta"
              titlePlaceholder="Ex: Manutenção hoje às 22h"
              messagePlaceholder="Escreva o aviso que os membros vão receber"
              className="group-alert-card"
              buttonType="button"
              disabled={groupAlertMembers.length === 0}
            />

            <div className="members-list">
              {members.map((member, idx) => (
                <div key={member.user_id} className="member-entry">
                  <div className="member-info">
                    <span className="member-number">#{idx + 1}</span>
                    <div>
                      <strong>{member.user?.name || 'Sem nome'}</strong>
                      <span className="member-email">{member.user?.email || member.user_id}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      padding: '0.2rem 0.5rem',
                      borderRadius: '999px',
                      background: member.status === 'active' ? 'rgba(16, 185, 129, 0.12)' : member.status === 'pending' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                      color: member.status === 'active' ? '#10B981' : member.status === 'pending' ? '#F59E0B' : '#EF4444',
                    }}>
                      {member.status === 'active' ? 'Ativo' : member.status === 'pending' ? 'Pendente' : 'Cancelado'}
                    </span>
                    <button
                      type="button"
                      className="btn-icon danger"
                      onClick={() => handleRemoveMember(member.user_id)}
                      title="Remover membro"
                    >
                      <UserMinus size={16} />
                    </button>
                  </div>
                </div>
              ))}

              {members.length === 0 && (
                <p className="section-desc" style={{ textAlign: 'center', padding: '1rem' }}>
                  Nenhum membro neste grupo.
                </p>
              )}
            </div>

            <div className="add-member-row">
              <input
                type="email"
                value={newMemberEmail}
                onChange={e => setNewMemberEmail(e.target.value)}
                placeholder="E-mail do usuário para adicionar"
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddMember())}
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={handleAddMember}
                disabled={addingMember || !newMemberEmail.trim()}
              >
                {addingMember ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />}
                Adicionar
              </button>
            </div>
          </section>
        )}

          </>
        )}

        <div className="form-footer">
          <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/groups')}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {isEditing ? 'Salvar Alterações' : 'Criar Grupo'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default GroupForm;
