import { Mail, Link, Hash, MessageSquare, Settings } from 'lucide-react';
import './GroupCreation.css';

const CRED_TYPES = [
  { value: 'email_password', icon: Mail, label: 'E-mail + Senha' },
  { value: 'link', icon: Link, label: 'Link de Acesso' },
  { value: 'code', icon: Hash, label: 'Código' },
  { value: 'invite', icon: MessageSquare, label: 'Convite' },
  { value: 'custom', icon: Settings, label: 'Personalizado' },
];

/**
 * ETAPA — CREDENCIAIS + COMUNICAÇÃO
 *
 * Como os membros acessam a conta compartilhada. O creator é responsável por
 * essas credenciais (ver políticas na etapa final).
 *
 * No fim da etapa, a seção COMUNICAÇÃO liga ou desliga o chat do grupo
 * (troca de mensagens entre os membros).
 */
export default function CredentialsStep({ value = {}, onChange }) {
  const {
    credential_type = 'email_password',
    login_email = '',
    login_password = '',
    credential_extra = '',
    credential_notes = '',
    chat_enabled = true,
  } = value;

  const set = (patch) => onChange?.(patch);

  return (
    <>
      <div className="gc-tag-list" style={{ marginBottom: '1.1rem' }}>
        {CRED_TYPES.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              className={`gc-tag ${credential_type === opt.value ? 'active' : ''}`}
              onClick={() => set({ credential_type: opt.value, credential_extra: '' })}
            >
              <Icon size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
              {opt.label}
            </button>
          );
        })}
      </div>

      {credential_type === 'email_password' && (
        <div className="gc-grid-2">
          <div className="gc-field">
            <label>E-mail de acesso *</label>
            <input
              value={login_email}
              onChange={(e) => set({ login_email: e.target.value })}
              placeholder="conta@plataforma.com"
              autoFocus
            />
          </div>
          <div className="gc-field">
            <label>Senha de acesso</label>
            <input
              type="password"
              value={login_password}
              onChange={(e) => set({ login_password: e.target.value })}
              placeholder="Senha aqui"
            />
          </div>
        </div>
      )}

      {credential_type === 'link' && (
        <div className="gc-field">
          <label>Link de acesso *</label>
          <input
            value={credential_extra}
            onChange={(e) => set({ credential_extra: e.target.value })}
            placeholder="https://..."
            autoFocus
          />
        </div>
      )}

      {credential_type === 'code' && (
        <div className="gc-field">
          <label>Código de acesso *</label>
          <input
            value={credential_extra}
            onChange={(e) => set({ credential_extra: e.target.value })}
            placeholder="Ex: ABCD-1234"
            autoFocus
          />
        </div>
      )}

      {credential_type === 'invite' && (
        <div className="gc-field">
          <label>Link de convite *</label>
          <input
            value={credential_extra}
            onChange={(e) => set({ credential_extra: e.target.value })}
            placeholder="https://..."
            autoFocus
          />
        </div>
      )}

      {credential_type === 'custom' && (
        <div className="gc-field">
          <label>Instruções de acesso *</label>
          <textarea
            rows={3}
            value={credential_extra}
            onChange={(e) => set({ credential_extra: e.target.value })}
            placeholder="Descreva ou cole a credencial de acesso..."
            autoFocus
          />
        </div>
      )}

      {credential_type !== 'custom' && (
        <div className="gc-field">
          <label>Observações (opcional)</label>
          <textarea
            rows={2}
            value={credential_notes}
            onChange={(e) => set({ credential_notes: e.target.value })}
            placeholder="Ex: Não compartilhar; usar apenas 1 tela."
          />
        </div>
      )}

      {/* ---------------------------------------------------- COMUNICAÇÃO */}
      <div className="gc-block">
        <p className="gc-section-label">COMUNICAÇÃO</p>

        <div className="gc-toggle-row">
          <div className="gc-toggle-text">
            <strong>Chat do Grupo</strong>
            <span>Permitir troca de mensagens entre os membros.</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={chat_enabled !== false}
            aria-label="Chat do grupo"
            className={`gc-switch ${chat_enabled !== false ? 'on' : ''}`}
            onClick={() => set({ chat_enabled: chat_enabled === false })}
          >
            <span className="gc-switch-knob" />
          </button>
        </div>
      </div>
    </>
  );
}
