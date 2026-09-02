import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import './ForgotPassword.css';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: 'https://www.dividepass.com/reset-password',
      });

      if (error) throw new Error(error.message);

      setSubmitted(true);
    } catch (err) {
      setError(err.message || 'Erro ao enviar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="forgot-container">
        <div className="forgot-card">
          <div className="success-message">
            <div className="icon-circle">✓</div>
            <h3>E-mail enviado!</h3>
            <p>Verifique sua caixa de entrada e clique no link para redefinir sua senha.</p>
          </div>
          <div className="forgot-footer">
            <Link to="/login">Voltar para Login</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="forgot-container">
      <div className="forgot-card">
        <div className="forgot-header">
          <h2>Recuperar Senha</h2>
          <p>Enviaremos instruções para o seu e-mail</p>
        </div>

        <form onSubmit={handleSubmit} className="forgot-form">
          <div className="form-group">
            <label htmlFor="email">E-mail cadastrado</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
            />
          </div>

          {error && <div className="forgot-error">{error}</div>}

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Enviando...' : 'Enviar Link'}
          </button>
        </form>

        <div className="forgot-footer">
          <p>Lembrou a senha? <Link to="/login">Voltar para Login</Link></p>
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
