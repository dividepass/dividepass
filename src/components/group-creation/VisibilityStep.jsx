import { Globe, Lock, Info } from 'lucide-react';
import './GroupCreation.css';

/**
 * ETAPA — VISIBILIDADE NA PLATAFORMA
 *
 * "Público": qualquer pessoa encontra o grupo e pode entrar pagando.
 * "Privado": o grupo não aparece no catálogo — entra por convite ou pelo link.
 */
export default function VisibilityStep({ value = 'public', onChange }) {
  const options = [
    {
      key: 'public',
      icon: Globe,
      title: 'Público',
      desc: 'Aberto a todos',
      hint: 'Aparece no catálogo da plataforma e qualquer pessoa pode entrar pagando a sua cota.',
    },
    {
      key: 'private',
      icon: Lock,
      title: 'Privado',
      desc: 'Apenas com link',
      hint: 'Não aparece no catálogo. Só entra quem receber o convite ou o link de acesso.',
    },
  ];

  return (
    <>
      <p className="gc-section-label">VISIBILIDADE NA PLATAFORMA</p>

      <div className="gc-visibility-grid">
        {options.map((opt) => {
          const Icon = opt.icon;
          const selected = value === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              className={`gc-visibility-card ${selected ? 'selected' : ''}`}
              onClick={() => onChange?.(opt.key)}
              aria-pressed={selected}
            >
              <span className={`gc-visibility-icon is-${opt.key}`}>
                <Icon size={22} />
              </span>
              <span className="gc-visibility-title">{opt.title}</span>
              <span className="gc-visibility-desc">{opt.desc}</span>
            </button>
          );
        })}
      </div>

      <div className="gc-note info">
        <Info />
        <span>
          {value === 'private'
            ? 'Grupo privado: ele não aparece no catálogo da plataforma. Compartilhe o link ou convide os membros.'
            : 'Grupo público: ele aparece no catálogo da plataforma e qualquer pessoa pode entrar pagando a sua cota.'}
        </span>
      </div>
    </>
  );
}
