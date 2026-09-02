import { Loader2, Bell, Smartphone, MessageSquare } from 'lucide-react';
import './NotificationComposerCard.css';

function NotificationComposerCard({
  title,
  setTitle,
  message,
  setMessage,
  channels,
  setChannels,
  onSubmit,
  loading = false,
  error = '',
  titleLabel = 'Título',
  messageLabel = 'Mensagem',
  titlePlaceholder = 'Ex: Aviso importante',
  messagePlaceholder = 'Escreva a mensagem que será enviada',
  recipientsLabel = '',
  scopeBadge = '',
  submitLabel = 'Enviar',
  description = '',
  className = '',
  buttonType = 'button',
  disabled = false,
}) {
  return (
    <div className={`notification-composer-card ${className}`.trim()}>
      <div className="notification-composer-header">
        <div>
          {scopeBadge && <span className="notification-composer-badge">{scopeBadge}</span>}
          <h3>{titleLabel === 'Título' ? 'Compor notificação' : titleLabel}</h3>
          {description && <p className="section-desc" style={{ marginBottom: 0 }}>{description}</p>}
        </div>
        {recipientsLabel && <span className="notification-composer-meta">{recipientsLabel}</span>}
      </div>

      <div className="notification-composer-grid">
        <div className="form-group">
          <label>{titleLabel}</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={titlePlaceholder}
          />
        </div>

        <div className="form-group notification-composer-message">
          <label>{messageLabel}</label>
          <textarea
            rows={4}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={messagePlaceholder}
          />
        </div>
      </div>

      <div className="notification-composer-channels">
        <label>Canais de envio</label>
        <div className="notification-composer-channel-toggle">
          <button
            type="button"
            className={`channel-btn ${channels === 'alert' ? 'active' : ''}`}
            onClick={() => setChannels('alert')}
          >
            <MessageSquare size={14} /> Só alerta
          </button>
          <button
            type="button"
            className={`channel-btn ${channels === 'push' ? 'active' : ''}`}
            onClick={() => setChannels('push')}
          >
            <Smartphone size={14} /> Só push
          </button>
          <button
            type="button"
            className={`channel-btn ${channels === 'both' ? 'active' : ''}`}
            onClick={() => setChannels('both')}
          >
            <Bell size={14} /> Ambos
          </button>
        </div>
      </div>

      {error && <div className="notification-composer-error">{error}</div>}

      <div className="notification-composer-footer">
        <button type={buttonType} className="btn btn-primary btn-sm" onClick={buttonType === 'button' ? onSubmit : undefined} disabled={loading || disabled}>
          {loading ? <Loader2 size={14} className="spin" /> : <Bell size={14} />}
          {loading ? 'Enviando...' : submitLabel}
        </button>
      </div>
    </div>
  );
}

export default NotificationComposerCard;
