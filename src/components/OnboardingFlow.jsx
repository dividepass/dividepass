import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ArrowRight, ArrowLeft, Loader2, AlertCircle, CheckCircle2, Sparkles, Plus, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { saveAvatar } from '../lib/uploadAvatar';
import { buildOnboardingPath, pickColumnValues, restoreAnswersFromProfile, ONBOARDING_STEPS } from '../lib/onboardingQuestions';
import { maskPhone, onlyDigits, isValidPhone } from '../lib/maskPhone';
import PlatformPicker, { NONE_PLATFORM } from './PlatformPicker';
import AvatarPicker from './AvatarPicker';
import Confetti from './Confetti';
import './OnboardingFlow.css';

// Últimos 10 dígitos: compara 11... com 55... como o mesmo contato.
const right11 = (digits) => String(digits || '').slice(-10);

/**
 * Quantas indicações a etapa exige. O questionário define (`minInvites`); o
 * padrão é 1 — pedir 2 fazia as pessoas largarem o onboarding no meio.
 */
const minConvidados = (step) => step?.minInvites ?? 1;

/**
 * Erro de coluna ausente: 42703 (Postgres, quando a coluna existe mas o
 * INSERT não pode usá-la) ou PGRST204 (PostgREST, quando a coluna ainda
 * NÃO existe no schema cache). É o sinal de que a migration do fluxo novo
 * ainda não foi aplicada no banco.
 */
const isColunaFaltando = (err) => {
  const msg = err?.message || '';
  return (
    err?.code === '42703' ||
    err?.code === 'PGRST204' ||
    /does not exist/i.test(msg) ||
    /could not find the '.*' column/i.test(msg)
  );
};

/**
 * Dois telefones são o mesmo quando batem os dígitos NACIONAIS.
 *
 * O cadastro costuma gravar com DDI ("55 11 98888-7777") e a pessoa digita
 * com DDD ("11 98888-7777") — comparar a string inteira deixaria o próprio
 * número passar. A comparação pelos últimos dígitos resolve o DDI, mas
 * confunde dois números de DDD diferente com o mesmo sufixo (11 e 21 com o
 * mesmo 8 dígitos). Por isso: tira o DDI e compara o national inteiro.
 */
const mesmoTelefone = (a, b) => {
  const nacional = (v) => {
    let d = String(v || '').replace(/\D/g, '');
    // DDI do Brasil: o número com DDI tem 13 dígitos (celular) ou 12 (fixo).
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    return d;
  };

  const x = nacional(a);
  const y = nacional(b);
  return !!x && !!y && x === y;
};

const SCREEN_AVATAR = 'avatar';
const SCREEN_SURVEY = 'survey';
const SCREEN_DONE = 'done';

/**
 * Conteúdo do onboarding: foto (pulado) + pesquisa de qualificação
 * (obrigatória).
 *
 * É uma página dedicada, não um modal. Com overlay o usuário dispensava
 * com um clique e nunca mais voltava; como rota, o guard do UserLayout
 * devolve qualquer tentativa de sair para o dashboard.
 *
 * A pesquisa não tem como ser pulada: `users.onboarding_completed_at` só é
 * gravado ao terminar todas as etapas, e é esse campo que os gates de PWA e
 * push leem para não atrapalharem.
 */
export default function OnboardingFlow({ onFinished }) {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [screen, setScreen] = useState(SCREEN_AVATAR);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState('');

  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarPreset, setAvatarPreset] = useState(null);
  const [uploading, setUploading] = useState(false);
  /* Contador do confete: cada vez que muda, dispara de novo. */
  const [celebrar, setCelebrar] = useState(0);

  // Estados dos passos de plataforma: current e interested podem virar
  // várias perguntas, então ficam separados de `answers`.
  const [platformPicks, setPlatformPicks] = useState({});
  const [customPicks, setCustomPicks] = useState({});
  const [customInputs, setCustomInputs] = useState({});

  // Etapa final: pessoas que o usuário chamaria para um grupo.
  const [invites, setInvites] = useState([]);
  const [inviteName, setInviteName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteError, setInviteError] = useState('');

  // Retomada: carrega o que já foi salvo e pula pra etapa salva.
  const [resuming, setResuming] = useState(Boolean(profile?.onboarding_step));

  useEffect(() => {
    if (!profile?.id || !profile?.onboarding_step) return;

    let cancelled = false;

    (async () => {
      const [pRes, iRes, invRes] = await Promise.all([
        supabase.from('user_onboarding_profiles').select('*').eq('user_id', profile.id).maybeSingle(),
        supabase.from('user_onboarding_interests').select('*').eq('user_id', profile.id),
        supabase.from('user_onboarding_invites').select('*').eq('user_id', profile.id),
      ]);
      if (cancelled) return;

      // Respostas escalares.
      setAnswers(restoreAnswersFromProfile(pRes.data));

      // Plataformas já respondidas. Cada pergunta de plataforma tem um
      // `kind` próprio ('share' = quer criar, 'join' = quer entrar), então o
      // mapeamento é direto: kind -> id do passo.
      const stepByKind = Object.fromEntries(
        ONBOARDING_STEPS.filter((s) => s.type === 'platforms').map((s) => [s.kind, s.id])
      );
      const picks = {};
      for (const i of iRes.data || []) {
        const stepId = stepByKind[i.kind];
        if (!stepId || !i.platform_id) continue;
        picks[stepId] = picks[stepId] || [];
        picks[stepId].push(String(i.platform_id));
      }
      if (Object.keys(picks).length) {
        setPlatformPicks((prev) => ({ ...prev, ...picks }));
      }

      /* O próprio número da pessoa não vale como indicação: se ficou salvo
         de uma tentativa anterior, ele sai da lista e não trava a etapa. */
      setInvites(
        (invRes.data || [])
          .filter((iv) => !mesmoTelefone(iv.phone, profile?.phone))
          .map((iv) => ({ name: iv.name, phone: iv.phone }))
      );

      // Pula direto pra etapa salva.
      const savedPath = buildOnboardingPath(restoreAnswersFromProfile(pRes.data));
      const idx = savedPath.findIndex((s) => s.id === profile.onboarding_step);
      if (idx >= 0) {
        setScreen(SCREEN_SURVEY);
        setIndex(idx);
      }

      setResuming(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // A sequência só muda quando a resposta do yes/no muda, então recalcular
  // por render é barato e evita uma lista de passos dessincronizada.
  const path = useMemo(() => buildOnboardingPath(answers), [answers]);

  const step = path[index];
  const isFirst = index === 0;
  const isLast = index === path.length - 1;

  /* O botão de continuar só libera quando a etapa está satisfeita. Na etapa
     de convidados, isso significa as 2 pessoas — antes o botão aparecia
     clicável e só reclamava depois do clique. */
  const canContinue = (() => {
    if (!step) return false;
    if (step.type === 'invites') return invites.length >= minConvidados(step);
    return true;
  })();

  const setAnswer = (stepId, value) => {
    setError('');
    setAnswers((prev) => ({ ...prev, [stepId]: value }));
  };

  const setPlatform = (step, ids) => {
    setError('');
    setPlatformPicks((prev) => ({ ...prev, [step.id]: ids }));
    // Marcar uma plataforma invalida o "Nenhuma estas" da pergunta.
    if (customPicks[step.id]?.length && !ids.includes(NONE_PLATFORM)) {
      setCustomPicks((prev) => ({ ...prev, [step.id]: [] }));
    }
  };

  const addCustom = (step) => {
    const name = (customInputs[step.id] || '').trim();
    if (!name) return;
    setError('');
    setCustomPicks((prev) => ({ ...prev, [step.id]: [...(prev[step.id] || []), name] }));
    setCustomInputs((prev) => ({ ...prev, [step.id]: '' }));
  };

  const removeCustom = (step, name) => {
    setCustomPicks((prev) => ({ ...prev, [step.id]: (prev[step.id] || []).filter((n) => n !== name) }));
  };

  const validateStep = (s) => {
    if (!s) return true;
    if (s.type === 'info') return true;

    if (s.type === 'platforms') {
      const picked = platformPicks[s.id] || [];
      const customs = customPicks[s.id] || [];
      const chosen = Array.isArray(picked)
        ? picked.filter((v) => v !== NONE_PLATFORM).length
        : 0;
      if (chosen === 0 && customs.length === 0) {
        setError('Escolha ao menos uma opção.');
        return false;
      }
      return true;
    }

    if (s.type === 'text') return true; // opcional

    // A etapa de indicações é a única que não usa `answers`: as pessoas
    // ficam em `invites`, porque viram linhas próprias na tabela.
    if (s.type === 'invites') {
      const falta = minConvidados(s) - invites.length;
      if (falta > 0) {
        setError(
          falta === 1
            ? 'Adicione mais 1 pessoa para continuar.'
            : `Adicione mais ${falta} pessoas para continuar.`
        );
        return false;
      }
      return true;
    }

    const value = answers[s.id];
    const empty =
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (s.type === 'yes_no' && typeof value !== 'boolean');
    if (empty) {
      setError('Responda para continuar.');
      return false;
    }

    if (s.type === 'single' && s.customField && value === s.customOption) {
      if (!(answers[s.customField] || '').trim()) {
        setError('Conte qual é o outro motivo.');
        return false;
      }
    }

    return true;
  };

  const handleNext = () => {
    if (!validateStep(step)) return;
    setError('');

    const nextIndex = Math.min(index + 1, path.length - 1);
    const nextStep = path[nextIndex];
    setIndex(nextIndex);

    // Grava em segundo plano: respostas + a etapa para onde o usuário foi.
    // Se falhar, não trava a navegação — a retomada salva de novo depois.
    persistProgress(nextStep?.id).catch((err) => {
      console.error('Onboarding: falha ao salvar progresso', err);
    });
  };

  const handleBack = () => {
    setError('');
    setIndex((i) => Math.max(i - 1, 0));
  };

  const addInvite = () => {
    const name = inviteName.trim();
    const phone = onlyDigits(invitePhone);

    if (!name) {
      setInviteError('Digite o nome da pessoa.');
      return;
    }
    if (!isValidPhone(phone)) {
      setInviteError('Digite um WhatsApp válido com DDD.');
      return;
    }
    /* O próprio número da pessoa não vale como indicação. Sem esta regra o
       jeito mais rápido de cumprir a etapa era digitar o número dela duas
       vezes — e esse contato não serve para nada: não dá para avisar quem
       já está cadastrado. */
    if (mesmoTelefone(phone, profile?.phone)) {
      setInviteError('Este número é idêntico ao seu do cadastro. Indique outra pessoa.');
      return;
    }
    // O mesmo contato não entra duas vezes nem com DDD diferente.
    const jaTem = invites.some((i) => i.phone === phone || right11(i.phone) === right11(phone));
    if (jaTem) {
      setInviteError('Esse WhatsApp já foi adicionado.');
      return;
    }

    setInvites((prev) => [...prev, { name, phone }]);
    setInviteName('');
    setInvitePhone('');
    setInviteError('');
    setError('');
  };

  const removeInvite = (phone) => {
    setInvites((prev) => prev.filter((i) => i.phone !== phone));
    setInviteError('');
  };

  const goToSurvey = async () => {
    setError('');

    if ((!avatarFile && !avatarPreset) || !profile?.id) {
      setError('Escolha um avatar ou envie uma foto para continuar.');
      return;
    }

    if (avatarFile) {
      setUploading(true);
      try {
        await saveAvatar(avatarFile, profile.id);
        await refreshProfile?.();
      } catch (err) {
        setError(err.message || 'Não foi possível enviar a foto.');
        setUploading(false);
        return;
      }
      setUploading(false);
    } else if (avatarPreset) {
      setUploading(true);
      const { error: presetErr } = await supabase
        .from('users')
        .update({ avatar_url: avatarPreset.url })
        .eq('id', profile.id);
      setUploading(false);
      if (presetErr) {
        setError('Não foi possível salvar o avatar. Tente novamente.');
        return;
      }
      await refreshProfile?.();
    }

    // Marca o início e a primeira etapa, pra retomada funcionar mesmo se o
    // usuário fechar antes do primeiro "Continuar".
    if (profile?.id) {
      supabase
        .from('users')
        .update({ onboarding_step: ONBOARDING_STEPS[0].id, onboarding_started_at: new Date().toISOString() })
        .eq('id', profile.id)
        .then(() => {});
    }

    setScreen(SCREEN_SURVEY);
  };

  /**
   * Grava as respostas atuais + a etapa para onde o usuário está indo.
   * Idempotente: usado a cada "Continuar" (fire-and-forget) e no finish.
   *
   * Tolerante à migration pendente: se as colunas novas (group_intent,
   * expectations) ou o CHECK do kind ainda não existirem no banco, o
   * onboarding CONTINUA funcionando — salva o que o banco aceita e avisa no
   * console. Sem isso, "Concluir" falharia e o usuário ficaria preso no
   * primeiro acesso.
   */
  const persistProgress = async (nextStepId) => {
    if (!profile?.id) return;

    const row = pickColumnValues(answers);
    if (Object.keys(row).length) {
      const { error: profileErr } = await supabase
        .from('user_onboarding_profiles')
        .upsert({ user_id: profile.id, ...row }, { onConflict: 'user_id' });

      if (profileErr) {
        if (!isColunaFaltando(profileErr)) throw profileErr;

        // Só as colunas que já existiam no schema antigo.
        const legado = {};
        for (const col of ['main_barrier', 'main_barrier_other']) {
          if (row[col] !== undefined) legado[col] = row[col];
        }
        if (!Object.keys(legado).length) throw profileErr;

        const { error: retryErr } = await supabase
          .from('user_onboarding_profiles')
          .upsert({ user_id: profile.id, ...legado }, { onConflict: 'user_id' });
        if (retryErr) throw retryErr;

        console.warn(
          'Onboarding: as colunas group_intent/expectations ainda não existem no banco. ' +
            'Aplique database/EXECUTAR-2026-11-02-onboarding-novo-fluxo.sql no SQL Editor do Supabase.'
        );
      }
    }

    // Plataformas são linhas individuais: uma por (usuário, plataforma, tipo).
    const interestRows = [];
    for (const s of ONBOARDING_STEPS) {
      if (s.type !== 'platforms') continue;
      const picked = platformPicks[s.id] || [];
      const real = Array.isArray(picked) ? picked.filter((v) => v !== NONE_PLATFORM) : [];

      if (real.length) {
        const { data: db } = await supabase
          .from('streaming_services')
          .select('id, name')
          .in('id', real);
        for (const p of db || []) {
          interestRows.push({
            user_id: profile.id,
            platform_id: p.id,
            platform_name: p.name,
            kind: s.kind,
            is_custom: false,
          });
        }
      }

      for (const name of customPicks[s.id] || []) {
        interestRows.push({
          user_id: profile.id,
          platform_id: null,
          platform_name: name,
          kind: s.kind,
          is_custom: true,
        });
      }
    }

    if (interestRows.length) {
      /* Uma escrita por 'kind': se o CHECK do banco ainda não aceitar um dos
         tipos (migration nova não aplicada), os outros tipos continuam
         sendo gravados. */
      const porKind = {};
      for (const r of interestRows) (porKind[r.kind] = porKind[r.kind] || []).push(r);

      for (const [kind, lista] of Object.entries(porKind)) {
        const { error: intErr } = await supabase
          .from('user_onboarding_interests')
          .upsert(lista, { onConflict: 'user_id,kind,platform_name', ignoreDuplicates: true });
        if (intErr) {
          console.warn(
            `Onboarding: não foi possível salvar as plataformas do tipo "${kind}". ` +
              'Aplique database/EXECUTAR-2026-11-02-onboarding-novo-fluxo.sql no SQL Editor do Supabase.',
            intErr.message
          );
        }
      }
    }

    if (invites.length) {
      const { error: invErr } = await supabase
        .from('user_onboarding_invites')
        .upsert(
          invites.map((i) => ({ user_id: profile.id, name: i.name, phone: i.phone })),
          { onConflict: 'user_id,phone', ignoreDuplicates: true }
        );
      if (invErr) throw invErr;
    }

    // Marca a etapa e, se ainda não tinha, o início.
    const { error: userErr } = await supabase
      .from('users')
      .update({
        onboarding_step: nextStepId || null,
        onboarding_started_at: new Date().toISOString(),
      })
      .eq('id', profile.id);
    if (userErr) throw userErr;
  };

  const finish = async () => {
    if (!profile?.id) return;
    setUploading(true);
    setError('');

    try {
      await persistProgress(null);

      // A flag vai por último: se algo acima falhar, o gate abre de novo
      // em vez de marcar o onboarding como concluído sem estar.
      const { error: userErr } = await supabase
        .from('users')
        .update({
          onboarding_completed_at: new Date().toISOString(),
          onboarding_step: null,
        })
        .eq('id', profile.id);
      if (userErr) throw userErr;

      await refreshProfile?.();
      setScreen(SCREEN_DONE);
      setCelebrar((c) => c + 1);
      // A página pai usa isso para não redirecionar para o dashboard antes
      // de o usuário ver a confirmação de "Tudo pronto!".
      onFinished?.();
    } catch (err) {
      console.error('Onboarding: falha ao salvar', err);
      setError('Não foi possível salvar suas respostas. Tente novamente.');
    } finally {
      setUploading(false);
    }
  };

  if (resuming) {
    return (
      <div className="ob-flow">
        <div className="ob-card">
          <Loader2 size={28} className="spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="ob-flow" role="region" aria-labelledby="ob-title">
      <div className="ob-card">
        {screen === SCREEN_AVATAR && (
          <>
            <div className="ob-icon"><Camera size={26} /></div>
            <h2 id="ob-title" className="ob-title">Escolha seu avatar</h2>
            <p className="ob-sub">
              Suba uma foto ou escolha um avatar pronto. Quem divide grupos com você
              reconhece mais rápido um rosto — e dá para trocar depois.
            </p>

            <div className="ob-avatar-area">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Pré-visualização do avatar" className="ob-avatar-img" />
              ) : avatarPreset ? (
                <img src={avatarPreset.url} alt="Pré-visualização do avatar" className="ob-avatar-img" />
              ) : profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="Seu avatar" className="ob-avatar-img" />
              ) : (
                <div className="ob-avatar-placeholder">
                  {(profile?.name || '?').charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <AvatarPicker
              compact
              selectedPreset={avatarPreset?.id || null}
              onSelectPreset={(preset) => {
                setAvatarPreset(preset);
                setAvatarFile(null);
                setAvatarPreview(null);
                setError('');
              }}
              onSelectFile={(file) => {
                setAvatarFile(file);
                setAvatarPreset(null);
                setError('');
                const reader = new FileReader();
                reader.onload = (ev) => setAvatarPreview(ev.target.result);
                reader.readAsDataURL(file);
              }}
              disabled={uploading}
            />

            {error && (
              <div className="ob-error">
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <div className="ob-actions ob-actions-center">
              <button className="ob-btn-primary ob-btn-block" onClick={goToSurvey} disabled={uploading}>
                {uploading ? <><Loader2 size={16} className="spin" /> Salvando...</> : <>Continuar <ArrowRight size={16} /></>}
              </button>
            </div>
          </>
        )}

        {screen === SCREEN_SURVEY && step && (
          <>
            {step.type !== 'info' && (
              <>
                <span className="ob-eyebrow">
                  {isLast ? 'Última pergunta' : `Pergunta ${index} de ${path.length - 1}`}
                </span>
                <h2 id="ob-title" className="ob-title ob-question">{step.title}</h2>
                {step.helper && step.type !== 'invites' && (
                  <p className="ob-question-helper">{step.helper}</p>
                )}
              </>
            )}

            {step.type === 'info' && (
              <div className="ob-info">
                <div className="ob-icon"><Sparkles size={24} /></div>
                <h2 id="ob-title" className="ob-title">{step.title}</h2>
                <div className="ob-info-body">
                  {String(step.content || '')
                    .split('\n\n')
                    .filter(Boolean)
                    .map((paragraph, i) => (
                      <p key={i}>{paragraph}</p>
                    ))}
                </div>
              </div>
            )}

            {step.type === 'yes_no' && (
              <div className="ob-yesno">
                <button
                  className={`ob-yn ${answers[step.id] === true ? 'selected' : ''}`}
                  onClick={() => setAnswer(step.id, true)}
                >
                  Sim
                </button>
                <button
                  className={`ob-yn ${answers[step.id] === false ? 'selected' : ''}`}
                  onClick={() => setAnswer(step.id, false)}
                >
                  Não
                </button>
              </div>
            )}

            {step.type === 'single' && (
              <div className="ob-options">
                {step.options.map((opt) => (
                  <button
                    key={opt.value}
                    className={`ob-option ${answers[step.id] === opt.value ? 'selected' : ''}`}
                    onClick={() => setAnswer(step.id, opt.value)}
                  >
                    <span className="ob-radio" />
                    {opt.label}
                  </button>
                ))}
                {step.customField && answers[step.id] === step.customOption && (
                  <input
                    type="text"
                    className="ob-custom-input"
                    value={answers[step.customField] || ''}
                    onChange={(e) => setAnswer(step.customField, e.target.value)}
                    placeholder="Descreva o motivo"
                    autoFocus
                  />
                )}
              </div>
            )}

            {step.type === 'multiple' && (
              <div className="ob-options">
                {step.options.map((opt) => {
                  const list = answers[step.id] || [];
                  const selected = list.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      className={`ob-option ob-option-multi ${selected ? 'selected' : ''}`}
                      onClick={() =>
                        setAnswer(
                          step.id,
                          selected ? list.filter((v) => v !== opt.value) : [...list, opt.value]
                        )
                      }
                    >
                      <span className="ob-checkbox">{selected && <CheckCircle2 size={14} />}</span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {step.type === 'platforms' && (
              <PlatformPicker
                categories={step.categories}
                value={platformPicks[step.id] || []}
                customNames={customPicks[step.id] || []}
                customInput={customInputs[step.id] || ''}
                showNoneOption
                showCustomOption
                /* O catálogo tem 100+ serviços: sem busca e sem blocos por
                   categoria, a pergunta vira uma rolagem infinita — e isso
                   cansa mais do que a pergunta anterior. */
                searchable
                groupByCategory
                onToggle={(ids) => setPlatform(step, ids)}
                onCustomInputChange={(v) => setCustomInputs((p) => ({ ...p, [step.id]: v }))}
                onAddCustom={() => addCustom(step)}
                onRemoveCustom={(name) => removeCustom(step, name)}
              />
            )}

            {step.type === 'invites' && (
              <div className="ob-invites">
                {step.helper && <p className="ob-invites-helper">{step.helper}</p>}

                {invites.length > 0 && (
                  <ul className="ob-invites-list">
                    {invites.map((i) => (
                      <li key={i.phone}>
                        <span className="ob-invites-avatar">{i.name.charAt(0).toUpperCase()}</span>
                        <span className="ob-invites-info">
                          <strong>{i.name}</strong>
                          <span>{maskPhone(i.phone)}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeInvite(i.phone)}
                          aria-label={`Remover ${i.name}`}
                        >
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="ob-invites-count">
                  <strong>{invites.length}</strong> de {minConvidados(step)} adicionada{minConvidados(step) === 1 ? '' : 's'}
                </div>

                <div className="ob-invites-form">
                  <div className="ob-invites-row">
                    <input
                      type="text"
                      value={inviteName}
                      onChange={(e) => { setInviteName(e.target.value); setInviteError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInvite(); } }}
                      placeholder="Nome"
                      aria-label="Nome da pessoa"
                    />
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={invitePhone}
                      onChange={(e) => { setInvitePhone(maskPhone(e.target.value)); setInviteError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInvite(); } }}
                      placeholder="(11) 99999-9999"
                      aria-label="WhatsApp da pessoa"
                    />
                    <button type="button" onClick={addInvite} disabled={uploading}>
                      <Plus size={16} /> Adicionar
                    </button>
                  </div>

                  {inviteError && (
                    <span className="field-error">
                      <AlertCircle size={13} /> {inviteError}
                    </span>
                  )}

                  {invites.length < minConvidados(step) && (
                    <p className="ob-invites-hint">
                      Faltam <strong>{minConvidados(step) - invites.length}</strong>{' '}
                      {minConvidados(step) - invites.length === 1 ? 'pessoa' : 'pessoas'} para continuar.
                    </p>
                  )}
                </div>
              </div>
            )}

            {step.type === 'text' && (
              <div className="ob-text-block">
                <textarea
                  className="ob-textarea"
                  value={answers[step.id] || ''}
                  onChange={(e) => setAnswer(step.id, e.target.value)}
                  placeholder={step.placeholder}
                  rows={5}
                />
                <p className="ob-text-hint">Opcional — mas é a resposta que mais ajuda a gente.</p>
              </div>
            )}

            {error && (
              <div className="ob-error">
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <div className="ob-actions">
              {!isFirst && (
                <button className="ob-btn-ghost" onClick={handleBack} disabled={uploading}>
                  <ArrowLeft size={16} /> Voltar
                </button>
              )}
              <button
                className="ob-btn-primary ob-next"
                onClick={isLast ? finish : handleNext}
                disabled={uploading || !canContinue}
              >
                {uploading ? (
                  <><Loader2 size={16} className="spin" /> Salvando...</>
                ) : isLast ? (
                  <>Concluir <CheckCircle2 size={16} /></>
                ) : (
                  <>Continuar <ArrowRight size={16} /></>
                )}
              </button>
            </div>
          </>
        )}

        {screen === SCREEN_DONE && (
          <>
            {/* Confete de conclusão: o questionário acabou e a pessoa precisa
                sentir que valeu a pena. */}
            {celebrar > 0 && (
              <div className="confetti-overlay">
                <Confetti fire={celebrar} fall={window.innerHeight} />
              </div>
            )}
            <div className="ob-icon ob-icon-done"><CheckCircle2 size={28} /></div>
            <h2 id="ob-title" className="ob-title">Tudo pronto!</h2>
            <p className="ob-sub">Agora a gente consegue montar as melhores opções para você.</p>
            <div className="ob-actions">
              <button className="ob-btn-primary ob-next" onClick={() => navigate('/dashboard')}>
                Ir para o meu painel <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}