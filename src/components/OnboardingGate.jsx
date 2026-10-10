import { useState, useRef, useMemo } from 'react';
import { Camera, ArrowRight, ArrowLeft, Loader2, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { saveAvatar } from '../lib/uploadAvatar';
import { buildOnboardingPath, pickColumnValues, ONBOARDING_STEPS } from '../lib/onboardingQuestions';
import PlatformPicker, { NONE_PLATFORM } from './PlatformPicker';
import './OnboardingGate.css';

const SCREEN_AVATAR = 'avatar';
const SCREEN_SURVEY = 'survey';
const SCREEN_DONE = 'done';

/**
 * Onboarding de primeiro acesso: foto (pulado) + pesquisa de qualificação
 * (obrigatória).
 *
 * Segue o padrão dos gates já existentes (PwaInstallGate, PushNotificationGate):
 * componente montado no UserLayout, cobrindo todas as páginas de /dashboard,
 * com `if (!shouldShow) return null` e conclusão persistida no backend.
 *
 * A pesquisa não tem como ser pulada: `users.onboarding_completed_at` só é
 * gravado ao terminar todas as etapas, e é esse campo que os outros gates
 * leem para não atrapalhar.
 */
export default function OnboardingGate() {
  const { profile, refreshProfile } = useAuth();

  const shouldShow = !!profile && !profile.onboarding_completed_at;

  const [screen, setScreen] = useState(SCREEN_AVATAR);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState('');

  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const avatarInputRef = useRef(null);

  // Estados dos passos de plataforma: current e interested podem virar
  // várias perguntas, então ficam separados de `answers`.
  const [platformPicks, setPlatformPicks] = useState({});
  const [customPicks, setCustomPicks] = useState({});
  const [customInputs, setCustomInputs] = useState({});

  // A sequência só muda quando a resposta do yes/no muda, então recalcular
  // por render é barato e evita uma lista de passos dessincronizada.
  const path = useMemo(() => buildOnboardingPath(answers), [answers]);

  if (!shouldShow) return null;

  const step = path[index];
  const isFirst = index === 0;
  const isLast = index === path.length - 1;

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
      if (picked.filter((v) => v !== NONE_PLATFORM).length === 0 && customs.length === 0) {
        setError('Escolha ao menos uma opção.');
        return false;
      }
      return true;
    }

    if (s.type === 'text') return true; // opcional

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
    setIndex((i) => Math.min(i + 1, path.length - 1));
  };

  const handleBack = () => {
    setError('');
    setIndex((i) => Math.max(i - 1, 0));
  };

  const handleAvatarFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const goToSurvey = async () => {
    setError('');

    if (avatarFile && profile?.id) {
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
    }

    setScreen(SCREEN_SURVEY);
  };

  const finish = async () => {
    if (!profile?.id) return;
    setUploading(true);
    setError('');

    try {
      const row = pickColumnValues(answers);

      const { error: profileErr } = await supabase
        .from('user_onboarding_profiles')
        .upsert({ user_id: profile.id, ...row }, { onConflict: 'user_id' });
      if (profileErr) throw profileErr;

      // Plataformas são linhas individuais: uma por (usuário, plataforma, tipo).
      const interestRows = [];

      for (const s of ONBOARDING_STEPS) {
        if (s.type !== 'platforms') continue;
        const picked = platformPicks[s.id] || [];
        const real = picked.filter((v) => v !== NONE_PLATFORM);

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
        const { error: intErr } = await supabase
          .from('user_onboarding_interests')
          .upsert(interestRows, { onConflict: 'user_id,kind,platform_name', ignoreDuplicates: true });
        if (intErr) throw intErr;
      }

      // A flag vai por último: se algo acima falhar, o gate abre de novo
      // em vez de marcar o onboarding como concluído sem estar.
      const { error: userErr } = await supabase
        .from('users')
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq('id', profile.id);
      if (userErr) throw userErr;

      await refreshProfile?.();
      setScreen(SCREEN_DONE);
    } catch (err) {
      console.error('Onboarding: falha ao salvar', err);
      setError('Não foi possível salvar suas respostas. Tente novamente.');
    } finally {
      setUploading(false);
    }
  };

  const answeredCount = path.filter((s) => s.type !== 'info').length;
  const progress = Math.round(((index + 1) / path.length) * 100);

  return (
    <div className="ob-backdrop" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      <div className="ob-modal">
        {screen === SCREEN_AVATAR && (
          <>
            <div className="ob-icon"><Camera size={26} /></div>
            <h2 id="ob-title" className="ob-title">Deixe o seu perfil mais completo</h2>
            <p className="ob-sub">
              Uma foto de perfil ajuda outras pessoas a confiarem em você e deixa o seu
              depoimento com cara de gente.
            </p>

            <div className="ob-avatar-area">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Pré-visualização do avatar" className="ob-avatar-img" />
              ) : profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="Seu avatar" className="ob-avatar-img" />
              ) : (
                <div className="ob-avatar-placeholder">
                  {(profile?.name || '?').charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {error && (
              <div className="ob-error">
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <div className="ob-actions">
              <button className="ob-btn-primary" onClick={goToSurvey} disabled={uploading}>
                {uploading ? <><Loader2 size={16} className="spin" /> Enviando...</> : <>Continuar <ArrowRight size={16} /></>}
              </button>
              <button
                className="ob-btn-ghost"
                onClick={() => setScreen(SCREEN_SURVEY)}
                disabled={uploading}
              >
                {avatarFile ? 'Enviar depois' : 'Agora não'}
              </button>
            </div>
            {!avatarFile && (
              <button
                className="ob-upload-link"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploading}
              >
                <Camera size={14} /> Escolher foto
              </button>
            )}
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarFile}
              hidden
            />
          </>
        )}

        {screen === SCREEN_SURVEY && step && (
          <>
            <div className="ob-progress-wrap">
              <div className="ob-progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <span className="ob-step-count">
              {index + 1} de {path.length}
            </span>

            {step.type !== 'info' && (
              <h2 id="ob-title" className="ob-title ob-question">{step.title}</h2>
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
                onToggle={(ids) => setPlatform(step, ids)}
                onCustomInputChange={(v) => setCustomInputs((p) => ({ ...p, [step.id]: v }))}
                onAddCustom={() => addCustom(step)}
                onRemoveCustom={(name) => removeCustom(step, name)}
                helper={step.helper}
              />
            )}

            {step.type === 'text' && (
              <textarea
                className="ob-textarea"
                value={answers[step.id] || ''}
                onChange={(e) => setAnswer(step.id, e.target.value)}
                placeholder={step.placeholder}
                rows={4}
              />
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
                disabled={uploading}
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

            <p className="ob-note">
              {answeredCount} perguntas rápidas para a gente entender melhor o que você procura.
            </p>
          </>
        )}

        {screen === SCREEN_DONE && (
          <>
            <div className="ob-icon ob-icon-done"><CheckCircle2 size={28} /></div>
            <h2 id="ob-title" className="ob-title">Tudo pronto!</h2>
            <p className="ob-sub">Agora a gente consegue montar as melhores opções para você.</p>
          </>
        )}
      </div>
    </div>
  );
}