import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Loader2, Save, Info, Tv, Crown, Eye, KeyRound, QrCode,
  CheckCircle2, Trash2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { brl, MIN_PRICE_PER_SLOT } from '../../lib/platformFee';
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

import WizardSteps from '../../components/group-creation/WizardSteps';
import PlatformSearchStep from '../../components/group-creation/PlatformSearchStep';
import PlanSelectionStep from '../../components/group-creation/PlanSelectionStep';
import SlotsStep from '../../components/group-creation/SlotsStep';
import SubscriptionStatusStep from '../../components/group-creation/SubscriptionStatusStep';
import VisibilityStep from '../../components/group-creation/VisibilityStep';
import RuleTypesField from '../../components/group-creation/RuleTypesField';
import BillingStep from '../../components/group-creation/BillingStep';
import CredentialsStep from '../../components/group-creation/CredentialsStep';
import PaymentStep from '../../components/group-creation/PaymentStep';
import SummaryStep from '../../components/group-creation/SummaryStep';
import ManagedEmailOption from '../../components/group-creation/ManagedEmailOption';
import { provisionarEmailGerenciado, isMissingEmailCodeColumn } from '../../lib/managedGroupEmail';

import './CreateGroup.css';

/**
 * TRILHA DE 6 ETAPAS (usuário e admin usam a mesma ordem).
 *
 * 1. Plataforma  — busca + as mais usadas no topo + confirmação
 * 2. Plano       — plano/tipo de conta, vagas e status da assinatura
 * 3. Grupo       — visibilidade (público/privado) e regras do grupo
 * 4. Credenciais — como os membros acessam a conta
 * 5. Pagamentos  — ciclos, PIX, taxa de adesão e valor do grupo
 * 6. Resumo      — confirmação + políticas + criação do grupo
 */
const STEPS = [
  { key: 'plataforma', title: 'Plataforma', icon: Tv },
  { key: 'plano', title: 'Plano', icon: Crown },
  { key: 'grupo', title: 'Grupo', icon: Eye },
  { key: 'credenciais', title: 'Credenciais', icon: KeyRound },
  { key: 'pagamentos', title: 'Pagamentos', icon: QrCode },
  { key: 'resumo', title: 'Resumo', icon: CheckCircle2 },
];

const STEP_COPY = {
  plataforma: {
    title: 'Qual plataforma o grupo vai compartilhar?',
    desc: 'É o serviço cujas credenciais os membros vão usar.',
  },
  plano: {
    title: 'Qual é o tipo de conta que você tem a assinatura?',
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

const EMPTY_DRAFT = {
  groupId: null,
  step: 0,
  service_id: '',
  plan_id: '',
  plan_type: '',
  plan_type_custom: '',
  custom_plan_active: false,
  has_ads: null,
  visibility: 'public',
  // Status da assinatura da conta do serviço: 'active' (ja assinou) ou
  // 'pending' (vai assinar quando o grupo fechar).
  subscription_status: SUBSCRIPTION_ACTIVE,
  // Chat do grupo (troca de mensagens entre os membros).
  chat_enabled: true,
  // E-mail do grupo gerenciado pela DividePass com IA (busca automatica do
  // codigo de verificacao). Vira a caixa de e-mail do grupo no fim do wizard.
  managed_email: false,
  available_cycles: ['monthly'],
  custom_cycle_enabled: false,
  custom_cycle_months: 2,
  custom_cycle_label: '',
  days_cycle_enabled: false,
  days_cycle_days: 15,
  days_cycle_label: '',
  has_slot_limit: true,
  max_size: 4,
  price_total: '',
  rules: DEFAULT_RULE_TEXT,
  credential_type: 'email_password',
  login_email: '',
  login_password: '',
  credential_extra: '',
  credential_notes: '',
  pix_key: '',
  pix_type: 'cpf',
  entrance_fee: 15,
  price_per_slot: '',
  policies_accepted: false,
};

/**
 * Colunas REAIS de public.group_credentials em producao:
 *   credential_type | login_email | login_password | credential_url | credential_notes | has_profiles
 * Nao existem credential_code / credential_invite / credential_custom — o valor extra
 * depende do tipo (ver buildCredentialPayload).
 */
function buildCredentialPayload(draft, groupId) {
  const t = draft.credential_type;
  return {
    group_id: groupId,
    credential_type: t,
    login_email: t === 'email_password' ? (draft.login_email || null) : null,
    login_password: t === 'email_password'
      ? (draft.login_password || null)
      : (t === 'code' ? (draft.credential_extra || null) : null),
    credential_url: (t === 'link' || t === 'invite') ? (draft.credential_extra || null) : null,
    credential_notes: t === 'custom' ? (draft.credential_extra || null) : (draft.credential_notes || null),
    has_profiles: false,
  };
}

function readCredentialExtra(cred, type) {
  if (!cred) return '';
  if (type === 'link' || type === 'invite') return cred.credential_url || '';
  if (type === 'code') return cred.login_password || '';
  if (type === 'custom') return cred.credential_notes || '';
  return '';
}

// Deduz a etapa a partir do que ja foi gravado (retomar de outro dispositivo)
// 0 plataforma | 1 plano | 2 grupo | 3 credenciais | 4 pagamentos | 5 resumo
function inferStep({ service_id, plan_id, plan_type, plan_type_custom, hasCredential, price_total }) {
  if (!service_id) return 0;
  if (!plan_id && !plan_type && !plan_type_custom) return 1;
  if (!hasCredential) return 3;
  if (!(parseFloat(price_total) > 0)) return 4;
  return 5;
}

/**
 * Campos do grupo que dependem de migration: se o banco ainda nao conhece a
 * coluna, o insert/update e refeito sem ela (o front degrada com elegancia
 * em vez de quebrar o cadastro do grupo).
 *
 * @returns {{payload: object, missing: string[]}|null} payload limpo + as
 *          colunas que o banco nao conhece (null = nada a remover).
 */
function stripMissingColumns(payload, error) {
  const next = { ...payload };
  const missing = [];

  const optional = [
    { field: 'has_ads', test: isMissingHasAdsColumn },
    { field: 'visibility', test: isMissingVisibilityColumn },
    { field: 'subscription_status', test: isMissingSubscriptionStatusColumn },
    { field: 'chat_enabled', test: isMissingChatColumn },
    { field: 'email_code_enabled', test: isMissingEmailCodeColumn },
    { field: 'email_code_method', test: isMissingEmailCodeColumn },
    { field: 'managed_email', test: isMissingEmailCodeColumn },
  ];

  optional.forEach(({ field, test }) => {
    if (field in next && test(error)) {
      delete next[field];
      missing.push(field);
    }
  });

  return missing.length ? { payload: next, missing } : null;
}

function CreateGroup() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const draftIdParam = searchParams.get('draft');

  const [services, setServices] = useState([]);
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [usage, setUsage] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [saveWarning, setSaveWarning] = useState('');
  const [error, setError] = useState('');
  const [stepError, setStepError] = useState('');
  const [hasPixColumn, setHasPixColumn] = useState(true);
  const [hasAdsColumn, setHasAdsColumn] = useState(true);
  const [hasVisibilityColumn, setHasVisibilityColumn] = useState(false);
  const [hasSubscriptionColumn, setHasSubscriptionColumn] = useState(false);
  const [hasChatColumn, setHasChatColumn] = useState(false);
  const [draftOffer, setDraftOffer] = useState(null);

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const savingRef = useRef(false);
  const autosaveRef = useRef(null);
  const finalizedRef = useRef(false);

  const set = useCallback((patch) => {
    setDraft(prev => ({ ...prev, ...patch }));
  }, []);

  // ---------------------------------------------------------------- carregamento
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [servicesRes, settingsRes, usageRes] = await Promise.all([
          supabase.from('streaming_services')
            .select('id, name, full_name, icon, icon_url, color, slug, pinned, featured, max_group_size')
            .eq('status', 'active')
            .order('name'),
          supabase.from('app_settings').select('key, value').in('key', ['default_entrance_fee']),
          // Quantos grupos cada plataforma tem: as mais usadas ficam no topo
          // da lista de plataformas (só os ids, é o que alimenta a ordem).
          supabase.from('groups').select('service_id').limit(2000),
        ]);
        if (cancelled) return;

        if (servicesRes.error) throw servicesRes.error;
        setServices(servicesRes.data || []);

        const counts = {};
        (usageRes.data || []).forEach((g) => {
          if (!g.service_id) return;
          counts[g.service_id] = (counts[g.service_id] || 0) + 1;
        });
        setUsage(counts);

        const fee = settingsRes.data?.find(s => s.key === 'default_entrance_fee');
        const feeValue = fee ? (parseFloat(fee.value) || 15) : 15;

        // a coluna pix_key so existe depois da migration add-group-pix.sql.
        // Detecta pelas colunas devolvidas por select=* (sem gerar erro no console).
        const probe = await supabase.from('groups').select('*').limit(1);
        if (!probe.error && probe.data?.length) {
          setHasPixColumn('pix_key' in probe.data[0]);
        } else {
          const pixProbe = await supabase.from('groups').select('id, pix_key').limit(1);
          setHasPixColumn(!pixProbe.error);
        }

        // a coluna has_ads (migration add-group-has-ads.sql) entra depois do
        // deploy: ate la, o seletor fica escondido e nada e gravado.
        setHasAdsColumn(await hasAdsColumnAvailable());

        // a coluna visibility (migration add-platform-plans-and-group-visibility.sql)
        setHasVisibilityColumn(await visibilityColumnAvailable());

        // as colunas subscription_status e chat_enabled (mesma migration)
        setHasSubscriptionColumn(await subscriptionStatusColumnAvailable());
        setHasChatColumn(await chatColumnAvailable());

        // retomar rascunho
        if (draftIdParam) {
          const { data: g } = await supabase.from('groups').select('*').eq('id', draftIdParam).maybeSingle();
          if (g) {
            const { data: cred } = await supabase.from('group_credentials').select('*').eq('group_id', g.id).maybeSingle();
            const cycles = g.available_cycles || ['monthly'];
            const credType = cred?.credential_type || 'email_password';
            setDraft({
              ...EMPTY_DRAFT,
              groupId: g.id,
              service_id: g.service_id || '',
              plan_id: g.plan_id || '',
              plan_type: g.plan_type || '',
              plan_type_custom: g.plan_type_custom || '',
              custom_plan_active: !!(g.plan_type_custom && !g.plan_type),
              has_ads: g.has_ads === true ? true : (g.has_ads === false ? false : null),
              visibility: g.visibility || 'public',
              subscription_status: g.subscription_status || SUBSCRIPTION_ACTIVE,
              chat_enabled: g.chat_enabled === false ? false : true,
              managed_email: g.managed_email === true || g.email_code_enabled === true,
              available_cycles: cycles.filter(c => c !== 'custom' && c !== 'days'),
              custom_cycle_enabled: cycles.includes('custom'),
              custom_cycle_months: g.custom_cycle_months || 2,
              custom_cycle_label: g.custom_cycle_label || '',
              days_cycle_enabled: cycles.includes('days'),
              days_cycle_days: g.custom_cycle_days || 15,
              days_cycle_label: g.custom_cycle_label || '',
              has_slot_limit: true,
              max_size: g.max_size || 4,
              // Recria o total que reproduz o preco por vaga salvo.
              price_total: g.price_per_slot > 0
                ? String(Math.round(g.price_per_slot * (g.max_size || 4) * 100) / 100)
                : '',
              // Rascunho em andamento sem regrinha volta com a padrão — o
              // grupo sempre nasce com pelo menos um aviso para o membro.
              rules: g.rules || DEFAULT_RULE_TEXT,
              entrance_fee: feeValue,
              price_per_slot: g.price_per_slot > 0.01 ? String(g.price_per_slot) : '',
              pix_key: g.pix_key || '',
              pix_type: g.pix_type || 'cpf',
              credential_type: credType,
              login_email: cred?.login_email || '',
              login_password: credType === 'email_password' ? (cred?.login_password || '') : '',
              credential_extra: readCredentialExtra(cred, credType),
              credential_notes: credType === 'custom' ? '' : (cred?.credential_notes || ''),
              step: inferStep({
                service_id: g.service_id,
                plan_id: g.plan_id,
                plan_type: g.plan_type,
                plan_type_custom: g.plan_type_custom,
                hasCredential: !!cred,
                price_total: g.price_per_slot > 0
                  ? String(Math.round(g.price_per_slot * (g.max_size || 4) * 100) / 100)
                  : '',
              }),
            });
          }
        } else {
          setDraft(prev => ({ ...prev, entrance_fee: feeValue }));
          // rascunho em andamento? (o usuario recarregou a pagina)
          if (user?.id) {
            const { data: pending } = await supabase
              .from('groups')
              .select('id, name, updated_at')
              .eq('owner_id', user.id)
              .eq('status', 'draft')
              .order('updated_at', { ascending: false })
              .limit(1);
            if (pending?.length) setDraftOffer(pending[0]);
          }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [draftIdParam, user?.id]);

  // ------------------------------------------------------- planos da plataforma
  useEffect(() => {
    let cancelled = false;
    if (!draft.service_id) return undefined;
    fetchPlansForService(draft.service_id).then((list) => {
      if (cancelled) return;
      setPlans(list);
      setPlansLoading(false);
    });
    return () => { cancelled = true; };
  }, [draft.service_id]);

  const currentStep = STEPS[draft.step] || STEPS[0];
  const StepIcon = currentStep.icon;
  const isLast = draft.step === STEPS.length - 1;

  const platform = useMemo(
    () => services.find(s => s.id === draft.service_id) || null,
    [services, draft.service_id],
  );
  const selectedPlan = useMemo(
    () => plans.find(p => p.id === draft.plan_id) || null,
    [plans, draft.plan_id],
  );

  // ---------------------------------------------------------------- persistência
  // IMPORTANTE: o payload de update NAO leva `status`.
  // O status só é escrito em dois momentos: no insert (draft) e na finalização
  // (open). Se o update levasse status, o autosave (debounce de 1,2s) poderia
  // disparar DEPOIS da finalização e reescrever 'draft' por cima de 'open' —
  // o grupo ficaria invisível no catálogo sem nenhum aviso.
  const buildGroupPayload = () => {
    const cycles = [...draft.available_cycles];
    if (draft.custom_cycle_enabled) cycles.push('custom');
    if (draft.days_cycle_enabled) cycles.push('days');

    const entrance = parseFloat(draft.entrance_fee) || 0;

    const payload = {
      service_id: draft.service_id,
      // Nome automatico: [plataforma] + [plano] ou [plataforma] + [id do grupo].
      name: buildGroupName({ platform, plan: selectedPlan, groupId: draft.groupId }),
      description: null,
      // Preço por pessoa: o total do grupo dividido pelas vagas abertas.
      price_per_slot: pricePerSlot(draft.price_total, draft.max_size)
        || parseFloat(draft.price_per_slot)
        || 0.01,
      billing_cycle: cycles[0] || 'monthly',
      available_cycles: cycles,
      max_size: draft.has_slot_limit ? parseInt(draft.max_size, 10) || 4 : 4,
      has_slot_limit: draft.has_slot_limit,
      has_entrance_fee: entrance > 0,
      entrance_fee: entrance,
      rules: draft.rules || null,
      tags: [],
      plan_type: draft.custom_plan_active ? null : (draft.plan_type || null),
      plan_type_custom: draft.custom_plan_active ? (draft.plan_type_custom || null) : null,
      custom_cycle_months: draft.custom_cycle_enabled ? parseInt(draft.custom_cycle_months, 10) : null,
      custom_cycle_label: draft.custom_cycle_enabled ? draft.custom_cycle_label : (draft.days_cycle_enabled ? draft.days_cycle_label : null),
      custom_cycle_days: draft.days_cycle_enabled ? parseInt(draft.days_cycle_days, 10) : null,
    };

    if (draft.plan_id) payload.plan_id = draft.plan_id;

    if (hasPixColumn && draft.pix_key) {
      // O que vai para o banco é a chave CRUA (só dígitos no CPF/CNPJ/
      // telefone) — na tela ela aparece mascarada. Ver lib/pixKeyMask.js.
      payload.pix_key = unmaskPixKey(draft.pix_key, draft.pix_type);
      payload.pix_type = draft.pix_type;
    }
    // a coluna has_ads só entra no payload quando a migration já rodou.
    // null = "Não mostrar" (grupo sem selo) e PRECISA ser enviado: sem isso,
    // um grupo que antes tinha "Sem anúncios" continuaria com o selo antigo.
    if (hasAdsColumn) {
      payload.has_ads = draft.has_ads === true ? true : (draft.has_ads === false ? false : null);
    }
    // a coluna visibility entra junto (migration add-platform-plans-and-group-visibility.sql).
    if (hasVisibilityColumn) {
      payload.visibility = draft.visibility || 'public';
    }
    // status da assinatura da conta do servico ('active' | 'pending').
    if (hasSubscriptionColumn) {
      payload.subscription_status = draft.subscription_status || SUBSCRIPTION_ACTIVE;
    }
    // chat do grupo (troca de mensagens entre os membros).
    if (hasChatColumn) {
      payload.chat_enabled = draft.chat_enabled !== false;
    }
    // E-mail gerenciado com IA: liga a busca de codigo deste grupo — e o que
    // faz o botao "Buscar Codigo" aparecer para o membro. A CAIXA em si e
    // criada no servidor no fim do wizard (edge function), por isso aqui so
    // vai a intencao.
    payload.email_code_enabled = draft.managed_email === true;
    payload.email_code_method = draft.managed_email === true ? 'imap' : null;
    // A intencao do dono fica gravada mesmo se a criacao da caixa falhar
    // (a tela "Gerenciar Grupo" usa isso para oferecer a criacao de novo).
    payload.managed_email = draft.managed_email === true;
    return payload;
  };

  // Campos do grupo que dependem de migration: se o banco ainda nao conhece a
  // coluna, o insert/update e refeito sem ela (o front degrada com elegancia
  // em vez de quebrar o cadastro do grupo).
  const saveDraft = useCallback(async () => {
    if (!user?.id) throw new Error('Usuário não autenticado');
    const payload = buildGroupPayload();

    if (!draft.groupId) {
      const insertRow = {
        ...payload,
        status: 'draft',
        owner_id: user.id,
        verified: false,
        is_official: false,
        approval_status: null,
      };

      let { data, error: insErr } = await supabase
        .from('groups')
        .insert(insertRow)
        .select('id')
        .single();

      if (insErr) {
        // o banco ainda nao tem alguma das colunas novas: refaz sem o campo
        const retry = stripMissingColumns(insertRow, insErr);
        if (retry) {
          retry.missing.forEach((field) => {
            if (field === 'has_ads') setHasAdsColumn(false);
            if (field === 'visibility') setHasVisibilityColumn(false);
            if (field === 'subscription_status') setHasSubscriptionColumn(false);
            if (field === 'chat_enabled') setHasChatColumn(false);
          });
          const again = await supabase.from('groups').insert(retry.payload).select('id').single();
          data = again.data;
          insErr = again.error;
        }
      }
      if (insErr) throw insErr;

      const updates = { slug: data.id.slice(0, 6).toUpperCase() };
      // Refeza o nome agora que o id existe: sem plano, o nome usa o id curto.
      const finalName = buildGroupName({ platform, plan: selectedPlan, groupId: data.id });
      if (finalName && finalName !== payload.name) updates.name = finalName;

      const { error: updErr } = await supabase.from('groups').update(updates).eq('id', data.id);
      if (updErr) throw updErr;

      set({ groupId: data.id });
      // Agora existe um grupo do usuário: a sonda consegue provar se a coluna
      // has_ads existe no banco e liberar o seletor da etapa de plano.
      if (!hasAdsColumn) {
        const ok = await hasAdsColumnAvailable();
        if (ok) setHasAdsColumn(true);
      }
      return data.id;
    }

    let { error: updErr } = await supabase.from('groups').update(payload).eq('id', draft.groupId);
    if (updErr) {
      const retry = stripMissingColumns(payload, updErr);
      if (retry) {
        retry.missing.forEach((field) => {
          if (field === 'has_ads') setHasAdsColumn(false);
          if (field === 'visibility') setHasVisibilityColumn(false);
          if (field === 'subscription_status') setHasSubscriptionColumn(false);
          if (field === 'chat_enabled') setHasChatColumn(false);
        });
        const again = await supabase.from('groups').update(retry.payload).eq('id', draft.groupId);
        if (again.error) throw again.error;
        return draft.groupId;
      }
    }
    if (updErr) throw updErr;
    return draft.groupId;
  }, [draft, user, hasPixColumn, hasAdsColumn, hasVisibilityColumn, platform, selectedPlan]);

  // grava (ou atualiza) a credencial de acesso — chamado ao sair da etapa de credenciais
  const saveCredential = useCallback(async (groupId, currentDraft) => {
    const payload = buildCredentialPayload(currentDraft, groupId);
    const { data: existing } = await supabase
      .from('group_credentials').select('id').eq('group_id', groupId).maybeSingle();
    if (existing) {
      const { error: credErr } = await supabase.from('group_credentials').update(payload).eq('id', existing.id);
      if (credErr) throw credErr;
    } else {
      const { error: credErr } = await supabase.from('group_credentials').insert(payload);
      if (credErr) throw credErr;
    }
  }, []);

  // ---------------------------------------------------------------- autosave
  // Salva sozinho 1,2s apos a ultima mudanca, para nada se perder.
  useEffect(() => {
    if (loading || !draft.service_id) return undefined;
    if (finalizedRef.current) return undefined;
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(async () => {
      if (savingRef.current || finalizedRef.current) return;
      savingRef.current = true;
      try {
        await saveDraft();
        setSavedAt(new Date());
        setSaveWarning('');
      } catch (err) {
        setSaveWarning(err.message);
      } finally {
        savingRef.current = false;
      }
    }, 1200);
    return () => { if (autosaveRef.current) clearTimeout(autosaveRef.current); };
  }, [draft, loading, saveDraft]);

  // ---------------------------------------------------------------- validação
  const validateStep = (stepIndex) => {
    switch (stepIndex) {
      /* 1. PLATAFORMA */
      case 0:
        if (!draft.service_id) return 'Escolha a plataforma do grupo.';
        return '';

      /* 2. PLANO — plano/tipo de conta + vagas + status da assinatura */
      case 1:
        if (plansLoading) return 'Carregando os planos da plataforma...';
        if (plans.length > 0) {
          if (!draft.plan_id) return 'Escolha o plano da plataforma que você vai compartilhar.';
        } else {
          if (!draft.custom_plan_active && !draft.plan_type) return 'Escolha o tipo de conta ou use "Personalizado".';
          if (draft.custom_plan_active && !draft.plan_type_custom.trim()) return 'Escreva o tipo de conta personalizado.';
        }
        if (!draft.max_size || draft.max_size < 1) return 'Informe quantas vagas o grupo vai abrir.';
        if (selectedPlan?.max_members && draft.max_size > selectedPlan.max_members) {
          return `Este plano permite até ${selectedPlan.max_members} vaga(s).`;
        }
        // Status da assinatura: sempre tem um valor valido (o padrao e "ja
        // assinei"), entao nao bloqueia a criacao.
        if (!draft.subscription_status) return 'Escolha se você já assinou a conta ou vai assinar depois.';
        return '';

      /* 3. GRUPO — visibilidade (as regras do grupo sao opcionais) */
      case 2:
        if (!draft.visibility) return 'Escolha se o grupo é público ou privado.';
        return '';

      /* 4. CREDENCIAIS */
      case 3:
        if (draft.credential_type === 'email_password' && !draft.login_email.trim()) return 'Informe o e-mail de acesso.';
        if (draft.credential_type !== 'email_password' && !draft.credential_extra.trim()) return 'Informe a credencial de acesso.';
        return '';

      /* 5. PAGAMENTOS — ciclos + valor do grupo */
      case 4: {
        if (!draft.available_cycles.length && !draft.custom_cycle_enabled && !draft.days_cycle_enabled) return 'Escolha ao menos um ciclo de cobrança.';
        if (draft.custom_cycle_enabled && !draft.custom_cycle_label.trim()) return 'Dê um nome ao ciclo personalizado.';
        if (draft.days_cycle_enabled && !draft.days_cycle_label.trim()) return 'Dê um nome ao ciclo de dias.';
        const total = parseFloat(draft.price_total);
        if (!(total > 0)) return 'Informe o valor total do grupo.';
        const perSlot = pricePerSlot(total, draft.max_size);
        // PISO DE R$ 5,00 POR VAGA — vale para o usuário comum. O admin da
        // plataforma controla os grupos e não passa por essa regra.
        if (!isAdmin && perSlot > 0 && perSlot < MIN_PRICE_PER_SLOT) {
          return `O valor por pessoa (R$ ${brl(perSlot)}) está abaixo do mínimo de R$ ${brl(MIN_PRICE_PER_SLOT)}.`;
        }
        // TETO DO PLANO: o min/max do plano vale por pessoa. Fora da faixa o
        // grupo nao e criado — e o que impede o dono de cobrar um valor
        // desproporcional ao plano que ele escolheu.
        if (selectedPlan) {
          const range = slotPriceOutOfRange(selectedPlan, perSlot);
          if (range.outOfRange) {
            const faixa = planSlotRangeText(selectedPlan, (v) => `R$ ${brl(v)}`);
            return `O valor por pessoa (R$ ${brl(perSlot)}) está fora da faixa do plano "${selectedPlan.name}" (${faixa}). Ajuste o valor total.`;
          }
        }
        return '';
      }

      /* 6. RESUMO — politicas */
      case 5:
        if (!draft.policies_accepted) return 'Aceite as políticas para criar o grupo.';
        return '';

      default:
        return '';
    }
  };

  const handleNext = async () => {
    const msg = validateStep(draft.step);
    setStepError(msg);
    if (msg) return;

    setSaving(true);
    setError('');
    setSaveWarning('');
    try {
      const groupId = await saveDraft();
      // a etapa de credenciais tambem fica salva no banco
      if (STEPS[draft.step].key === 'credenciais') await saveCredential(groupId, draft);
      setSavedAt(new Date());
      set({ step: Math.min(draft.step + 1, STEPS.length - 1) });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    setStepError('');
    setError('');
    set({ step: Math.max(draft.step - 1, 0) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDiscard = async () => {
    if (!window.confirm('Descartar este rascunho? As etapas preenchidas serão perdidas.')) return;
    try {
      if (draft.groupId) {
        const { error: credErr } = await supabase.from('group_credentials').delete().eq('group_id', draft.groupId);
        if (credErr) throw credErr;
        const { error: grpErr } = await supabase.from('groups').delete().eq('id', draft.groupId);
        if (grpErr) throw grpErr;
      }
      navigate('/dashboard/my-groups');
    } catch (err) {
      setError(err.message);
    }
  };

  // retoma um rascunho ja salvo (apos recarregar a pagina, por exemplo)
  const resumeOfferedDraft = () => {
    if (!draftOffer) return;
    setSearchParams({ draft: draftOffer.id });
  };

  // apaga o rascunho oferecido e comeca do zero
  const discardOfferedDraft = async () => {
    if (!draftOffer) return;
    try {
      await supabase.from('group_credentials').delete().eq('group_id', draftOffer.id);
      const { error: grpErr } = await supabase.from('groups').delete().eq('id', draftOffer.id);
      if (grpErr) throw grpErr;
      setDraftOffer(null);
      setDraft(EMPTY_DRAFT);
      setPlans([]);
      setPlansLoading(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleFinish = async () => {
    const msg = validateStep(STEPS.length - 1);
    setStepError(msg);
    if (msg) return;
    if (!user?.id) { setError('Usuário não autenticado'); return; }

    setSaving(true);
    setError('');
    setSaveWarning('');
    // trava o autosave: a partir daqui o grupo esta sendo finalizado
    finalizedRef.current = true;
    if (autosaveRef.current) { clearTimeout(autosaveRef.current); autosaveRef.current = null; }
    try {
      const groupId = await saveDraft();

      // credencial de acesso
      await saveCredential(groupId, draft);

      // finaliza: pendente de aprovacao pela plataforma.
      // Quem ainda vai assinar a conta ("Vou Assinar") deixa o grupo em
      // FORMACAO (status 'forming') — ele aparece no catalogo como "Formando"
      // e vira 'open' quando o dono confirmar a assinatura.
      const finalStatus = groupStatusForSubscription(draft.subscription_status, 'open');

      const { error: finalErr } = await supabase
        .from('groups')
        .update({ status: finalStatus, approval_status: 'pending' })
        .eq('id', groupId);
      if (finalErr) throw finalErr;

      // confere de verdade: se o status nao virar 'open'/'forming', o grupo
      // ficaria invisivel no catalogo (que filtra status IN ('open','forming'))
      const { data: check } = await supabase.from('groups').select('status').eq('id', groupId).maybeSingle();
      if (!check || !['open', 'forming'].includes(check.status)) {
        throw new Error('O grupo foi salvo, mas não foi publicado. Verifique as permissões do grupo.');
      }

      try {
        const groupName = buildGroupName({ platform, plan: selectedPlan, groupId });
        const { error: evErr } = await supabase.from('platform_events').insert({
          event_type: 'group_created',
          title: 'Grupo criado',
          message: `${user?.name || 'Usuário'} criou o grupo "${groupName}".`,
          metadata: JSON.stringify({ group_id: groupId, group_name: groupName, owner_id: user.id }),
          created_by: user.id,
        });
        if (evErr) console.warn('Platform event nao registrado:', evErr.message);
      } catch (e) { console.warn('Platform event nao registrado:', e); }

      // E-mail gerenciado com IA: agora que o grupo existe, a caixa de e-mail
      // dele e criada no servidor. O dono cai direto na tela "Gerenciar Grupo",
      // onde ve o endereco e o passo a passo para trocar o e-mail da conta da
      // plataforma pelo e-mail do grupo.
      if (draft.managed_email) {
        const prov = await provisionarEmailGerenciado(groupId);
        if (!prov.success) {
          console.warn('E-mail gerenciado nao criado:', prov.error);
          // Sem caixa nao ha busca de codigo: desliga para o membro nao ver
          // um botao quebrado. A tela "Gerenciar Grupo" deixa criar de novo.
          await supabase
            .from('groups')
            .update({ email_code_enabled: false, email_code_method: null })
            .eq('id', groupId);
        }
        navigate(`/dashboard/my-groups/${groupId}/manage`);
        return;
      }

      navigate('/dashboard/my-groups');
    } catch (err) {
      setError(err.message);
      finalizedRef.current = false;
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------ handlers das etapas
  const handlePlatformConfirm = (service) => {
    setPlans([]);
    setPlansLoading(true);
    set({
      service_id: service.id,
      // trocar de plataforma zera o plano e o preco (o teto muda junto)
      plan_id: '',
      plan_type: '',
      plan_type_custom: '',
      custom_plan_active: false,
      price_per_slot: '',
      max_size: 4,
      has_slot_limit: false,
      step: 1,
    });
    setStepError('');
  };

  const handlePlanChange = (patch) => {
    // Ao escolher um plano, o preco e o limite de vagas seguem o plano.
    const next = { ...patch };
    if (patch.plan_id && patch.plan_id !== draft.plan_id) {
      const plan = plans.find(p => p.id === patch.plan_id);
      if (plan) {
        const maxSlots = maxSlotsFor(plan, platform);
        // Total do grupo: valor sugerido do plano (por pessoa) x vagas; sem
        // sugestao, o preco oficial do plano + 8%.
        // Plano sem max_members nao impõe vagas: o total usa as vagas que o
        // dono abriu (ou o padrao), senão o preco por pessoa sai errado.
        const slots = plan.max_members
          ? maxSlots
          : (parseInt(draft.max_size, 10) || 4);
        next.price_total = String(suggestedGroupTotal(plan, slots));
        if (plan.max_members) {
          next.max_size = maxSlots;
          next.has_slot_limit = true;
        }
      }
    }
    setDraft(prev => ({ ...prev, ...next }));
  };

  const platformName = platform?.full_name || platform?.name || '—';
  const groupNamePreview = buildGroupName({ platform, plan: selectedPlan, groupId: draft.groupId });

  const summaryItems = [
    { label: 'Plataforma', value: platformName },
    { label: 'Nome do grupo', value: groupNamePreview },
    { label: 'Plano', value: selectedPlan?.name || (draft.custom_plan_active ? draft.plan_type_custom : (draft.plan_type || '—')) },
    { label: 'Vagas', value: `${draft.max_size} membro(s)` },
    {
      label: 'Status da assinatura',
      value: draft.subscription_status === SUBSCRIPTION_PENDING
        ? 'Vou assinar (grupo fica em formação)'
        : 'Já assinei (conta ativa)',
    },
    { label: 'Chat do grupo', value: draft.chat_enabled === false ? 'Desligado' : 'Ligado' },
    {
      label: 'E-mail gerenciado com IA',
      value: draft.managed_email === true ? 'Ligado' : 'Desligado',
    },
    { label: 'Visibilidade', value: draft.visibility === 'private' ? 'Privado (só convite/link)' : 'Público' },
    { label: 'Ciclos', value: [...draft.available_cycles, ...(draft.custom_cycle_enabled ? ['personalizado'] : []), ...(draft.days_cycle_enabled ? ['dias'] : [])].join(', ') || '—' },
    { label: 'Regrinhas', value: rulesSummary(draft.rules) },
    { label: 'PIX', value: draft.pix_key ? `${draft.pix_key} (${draft.pix_type})` : '—' },
    { label: 'Taxa de adesão', value: `R$ ${brl(parseFloat(draft.entrance_fee) || 0)}` },
    { label: 'Total do grupo', value: `R$ ${brl(parseFloat(draft.price_total) || 0)}` },
    { label: 'Cada membro paga', value: `R$ ${brl(pricePerSlot(draft.price_total, draft.max_size))} / mês` },
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
    <div className="fade-in create-group-page wizard-page">
      <button onClick={() => navigate('/dashboard/my-groups')} className="back-btn">
        <ArrowLeft size={18} />
        Voltar
      </button>

      <div className="page-header">
        <h1>Criar Grupo</h1>
        <p>{STEPS.length} etapas rápidas. O que você preencher vai sendo salvo sozinho.</p>
      </div>

      <WizardSteps
        steps={STEPS}
        current={draft.step}
        onNavigate={(i) => { if (i <= draft.step) { setStepError(''); setError(''); set({ step: i }); } }}
      />

      {error && <div className="error-banner">{error}</div>}

      {draftOffer && !draft.groupId && (
        <div className="wizard-resume">
          <Info size={18} />
          <div className="wizard-resume-text">
            <strong>Você tem um rascunho em andamento</strong>
            <span>
              “{draftOffer.name}” foi salvo automaticamente. Continue de onde parou ou comece do zero.
            </span>
          </div>
          <div className="wizard-resume-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={resumeOfferedDraft}>
              Continuar
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={discardOfferedDraft}>
              Começar do zero
            </button>
          </div>
        </div>
      )}

      <div className="wizard-card">
        <div className="wizard-card-head">
          <span className="wizard-eyebrow">
            <StepIcon size={16} /> Etapa {draft.step + 1} de {STEPS.length}
          </span>
          <h2>{STEP_COPY[currentStep.key].title}</h2>
          <p className="section-desc">{STEP_COPY[currentStep.key].desc}</p>
        </div>

        <div className="wizard-card-body">
          {/* ---------------------------------------------------- 1. PLATAFORMA */}
          {draft.step === 0 && (
            <PlatformSearchStep
              services={services}
              usage={usage}
              selectedId={draft.service_id}
              onConfirm={handlePlatformConfirm}
            />
          )}

          {/* --------------------- 2. PLANO (tipo de conta) + VAGAS + ASSINATURA */}
          {draft.step === 1 && (
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
                    plan_id: draft.plan_id,
                    plan_type: draft.plan_type,
                    plan_type_custom: draft.plan_type_custom,
                    custom_plan_active: draft.custom_plan_active,
                    has_ads: draft.has_ads,
                  }}
                  onChange={handlePlanChange}
                  hasAdsColumn={hasAdsColumn}
                />
              )}

              {!plansLoading && (
                <>
                  <SlotsStep
                    value={{ slots: draft.max_size }}
                    onChange={(patch) => setDraft(prev => {
                      const slots = patch.slots;
                      const next = { ...prev, max_size: slots, has_slot_limit: true };
                      /* Se o total veio do plano (o dono nao mexeu no valor), ele
                         acompanha o numero de vagas. Sem isso, abrir/fechar uma vaga
                         empurraria o preco por pessoa para fora da faixa do plano e a
                         criacao ficaria bloqueada sem o dono ter feito nada de
                         errado. */
                      if (selectedPlan) {
                        const before = suggestedGroupTotal(selectedPlan, prev.max_size);
                        if (!prev.price_total || Number(prev.price_total) === before) {
                          next.price_total = String(suggestedGroupTotal(selectedPlan, slots));
                        }
                      }
                      return next;
                    })}
                    plan={selectedPlan}
                    service={platform}
                  />

                  <SubscriptionStatusStep
                    value={draft.subscription_status}
                    onChange={(v) => set({ subscription_status: v })}
                  />
                </>
              )}
            </>
          )}

          {/* ---------------------------------- 3. GRUPO: VISIBILIDADE + REGRAS */}
          {draft.step === 2 && (
            <>
              <VisibilityStep
                value={draft.visibility}
                onChange={(v) => set({ visibility: v })}
              />

              {/* As REGRAS do grupo (opcional) ocupam o lugar que era da
                  descrição do grupo — o campo é livre e aparece para o membro. */}
              <RuleTypesField
                value={draft.rules}
                onChange={(patch) => setDraft(prev => ({ ...prev, ...patch }))}
              />
            </>
          )}

          {/* ------------------------------------------------ 4. CREDENCIAIS */}
          {draft.step === 3 && (
            <>
              <CredentialsStep
                value={{
                  credential_type: draft.credential_type,
                  login_email: draft.login_email,
                  login_password: draft.login_password,
                  credential_extra: draft.credential_extra,
                  credential_notes: draft.credential_notes,
                  chat_enabled: draft.chat_enabled,
                }}
                onChange={(patch) => setDraft(prev => ({ ...prev, ...patch }))}
              />

              {/* O e-mail gerenciado com IA e uma escolha do DONO do grupo:
                  ele cria a caixa e troca o e-mail da conta da plataforma. */}
              <ManagedEmailOption
                value={{ managed_email: draft.managed_email }}
                onChange={(patch) => setDraft(prev => ({ ...prev, ...patch }))}
                serviceName={platformName}
              />
            </>
          )}

          {/* ------------------------------------------------- 5. PAGAMENTOS */}
          {draft.step === 4 && (
            <>
              <BillingStep
                value={{
                  available_cycles: draft.available_cycles,
                  custom_cycle_enabled: draft.custom_cycle_enabled,
                  custom_cycle_months: draft.custom_cycle_months,
                  custom_cycle_label: draft.custom_cycle_label,
                  days_cycle_enabled: draft.days_cycle_enabled,
                  days_cycle_days: draft.days_cycle_days,
                  days_cycle_label: draft.days_cycle_label,
                }}
                onChange={(patch) => setDraft(prev => ({ ...prev, ...patch }))}
              />

              <PaymentStep
                value={{
                  pix_key: draft.pix_key,
                  pix_type: draft.pix_type,
                  entrance_fee: draft.entrance_fee,
                  price_total: draft.price_total,
                  slots: draft.max_size,
                }}
                onChange={(patch) => setDraft(prev => ({ ...prev, ...patch }))}
                plan={selectedPlan}
                hasPixColumn={hasPixColumn}
              />
            </>
          )}

          {/* ---------------------------------------------------- 6. RESUMO */}
          {draft.step === 5 && (
            <SummaryStep
              items={summaryItems}
              policiesAccepted={draft.policies_accepted}
              onPoliciesChange={(v) => set({ policies_accepted: v })}
              notice={
                draft.subscription_status === SUBSCRIPTION_PENDING
                  ? 'Seu grupo ficará EM FORMAÇÃO até você confirmar a assinatura da conta. Depois disso ele abre para os membros.'
                  : 'Seu grupo ficará pendente de aprovação pela equipe DividePass antes de ficar visível no catálogo.'
              }
            />
          )}
        </div>

        {stepError && <div className="wizard-step-error">{stepError}</div>}
        {saveWarning && <div className="wizard-step-error">{saveWarning}</div>}

        <div className="wizard-foot">
          <div className="wizard-foot-left">
            {draft.step > 0 && (
              <button type="button" className="btn btn-outline" onClick={handleBack} disabled={saving}>
                <ArrowLeft size={16} /> Voltar
              </button>
            )}
            {draft.groupId && (
              <button type="button" className="btn btn-ghost btn-danger-text" onClick={handleDiscard} disabled={saving}>
                <Trash2 size={16} /> Descartar rascunho
              </button>
            )}
          </div>

          <div className="wizard-foot-right">
            {savedAt && (
              <span className="wizard-saved">
                <CheckCircle2 size={14} /> Salvo {savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {!isLast ? (
              <button type="button" className="btn btn-primary" onClick={handleNext} disabled={saving}>
                {saving ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />} Continuar
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={handleFinish} disabled={saving}>
                {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />} Criar grupo
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreateGroup;
