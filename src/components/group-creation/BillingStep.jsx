import './GroupCreation.css';

const CYCLE_OPTIONS = [
  { value: 'monthly', label: 'Mensal' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'semiannual', label: 'Semestral' },
  { value: 'annual', label: 'Anual' },
];

/**
 * ETAPA — PAGAMENTOS (parte 1: ciclos)
 *
 * Ciclos que os membros podem contratar. A quantidade de vagas é definida na
 * etapa do PLANO (que usa o limite do plano da plataforma como teto) e as
 * REGRAS DO GRUPO ficam na etapa do GRUPO.
 */
export default function BillingStep({
  value = {},
  onChange,
}) {
  const {
    available_cycles = ['monthly'],
    custom_cycle_enabled = false,
    custom_cycle_months = 2,
    custom_cycle_label = '',
    days_cycle_enabled = false,
    days_cycle_days = 15,
    days_cycle_label = '',
  } = value;

  const set = (patch) => onChange?.(patch);

  const toggleCycle = (cycle) => {
    const current = available_cycles || [];
    const updated = current.includes(cycle)
      ? current.filter((c) => c !== cycle)
      : [...current, cycle];
    set({ available_cycles: updated.length ? updated : current });
  };

  return (
    <>
      <div className="gc-field">
        <label>Ciclos que os membros podem escolher *</label>
        <div className="gc-tag-list">
          {CYCLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`gc-tag ${available_cycles.includes(opt.value) ? 'active' : ''}`}
              onClick={() => toggleCycle(opt.value)}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            className={`gc-tag ${days_cycle_enabled ? 'active' : ''}`}
            onClick={() => set({ days_cycle_enabled: !days_cycle_enabled })}
          >
            Dias
          </button>
          <button
            type="button"
            className={`gc-tag ${custom_cycle_enabled ? 'active' : ''}`}
            onClick={() => set({ custom_cycle_enabled: !custom_cycle_enabled })}
          >
            Personalizado
          </button>
        </div>
      </div>

      {days_cycle_enabled && (
        <div className="gc-grid-2">
          <div className="gc-field">
            <label>Quantidade de dias *</label>
            <input
              type="number"
              min="1"
              max="365"
              value={days_cycle_days}
              onChange={(e) => set({ days_cycle_days: e.target.value })}
            />
          </div>
          <div className="gc-field">
            <label>Nome do ciclo *</label>
            <input
              value={days_cycle_label}
              onChange={(e) => set({ days_cycle_label: e.target.value })}
              placeholder="Ex: 15 dias"
            />
          </div>
        </div>
      )}

      {custom_cycle_enabled && (
        <div className="gc-grid-2">
          <div className="gc-field">
            <label>Meses do ciclo *</label>
            <input
              type="number"
              min="1"
              max="36"
              value={custom_cycle_months}
              onChange={(e) => set({ custom_cycle_months: e.target.value })}
            />
          </div>
          <div className="gc-field">
            <label>Nome do ciclo *</label>
            <input
              value={custom_cycle_label}
              onChange={(e) => set({ custom_cycle_label: e.target.value })}
              placeholder="Ex: Bimestral"
            />
          </div>
        </div>
      )}
    </>
  );
}
