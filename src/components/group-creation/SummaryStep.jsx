import { useState } from 'react';
import { CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { GROUP_POLICIES } from '../../lib/groupPolicies';
import './GroupCreation.css';

/**
 * ETAPA FINAL — RESUMO + POLÍTICAS
 *
 * O resumo mostra o que vai ser criado. Embaixo, o criador precisa ACEITAR as
 * políticas: a DividePass é somente uma facilitadora de acesso e não tem
 * responsabilidade sobre a conta/credenciais; quem cria o grupo assume total
 * responsabilidade por compartilhar as credenciais com os membros.
 *
 * O texto está em `src/lib/groupPolicies.js`.
 */

export default function SummaryStep({
  items = [],
  policiesAccepted = false,
  onPoliciesChange,
  children,
  notice = null,
  noticeIcon = Info,
}) {
  const [expanded, setExpanded] = useState(true);
  const NoticeIcon = noticeIcon;

  return (
    <>
      <div className="gc-summary">
        <h3>Resumo do grupo</h3>
        <ul>
          {items.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </li>
          ))}
        </ul>
      </div>

      {children}

      <div className="gc-policies" style={{ marginTop: '1rem' }}>
        <h4 className="gc-policies-title">
          <ShieldAlert size={18} />
          Políticas de uso e responsabilidade
        </h4>

        {expanded && (
          <ul>
            {GROUP_POLICIES.map((policy) => (
              <li key={policy.title}>
                <strong>{policy.title}</strong> {policy.text}
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="gc-policies-check"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            {expanded ? 'Ocultar' : 'Ver'} o texto completo das políticas
          </span>
        </button>

        <label className="gc-policies-check" style={{ marginTop: '0.6rem' }}>
          <input
            type="checkbox"
            checked={policiesAccepted}
            onChange={(e) => onPoliciesChange?.(e.target.checked)}
          />
          <span>
            Li e aceito as políticas de uso e responsabilidade da DividePass e assumo total
            responsabilidade pelo compartilhamento das credenciais do grupo.
          </span>
        </label>
      </div>

      {notice && (
        <div className="gc-note info">
          <NoticeIcon size={16} />
          <span>{notice}</span>
        </div>
      )}

      {!policiesAccepted && (
        <div className="gc-note warn">
          <CheckCircle2 size={16} />
          <span>É preciso aceitar as políticas para criar o grupo.</span>
        </div>
      )}
    </>
  );
}
