import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Loader2, Save, Info, Mail, Link, Hash, MessageSquare,
  Settings, Camera, Check, Sparkles, Tv, Crown, CalendarDays, KeyRound, QrCode,
  Trash2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { simulatePrice, brl, MIN_PRICE_PER_SLOT } from '../../lib/platformFee';
import { hasAdsColumnAvailable, isMissingHasAdsColumn } from '../../lib/groupHasAds';
import AdsToggle from '../../components/AdsToggle';
import {
  PIX_TYPE_OPTIONS as PIX_TYPES, pixTypePlaceholder, maskPixKey, unmaskPixKey, remaskPixKey,
} from '../../lib/pixKeyMask';
import './CreateGroup.css';

const PLAN_TYPES = [
  'Conta Individual', 'Conta Padrão', 'Conta Premium', 'Conta VIP', 'Conta Go',
  'Conta Light', 'Conta Enterprise', 'Conta Team', 'Conta PRO', 'Conta PRO+',
  'Conta PLUS', 'Conta MAX', 'Conta Educação', 'Conta Duo', 'Conta Família',
];

const CRED_TYPES = [
  { value: 'email_password', icon: Mail, label: 'E-mail + Senha' },
  { value: 'link', icon: Link, label: 'Link de Acesso' },
  { value: 'code', icon: Hash, label: 'Código' },
  { value: 'invite', icon: MessageSquare, label: 'Convite' },
  { value: 'custom', icon: Settings, label: 'Personalizado' },
];

const CYCLE_OPTIONS = [
  { value: 'monthly', label: 'Mensal' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'semiannual', label: 'Semestral' },
  { value: 'annual', label: 'Anual' },
];

const STEPS = [
  { key: 'servico', title: 'Plataforma', icon: Tv },
  { key: 'identidade', title: 'Identidade', icon: Sparkles },
  { key: 'plano', title: 'Plano', icon: Crown },
  { key: 'cobranca', title: 'Cobrança', icon: CalendarDays },
  { key: 'credenciais', title: 'Credenciais', icon: KeyRound },
  { key: 'pagamento', title: 'Pagamento', icon: QrCode },
];

const STEP_COPY = {
  servico: {
    title: 'Qual plataforma o grupo vai compartilhar?',
    desc: 'É o serviço cujas credenciais os membros vão usar.',
  },
  identidade: {
    title: 'Como o grupo vai se chamar?',
    desc: 'Esse nome aparece no catálogo e para os membros.',
  },
  plano: {
    title: 'Que tipo de conta você compartilha?',
    desc: 'Ajuda os membros a saber o que vão receber.',
  },
  cobranca: {
    title: 'Como os membros vão pagar?',
    desc: 'Escolha os ciclos que os membros poderão contratar.',
  },
  credenciais: {
    title: 'Como os membros acessam a conta?',
    desc: 'Os membros acessam a conta por aqui — você pode mudar depois.',
  },
  pagamento: {
    title: 'Como o dinheiro chega até você?',
    desc: 'Última etapa: PIX, taxa de adesão e o valor da mensalidade.',
  },
};

const EMPTY_DRAFT = {
  groupId: null,
  step: 0,
  service_id: '',
  name: '',
  description: '',
  plan_type: '',
  plan_type_custom: '',
  custom_plan_active: false,
  has_ads: null,
  available_cycles: ['monthly'],
  custom_cycle_enabled: false,
  custom_cycle_months: 2,
  custom_cycle_label: '',
  days_cycle_enabled: false,
  days_cycle_days: 15,
  days_cycle_label: '',
  has_slot_limit: false,
  max_size: 4,
  rules: '',
  credential_type: 'email_password',
  login_email: '',
  login_password: '',
  credential_extra: '',
  credential_notes: '',
  pix_key: '',
  pix_type: 'cpf',
  entrance_fee: 15,
  price_per_slot: '',
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
function inferStep({ service_id, name, plan_type, plan_type_custom, hasCredential }) {
  if (!service_id) return 0;
  if (!name) return 1;
  if (!plan_type && !plan_type_custom) return 2;
  if (!hasCredential) return 3;   // ainda falta fechar cobranca + credenciais
  return 5;                        // credenciais salvas: falta so o pagamento
}

function CreateGroup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const draftIdParam = searchParams.get('draft');

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [saveWarning, setSaveWarning] = useState('');
  const [error, setError] = useState('');
  const [stepError, setStepError] = useState('');
  const [hasPixColumn, setHasPixColumn] = useState(true);
  const [hasAdsColumn, setHasAdsColumn] = useState(true);
  const [defaultEntranceFee, setDefaultEntranceFee] = useState(15);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [draftOffer, setDraftOffer] = useState(null);

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const fileInputRef = useRef(null);
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
        const [servicesRes, settingsRes] = await Promise.all([
          supabase.from('streaming_services').select('id, name, full_name, icon, icon_url, color, slug').eq('status', 'active').order('name'),
          supabase.from('app_settings').select('key, value').in('key', ['default_entrance_fee']),
        ]);
        if (cancelled) return;

        if (servicesRes.error) throw servicesRes.error;
        setServices(servicesRes.data || []);

        const fee = settingsRes.data?.find(s => s.key === 'default_entrance_fee');
        const feeValue = fee ? (parseFloat(fee.value) || 15) : 15;
        setDefaultEntranceFee(feeValue);

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

        // retomar rascunho
        if (draftIdParam) {
          const { data: g } = await supabase.from('groups').select('*').eq('id', draftIdParam).maybeSingle();
          if (g) {
            const { data: cred } = await supabase.from('group_credentials').select('*').eq('group_id', g.id).maybeSingle();
            const cycles = g.available_cycles || ['monthly'];
            const credType = cred?.credential_type || 'email_password';
            const realName = g.name === 'Rascunho de grupo' ? '' : (g.name || '');
            setDraft({
              ...EMPTY_DRAFT,
              groupId: g.id,
              service_id: g.service_id || '',
              name: realName,
              description: g.description || '',
              plan_type: g.plan_type || '',
              plan_type_custom: g.plan_type_custom || '',
              custom_plan_active: !!(g.plan_type_custom && !g.plan_type),
              has_ads: g.has_ads === true ? true : (g.has_ads === false ? false : null),
              available_cycles: cycles.filter(c => c !== 'custom' && c !== 'days'),
              custom_cycle_enabled: cycles.includes('custom'),
              custom_cycle_months: g.custom_cycle_months || 2,
              custom_cycle_label: g.custom_cycle_label || '',
              days_cycle_enabled: cycles.includes('days'),
              days_cycle_days: g.custom_cycle_days || 15,
              days_cycle_label: g.custom_cycle_label || '',
              has_slot_limit: !!g.has_slot_limit,
              max_size: g.max_size || 4,
              rules: g.rules || '',
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
                name: realName,
                plan_type: g.plan_type,
                plan_type_custom: g.plan_type_custom,
                hasCredential: !!cred,
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

  const currentStep = STEPS[draft.step] || STEPS[0];
  const StepIcon = currentStep.icon;
  const isLast = draft.step === STEPS.length - 1;

  // ---------------------------------------------------------------- simulação
  const priceSimulation = useMemo(() => {
    const sim = simulatePrice(draft.price_per_slot);
    return { ...sim, entrance: parseFloat(draft.entrance_fee) || 0 };
  }, [draft.price_per_slot, draft.entrance_fee]);

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
      name: draft.name || 'Rascunho de grupo',
      description: draft.description || null,
      price_per_slot: parseFloat(draft.price_per_slot) || 0.01,
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
    return payload;
  };

  const saveDraft = useCallback(async () => {
    if (!user?.id) throw new Error('Usuário não autenticado');
    const payload = buildGroupPayload();

    if (!draft.groupId) {
      let { data, error: insErr } = await supabase
        .from('groups')
        .insert({ ...payload, status: 'draft', owner_id: user.id, verified: false, is_official: false, approval_status: null })
        .select('id')
        .single();
      if (insErr && hasAdsColumn && isMissingHasAdsColumn(insErr)) {
        // o banco ainda nao tem a coluna has_ads: refaz sem o campo
        const semAds = { ...payload };
        delete semAds.has_ads;
        setHasAdsColumn(false);
        const retry = await supabase
          .from('groups')
          .insert({ ...semAds, status: 'draft', owner_id: user.id, verified: false, is_official: false, approval_status: null })
          .select('id')
          .single();
        data = retry.data;
        insErr = retry.error;
      }
      if (insErr) throw insErr;
      const { error: slugErr } = await supabase
        .from('groups')
        .update({ slug: data.id.slice(0, 6).toUpperCase() })
        .eq('id', data.id);
      if (slugErr) throw slugErr;
      set({ groupId: data.id });
      // Agora existe um grupo do usuário: a sonda consegue provar se a coluna
      // has_ads existe no banco e liberar o seletor da etapa 3.
      if (!hasAdsColumn) {
        const ok = await hasAdsColumnAvailable();
        if (ok) setHasAdsColumn(true);
      }
      return data.id;
    }

    const { error: updErr } = await supabase.from('groups').update(payload).eq('id', draft.groupId);
    if (updErr && hasAdsColumn && isMissingHasAdsColumn(updErr)) {
      const semAds = { ...payload };
      delete semAds.has_ads;
      setHasAdsColumn(false);
      const retry = await supabase.from('groups').update(semAds).eq('id', draft.groupId);
      if (retry.error) throw retry.error;
      return draft.groupId;
    }
    if (updErr) throw updErr;
    return draft.groupId;
  }, [draft, user, hasPixColumn, hasAdsColumn, set]);

  // grava (ou atualiza) a credencial de acesso — chamado ao sair da etapa 5
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
      case 0:
        if (!draft.service_id) return 'Escolha a plataforma do grupo.';
        return '';
      case 1:
        if (!draft.name.trim()) return 'Dê um nome ao grupo.';
        if (draft.name.trim().length < 3) return 'O nome precisa ter ao menos 3 caracteres.';
        return '';
      case 2:
        if (!draft.custom_plan_active && !draft.plan_type) return 'Escolha o tipo de conta ou use "Personalizado".';
        if (draft.custom_plan_active && !draft.plan_type_custom.trim()) return 'Escreva o tipo de conta personalizado.';
        return '';
      case 3:
        if (!draft.available_cycles.length && !draft.custom_cycle_enabled && !draft.days_cycle_enabled) return 'Escolha ao menos um ciclo de cobrança.';
        if (draft.custom_cycle_enabled && !draft.custom_cycle_label.trim()) return 'Dê um nome ao ciclo personalizado.';
        if (draft.days_cycle_enabled && !draft.days_cycle_label.trim()) return 'Dê um nome ao ciclo de dias.';
        return '';
      case 4:
        if (draft.credential_type === 'email_password' && !draft.login_email.trim()) return 'Informe o e-mail de acesso.';
        if (draft.credential_type !== 'email_password' && !draft.credential_extra.trim()) return 'Informe a credencial de acesso.';
        return '';
      case 5:
        if (!(parseFloat(draft.price_per_slot) > 0)) return 'Informe quanto você vai cobrar por transação.';
        if (parseFloat(draft.price_per_slot) < MIN_PRICE_PER_SLOT) {
          return `O valor mínimo por transação é R$ ${brl(MIN_PRICE_PER_SLOT)}.`;
        }
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
      if (draft.step === 4) await saveCredential(groupId, draft);
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
    } catch (err) {
      setError(err.message);
    }
  };

  const handleFinish = async () => {
    const msg = validateStep(5);
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

      // finaliza: pendente de aprovacao pela plataforma
      const { error: finalErr } = await supabase
        .from('groups')
        .update({ status: 'open', approval_status: 'pending' })
        .eq('id', groupId);
      if (finalErr) throw finalErr;

      // confere de verdade: se o status nao virou 'open', o grupo ficaria
      // invisivel no catalogo (que filtra status IN ('open','forming'))
      const { data: check } = await supabase.from('groups').select('status').eq('id', groupId).maybeSingle();
      if (check?.status !== 'open') {
        throw new Error('O grupo foi salvo, mas não foi publicado. Verifique as permissões do grupo.');
      }

      // foto (nao bloqueia a criacao do grupo)
      if (photoFile) {
        try {
          const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase();
          const photoPath = `${groupId}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from('group-covers').upload(photoPath, photoFile, { upsert: true });
          if (uploadError) throw uploadError;
          const { data: urlData } = supabase.storage.from('group-covers').getPublicUrl(photoPath);
          await supabase.from('groups').update({ photo_url: urlData.publicUrl }).eq('id', groupId);
        } catch (photoErr) {
          console.error('Falha no upload da foto:', photoErr);
          setSaveWarning('O grupo foi criado, mas a foto não pôde ser enviada.');
        }
      }

      try {
        const { error: evErr } = await supabase.from('platform_events').insert({
          event_type: 'group_created',
          title: 'Grupo criado',
          message: `${user?.name || 'Usuário'} criou o grupo "${draft.name}".`,
          metadata: JSON.stringify({ group_id: groupId, group_name: draft.name, owner_id: user.id }),
          created_by: user.id,
        });
        if (evErr) console.warn('Platform event nao registrado:', evErr.message);
      } catch (e) { console.warn('Platform event nao registrado:', e); }

      navigate('/dashboard/my-groups');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleCycle = (cycle) => {
    setDraft(prev => {
      const current = prev.available_cycles || [];
      const updated = current.includes(cycle) ? current.filter(c => c !== cycle) : [...current, cycle];
      return { ...prev, available_cycles: updated.length ? updated : current };
    });
  };

  const serviceName = services.find(s => s.id === draft.service_id)?.full_name
    || services.find(s => s.id === draft.service_id)?.name || '—';

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

      {/* trilha de etapas */}
      <ol className="wizard-steps">
        {STEPS.map((s, i) => {
          const done = i < draft.step;
          const active = i === draft.step;
          return (
            <li key={s.key} className={`wizard-step ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
              <button
                type="button"
                className="wizard-step-btn"
                onClick={() => { if (i <= draft.step) { setStepError(''); setError(''); set({ step: i }); } }}
                disabled={i > draft.step}
              >
                <span className="wizard-step-dot">{done ? <Check size={14} /> : i + 1}</span>
                <span className="wizard-step-label">{s.title}</span>
              </button>
            </li>
          );
        })}
      </ol>

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
            <div className="service-picker">
              {services.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`service-pick ${draft.service_id === s.id ? 'active' : ''}`}
                  onClick={() => set({ service_id: s.id })}
                >
                  {s.icon_url
                    ? <img src={s.icon_url} alt="" />
                    : <span className="service-pick-fallback" style={{ background: s.color || 'var(--primary)' }}>{s.name?.[0]}</span>}
                  <span className="service-pick-name">{s.full_name || s.name}</span>
                  {draft.service_id === s.id && <Check size={16} className="service-pick-check" />}
                </button>
              ))}
            </div>
          )}

          {/* ---------------------------------------------------- 2. IDENTIDADE */}
          {draft.step === 1 && (
            <>
              <div className="form-group">
                <label>Nome do grupo *</label>
                <input
                  value={draft.name}
                  onChange={e => set({ name: e.target.value })}
                  placeholder="Ex: Netflix - Grupo Premium"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Descrição (opcional)</label>
                <textarea
                  rows={2}
                  value={draft.description}
                  onChange={e => set({ description: e.target.value })}
                  placeholder="Em 1 linha: o que os membros vão encontrar nesse grupo."
                />
              </div>
              <div className="form-group">
                <label>Foto do grupo (opcional)</label>
                <div className="group-photo-upload">
                  {photoPreview ? (
                    <div className="photo-preview">
                      <img src={photoPreview} alt="Preview" />
                      <button type="button" className="photo-remove" onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}>x</button>
                    </div>
                  ) : (
                    <label className="photo-placeholder">
                      <Camera size={24} />
                      <span>Adicionar foto</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) { setPhotoFile(file); setPhotoPreview(URL.createObjectURL(file)); }
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ---------------------------------------------------- 3. PLANO */}
          {draft.step === 2 && (
            <>
              <div className="plan-type-grid">
                {PLAN_TYPES.map(pt => (
                  <button
                    key={pt}
                    type="button"
                    className={`plan-type-btn ${!draft.custom_plan_active && draft.plan_type === pt ? 'active' : ''}`}
                    onClick={() => set({ plan_type: pt, custom_plan_active: false })}
                  >
                    {pt}
                  </button>
                ))}
                <button
                  type="button"
                  className={`plan-type-btn custom ${draft.custom_plan_active ? 'active' : ''}`}
                  onClick={() => set({ custom_plan_active: true, plan_type: '' })}
                >
                  Personalizado
                </button>
              </div>
              {draft.custom_plan_active && (
                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label>Tipo de conta personalizado *</label>
                  <input
                    value={draft.plan_type_custom}
                    onChange={e => set({ plan_type_custom: e.target.value })}
                    placeholder="Ex: Netflix Premium 4K"
                    autoFocus
                  />
                </div>
              )}

              {hasAdsColumn && (
                <div className="form-group ads-field">
                  <label>A conta compartilhada tem anúncios?</label>
                  <AdsToggle
                    value={draft.has_ads}
                    onChange={(v) => set({ has_ads: v })}
                    hint="O membro vê esse selo no card do grupo. Se preferir não informar, escolha “Não mostrar” e o grupo fica sem selo."
                  />
                </div>
              )}
            </>
          )}

          {/* ---------------------------------------------------- 4. COBRANCA */}
          {draft.step === 3 && (
            <>
              <div className="form-group">
                <label>Ciclos que os membros podem escolher *</label>
                <div className="cycles-grid">
                  {CYCLE_OPTIONS.map(opt => (
                    <label key={opt.value} className={`cycle-check ${draft.available_cycles.includes(opt.value) ? 'active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={draft.available_cycles.includes(opt.value)}
                        onChange={() => toggleCycle(opt.value)}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                  <label className={`cycle-check ${draft.days_cycle_enabled ? 'active' : ''}`}>
                    <input type="checkbox" checked={draft.days_cycle_enabled} onChange={e => set({ days_cycle_enabled: e.target.checked })} />
                    <span>Dias</span>
                  </label>
                  <label className={`cycle-check ${draft.custom_cycle_enabled ? 'active' : ''}`}>
                    <input type="checkbox" checked={draft.custom_cycle_enabled} onChange={e => set({ custom_cycle_enabled: e.target.checked })} />
                    <span>Personalizado</span>
                  </label>
                </div>
              </div>

              {draft.days_cycle_enabled && (
                <div className="custom-cycle-fields">
                  <div className="form-group">
                    <label>Quantidade de dias *</label>
                    <input type="number" min="1" max="365" value={draft.days_cycle_days} onChange={e => set({ days_cycle_days: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Nome do ciclo *</label>
                    <input value={draft.days_cycle_label} onChange={e => set({ days_cycle_label: e.target.value })} placeholder="Ex: 15 dias" />
                  </div>
                </div>
              )}

              {draft.custom_cycle_enabled && (
                <div className="custom-cycle-fields">
                  <div className="form-group">
                    <label>Meses do ciclo *</label>
                    <input type="number" min="1" max="36" value={draft.custom_cycle_months} onChange={e => set({ custom_cycle_months: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Nome do ciclo *</label>
                    <input value={draft.custom_cycle_label} onChange={e => set({ custom_cycle_label: e.target.value })} placeholder="Ex: Bimestral" />
                  </div>
                </div>
              )}

              <div className="toggle-section">
                <label className="toggle-label">
                  <input type="checkbox" checked={draft.has_slot_limit} onChange={e => set({ has_slot_limit: e.target.checked })} />
                  <span className="toggle-switch" />
                  <span className="toggle-text">
                    <strong>Limitar vagas</strong>
                    <small>Defina um limite de membros no grupo</small>
                  </span>
                </label>
              </div>

              {draft.has_slot_limit && (
                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label>Limite de vagas *</label>
                  <input type="number" min="1" value={draft.max_size} onChange={e => set({ max_size: e.target.value })} />
                </div>
              )}

              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label>Regras do grupo (opcional)</label>
                <textarea
                  rows={3}
                  value={draft.rules}
                  onChange={e => set({ rules: e.target.value })}
                  placeholder="Ex: Não compartilhar a senha; usar apenas 1 tela."
                />
              </div>
            </>
          )}

          {/* ---------------------------------------------------- 5. CREDENCIAIS */}
          {draft.step === 4 && (
            <>
              <div className="cred-type-grid">
                {CRED_TYPES.map(opt => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`cred-type-btn ${draft.credential_type === opt.value ? 'active' : ''}`}
                      onClick={() => set({ credential_type: opt.value, credential_extra: '' })}
                    >
                      <Icon size={16} />
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              {draft.credential_type === 'email_password' && (
                <div className="form-grid">
                  <div className="form-group">
                    <label>E-mail de acesso *</label>
                    <input value={draft.login_email} onChange={e => set({ login_email: e.target.value })} placeholder="conta@plataforma.com" autoFocus />
                  </div>
                  <div className="form-group">
                    <label>Senha de acesso</label>
                    <input value={draft.login_password} onChange={e => set({ login_password: e.target.value })} placeholder="Senha aqui" />
                  </div>
                </div>
              )}

              {draft.credential_type === 'link' && (
                <div className="form-group">
                  <label>Link de acesso *</label>
                  <input value={draft.credential_extra} onChange={e => set({ credential_extra: e.target.value })} placeholder="https://..." autoFocus />
                </div>
              )}

              {draft.credential_type === 'code' && (
                <div className="form-group">
                  <label>Código de acesso *</label>
                  <input value={draft.credential_extra} onChange={e => set({ credential_extra: e.target.value })} placeholder="Ex: ABCD-1234" autoFocus />
                </div>
              )}

              {draft.credential_type === 'invite' && (
                <div className="form-group">
                  <label>Link de convite *</label>
                  <input value={draft.credential_extra} onChange={e => set({ credential_extra: e.target.value })} placeholder="https://..." autoFocus />
                </div>
              )}

              {draft.credential_type === 'custom' && (
                <div className="form-group">
                  <label>Instruções de acesso *</label>
                  <textarea rows={3} value={draft.credential_extra} onChange={e => set({ credential_extra: e.target.value })} placeholder="Descreva ou cole a credencial de acesso..." autoFocus />
                </div>
              )}

              {draft.credential_type !== 'custom' && (
                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label>Observações (opcional)</label>
                  <textarea rows={2} value={draft.credential_notes} onChange={e => set({ credential_notes: e.target.value })} placeholder="Ex: Não compartilhar; usar apenas 1 tela." />
                </div>
              )}
            </>
          )}

          {/* ---------------------------------------------------- 6. PAGAMENTO */}
          {draft.step === 5 && (
            <>
              <div className="form-group">
                <label>PIX para transferir o valor *</label>
                <input
                  value={draft.pix_key}
                  onChange={e => set({ pix_key: maskPixKey(e.target.value, draft.pix_type) })}
                  placeholder={pixTypePlaceholder(draft.pix_type)}
                  inputMode={draft.pix_type === 'email' || draft.pix_type === 'random' ? 'text' : 'numeric'}
                  autoFocus
                />
                <div className="pix-type-row">
                  {PIX_TYPES.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      className={`pix-type-btn ${draft.pix_type === t.value ? 'active' : ''}`}
                      onClick={() => set({
                        pix_key: remaskPixKey(draft.pix_key, draft.pix_type, t.value),
                        pix_type: t.value,
                      })}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {!hasPixColumn && (
                  <div className="wizard-warn">
                    <Info size={15} />
                    <span>
                      A coluna <code>pix_key</code> ainda não existe no banco, então a chave não será gravada.
                      Aplique a migration <code>database/add-group-pix.sql</code> no SQL Editor do Supabase para gravar a chave PIX do grupo.
                    </span>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Taxa de Adesão (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={draft.entrance_fee}
                  readOnly
                  disabled
                  title="Definido pela DividePass"
                />
                <div className="wizard-info">
                  <Info size={15} />
                  <span>
                    A <strong>taxa de adesão é cobrada pela plataforma a cada novo usuário que entra no grupo</strong>,
                    uma única vez por membro. Depois da entrada, o membro paga somente o valor mensal.
                    Valor atual definido pela DividePass: <strong>R$ {brl(defaultEntranceFee)}</strong> —
                    não pode ser alterado na criação do grupo.
                  </span>
                </div>
              </div>

              <div className="form-group">
                <label>Valor cobrado por transação (R$) *</label>
                <input
                  type="number"
                  step="0.01"
                  min={MIN_PRICE_PER_SLOT}
                  value={draft.price_per_slot}
                  onChange={e => set({ price_per_slot: e.target.value })}
                  placeholder={brl(MIN_PRICE_PER_SLOT)}
                />
                <small className="field-hint">
                  Valor que cada membro paga em cada ciclo contratado. Mínimo de R$ {brl(MIN_PRICE_PER_SLOT)}.
                </small>
              </div>

              {priceSimulation.price > 0 && (
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
                  <small className="sim-footnote">
                    Simulação de um ciclo mensal. O valor da plataforma é o que a DividePass retém a cada pagamento.
                  </small>
                </div>
              )}

              {priceSimulation.belowMinimum && (
                <div className="wizard-warn">
                  <Info size={15} />
                  <span>
                    O valor mínimo aceito pela plataforma é R$ {brl(MIN_PRICE_PER_SLOT)} por transação.
                  </span>
                </div>
              )}

              <div className="wizard-summary">
                <h3>Resumo do grupo</h3>
                <ul>
                  <li><span>Plataforma</span><strong>{serviceName}</strong></li>
                  <li><span>Nome</span><strong>{draft.name || '—'}</strong></li>
                  <li><span>Tipo de conta</span><strong>{draft.custom_plan_active ? draft.plan_type_custom : (draft.plan_type || '—')}</strong></li>
                  <li><span>Ciclos</span><strong>{[...draft.available_cycles, ...(draft.custom_cycle_enabled ? ['personalizado'] : []), ...(draft.days_cycle_enabled ? ['dias'] : [])].join(', ') || '—'}</strong></li>
                  <li><span>Vagas</span><strong>{draft.has_slot_limit ? draft.max_size : 'Sem limite'}</strong></li>
                  <li><span>PIX</span><strong>{draft.pix_key ? `${draft.pix_key} (${draft.pix_type})` : '—'}</strong></li>
                  <li><span>Taxa de adesão</span><strong>R$ {brl(priceSimulation.entrance)}</strong></li>
                  <li><span>Por transação</span><strong>R$ {brl(priceSimulation.price)}</strong></li>
                </ul>
              </div>

              <div className="approval-notice">
                <Info size={16} />
                <span>Seu grupo ficará pendente de aprovação pela equipe DividePass antes de ficar visível no catálogo.</span>
              </div>
            </>
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
                <Check size={14} /> Salvo {savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
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
