import { Info } from 'lucide-react';
import { brl, simulatePrice, MIN_PRICE_PER_SLOT } from '../../lib/platformFee';
import { useAuth } from '../../hooks/useAuth';
import {
  planSlotRange, planSlotRangeText, planTotalRange, pricePerSlot, planBasePrice, planOfficialPrice,
  suggestedGroupTotal, slotPriceOutOfRange, GROUP_PLAN_MARKUP,
} from '../../lib/platformPlans';
import {
  PIX_TYPE_OPTIONS as PIX_TYPES, pixTypePlaceholder, maskPixKey, remaskPixKey,
} from '../../lib/pixKeyMask';
import './GroupCreation.css';

/**
 * ETAPA — PAGAMENTO
 *
 * Só os campos de dinheiro: chave PIX, taxa de adesão (definida pela
 * DividePass) e o valor do grupo. O total é o valor do plano + 8% fracionado
 * pelas vagas abertas — o preço por pessoa é o que o membro paga.
 *
 * O TETO DO PLANO é por pessoa: o dono não pode cobrar de cada membro mais
 * (nem menos) do que o min_price/max_price do plano permitem. O aviso aqui é
 * apenas informativo — quem bloqueia a criação é a validação da etapa.
 *
 * O resumo do grupo fica na etapa seguinte.
 */
export default function PaymentStep({
  value = {},
  onChange,
  plan = null,
  hasPixColumn = true,
}) {
  const {
    pix_key = '',
    pix_type = 'cpf',
    entrance_fee = 15,
    price_total = '',
    slots = 1,
  } = value;

  const set = (patch) => onChange?.(patch);

  // O admin da plataforma não passa pelo piso de R$ 5,00 por vaga.
  const { isAdmin } = useAuth();

  const range = planSlotRange(plan);
  const totalRange = planTotalRange(plan, slots);
  const minPrice = MIN_PRICE_PER_SLOT;
  const base = planBasePrice(plan);
  const official = planOfficialPrice(plan);

  const total = parseFloat(price_total) || 0;
  const perSlot = pricePerSlot(total, slots);
  const simulation = simulatePrice(perSlot, isAdmin);
  const markup = Math.round(GROUP_PLAN_MARKUP * 100);

  // A faixa do plano vale para o valor POR PESSOA; o total do grupo é essa
  // faixa levada para o número de vagas.
  const outOfRange = slotPriceOutOfRange(plan, perSlot);

  // Sugestão do plano: valor sugerido (por pessoa) x vagas, ou o preço
  // oficial + 8% quando o plano não tem valor sugerido.
  const suggestedTotal = plan ? suggestedGroupTotal(plan, slots) : 0;
  const suggestedPerSlot = suggestedTotal > 0 ? pricePerSlot(suggestedTotal, slots) : 0;

  return (
    <>
      <div className="gc-field">
        <label>PIX para transferir o valor *</label>
        <input
          value={pix_key}
          onChange={(e) => set({ pix_key: maskPixKey(e.target.value, pix_type) })}
          placeholder={pixTypePlaceholder(pix_type)}
          inputMode={pix_type === 'email' || pix_type === 'random' ? 'text' : 'numeric'}
          autoFocus
        />
        <div className="gc-tag-list" style={{ marginTop: '0.45rem' }}>
          {PIX_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`gc-tag ${pix_type === t.value ? 'active' : ''}`}
              onClick={() => set({
                pix_key: remaskPixKey(pix_key, pix_type, t.value),
                pix_type: t.value,
              })}
            >
              {t.label}
            </button>
          ))}
        </div>
        {!hasPixColumn && (
          <div className="gc-note warn">
            <Info size={15} />
            <span>
              A coluna <code>pix_key</code> ainda não existe no banco, então a chave não será gravada.
              Aplique a migration <code>database/add-group-pix.sql</code> no SQL Editor do Supabase.
            </span>
          </div>
        )}
      </div>

      <div className="gc-fee-line">
        <span>Taxa de adesão</span>
        <strong>
          {parseFloat(entrance_fee) > 0 ? `R$ ${brl(parseFloat(entrance_fee))}` : 'Sem taxa'}
        </strong>
        <small>
          cobrada pela plataforma a cada novo membro que entra no grupo, uma única vez por membro
        </small>
      </div>

      <div className="gc-field">
        <label>Valor total do grupo (R$) *</label>
        <input
          type="number"
          step="0.01"
          min={totalRange.min ?? 0}
          max={totalRange.max ?? undefined}
          value={price_total}
          onChange={(e) => set({ price_total: e.target.value })}
          placeholder="0,00"
        />

        {plan && suggestedTotal > 0 ? (
          <div className="gc-price-box">
            <span>
              {official > 0
                ? <>Plano de <strong>R$ {brl(official)}</strong> na plataforma</>
                : <>Sugestão do plano</>}
              {range.suggested ? <> · sugerido <strong>R$ {brl(range.suggested)}</strong> por pessoa</> : null}
            </span>
            <button
              type="button"
              className="gc-suggestion"
              onClick={() => set({ price_total: String(suggestedTotal) })}
            >
              {range.suggested
                ? `Usar R$ ${brl(suggestedPerSlot)} por pessoa`
                : `Usar R$ ${brl(suggestedTotal)}`}
            </button>
          </div>
        ) : (
          <small>Defina quanto o grupo vai cobrar por mês, no total.</small>
        )}

        {plan && base > 0 && !range.suggested && (
          <small className="gc-field-hint">
            O total sugerido é o valor do plano ({markup}% de margem) dividido pelas {slots} vaga(s).
          </small>
        )}

        {plan && (range.min || range.max) && (
          <div className="gc-note info">
            <Info size={15} />
            <span>
              Este plano permite cobrar <strong>{planSlotRangeText(plan, (v) => `R$ ${brl(v)}`)}</strong>
              {slots > 1 ? ` (R$ ${brl(totalRange.min || 0)}${totalRange.max ? ` a R$ ${brl(totalRange.max)}` : ''} no total de ${slots} vagas)` : ''}.
            </span>
          </div>
        )}

        {total > 0 && (
          <div className="gc-per-slot">
            <span>
              {slots > 1 ? `Dividido por ${slots} vagas` : 'Grupo com 1 vaga'}
            </span>
            <strong>
              R$ {brl(perSlot)} <small>por pessoa / mês</small>
            </strong>
          </div>
        )}
      </div>

      {perSlot > 0 && (
        <div className="gc-simulation">
          <h3>Simulação de recebimento</h3>
          <div className="gc-simulation-row is-client">
            <span>Valor cobrado do cliente</span>
            <strong>R$ {brl(simulation.price)}</strong>
          </div>
          <div className="gc-simulation-row is-fee">
            <span>Valor da plataforma</span>
            <strong>-R$ {brl(simulation.platformFee)}</strong>
          </div>
          <div className="gc-simulation-row is-net">
            <span>Você recebe</span>
            <strong>R$ {brl(simulation.net)}</strong>
          </div>
        </div>
      )}

      {simulation.belowMinimum && (
        <div className="gc-note warn">
          <Info size={15} />
          <span>
            O valor por pessoa ficou abaixo do mínimo da plataforma (R$ {brl(minPrice)}). Aumente o total
            ou abra mais vagas.
          </span>
        </div>
      )}

      {outOfRange.outOfRange && (
        <div className="gc-note warn">
          <Info size={15} />
          <span>
            O valor por pessoa (R$ {brl(perSlot)}) está fora da faixa deste plano
            {outOfRange.min ? ` (de R$ ${brl(outOfRange.min)}` : ''}
            {outOfRange.min && outOfRange.max ? ' a ' : ''}
            {outOfRange.max ? `R$ ${brl(outOfRange.max)}` : ''}
            ). Ajuste o total para conseguir criar o grupo.
          </span>
        </div>
      )}
    </>
  );
}
