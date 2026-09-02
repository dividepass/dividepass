import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import './ResetPassword.css';

function ResetPassword() {
  const url = new URL(window.location.href);
  const queryToken = url.searchParams.get('token');
  const hash = window.location.hash.substring(1);
  const hashParams = new URLSearchParams(hash);
  const accessToken = hashParams.get('access_token');
  const type = hashParams.get('type');

  const token = queryToken || accessToken;
  const isSupabaseToken = type === 'recovery' && accessToken;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const invalidToken = !token;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    setLoading(true);

    try {
      if (isSupabaseToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: hashParams.get('refresh_token') || '',
        });

        if (sessionError) throw new Error(sessionError.message);

        const { error: updateError } = await supabase.auth.updateUser({
          password: password,
        });

        if (updateError) throw new Error(updateError.message);
      } else {
        const { data, error: fnError } = await supabase.functions.invoke('confirm-password-reset', {
          body: { token: queryToken, newPassword: password },
        });

        if (fnError) throw new Error(fnError.message || 'Erro ao redefinir senha');
        if (data?.error) throw new Error(data.error);
      }

      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Erro ao redefinir senha. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (invalidToken) {
    return (
      <div className="reset-container">
        <div className="reset-card">
          <div className="reset-header">
            <h2>Link Inválido</h2>
          </div>
          <div className="reset-error-state">
            <div className="icon-circle-error">✕</div>
            <p>O link de recuperação de senha é inválido ou está incompleto.</p>
          </div>
          <div className="reset-footer">
            <Link to="/forgot-password">Solicitar novo link</Link>
            <Link to="/login">Voltar para Login</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="reset-container">
      <div className="reset-card">
        <div className="reset-header">
          <h2>Nova Senha</h2>
          <p>Digite sua nova senha abaixo</p>
        </div>

        {!success ? (
          <form onSubmit={handleSubmit} className="reset-form">
            <div className="form-group">
              <label htmlFor="password">Nova senha</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                minLength={6}
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirmar senha</label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
                required
                minLength={6}
              />
            </div>

            {error && <div className="reset-error">{error}</div>}

            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? 'Redefinindo...' : 'Redefinir Senha'}
            </button>
          </form>
        ) : (
          <div className="success-message">
            <div className="icon-circle">✓</div>
            <h3>Senha redefinida!</h3>
            <p>Sua senha foi atualizada com sucesso.</p>
            <Link to="/login" className="btn btn-primary" style={{ marginTop: '1rem' }}>
              Fazer Login
            </Link>
          </div>
        )}

        <div className="reset-footer">
          <Link to="/login">Voltar para Login</Link>
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;
