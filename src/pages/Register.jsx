import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import logoImg from '../assets/logo.png';
import './Register.css';

function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referralCode = searchParams.get('ref');
  const { signUp } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(referralCode || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

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
      await signUp(name, email, phone, password, inviteCode || null);
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Erro ao criar conta. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="register-container">
        <div className="register-card">
          <div className="success-message" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <div className="icon-circle" style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              background: 'rgba(34, 197, 94, 0.1)',
              color: '#22C55E',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              margin: '0 auto 1rem'
            }}>✓</div>
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
          <p>Junte-se ao DividePass hoje mesmo</p>
        </div>

        {error && (
          <div className="error-message" style={{
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#EF4444',
            padding: '0.75rem 1rem',
            borderRadius: '0.5rem',
            marginBottom: '1rem',
            fontSize: '0.9rem'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="register-form">
          <div className="form-group">
            <label htmlFor="name">Nome completo</label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="João da Silva"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">E-mail</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="phone">Celular</label>
            <input
              type="tel"
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 99999-9999"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Senha</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirmar Senha</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="inviteCode">Código de Convite <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(opcional)</span></label>
            <input
              type="text"
              id="inviteCode"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="Ex: ABC12345"
              maxLength={20}
            />
            {inviteCode && (
              <span style={{ fontSize: '0.8rem', color: 'var(--success)', marginTop: '0.25rem', display: 'block' }}>
                Código de convite aplicado!
              </span>
            )}
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Criando conta...' : 'Cadastrar'}
          </button>
        </form>

        <div className="register-footer">
          <p>Já tem uma conta? <Link to="/login">Entrar</Link></p>
        </div>
      </div>
    </div>
  );
}

export default Register;
