import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  CheckCircle, ArrowRight, ArrowLeft, User, Mail,
  MessageCircle, Loader2, PartyPopper, AlertCircle, Star
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './Pesquisa.css';

function Pesquisa() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [survey, setSurvey] = useState(null);
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // STATE: Etapa atual (0 = dados do usuário, 1+ = step_number)
  const [etapaAtual, setEtapaAtual] = useState(0);
  const [historico, setHistorico] = useState([0]);
  const [direction, setDirection] = useState('forward');

  const [userInfo, setUserInfo] = useState({ name: '', email: '', whatsapp: '' });
  const [userInfoErrors, setUserInfoErrors] = useState({});
  const [answers, setAnswers] = useState({});

  const maskPhone = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  useEffect(() => { loadSurvey(); }, [slug]);

  const loadSurvey = async () => {
    try {
      const { data: s, error: se } = await supabase
        .from('surveys').select('*')
        .eq('slug', slug).eq('is_active', true).single();
      if (se || !s) { setError('Pesquisa não encontrada ou inativa.'); setLoading(false); return; }

      const { data: st } = await supabase
        .from('survey_steps').select('*')
        .eq('survey_id', s.id).order('step_number', { ascending: true });

      for (const step of st || []) {
        if (step.step_type === 'platforms') {
          const filter = step.platform_filter || [];
          const uuidPat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (filter.length === 0) {
            const { data: p } = await supabase.from('streaming_services')
              .select('id, name, icon_url, color, pinned, featured').order('name');
            step.platforms = p || [];
          } else {
            const uuids = filter.filter(f => uuidPat.test(String(f)));
            const cats = filter.filter(f => !uuidPat.test(String(f)));
            let plats = [];
            if (uuids.length) {
              const { data: p } = await supabase.from('streaming_services')
                .select('id, name, icon_url, color, pinned, featured').in('id', uuids);
              plats.push(...(p || []));
            }
            if (cats.length) {
              const { data: p } = await supabase.from('streaming_services')
                .select('id, name, icon_url, color, pinned, featured').in('category', cats);
              plats.push(...(p || []));
            }
            const seen = new Set();
            step.platforms = plats.filter(p => { const d = seen.has(p.id); seen.add(p.id); return !d; });
          }
          step.platforms.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            if (a.featured && !b.featured) return -1;
            if (!a.featured && b.featured) return 1;
            return a.name?.localeCompare(b.name);
          });
        }
      }

      for (const step of st || []) {
        if (step.branch_sim_step !== undefined && step.branch_sim_step !== null) {
          step.branch_sim_step = Number(step.branch_sim_step) || 0;
        }
        if (step.branch_nao_step !== undefined && step.branch_nao_step !== null) {
          step.branch_nao_step = Number(step.branch_nao_step) || 0;
        }
        if ((step.step_type === 'question') && step.options?.length) {
          const seen = new Set();
          step.options = step.options.map((opt, i) => {
            let val = opt.value || `opt_${i}`;
            if (seen.has(val)) {
              val = `${val}_${i}`;
            }
            seen.add(val);
            return { ...opt, value: val };
          });
        }
      }

      setSurvey(s);
      setSteps(st || []);
      setLoading(false);
    } catch (e) {
      setError('Erro ao carregar pesquisa.');
      setLoading(false);
    }
  };

  const totalSteps = steps.length + 1;
  const progress = etapaAtual === 0 ? 0 : (etapaAtual / totalSteps) * 100;
  const stepAtual = steps.find(s => s.step_number === etapaAtual);

  // ==================== VALIDAÇÃO ====================
  const validateUserInfo = () => {
    const errors = {};
    if (!userInfo.name.trim()) errors.name = 'Nome é obrigatório';
    setUserInfoErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateCurrentStep = () => {
    if (!stepAtual) return true;
    if (stepAtual.step_type === 'info') return true;
    if (!stepAtual.is_required) return true;
    const answer = answers[String(stepAtual.step_number)];
    if (!answer || !answer.value) return false;
    if (Array.isArray(answer.value) && answer.value.length === 0) return false;
    return true;
  };

  // ==================== NAVEGAÇÃO ====================
  const irParaEtapa = (numEtapa) => {
    const num = Number(numEtapa);
    if (!num || num < 0) return;
    setDirection('forward');
    setHistorico(prev => [...prev, num]);
    setEtapaAtual(num);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleVoltar = () => {
    if (historico.length > 1) {
      setDirection('backward');
      const novo = historico.slice(0, -1);
      setHistorico(novo);
      setEtapaAtual(novo[novo.length - 1]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleProximo = () => {
    if (etapaAtual === 0) {
      if (!validateUserInfo()) return;
      irParaEtapa(1);
    } else {
      if (!validateCurrentStep()) {
        alert('Por favor, responda esta pergunta para continuar.');
        return;
      }
      const proxima = etapaAtual + 1;
      if (proxima > steps.length) {
        handleSubmit();
      } else {
        irParaEtapa(proxima);
      }
    }
  };

  const handleSim = () => {
    if (!stepAtual) return;
    handleAnswer(String(stepAtual.step_number), 'sim', 'Sim');

    const targetStepNum = Number(stepAtual.branch_sim_step) || 0;

    if (targetStepNum === 0) { handleSubmit(); return; }
    if (targetStepNum > 0) { irParaEtapa(targetStepNum); return; }

    handleProximo();
  };

  const handleNao = () => {
    if (!stepAtual) return;
    handleAnswer(String(stepAtual.step_number), 'nao', 'Não');

    const targetStepNum = Number(stepAtual.branch_nao_step) || 0;

    if (targetStepNum === 0) { handleSubmit(); return; }
    if (targetStepNum > 0) { irParaEtapa(targetStepNum); return; }

    handleProximo();
  };

  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !submitting && !submitted) {
      if (stepAtual?.step_type === 'question' && stepAtual?.question_type === 'yes_no') return;
      if (stepAtual?.step_type === 'question' && stepAtual?.question_type === 'text_input') return;
      handleProximo();
    }
  }, [etapaAtual, userInfo, answers, submitting, submitted, stepAtual]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  // ==================== RESPOSTAS ====================
  const handleAnswer = (stepId, value, label) => {
    setAnswers(prev => ({ ...prev, [stepId]: { value, label } }));
  };

  const handleMultipleAnswer = (stepId, value, label) => {
    const current = answers[stepId]?.value || [];
    const newValue = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    const step = steps.find(s => s.id === stepId);
    let displayLabels = [];
    if (step?.step_type === 'platforms') {
      displayLabels = (step.platforms || []).filter(p => newValue.includes(String(p.id))).map(p => p.name);
    } else if (step?.options) {
      displayLabels = step.options.filter(o => newValue.includes(o.value)).map(o => o.label);
    }
    if (displayLabels.length === 0) displayLabels = newValue;
    setAnswers(prev => ({ ...prev, [stepId]: { value: newValue, label: displayLabels.join(', ') } }));
  };

  // ==================== SUBMIT ====================
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const { error } = await supabase.from('survey_responses').insert({
        survey_id: survey.id,
        respondent_name: userInfo.name.trim(),
        respondent_email: userInfo.email.trim() || null,
        respondent_whatsapp: userInfo.whatsapp.trim() || null,
        answers,
        completed_at: new Date().toISOString(),
      });
      if (error) throw error;
      setSubmitted(true);
    } catch (e) {
      console.error('Submit error:', e);
      alert('Erro ao enviar resposta. Tente novamente.');
    }
    setSubmitting(false);
  };

  // ==================== RENDER ====================
  if (loading) {
    return (
      <div className="pesquisa-container">
        <div className="pesquisa-loading">
          <Loader2 size={32} className="spin" />
          <p>Carregando pesquisa...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pesquisa-container">
        <div className="pesquisa-error">
          <AlertCircle size={48} />
          <h2>Ops!</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="pesquisa-container">
        <div className="pesquisa-success">
          <div className="success-icon">
            <PartyPopper size={48} />
          </div>
          <h2>Obrigado!</h2>
          <p>Sua resposta foi registrada com sucesso.</p>
          <p className="success-subtitle">Agradecemos seu tempo e contribuição.</p>
        </div>
      </div>
    );
  }

  const isYesNo = stepAtual?.step_type === 'question' && stepAtual?.question_type === 'yes_no';

  return (
    <div className="pesquisa-container">
      {/* Barra de progresso */}
      <div className="pesquisa-progress">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="progress-label">
          {etapaAtual === 0 ? '0' : etapaAtual}/{totalSteps}
        </span>
      </div>

      {/* Conteúdo da etapa */}
      <div className={`pesquisa-step ${direction}`}>
        {/* ETAPA 0: Dados do usuário */}
        {etapaAtual === 0 && (
          <div className="step-content">
            <div className="step-header">
              <User size={28} className="step-icon" />
              <h1>Quem é você?</h1>
              <p className="step-description">Preencha seus dados para continuarmos.</p>
            </div>
            <div className="step-form">
              <div className={`input-group ${userInfoErrors.name ? 'error' : ''}`}>
                <label><User size={16} /> Nome *</label>
                <input type="text" value={userInfo.name}
                  onChange={(e) => { setUserInfo({ ...userInfo, name: e.target.value }); setUserInfoErrors({}); }}
                  placeholder="Seu nome completo" autoFocus />
                {userInfoErrors.name && <span className="error-text">{userInfoErrors.name}</span>}
              </div>
              <div className="input-group">
                <label><Mail size={16} /> Email</label>
                <input type="email" value={userInfo.email}
                  onChange={(e) => setUserInfo({ ...userInfo, email: e.target.value })}
                  placeholder="seu@email.com" />
              </div>
              <div className="input-group">
                <label><MessageCircle size={16} /> WhatsApp</label>
                <input type="tel" value={userInfo.whatsapp}
                  onChange={(e) => setUserInfo({ ...userInfo, whatsapp: maskPhone(e.target.value) })}
                  placeholder="(00) 00000-0000" maxLength={16} />
              </div>
            </div>
          </div>
        )}

        {/* ETAPA: Informação */}
        {stepAtual?.step_type === 'info' && (
          <div className="step-content">
            <div className="step-header">
              {stepAtual.image_url && <img src={stepAtual.image_url} alt="" className="step-image" />}
              <h1>{stepAtual.title}</h1>
              {stepAtual.description && <p className="step-description">{stepAtual.description}</p>}
            </div>
            {stepAtual.content && (
              <div className="step-text-content">
                {stepAtual.content.split('\n').map((line, i) => <p key={i}>{line}</p>)}
              </div>
            )}
          </div>
        )}

        {/* ETAPA: Pergunta */}
        {stepAtual?.step_type === 'question' && (
          <div className="step-content">
            <div className="step-header">
              <h1>{stepAtual.title}</h1>
              {stepAtual.description && <p className="step-description">{stepAtual.description}</p>}
            </div>

            <div className="step-options">
              {/* SIM / NÃO — os botões SÃO a navegação */}
              {stepAtual.question_type === 'yes_no' && (
                <div className="yes-no-options">
                  <button className="option-btn yes-btn" onClick={handleSim}>
                    <CheckCircle size={20} />
                    Sim
                  </button>
                  <button className="option-btn no-btn" onClick={handleNao}>
                    <CheckCircle size={20} />
                    Não
                  </button>
                </div>
              )}

              {/* Múltipla escolha */}
              {stepAtual.question_type === 'multiple' && (
                <div className="multiple-options">
                  {(stepAtual.options || []).map((opt, i) => {
                    const isSelected = (answers[String(stepAtual.step_number)]?.value || []).includes(opt.value);
                    return (
                      <button key={i} className={`option-btn multi-btn ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleMultipleAnswer(String(stepAtual.step_number), opt.value, opt.label)}>
                        <div className={`checkbox ${isSelected ? 'checked' : ''}`}>
                          {isSelected && <CheckCircle size={14} />}
                        </div>
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Texto livre */}
              {stepAtual.question_type === 'text_input' && (
                <div className="text-input-step">
                  <textarea className="survey-text-input"
                    placeholder="Digite sua resposta aqui..."
                    value={answers[String(stepAtual.step_number)]?.value || ''}
                    onChange={(e) => handleAnswer(String(stepAtual.step_number), e.target.value, e.target.value)}
                    rows={4} />
                </div>
              )}

              {/* Estrelas */}
              {stepAtual.question_type === 'rating_star' && (
                <div className="rating-step">
                  <div className="rating-stars">
                    {[1, 2, 3, 4, 5].map((star) => {
                      const currentVal = Number(answers[String(stepAtual.step_number)]?.value) || 0;
                      return (
                        <button key={star} className={`star-btn ${star <= currentVal ? 'active' : ''}`}
                          onClick={() => handleAnswer(String(stepAtual.step_number), star, `${star} estrela${star > 1 ? 's' : ''}`)}
                          type="button">
                          <Star size={40}
                            fill={star <= currentVal ? '#FBBF24' : 'none'}
                            color={star <= currentVal ? '#FBBF24' : '#6b7280'}
                            strokeWidth={1.5} />
                        </button>
                      );
                    })}
                  </div>
                  {Number(answers[String(stepAtual.step_number)]?.value) > 0 && (
                    <p className="rating-label">{answers[String(stepAtual.step_number)]?.label}</p>
                  )}
                </div>
              )}

              {/* Escolha única */}
              {stepAtual.question_type === 'single' && (
                <div className="single-options">
                  {(stepAtual.options || []).map((opt, i) => (
                    <button key={i}
                      className={`option-btn single-btn ${answers[String(stepAtual.step_number)]?.value === opt.value ? 'selected' : ''}`}
                      onClick={() => handleAnswer(String(stepAtual.step_number), opt.value, opt.label)}>
                      <div className="radio">
                        {answers[String(stepAtual.step_number)]?.value === opt.value && <div className="radio-dot" />}
                      </div>
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ETAPA: Plataformas */}
        {stepAtual?.step_type === 'platforms' && (
          <div className="step-content">
            <div className="step-header">
              <h1>{stepAtual.title}</h1>
              {stepAtual.description && <p className="step-description">{stepAtual.description}</p>}
            </div>
            <div className="step-options">
              <div className="platforms-options">
                {(stepAtual.platforms || []).map((platform) => {
                  const isSelected = (answers[String(stepAtual.step_number)]?.value || []).includes(String(platform.id));
                  return (
                    <button key={platform.id}
                      className={`option-btn platform-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleMultipleAnswer(String(stepAtual.step_number), String(platform.id), platform.name)}>
                      <div className={`checkbox ${isSelected ? 'checked' : ''}`}>
                        {isSelected && <CheckCircle size={14} />}
                      </div>
                      <div className="platform-icon">
                        {platform.icon_url ? (
                          <img src={platform.icon_url} alt="" />
                        ) : (
                          <span>{platform.name?.[0]}</span>
                        )}
                      </div>
                      {platform.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navegação inferior */}
      <div className="pesquisa-nav">
        {etapaAtual > 0 && historico.length > 1 && (
          <button className="nav-btn back" onClick={handleVoltar}>
            <ArrowLeft size={18} />
            Voltar
          </button>
        )}

        {!isYesNo && (
          <button className="nav-btn next" onClick={handleProximo} disabled={submitting}>
            {submitting ? (
              <Loader2 size={18} className="spin" />
            ) : etapaAtual === steps.length ? (
              <>
                Enviar
                <CheckCircle size={18} />
              </>
            ) : (
              <>
                Próximo
                <ArrowRight size={18} />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default Pesquisa;
