import { CheckCircle2, Hourglass, Info } from 'lucide-react';
import {
  SUBSCRIPTION_ACTIVE,
  SUBSCRIPTION_PENDING,
  SUBSCRIPTION_STATUS_OPTIONS,
} from '../../lib/groupSubscription';
import './GroupCreation.css';

/**
 * ETAPA — STATUS DA ASSINATURA
 *
 * O dono declara se a conta do serviço compartilhado já está paga e ativa
 * ("Já Assinei") ou se ele só vai assinar quando o grupo fechar ("Vou
 * Assinar").
 *
 * O que muda no app:
 *   - "Já Assinei"      -> o grupo nasce ABERTO (status 'open');
 *   - "Vou Assinar"    -> o grupo nasce EM FORMAÇÃO (status 'forming') e só
 *                          vira aberto quando o dono confirmar que assinou.
 */
export default function SubscriptionStatusStep({ value = SUBSCRIPTION_ACTIVE, onChange }) {
  const selected = value || SUBSCRIPTION_ACTIVE;

  return (
    <>
      <p className="gc-section-label">STATUS DA ASSINATURA</p>

      <div className="gc-subscription-list">
        {SUBSCRIPTION_STATUS_OPTIONS.map((opt) => {
          const isSelected = selected === opt.key;
          const Icon = opt.key === SUBSCRIPTION_ACTIVE ? CheckCircle2 : Hourglass;
          return (
            <button
              key={opt.key}
              type="button"
              className={`gc-subscription-card is-${opt.tone} ${isSelected ? 'selected' : ''}`}
              onClick={() => onChange?.(opt.key)}
              aria-pressed={isSelected}
            >
              <span className={`gc-subscription-icon is-${opt.tone}`}>
                <Icon size={18} />
              </span>
              <span className="gc-subscription-body">
                <strong>{opt.title}</strong>
                <small>{opt.desc}</small>
              </span>
            </button>
          );
        })}
      </div>

      <div className="gc-note info">
        <Info size={15} />
        <span>
          {selected === SUBSCRIPTION_PENDING
            ? 'O grupo fica em formação até você assinar a conta. Você pode confirmar a assinatura na tela de gestão do grupo — ele abre para os membros assim que isso acontecer.'
            : 'O grupo abre para os membros assim que a aprovação da plataforma for concluída.'}
        </span>
      </div>
    </>
  );
}
