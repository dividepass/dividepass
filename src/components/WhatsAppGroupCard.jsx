import { ArrowRight } from 'lucide-react';
import WhatsAppIcon from './WhatsAppIcon';
import { useWhatsappVipUrl } from '../hooks/useWhatsappVipUrl';
import './WhatsAppGroupCard.css';

/**
 * Card de convite do Grupo Oficial da DividePass no WhatsApp.
 *
 * Aparece no dashboard (/dashboard) logo acima do card de feedback.
 * O objetivo é simples: fazer a pessoa entrar no grupo oficial, onde
 * saem as vagas assim que aparecem.
 *
 * O link vem de `useWhatsappVipUrl` — a configuração `whatsapp_vip_url` do
 * banco, que o admin edita em Configurações. O mesmo link aparece no chip
 * do cabeçalho, no rodapé e na home.
 */
export default function WhatsAppGroupCard({
  url: urlOverride,
  title = 'Grupo Oficial da DividePass',
  description = '💜 Entre no nosso Grupo Oficial da DividePass no WhatsApp e fique por dentro de todas as vagas que surgirem!',
}) {
  const whatsappVipUrl = useWhatsappVipUrl();
  const url = urlOverride || whatsappVipUrl;
  return (
    <section className="wa-group-card" aria-label="Convite para o Grupo Oficial da DividePass no WhatsApp">
      {/* Brilhos decorativos — dão profundidade sem competir com o texto. */}
      <span className="wa-group-glow wa-group-glow-a" aria-hidden="true" />
      <span className="wa-group-glow wa-group-glow-b" aria-hidden="true" />

      {/* Marca d'água com o glifo do WhatsApp. */}
      <span className="wa-group-watermark" aria-hidden="true">
        <WhatsAppIcon size={150} />
      </span>

      <div className="wa-group-icon" aria-hidden="true">
        <WhatsAppIcon size={30} />
      </div>

      <div className="wa-group-body">
        <strong className="wa-group-title">{title}</strong>
        <p className="wa-group-desc">{description}</p>

        <a
          className="wa-group-btn"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Entrar no Grupo Oficial da DividePass no WhatsApp"
        >
          <WhatsAppIcon size={18} />
          Entrar no grupo
          <ArrowRight size={18} className="wa-group-btn-arrow" />
        </a>
      </div>
    </section>
  );
}
