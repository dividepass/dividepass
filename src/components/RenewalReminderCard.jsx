import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { formatDateBR } from '../lib/dateFormat';
import {
  ACCESS_OVERDUE,
  OVERDUE_GRACE_DAYS,
  RENEWAL_REMINDER_DAYS,
  daysUntilRenewal,
  subscriptionAccessState,
  subscriptionRenewalDate,
} from '../lib/subscriptionAccess';
import './RenewalReminderCard.css';

/**
 * Soma dias à data de renovação preservando o tipo dela:
 *  - "YYYY-MM-DD" (coluna DATE) continua um dia de calendário;
 *  - timestamptz continua o mesmo instante, N dias depois.
 *
 * Assim o fim da carência sai com a mesma convenção de exibição da data de
 * renovação (dia em UTC quando é meia-noite UTC, fuso do navegador nos
 * demais) — os dois dias nunca parecem "errados" um para o outro.
 */
function addDays(value, days) {
  const raw = String(value).trim();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [year, month, day] = dateOnly.map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

/**
 * Aviso de renovação da assinatura.
 *
 * Aparece em dois momentos:
 *  - a renovação vence em até 2 dias ("Renovação próxima");
 *  - a renovação já venceu e a assinatura está dentro da carência de 7 dias
 *    ("Assinatura atrasada").
 *
 * O estado e a data saem sempre do módulo de domínio (`subscriptionAccess`),
 * que é a mesma regra usada pelo backend — a interface não recalcula nada.
 */
export default function RenewalReminderCard({ subscription, group, onRenew, variant }) {
  const state = subscriptionAccessState(subscription);
  const overdue = state === ACCESS_OVERDUE;
  const days = daysUntilRenewal(subscription);
  const expiringSoon = !overdue && days !== null && days <= RENEWAL_REMINDER_DAYS;

  // Nada a avisar: assinatura em dia e ainda longe do vencimento.
  if (!overdue && !expiringSoon) return null;

  const tone = variant || (overdue ? 'danger' : 'warning');
  const groupName = group?.name || subscription?.group?.name || 'seu grupo';
  const renewalDate = subscriptionRenewalDate(subscription);

  // Fim da carência: a data limite para regularizar antes de ser cancelada.
  const graceEnd = renewalDate ? addDays(renewalDate, OVERDUE_GRACE_DAYS) : null;

  const title = overdue ? 'Assinatura atrasada' : 'Renovação próxima';
  const text = overdue
    ? `A renovação do ${groupName} venceu em ${formatDateBR(renewalDate)}. Você tem até ${formatDateBR(graceEnd)} (${OVERDUE_GRACE_DAYS} dias) para regularizar — depois disso sua assinatura é cancelada.`
    : `Sua assinatura do ${groupName} renova em ${formatDateBR(renewalDate)}. Renove agora para não perder o acesso.`;

  const Icon = overdue ? AlertTriangle : Clock;

  return (
    <div className={`rrc-card ${tone === 'danger' ? 'is-danger' : 'is-warning'}`}>
      <span className="rrc-icon"><Icon size={18} /></span>
      <div className="rrc-body">
        <strong className="rrc-title">{title}</strong>
        <p className="rrc-text">{text}</p>
        {onRenew && (
          <button
            type="button"
            className="btn btn-primary btn-sm rrc-btn"
            // O card costuma ficar dentro de outro elemento clicável (o card
            // do carrossel): sem isso o clique abriria os dois.
            onClick={(e) => {
              e.stopPropagation();
              onRenew();
            }}
          >
            <RefreshCw size={14} /> Renovar agora
          </button>
        )}
      </div>
    </div>
  );
}
