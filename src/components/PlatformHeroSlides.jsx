import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, ChevronRight, Users, Zap, ArrowRight, Star } from 'lucide-react';
import { fmtBRL } from '../lib/dashboardInsights';
import './dashboard-insights.css';

/**
 * Slides ("tarjas") da página de uma plataforma.
 *
 * A listagem de grupos sozinha é uma grade fria: ninguém sabe se vale a pena
 * entrar. Os slides mostram ANTES a oferta (quanto custa sozinho x quanto
 * custa dividido), DEPOIS a prova social (quem já entrou) e ainda o grupo que
 * o ADMIN escolheu para dar destaque.
 *
 * NO CELULAR o slide:
 *  - vira um banner com proporção fixa (3:2), não uma coluna gigante;
 *  - some o texto que não é essencial (descrição, checklist de benefits);
 *  - pode ser arrastado com o dedo (trilho com scroll-snap) — as setas
 *    continuam existindo no desktop.
 */
export default function PlatformHeroSlides({
  service,
  groups = [],
  recent = [],
  fromPrice = 0,
  officialPrice = 0,
  featuredGroup = null,
  extraSlides = [],
}) {
  const [index, setIndex] = useState(0);
  const trackRef = useRef(null);

  const official = Number(officialPrice) || 0;
  const preco = Number(fromPrice) || 0;
  const desconto = official > 0 && preco > 0 ? Math.round(((official - preco) / official) * 100) : 0;
  const nome = service?.full_name || service?.name || '';
  const href = `/dashboard/catalog/${service?.slug || service?.id}`;

  const slides = useMemo(() => {
    const lista = [];

    // 0) Grupo em destaque — escolhido pelo admin (destacado no slide da
    //    plataforma). Vem primeiro porque é uma escolha de Curadoria.
    if (featuredGroup) {
      const precoGrupo = Number(featuredGroup.price_per_slot) || 0;
      const descontoGrupo =
        official > 0 && precoGrupo > 0
          ? Math.round(((official - precoGrupo) / official) * 100)
          : 0;
      const membros = (featuredGroup.members || []).filter((m) => m.status === 'active').length;
      const max = featuredGroup.max_size || featuredGroup.service?.max_group_size || 0;

      lista.push({
        key: 'destaque',
        kicker: 'Grupo em destaque',
        kickerNeutral: true,
        title: featuredGroup.name,
        sub: `${membros} de ${max} membros`,
        features: [],
        people: [],
        cta: 'Quero entrar neste grupo',
        ctaHref: `/dashboard/groups/${featuredGroup.slug || featuredGroup.id}`,
        art: null,
        price: precoGrupo,
        priceLabel: 'A partir de',
        priceOld: official,
        discount: descontoGrupo,
        featured: true,
      });
    }

    // 1) Oferta principal
    lista.push({
      key: 'oferta',
      kicker: desconto > 0 ? `Até ${desconto}% OFF` : preco > 0 ? 'A partir de' : 'Plataforma',
      kickerNeutral: desconto === 0,
      title: nome,
      sub:
        service?.description ||
        `Entre em um grupo de ${service?.name || 'esta plataforma'} e divida o valor da assinatura com outras pessoas.`,
      features: [
        preco > 0 ? `Vaga a partir de ${fmtBRL(preco)}/mês` : 'Grupos com vaga aberta',
        official > 0 ? `Sozinho sairia ${fmtBRL(official)}/mês` : 'Pagamento único por mês',
        'Acesso liberado assim que o pagamento confirma',
      ],
      cta: `Quero meu ${service?.name || ''}`.trim(),
      ctaHref: href,
      art: service,
      price: preco,
      priceLabel: 'A partir de',
      priceOld: official,
      people: [],
    });

    // 2) Prova social — quem já entrou
    if (recent.length) {
      lista.push({
        key: 'prova',
        kicker: 'Prova social',
        kickerNeutral: true,
        title: `${recent.length} ${recent.length === 1 ? 'pessoa já entrou' : 'pessoas já entraram'}`,
        sub: `Quem assina ${service?.name || 'a plataforma'} na DividePass paga uma fração do preço oficial.`,
        people: recent.slice(0, 5),
        features: [],
        cta: 'Ver os grupos',
        ctaHref: href,
        art: null,
        price: preco,
        priceLabel: 'A partir de',
        priceOld: official,
      });
    }

    // 3) Quantidade de grupos prontos
    if (groups.length) {
      lista.push({
        key: 'grupos',
        kicker: `${groups.length} ${groups.length === 1 ? 'grupo pronto' : 'grupos prontos'}`,
        kickerNeutral: true,
        title: 'Escolha o grupo que combina com você',
        sub: 'Cada grupo tem um tamanho e um valor. Entre no que tiver vaga e a renovação é automática.',
        features: groups.slice(0, 3).map((g) => `${g.name} — ${fmtBRL(g.price_per_slot)}/mês`),
        cta: 'Ver todos os grupos',
        ctaHref: href,
        art: null,
        price: preco,
        priceLabel: 'A partir de',
        priceOld: official,
        people: [],
      });
    }

    return [...lista, ...extraSlides];
  }, [service, groups, recent, preco, official, desconto, nome, href, extraSlides, featuredGroup]);

  // Índice seguro: se a lista encolheu (o grupo em destaque saiu), não estoura.
  const indiceSeguro = Math.min(index, Math.max(0, slides.length - 1));

  const ir = (dir) => {
    const track = trackRef.current;
    const base = Math.min(indiceSeguro, Math.max(0, slides.length - 1));
    const proximo = (base + dir + slides.length) % slides.length;
    setIndex(proximo);
    if (track) {
      const largura = track.clientWidth;
      track.scrollTo({ left: proximo * largura, behavior: 'smooth' });
    }
  };

  /** Ao arrastar com o dedo, os bullets acompanham. */
  const aoRolar = () => {
    const track = trackRef.current;
    if (!track) return;
    const largura = track.clientWidth || 1;
    const atual = Math.round(track.scrollLeft / largura);
    if (atual !== index) setIndex(atual);
  };

  if (!slides.length) return null;

  return (
    <div className="plat-slides">
      <div className="plat-slides-track" ref={trackRef} onScroll={aoRolar}>
        {slides.map((slide) => (
          <div
            className={`plat-slide ${slide.featured ? 'plat-slide--featured' : ''}`}
            key={slide.key}
            style={{ '--slide-glow': `${service?.color || '#4F46E5'}2E` }}
          >
            {slide.art ? (
              <div className="plat-slide-art">
                {slide.art.icon_url ? (
                  <img src={slide.art.icon_url} alt={slide.art.name} />
                ) : (
                  <span className="plat-slide-art-letter">
                    {(slide.art.name || '?').charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
            ) : slide.featured ? (
              <div className="plat-slide-art">
                <Star size={34} style={{ color: service?.color || 'var(--primary)' }} />
              </div>
            ) : (
              <div className="plat-slide-art">
                <Zap size={38} style={{ color: service?.color || 'var(--primary)' }} />
              </div>
            )}

            <div className="plat-slide-body">
              <span
                className={`plat-slide-kicker ${slide.kickerNeutral ? 'plat-slide-kicker--neutral' : ''}`}
              >
                {slide.kicker}
              </span>

              <h2 className="plat-slide-title">{slide.title}</h2>
              <p className="plat-slide-sub">{slide.sub}</p>

              {slide.features?.length > 0 && (
                <ul className="plat-slide-features">
                  {slide.features.map((feat, i) => (
                    <li key={i}>
                      <CheckCircle2 size={15} />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              )}

              {slide.people?.length > 0 && (
                <div className="plat-slide-people">
                  <div className="plat-slide-avatars">
                    {slide.people.map((p, i) => (
                      <span className="recent-avatar" key={i} title={p.displayName}>
                        {p.avatarUrl ? <img src={p.avatarUrl} alt="" loading="lazy" /> : p.initial}
                      </span>
                    ))}
                  </div>
                  <span className="plat-slide-people-text">
                    <Users size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                    {slide.people.length === 1
                      ? '1 pessoa entrou por último'
                      : `${slide.people.length} pessoas entraram por último`}
                  </span>
                </div>
              )}

              <Link to={slide.ctaHref} className="plat-slide-cta">
                {slide.cta} <ArrowRight size={15} />
              </Link>
            </div>

            <div className="plat-slide-price">
              {slide.price > 0 ? (
                <>
                  <span className="plat-slide-price-label">{slide.priceLabel}</span>
                  <span className="plat-slide-price-value">
                    {fmtBRL(slide.price)}
                    <small>/mês</small>
                  </span>
                  {slide.priceOld > 0 && (
                    <span className="plat-slide-price-old">
                      <s>{fmtBRL(slide.priceOld)}</s> sozinho
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="plat-slide-price-label">Grupos</span>
                  <span className="plat-slide-price-value">{groups.length}</span>
                  <span className="plat-slide-price-old">disponíveis</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        <>
          <button
            type="button"
            className="plat-slide-nav plat-slide-nav--prev"
            onClick={() => ir(-1)}
            aria-label="Slide anterior"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            type="button"
            className="plat-slide-nav plat-slide-nav--next"
            onClick={() => ir(1)}
            aria-label="Próximo slide"
          >
            <ChevronRight size={17} />
          </button>

          <div className="plat-dots">
            {slides.map((slide, i) => (
              <button
                key={slide.key}
                type="button"
                className={`plat-dot ${i === indiceSeguro ? 'active' : ''}`}
                onClick={() => {
                  setIndex(i);
                  const track = trackRef.current;
                  if (track) track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
                }}
                aria-label={`Ir para o slide ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
