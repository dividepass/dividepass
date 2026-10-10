import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { maskPhone, onlyDigits, isValidPhone } from '../lib/maskPhone';
import logoImg from '../assets/logo.png';
import './Register.css';

const LEAD_SOURCES = [
  'Instagram',
  'Google',
  'Indicação de amigo/cliente',
  'Facebook',
  'TikTok',
  'YouTube',
  'WhatsApp',
  'LinkedIn',
  'ChatGPT e IAs',
  'Outro',
];

const TOTAL_STEPS = 5;

function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referralCode = searchParams.get('ref');
  const { signUp } = useAuth();

  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [leadSource, setLeadSource] = useState('');
  const [leadSourceOther, setLeadSourceOther] = useState('');
  const [inviteCode, setInviteCode] = useState(referralCode || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const goToStep = (next) => {
    setError('');
    setFieldErrors({});
    setStep(next);
  };

  // Erros por campo, mostrados logo abaixo do input. A banner global fica
  // como reforço, mas o usuário está olhando para o campo, não para o topo.
  const [fieldErrors, setFieldErrors] = useState({});

  const clearError = (field) => {
    setError('');
    setFieldErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const fail = (field, message) => {
    setError('');
    setFieldErrors(prev => ({ ...prev, [field]: message }));
    return false;
  };

  // Enter já dispara o onSubmit do <form> (implicit submission), então não
  // precisa de handler de teclado separado.
  const handleNext = (e) => {
    // Sem isso o <form> faz submit nativo e a página recarrega, zerando o wizard.
    e.preventDefault();

    if (step === 1 && name.trim().length < 3) {
      return fail('name', 'Preencha o nome completo.');
    }

    if (step === 2 && !isValidPhone(phone)) {
      return fail('phone', 'Preencha o WhatsApp com DDD.');
    }

    if (step === 3 && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      return fail('email', 'Preencha um e-mail válido.');
    }

    if (step === 4) {
      if (!leadSource) {
        return fail('leadSource', 'Escolha como você conheceu o DividePass.');
      }
      if (leadSource === 'Outro' && !leadSourceOther.trim()) {
        return fail('leadSourceOther', 'Conte como você conheceu o DividePass.');
      }
    }

    goToStep(step + 1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      return fail('password', 'A senha deve ter pelo menos 6 caracteres.');
    }

    if (password !== confirmPassword) {
      return fail('confirmPassword', 'As senhas não coincidem.');
    }

    setLoading(true);

    try {
      await signUp(name.trim(), email.trim(), onlyDigits(phone), password, inviteCode || null, {
        lead_source: leadSource,
        lead_source_other: leadSource === 'Outro' ? leadSourceOther.trim() : null,
      });
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Erro ao criar conta. Tente novamente.');
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="register-container">
        <div className="register-card">
          <div className="success-message" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <div
              className="icon-circle"
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                background: 'rgba(34, 197, 94, 0.1)',
                color: '#22C55E',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.5rem',
                margin: '0 auto 1rem',
              }}
            >
              ✓
            </div>
            <h3>Conta criada!</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              Verifique seu e-mail para confirmar o cadastro. Depois é só fazer login.
            </p>
            <button onClick={() => navigate('/login')} className="btn btn-primary btn-full">
              Ir para o Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="register-container">
      <div className="register-card">
        <div className="register-logo">
          <img src={logoImg} alt="DividePass" />
        </div>

        <div className="register-header">
          <h2>Criar Conta</h2>
          <p>
            Etapa {step} de {TOTAL_STEPS}
          </p>
        </div>

        <div className="reg-progress" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={TOTAL_STEPS}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={`reg-progress-bar ${i + 1 < step ? 'done' : ''} ${i + 1 === step ? 'current' : ''}`}
            />
          ))}
        </div>

        {error && (
          <div
            className="error-message"
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#EF4444',
              padding: '0.75rem 1rem',
              borderRadius: '0.5rem',
              marginBottom: '1rem',
              fontSize: '0.9rem',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={step === TOTAL_STEPS ? handleSubmit : handleNext} className="register-form">
          {step === 1 && (
            <div className="form-group">
              <label htmlFor="name">Como podemos te chamar?</label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearError('name');
                }}
                placeholder="João da Silva"
                className={fieldErrors.name ? 'input-error' : ''}
                aria-invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? 'name-error' : undefined}
                autoFocus
              />
              {fieldErrors.name ? (
                <span className="field-error" id="name-error">
                  <AlertCircle size={13} /> {fieldErrors.name}
                </span>
              ) : (
                <span className="form-hint">Use seu nome completo.</span>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="form-group">
              <label htmlFor="phone">Seu WhatsApp</label>
              <input
                type="tel"
                id="phone"
                value={phone}
                onChange={(e) => {
                  setPhone(maskPhone(e.target.value));
                  clearError('phone');
                }}
                placeholder="(11) 99999-9999"
                className={fieldErrors.phone ? 'input-error' : ''}
                aria-invalid={!!fieldErrors.phone}
                aria-describedby={fieldErrors.phone ? 'phone-error' : undefined}
                inputMode="numeric"
                autoFocus
              />
              {fieldErrors.phone ? (
                <span className="field-error" id="phone-error">
                  <AlertCircle size={13} /> {fieldErrors.phone}
                </span>
              ) : (
                <span className="form-hint">É por aqui que falamos com você quando precisar.</span>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="form-group">
              <label htmlFor="email">Seu e-mail</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearError('email');
                }}
                placeholder="seu@email.com"
                className={fieldErrors.email ? 'input-error' : ''}
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                autoFocus
              />
              {fieldErrors.email ? (
                <span className="field-error" id="email-error">
                  <AlertCircle size={13} /> {fieldErrors.email}
                </span>
              ) : (
                <span className="form-hint">Enviamos a confirmação de cadastro para cá.</span>
              )}
            </div>
          )}

          {step === 4 && (
            <>
              <div className="form-group">
                <label id="leadSourceLabel">Como você conheceu o DividePass?</label>
                <div className="lead-source-grid" role="group" aria-labelledby="leadSourceLabel">
                  {LEAD_SOURCES.map((source) => {
                    const selected = leadSource === source;
                    return (
                      <button
                        key={source}
                        type="button"
                        className={`lead-source-chip ${selected ? 'selected' : ''}`}
                        aria-pressed={selected}
                        onClick={() => {
                          setLeadSource(source);
                          if (source !== 'Outro') {
                            setLeadSourceOther('');
                            clearError('leadSourceOther');
                          }
                          clearError('leadSource');
                        }}
                      >
                        {source}
                      </button>
                    );
                  })}
                </div>
                {fieldErrors.leadSource && (
                  <span className="field-error" id="leadSource-error">
                    <AlertCircle size={13} /> {fieldErrors.leadSource}
                  </span>
                )}
              </div>

              {leadSource === 'Outro' && (
                <div className="form-group">
                  <label htmlFor="leadSourceOther">Como você conheceu?</label>
                  <input
                    type="text"
                    id="leadSourceOther"
                    value={leadSourceOther}
                    onChange={(e) => {
                      setLeadSourceOther(e.target.value);
                      clearError('leadSourceOther');
                    }}
                    placeholder="Ex: vi num grupo do Facebook"
                    className={fieldErrors.leadSourceOther ? 'input-error' : ''}
                    aria-invalid={!!fieldErrors.leadSourceOther}
                  />
                  {fieldErrors.leadSourceOther && (
                    <span className="field-error" id="leadSourceOther-error">
                      <AlertCircle size={13} /> {fieldErrors.leadSourceOther}
                    </span>
                  )}
                </div>
              )}

              <div className="form-group">
                <label htmlFor="inviteCode">
                  Código de Convite{' '}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(opcional)</span>
                </label>
                <input
                  type="text"
                  id="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="Ex: ABC12345"
                  maxLength={20}
                />
                {inviteCode && (
                  <span
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--success)',
                      marginTop: '0.25rem',
                      display: 'block',
                    }}
                  >
                    Código de convite aplicado!
                  </span>
                )}
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <div className="form-group">
                <label htmlFor="password">Crie uma senha</label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearError('password');
                    clearError('confirmPassword');
                  }}
                  placeholder="Mínimo de 6 caracteres"
                  className={fieldErrors.password ? 'input-error' : ''}
                  aria-invalid={!!fieldErrors.password}
                  autoFocus
                />
                {fieldErrors.password && (
                  <span className="field-error">
                    <AlertCircle size={13} /> {fieldErrors.password}
                  </span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Repita a senha</label>
                <input
                  type="password"
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    clearError('confirmPassword');
                  }}
                  placeholder="••••••••"
                  className={fieldErrors.confirmPassword ? 'input-error' : ''}
                  aria-invalid={!!fieldErrors.confirmPassword}
                />
                {fieldErrors.confirmPassword && (
                  <span className="field-error">
                    <AlertCircle size={13} /> {fieldErrors.confirmPassword}
                  </span>
                )}
              </div>
            </>
          )}

          <div className="reg-nav">
            {step > 1 && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => goToStep(step - 1)}
                disabled={loading}
              >
                <ArrowLeft size={16} /> Voltar
              </button>
            )}

            {step < TOTAL_STEPS ? (
              <button type="submit" className="btn btn-primary reg-nav-next">
                Continuar <ArrowRight size={16} />
              </button>
            ) : (
              <button type="submit" className="btn btn-primary reg-nav-next" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 size={16} className="spin" /> Criando conta...
                  </>
                ) : (
                  <>
                    <Check size={16} /> Cadastrar
                  </>
                )}
              </button>
            )}
          </div>
        </form>

        <div className="register-footer">
          <p>
            Já tem uma conta?{' '}
            <Link to="/login">Entrar</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;