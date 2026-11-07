import { Check } from 'lucide-react';
import './GroupCreation.css';

/**
 * Trilha de etapas do wizard de criação de grupo.
 * Usada pelas duas rotas:
 *   - /dashboard/my-groups/create  (usuário)
 *   - /admin/groups/new            (admin)
 */
export default function WizardSteps({ steps = [], current = 0, onNavigate }) {
  return (
    <ol className="gc-steps">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const Icon = step.icon;

        return (
          <li
            key={step.key}
            className={`gc-step ${done ? 'done' : ''} ${active ? 'active' : ''}`}
          >
            <button
              type="button"
              className="gc-step-btn"
              onClick={() => onNavigate?.(index)}
              disabled={index > current}
              title={step.title}
            >
              <span className="gc-step-dot">
                {done ? <Check size={14} /> : (Icon ? <Icon size={13} /> : index + 1)}
              </span>
              <span className="gc-step-label">{step.title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
