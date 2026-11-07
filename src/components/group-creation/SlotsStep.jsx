import { Minus, Plus, Info } from 'lucide-react';
import { brl, simulatePrice } from '../../lib/platformFee';
import {
  GROUP_PLAN_MARKUP,
  maxSlotsFor,
  planBasePrice,
  planSlotRange,
  pricePerSlot,
  suggestedGroupTotal,
} from '../../lib/platformPlans';
import './GroupCreation.css';

/**
 * ETAPA — VAGAS DISPONÍVEIS
 *
 * Quantas vagas o grupo vai abrir. O limite vem do plano da plataforma
 * (`max_members`); sem plano, vale o limite da plataforma
 * (`streaming_services.max_group_size`).
 *
 * O total do grupo é o valor do plano + 8%, e ele é fracionado entre as
 * vagas — o preço por pessoa é o que o membro paga todo mês.
 *
 * A caixa verde mostra quanto o dono recebe por mês se todas as vagas forem
 * preenchidas (mesma conta da simulação da etapa de pagamento: valor menos a
 * taxa da plataforma).
 */
export default function SlotsStep({
  value = {},
  onChange,
  plan = null,
  service = null,
}) {
  const slots = Math.max(1, parseInt(value.slots, 10) || 1);
  const maxSlots = maxSlotsFor(plan, service);

  const base = planBasePrice(plan);
  const range = planSlotRange(plan);
  /* O total depende do numero de vagas: o valor sugerido do plano (por
     pessoa) x vagas, ou o preco oficial + 8% quando o plano nao tem sugestao. */
  const total = suggestedGroupTotal(plan, slots);
  const perSlot = pricePerSlot(total, slots);
  const simulation = simulatePrice(perSlot);
  // Liquido do dono por mes com todas as vagas preenchidas.
  const monthlyNet = Math.round(simulation.net * slots * 100) / 100;
  const markup = Math.round(GROUP_PLAN_MARKUP * 100);

  const setSlots = (next) => {
    const clamped = Math.min(Math.max(next, 1), maxSlots);
    onChange?.({ slots: clamped });
  };

  return (
    <>
      <div className="gc-slots-card">
        <p className="gc-section-label">VAGAS DISPONÍVEIS</p>

        <div className="gc-stepper">
          <button
            type="button"
            className="gc-stepper-btn"
            onClick={() => setSlots(slots - 1)}
            disabled={slots <= 1}
            aria-label="Diminuir vagas"
          >
            <Minus size={18} />
          </button>

          <span className="gc-stepper-value">{slots}</span>

          <button
            type="button"
            className="gc-stepper-btn"
            onClick={() => setSlots(slots + 1)}
            disabled={slots >= maxSlots}
            aria-label="Aumentar vagas"
          >
            <Plus size={18} />
          </button>
        </div>

        {total > 0 ? (
          <div className="gc-receive-box">
            <span>
              Você receberá: <strong>R$ {brl(monthlyNet)}</strong>/mês
            </span>
            <small>
              {slots > 1
                ? `com as ${slots} vagas preenchidas · cada membro paga R$ ${brl(perSlot)}`
                : 'com a vaga preenchida'}
            </small>
          </div>
        ) : (
          <div className="gc-receive-box is-empty">
            <span>
              Você receberá: <strong>—</strong>/mês
            </span>
            <small>Escolha um plano com valor para ver a sua receita.</small>
          </div>
        )}
      </div>

      <div className="gc-note info">
        <Info size={15} />
        <span>
          {plan
            ? `O plano ${plan.name} permite até ${maxSlots} membro(s) — o grupo não pode passar disso.`
            : `Esta plataforma permite até ${maxSlots} membro(s) por grupo.`}
          {range.suggested
            ? ` Cada membro paga R$ ${brl(range.suggested)} — total de R$ ${brl(total)} com ${slots} vaga(s).`
            : base > 0 && ` O total do grupo é R$ ${brl(base)} (plano) + ${markup}% = R$ ${brl(total)}, dividido pelas vagas.`}
        </span>
      </div>
    </>
  );
}
