import { useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { useEngagement } from '../hooks/useEngagement';
import './engagement.css';

/**
 * "Avise-me quando houver uma vaga".
 *
 * Salva o serviço na lista de espera do usuário (tabela `group_interest`, a
 * mesma que o admin já acompanha). Quando um grupo novo abrir para aquele
 * serviço, a edge function `notify-service-watchers` avisa a pessoa.
 *
 * Sem serviço → não renderiza. Com serviço já lotado, vira a porta de entrada
 * do card de recomendação.
 */
export default function WatchlistButton({
  serviceId,
  label = 'Avise-me quando houver uma vaga',
  activeLabel = 'Você será avisado(a)',
  size = 'md',
  block = false,
  onToggle,
}) {
  const { isWatching, toggleWatch } = useEngagement();
  const [busy, setBusy] = useState(false);

  if (!serviceId) return null;

  const watching = isWatching(serviceId);

  const handleClick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const result = await toggleWatch(serviceId);
      if (result.ok && onToggle) onToggle(result.watching);
    } finally {
      setBusy(false);
    }
  };

  const className = [
    'watch-btn',
    size === 'sm' ? 'watch-btn--sm' : '',
    block ? 'watch-btn--block' : '',
    watching ? 'watch-btn--active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={busy}
      aria-pressed={watching}
      title={watching ? 'Você vai ser avisado quando abrir uma vaga' : label}
    >
      {watching ? <BellRing size={14} /> : <Bell size={14} />}
      {watching ? activeLabel : label}
    </button>
  );
}
