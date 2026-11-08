import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Megaphone, Flame } from 'lucide-react';
import { useEngagement } from '../hooks/useEngagement';
import { fetchTopSoldServices, fmtBRL } from '../lib/dashboardInsights';
import { registerSponsorClick, registerSponsorMetric } from '../lib/catalogEngagement';
import './dashboard-insights.css';

/**
 * Banner slider do catálogo.
 *
 * É a vitrine do topo: mostra as ofertas dos parceiros (o espaço comprado) e
 * as plataformas em alta, no formato de banner grande — no celular dá para
 * arrastar com o dedo.
 *
 * O antigo card "Oferta em destaque" (um retângulo com texto) foi trocado por
 * isto: banner com imagem de fundo, logo do serviço, título curto e um botão
 * de verdade. O clique passa a ter para onde ir.
 */
export default function CatalogBannerSlider({ services = [], groups = [] }) {
  const { sponsoredOffers } = useEngagement();
  const [topSlides, setTopSlides] = useState([]);
  const [index, setIndex] = useState(0);
  const trackRef = useRef(null);

  /* Plataformas em alta → viram banner quando não há oferta patrocinada. */
  useEffect(() => {
    let alive = true;
    fetchTopSoldServices({ limit: 4, services, groups })
      .then((result) => {
        if (!alive) return;
        setTopSlides(
          (result.items || [])
            .filter((item) => item.fromPrice > 0)
            .slice(0, 4)
            .map((item) => ({
              key: `top-${item.id}`,
              kind: 'servico',
              badge: item.savingsPct > 0 ? `-${item.savingsPct}%` : 'Em alta',
              title: item.name,
              sub: 'A partir de',
              price: item.fromPrice,
              oldPrice: item.officialPrice,
              service: {
                id: item.id,
                name: item.name,
                slug: item.slug,
                icon_url: item.iconUrl,
                color: item.color,
              },
              href: `/dashboard/catalog/${item.slug || item.id}`,
            }))
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [services, groups]);

  const slides = useMemo(() => {
    const ofertas = (sponsoredOffers || [])
      .filter((offer) => offer.placement === 'catalog' || offer.placement === 'both')
      .slice(0, 4)
      .map((offer) => {
        const service = offer.service || offer.group?.service || null;
        const href = offer.cta_url
          ? offer.cta_url
          : service
            ? `/dashboard/catalog/${service.slug || service.id}`
            : offer.group?.slug
              ? `/dashboard/groups/${offer.group.slug}`
              : '/dashboard/catalog';
        return {
          key: `oferta-${offer.id}`,
          kind: 'oferta',
          badge: offer.badge || 'Oferta em destaque',
          title: offer.headline,
          sub: offer.subtitle || (service ? service.name : null),
          sponsor: offer.sponsor_name,
          image: offer.banner_url,
          service,
          href,
          offerId: offer.id,
        };
      });

    // Sem oferta de parceiro, a vitrine mostra as plataformas em alta.
    return ofertas.length ? ofertas : topSlides;
  }, [sponsoredOffers, topSlides]);

  const aoRolar = () => {
    const track = trackRef.current;
    if (!track) return;
    const largura = track.clientWidth || 1;
    const atual = Math.round(track.scrollLeft / largura);
    setIndex(atual);
  };

  const ir = (dir) => {
    const track = trackRef.current;
    if (!track || !slides.length) return;
    const proximo = (index + dir + slides.length) % slides.length;
    setIndex(proximo);
    track.scrollTo({ left: proximo * track.clientWidth, behavior: 'smooth' });
  };

  /* O banner anda SOZINHO, um slide a cada 5 segundos — igual as fileiras da
     vitrine. Quando a pessoa encosta o mouse (ou o dedo) em cima, ele
     para: ninguém quer o banner mudando na hora de clicar. */
  const pausado = useRef(false);
  useEffect(() => {
    if (slides.length < 2) return undefined;
    const timer = setInterval(() => {
      if (pausado.current) return;
      ir(1);
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length, index]);

  if (!slides.length) return null;

  return (
    <section
      className="cat-banner"
      aria-label="Destaques"
      onMouseEnter={() => { pausado.current = true; }}
      onMouseLeave={() => { pausado.current = false; }}
    >
      <div className="cat-banner-track" ref={trackRef} onScroll={aoRolar}>
        {slides.map((slide) => (
          <Link
            key={slide.key}
            className={`cat-banner-card cat-banner-card--${slide.kind}`}
            to={slide.href}
            style={
              slide.service?.color
                ? { '--banner-color': `${slide.service.color}2E` }
                : undefined
            }
            onClick={() => {
              if (slide.offerId) {
                registerSponsorMetric(slide.offerId, 'impression');
                registerSponsorClick(slide.offerId);
              }
            }}
          >
            {slide.image && <img className="cat-banner-img" src={slide.image} alt="" loading="lazy" />}

            <div className="cat-banner-overlay" />

            <div className="cat-banner-content">
              <span className="cat-banner-badge">
                {slide.kind === 'oferta' ? <Megaphone size={12} /> : <Flame size={12} />}
                {slide.badge}
              </span>

              <div className="cat-banner-title-row">
                {slide.service?.icon_url && (
                  <span className="cat-banner-logo">
                    <img src={slide.service.icon_url} alt="" loading="lazy" />
                  </span>
                )}
                <h3 className="cat-banner-title">{slide.title}</h3>
              </div>

              {slide.sub && <p className="cat-banner-sub">{slide.sub}</p>}

              {slide.price > 0 ? (
                <div className="cat-banner-price">
                  <span className="cat-banner-price-old">
                    {slide.oldPrice > 0 && <s>{fmtBRL(slide.oldPrice)}</s>}
                  </span>
                  <span className="cat-banner-price-value">{fmtBRL(slide.price)}</span>
                  <small>/mês</small>
                </div>
              ) : (
                slide.sponsor && <p className="cat-banner-sponsor">por {slide.sponsor}</p>
              )}

              <span className="cat-banner-cta">
                {slide.kind === 'oferta' ? 'Ver oferta' : 'Ver grupos'}
                <ArrowRight size={15} />
              </span>
            </div>
          </Link>
        ))}
      </div>

      {slides.length > 1 && (
        <>
          <button
            type="button"
            className="cat-banner-nav cat-banner-nav--prev"
            onClick={() => ir(-1)}
            aria-label="Banner anterior"
          >
            ‹
          </button>
          <button
            type="button"
            className="cat-banner-nav cat-banner-nav--next"
            onClick={() => ir(1)}
            aria-label="Próximo banner"
          >
            ›
          </button>
          <div className="cat-banner-dots">
            {slides.map((slide, i) => (
              <button
                key={slide.key}
                type="button"
                className={`cat-banner-dot ${i === index ? 'active' : ''}`}
                onClick={() => {
                  setIndex(i);
                  const track = trackRef.current;
                  if (track) track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
                }}
                aria-label={`Ir para o banner ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
