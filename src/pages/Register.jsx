import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2, Check } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
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
    setStep(next);
  };

  // Enter já dispara o onSubmit do <form> (implicit submission), então não
  // precisa de handler de teclado separado.
  const handleNext = (e) => {
    // Sem isso o <form> faz submit nativo e a página recarrega, zerando o wizard.
    e.preventDefault();
    setError('');

    if (step === 1 && name.trim().length < 3) {
      setError('Digite seu nome completo.');
      return;
    }

    if (step === 2) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 10) {
        setError('Digite um WhatsApp válido com DDD.');
        return;
      }
    }

    if (step === 3) {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
        setError('Digite um e-mail válido.');
        return;
      }
    }

    if (step === 4) {
      if (!leadSource) {
        setError('Escolha como você conheceu o DividePass.');
        return;
      }
      if (leadSource === 'Outro' && !leadSourceOther.trim()) {
        setError('Conte como você conheceu o DividePass.');
        return;
      }
    }

    goToStep(step + 1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);

    try {
      await signUp(name.trim(), email.trim(), phone.trim(), password, inviteCode || null, {
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
                onChange={(e) => setName(e.target.value)}
                placeholder="João da Silva"
                autoFocus
                required
              />
              <span className="form-hint">Use seu nome completo.</span>
            </div>
          )}

          {step === 2 && (
            <div className="form-group">
              <label htmlFor="phone">Seu WhatsApp</label>
              <input
                type="tel"
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 99999-9999"
                autoFocus
                required
              />
              <span className="form-hint">É por aqui que falamos com você quando precisar.</span>
            </div>
          )}

          {step === 3 && (
            <div className="form-group">
              <label htmlFor="email">Seu e-mail</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                autoFocus
                required
              />
              <span className="form-hint">Enviamos a confirmação de cadastro para cá.</span>
            </div>
          )}

          {step === 4 && (
            <>
              <div className="form-group">
                <label htmlFor="leadSource">Como você conheceu o DividePass?</label>
                <select
                  id="leadSource"
                  value={leadSource}
                  onChange={(e) => {
                    setLeadSource(e.target.value);
                    if (e.target.value !== 'Outro') setLeadSourceOther('');
                  }}
                  autoFocus
                  required
                >
                  <option value="">Selecione...</option>
                  {LEAD_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </div>

              {leadSource === 'Outro' && (
                <div className="form-group">
                  <label htmlFor="leadSourceOther">Como você conheceu?</label>
                  <input
                    type="text"
                    id="leadSourceOther"
                    value={leadSourceOther}
                    onChange={(e) => setLeadSourceOther(e.target.value)}
                    placeholder="Ex: vi num grupo do Facebook"
                    required
                  />
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
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo de 6 caracteres"
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Repita a senha</label>
                <input
                  type="password"
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
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