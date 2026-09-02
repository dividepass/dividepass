import { useState } from 'react';
import { Bell, Loader2, ShieldAlert, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePushNotifications } from '../hooks/usePushNotifications';
import './PushNotificationGate.css';

const DISMISS_KEY = 'dp_push_gate_dismissed';

function PushNotificationGate() {
  const { profile } = useAuth();
  const { supported, enabled, loading, enablePush } = usePushNotifications();
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  const shouldShow = Boolean(
    profile && supported && !profile.push_notifications_enabled_at && !enabled && !dismissed
  );

  const handleEnable = async () => {
    setError('');
    try {
      await enablePush();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      handleDismiss();
    }
  };

  if (!shouldShow) return null;

  return (
    <div className="push-gate-backdrop" role="dialog" aria-modal="true" aria-labelledby="push-gate-title" onClick={handleBackdropClick}>
      <div className="push-gate-modal">
        <button className="push-gate-close" onClick={handleDismiss} aria-label="Fechar">
          <X size={20} />
        </button>
        <div className="push-gate-badge">
          <ShieldAlert size={16} />
          <span>Notificações opcionais</span>
        </div>
        <h2 id="push-gate-title">Ative as notificações</h2>
        <p className="push-gate-text">
          A DividePass pode enviar alertas de renovação e novidades por push. Ative para ficar por dentro de tudo.
        </p>
        <div className="push-gate-actions">
          <button className="btn btn-primary push-gate-btn" onClick={handleEnable} disabled={loading}>
            {loading ? <Loader2 size={18} className="spin" /> : <Bell size={18} />}
            {loading ? 'Ativando...' : 'Ativar notificações'}
          </button>
          <button className="btn push-gate-skip" onClick={handleDismiss}>
            Agora não
          </button>
        </div>
        {error && <p className="push-gate-error">{error}</p>}
        <p className="push-gate-hint">Você pode ativar depois em Configurações do perfil.</p>
      </div>
    </div>
  );
}

export default PushNotificationGate;
