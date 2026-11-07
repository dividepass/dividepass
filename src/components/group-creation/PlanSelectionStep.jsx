import { Check, Tv, Info } from 'lucide-react';
import { brl } from '../../lib/platformFee';
import { planDetailLines, planSlotRange, planSlotRangeText } from '../../lib/platformPlans';
import AdsToggle from '../AdsToggle';
import './GroupCreation.css';

const PLAN_TYPES = [
  'Conta Individual', 'Conta Padrão', 'Conta Premium', 'Conta VIP', 'Conta Go',
  'Conta Light', 'Conta Enterprise', 'Conta Team', 'Conta PRO', 'Conta PRO+',
  'Conta PLUS', 'Conta MAX', 'Conta Educação', 'Conta Duo', 'Conta Família',
];

/**
 * ETAPA 2 — PLANO
 *
 * Quando a plataforma tem planos cadastrados (admin define em
 * /admin/platforms/new), o dono escolhe UM deles: é esse plano que dá o teto
 * de preço do grupo, a quantidade máxima de membros e os detalhes (qualidade,
 * telas simultâneas) exibidos no card.
 *
 * Quando a plataforma NÃO tem planos, o grupo é criado sem vínculo de plano e
 * o dono informa o tipo de conta livremente.
 */
export default function PlanSelectionStep({
  plans = [],
  value = {},
  onChange,
  hasAdsColumn = false,
}) {
  const {
    plan_id = '',
    plan_type = '',
    plan_type_custom = '',
    custom_plan_active = false,
    has_ads = null,
  } = value;

  const set = (patch) => onChange?.(patch);
  const hasPlatformPlans = plans.length > 0;

  if (hasPlatformPlans) {
    return (
      <div className="gc-plan-list">
        {plans.map((plan) => {
          const selected = plan_id === plan.id;
          const details = planDetailLines(plan);
          const range = planSlotRange(plan);
          const rangeText = planSlotRangeText(plan, (v) => `R$ ${brl(v)}`);

          return (
            <button
              key={plan.id}
              type="button"
              className={`gc-plan ${selected ? 'selected' : ''}`}
              onClick={() => set({
                plan_id: plan.id,
                plan_type: plan.name,
                plan_type_custom: '',
                custom_plan_active: false,
              })}
            >
              <div className="gc-plan-head">
                <span className="gc-plan-name">
                  <Tv size={16} />
                  {plan.name}
                  {selected && <Check size={16} className="gc-plan-check" />}
                </span>
                <span className="gc-plan-price">
                  R$ {brl(plan.official_price)}
                  <small>por mês na plataforma</small>
                </span>
              </div>

              {details.length > 0 && (
                <ul className="gc-plan-details">
                  {details.map((line) => (
                    <li key={line}>
                      <Info size={13} />
                      <span>{line}</span>
                    </li>
                  ))}
                  {/* O teto do plano aparece aqui para a pessoa saber o
                     intervalo antes de escolher — e nao descobrir so na
                     etapa de pagamento. */}
                  {rangeText && (
                    <li>
                      <Info size={13} />
                      <span>
                        Cobrança: <strong>{rangeText}</strong>
                        {range.suggested ? ` · sugestão R$ ${brl(range.suggested)} por pessoa` : ''}
                      </span>
                    </li>
                  )}
                </ul>
              )}
            </button>
          );
        })}

        {hasAdsColumn && (
          <div className="gc-field" style={{ marginTop: '0.6rem' }}>
            <label>A conta compartilhada tem anúncios?</label>
            <AdsToggle
              value={has_ads}
              onChange={(v) => set({ has_ads: v })}
              hint="O membro vê esse selo no card do grupo. Se preferir não informar, escolha “Não mostrar” e o grupo fica sem selo."
            />
          </div>
        )}
      </div>
    );
  }

  /* Sem planos cadastrados para a plataforma: tipo de conta livre. */
  return (
    <>
      <div className="gc-note warn" style={{ marginTop: 0, marginBottom: '1rem' }}>
        <Info size={16} />
        <span>
          Esta plataforma ainda não tem planos cadastrados, então o grupo fica <strong>sem vínculo de plano</strong>.
          Informe o tipo de conta que você compartilha.
        </span>
      </div>

      <div className="gc-tag-list">
        {PLAN_TYPES.map((pt) => (
          <button
            key={pt}
            type="button"
            className={`gc-tag ${!custom_plan_active && plan_type === pt ? 'active' : ''}`}
            onClick={() => set({ plan_type: pt, plan_type_custom: '', custom_plan_active: false })}
          >
            {pt}
          </button>
        ))}
        <button
          type="button"
          className={`gc-tag ${custom_plan_active ? 'active' : ''}`}
          onClick={() => set({ custom_plan_active: true, plan_type: '' })}
        >
          Personalizado
        </button>
      </div>

      {custom_plan_active && (
        <div className="gc-field" style={{ marginTop: '1rem' }}>
          <label>Tipo de conta personalizado *</label>
          <input
            value={plan_type_custom}
            onChange={(e) => set({ plan_type_custom: e.target.value })}
            placeholder="Ex: Netflix Premium 4K"
            autoFocus
          />
        </div>
      )}

      {hasAdsColumn && (
        <div className="gc-field" style={{ marginTop: '1rem' }}>
          <label>A conta compartilhada tem anúncios?</label>
          <AdsToggle
            value={has_ads}
            onChange={(v) => set({ has_ads: v })}
            hint="O membro vê esse selo no card do grupo. Se preferir não informar, escolha “Não mostrar” e o grupo fica sem selo."
          />
        </div>
      )}
    </>
  );
}
