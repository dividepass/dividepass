import { Loader2, Bell, Smartphone, MessageSquare, Mail, MessageCircle } from 'lucide-react';
import './NotificationComposerCard.css';

/*
 * Canais de envio — todos podem ser marcados ao mesmo tempo.
 *
 * `in_app` = notificação dentro do app (sinais da NotificationBell)
 * `email`  = e-mail via SMTP (mail.dividepass.com)
 * `push`   = push do navegador (service worker)
 * `whatsapp` = WhatsApp Cloud API da Meta
 */
const CHANNELS = [
  { id: 'in_app', label: 'Notificação', icon: <MessageSquare size={14} />, hint: 'dentro do app' },
  { id: 'email', label: 'E-mail', icon: <Mail size={14} />, hint: 'caixa de e-mail' },
  { id: 'push', label: 'Push', icon: <Smartphone size={14} />, hint: 'no celular' },
  { id: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle size={14} />, hint: 'conversa' },
];

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
  // `channels` é uma lista: o admin marca tudo que quiser e cada canal
  // marcado dispara o seu próprio fluxo de envio.
  const selected = Array.isArray(channels) ? channels : [];

  const toggleChannel = (id) => {
    const next = selected.includes(id)
      ? selected.filter((c) => c !== id)
      : [...selected, id];
    setChannels(next);
  };

  const toggleAll = () => {
    setChannels(selected.length === CHANNELS.length ? [] : CHANNELS.map((c) => c.id));
  };

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
        <div className="notification-composer-channels-head">
          <label>Canais de envio</label>
          <button type="button" className="notification-composer-channels-all" onClick={toggleAll}>
            {selected.length === CHANNELS.length ? 'Limpar' : 'Todos'}
          </button>
        </div>

        <div className="notification-composer-channel-toggle">
          {CHANNELS.map((channel) => {
            const active = selected.includes(channel.id);
            return (
              <button
                type="button"
                key={channel.id}
                className={`channel-btn ${active ? 'active' : ''}`}
                onClick={() => toggleChannel(channel.id)}
                aria-pressed={active}
                title={`Enviar ${channel.hint}`}
              >
                {channel.icon}
                {channel.label}
              </button>
            );
          })}
        </div>

        <p className="notification-composer-channels-hint">
          {selected.length === 0
            ? 'Nenhum canal marcado — o aviso não será enviado.'
            : `Vai ser enviado por ${selected.length} canal${selected.length !== 1 ? 'is' : ''}: ${selected
                .map((id) => CHANNELS.find((c) => c.id === id)?.label || id)
                .join(', ')}.`}
        </p>
      </div>

      {error && <div className="notification-composer-error">{error}</div>}

      <div className="notification-composer-footer">
        <button
          type={buttonType}
          className="btn btn-primary btn-sm"
          onClick={buttonType === 'button' ? onSubmit : undefined}
          disabled={loading || disabled || selected.length === 0}
        >
          {loading ? <Loader2 size={14} className="spin" /> : <Bell size={14} />}
          {loading ? 'Enviando...' : submitLabel}
        </button>
      </div>
    </div>
  );
}

export default NotificationComposerCard;
