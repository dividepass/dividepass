import { Megaphone, MegaphoneOff, EyeOff } from 'lucide-react';
import './AdsToggle.css';

/**
 * Seletor "a conta compartilhada tem anúncios?".
 *
 * Aparece no wizard do usuário (etapa 3, logo abaixo do tipo de conta) e no
 * painel admin (criar/editar grupo).
 *
 * `value`:
 *   true  = "Com anúncios"  → selo âmbar no card
 *   false = "Sem anúncios"  → selo verde no card
 *   null  = "Não mostrar"   → grupo fica SEM selo no card (padrão)
 */
export default function AdsToggle({ value, onChange, disabled = false, hint = '' }) {
  return (
    <div className="ads-toggle-wrap">
      <div className="ads-toggle" role="radiogroup" aria-label="A conta compartilhada tem anúncios?">
        <button
          type="button"
          role="radio"
          aria-checked={value === true}
          disabled={disabled}
          className={`ads-option ads-option-with ${value === true ? 'active' : ''}`}
          onClick={() => onChange(true)}
        >
          <Megaphone size={15} />
          <span>Com anúncios</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === false}
          disabled={disabled}
          className={`ads-option ads-option-without ${value === false ? 'active' : ''}`}
          onClick={() => onChange(false)}
        >
          <MegaphoneOff size={15} />
          <span>Sem anúncios</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === null || value === undefined}
          disabled={disabled}
          className={`ads-option ads-option-hidden ${value === null || value === undefined ? 'active' : ''}`}
          onClick={() => onChange(null)}
        >
          <EyeOff size={15} />
          <span>Não mostrar</span>
        </button>
      </div>
      {hint && <p className="ads-hint">{hint}</p>}
    </div>
  );
}
