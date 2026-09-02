import { useState } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import logoImg from '../assets/logo.png';
import './Login.css';

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const referralCode = searchParams.get('ref');
  const { signIn, profile } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const from = location.state?.from?.pathname || '/dashboard';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signIn(email, password);
      // A navegação será feita após o profile ser carregado
    } catch (err) {
      setError(err.message || 'E-mail ou senha inválidos.');
    } finally {
      setLoading(false);
    }
  };

  // Redireciona quando o perfil estiver carregado
  if (profile) {
    navigate(profile.role === 'admin' ? '/admin' : from, { replace: true });
    return null;
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <img src={logoImg} alt="DividePass" />
        </div>
        <div className="login-header">
          <h2>Bem-vindo de volta</h2>
          <p>Faça login para continuar no DividePass</p>
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

        <form onSubmit={handleSubmit} className="login-form">
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

          <div className="form-actions">
            <Link to="/forgot-password" className="forgot-password">Esqueceu a senha?</Link>
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div className="login-footer">
          <p>Não tem uma conta? <Link to={`/register${referralCode ? `?ref=${referralCode}` : ''}`}>Cadastre-se</Link></p>
        </div>
      </div>
    </div>
  );
}

export default Login;
