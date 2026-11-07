import { useState } from 'react';

/**
 * Logo do serviço (imagem da marca ou emoji).
 * O mesmo tratamento dos cards já existentes: imagem contida sobre um
 * tile colorido, senão a marca "flutua" dentro do fundo.
 *
 * Se a URL da imagem estiver quebrada (acontece com serviço antigo no banco),
 * cai para a inicial em vez de mostrar o ícone de imagem quebrada.
 */
export default function ServiceLogo({ service, className = '', style }) {
  const [failed, setFailed] = useState(false);

  if (!service) return null;

  const name = service.name || service.full_name || '';
  const initial = (service.icon || name || '?').charAt(0).toUpperCase();
  const showImage = service.icon_url && !failed;

  return (
    <div
      className={className}
      style={{ backgroundColor: service.color || 'var(--surface-soft)', ...style }}
      aria-hidden="true"
    >
      {showImage ? (
        <img src={service.icon_url} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}
