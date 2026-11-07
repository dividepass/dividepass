import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Megaphone } from 'lucide-react';
import ServiceLogo from './ServiceLogo';
import { useEngagement } from '../hooks/useEngagement';
import { registerSponsorClick, registerSponsorMetric } from '../lib/catalogEngagement';
import './engagement.css';

/**
 * "Ofertas patrocinadas no catálogo".
 *
 * Área comprada por parceiros: o serviço aparece destacado no topo do
 * catálogo e/ou dentro dos "Recomendados para você". É o espaço que a
 * plataforma vende — por isso o badge é explícito ("Oferta em destaque") e o
 * crédito do patrocinador fica sempre visível.
 *
 * As ofertas vêm do banco (`sponsored_offers`). Se a migration ainda não foi
 * aplicada, a lista vem vazia e a seção simplesmente não aparece.
 */

/** Para onde o clique do anúncio leva. */
function resolveTarget(offer) {
  if (offer.cta_url) return { external: true, href: offer.cta_url };
  if (offer.service) {
    return { external: false, to: `/dashboard/catalog/${offer.service.slug || offer.service.id}` };
  }
  if (offer.group) {
    const svc = offer.group.service;
    if (svc) return { external: false, to: `/dashboard/catalog/${svc.slug || svc.id}` };
    if (offer.group.slug) return { external: false, to: `/dashboard/groups/${offer.group.slug}` };
  }
  return null;
}

/**
 * Conta a IMPRESSÃO do anúncio uma vez, quando ele aparece na tela.
 *
 * Antes isso não existia: `impressions` era lido no painel do admin mas
 * nunca escrito por ninguém — a coluna ficava em 0 para sempre.
 *
 * O `IntersectionObserver` conta só o que o usuário realmente viu (o
 * anúncio do catálogo é o primeiro da lista, mas o card de "Ofertas de
 * parceiros" fica lá embaixo e nem sempre entra na tela). Sem
 * IntersectionObserver — navegador antigo ou teste em Node — conta na
 * montagem, que é o melhor palpite disponível.
 */
function useSponsorImpression(offerId) {
  const ref = useRef(null);
  const counted = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !offerId) return undefined;

    const mark = () => {
      if (counted.current) return;
      counted.current = true;
      registerSponsorMetric(offerId, 'impression');
    };

    if (typeof IntersectionObserver === 'undefined') {
      mark();
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          mark();
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [offerId]);

  return ref;
}

function SponsoredCard({ offer, compact = false }) {
  const target = resolveTarget(offer);
  const service = offer.service || offer.group?.service || null;
  const ctaLabel = offer.cta_label || 'Ver oferta';
  const cardRef = useSponsorImpression(offer.id);

  const handleClick = () => {
    registerSponsorClick(offer.id);
  };

  const cta = target ? (
    target.external ? (
      <a
        className="sponsored-cta"
        href={target.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
      >
        {ctaLabel}
        <ArrowRight size={14} />
      </a>
    ) : (
      <Link className="sponsored-cta" to={target.to} onClick={handleClick}>
        {ctaLabel}
        <ArrowRight size={14} />
      </Link>
    )
  ) : null;

  const hasBanner = !compact && !!offer.banner_url;

  return (
    <article
      ref={cardRef}
      className={[
        'sponsored-card',
        compact ? 'sponsored-card--compact' : '',
        !compact && !hasBanner ? 'sponsored-card--no-banner' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {hasBanner && (
        <img className="sponsored-banner" src={offer.banner_url} alt="" loading="lazy" />
      )}

      <div className="sponsored-card-body">
        {/* O selo vive dentro do corpo: com banner ele flutua por cima da
            imagem (position absolute), sem banner ele entra no fluxo e não
            cobre o título. */}
        <span className="sponsored-badge">{offer.badge || 'Oferta em destaque'}</span>

        <h3>{offer.headline}</h3>

        {offer.description && <p>{offer.description}</p>}

        {service && (
          <span className="sponsored-service">
            <ServiceLogo service={service} className="sponsored-service-logo" />
            {service.name}
          </span>
        )}

        {compact ? (
          cta && <div className="sponsored-foot">{cta}</div>
        ) : (
          <div className="sponsored-foot">
            <span className="sponsored-sponsor">Patrocinado por {offer.sponsor_name}</span>
            {cta}
          </div>
        )}
      </div>
    </article>
  );
}

export default function SponsoredOffers({
  offers,
  placement = 'catalog',
  variant = 'grid',
  title,
  subtitle,
  showHeader = true,
}) {
  const { sponsoredOffers } = useEngagement();

  const list = (offers || sponsoredOffers || [])
    .filter((offer) => offer.placement === placement || offer.placement === 'both')
    .slice(0, variant === 'compact' ? 3 : 6);

  // Sem oferta ativa, a seção não existe — nada de moldura vazia na tela.
  if (list.length === 0) return null;

  const compact = variant === 'compact';

  return (
    <section className="sponsored-section">
      {showHeader && (
        <div className="sponsored-header">
          <div>
            <span className="sponsored-kicker">
              <Megaphone size={12} /> Ofertas patrocinadas
            </span>
            <h2>{title || 'Oferta em destaque'}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
      )}

      <div className={`sponsored-grid${compact ? ' sponsored-grid--compact' : ''}`}>
        {list.map((offer) => (
          <SponsoredCard key={offer.id} offer={offer} compact={compact} />
        ))}
      </div>
    </section>
  );
}
