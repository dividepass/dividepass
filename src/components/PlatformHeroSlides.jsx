import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, ChevronRight, Users, Zap, ArrowRight } from 'lucide-react';
import { fmtBRL } from '../lib/dashboardInsights';
import './dashboard-insights.css';

/**
 * Slides ("tarjas") da página de uma plataforma.
 *
 * A listagem de grupos sozinha é uma grade fria: ninguém sabe se vale a pena
 * entrar. Os slides mostram ANTES a oferta (quanto custa sozinho x quanto
 * custa dividido), DEPOIS a prova social (quem já entrou) e ainda o número
 * de grupos prontos — é a mesma estrutura da referência de layout.
 */
export default function PlatformHeroSlides({
  service,
  groups = [],
  recent = [],
  fromPrice = 0,
  officialPrice = 0,
  extraSlides = [],
}) {
  const [index, setIndex] = useState(0);

  const official = Number(officialPrice) || 0;
  const preco = Number(fromPrice) || 0;
  const desconto = official > 0 && preco > 0 ? Math.round(((official - preco) / official) * 100) : 0;
  const nome = service?.full_name || service?.name || '';
  const href = `/dashboard/catalog/${service?.slug || service?.id}`;

  const slides = useMemo(() => {
    const lista = [];

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
      });
    }

    return [...lista, ...extraSlides];
  }, [service, groups, recent, preco, official, desconto, nome, href, extraSlides]);

  // Se a lista de slides encolheu (a plataforma perdeu os grupos recentes),
  // o índice volta para o primeiro sem precisar de efeito.
  const indiceSeguro = Math.min(index, Math.max(0, slides.length - 1));

  const ir = (dir) => {
    setIndex((atualIdx) => {
      const base = Math.min(atualIdx, Math.max(0, slides.length - 1));
      return (base + dir + slides.length) % slides.length;
    });
  };

  if (!slides.length) return null;

  const atual = slides[indiceSeguro];

  return (
    <div className="plat-slides">
      <div
        className="plat-slide"
        style={{ '--slide-glow': `${service?.color || '#4F46E5'}2E` }}
      >
        {slides.length > 1 && (
          <button
            type="button"
            className="plat-slide-nav plat-slide-nav--prev"
            onClick={() => ir(-1)}
            aria-label="Slide anterior"
          >
            <ChevronLeft size={17} />
          </button>
        )}

        {atual.art ? (
          <div className="plat-slide-art">
            {atual.art.icon_url ? (
              <img src={atual.art.icon_url} alt={atual.art.name} />
            ) : (
              <span className="plat-slide-art-letter">
                {(atual.art.name || '?').charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        ) : (
          <div className="plat-slide-art">
            <Zap size={38} style={{ color: service?.color || 'var(--primary)' }} />
          </div>
        )}

        <div className="plat-slide-body">
          <span
            className={`plat-slide-kicker ${atual.kickerNeutral ? 'plat-slide-kicker--neutral' : ''}`}
          >
            {atual.kicker}
          </span>

          <h2 className="plat-slide-title">{atual.title}</h2>
          <p className="plat-slide-sub">{atual.sub}</p>

          {atual.features?.length > 0 && (
            <ul className="plat-slide-features">
              {atual.features.map((feat, i) => (
                <li key={i}>
                  <CheckCircle2 size={15} />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          )}

          {atual.people?.length > 0 && (
            <div className="plat-slide-people">
              <div className="plat-slide-avatars">
                {atual.people.map((p, i) => (
                  <span className="recent-avatar" key={i} title={p.displayName}>
                    {p.avatarUrl ? <img src={p.avatarUrl} alt="" loading="lazy" /> : p.initial}
                  </span>
                ))}
              </div>
              <span className="plat-slide-people-text">
                <Users size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                {atual.people.length === 1
                  ? '1 pessoa entrou por último'
                  : `${atual.people.length} pessoas entraram por último`}
              </span>
            </div>
          )}

          <Link to={atual.ctaHref} className="plat-slide-cta">
            {atual.cta} <ArrowRight size={15} />
          </Link>
        </div>

        <div className="plat-slide-price">
          {atual.price > 0 ? (
            <>
              <span className="plat-slide-price-label">{atual.priceLabel}</span>
              <span className="plat-slide-price-value">
                {fmtBRL(atual.price)}
                <small>/mês</small>
              </span>
              {atual.priceOld > 0 && (
                <span className="plat-slide-price-old">
                  <s>{fmtBRL(atual.priceOld)}</s> sozinho
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

        {slides.length > 1 && (
          <button
            type="button"
            className="plat-slide-nav plat-slide-nav--next"
            onClick={() => ir(1)}
            aria-label="Próximo slide"
          >
            <ChevronRight size={17} />
          </button>
        )}
      </div>

      {slides.length > 1 && (
        <div className="plat-dots">
          {slides.map((slide, i) => (
            <button
              key={slide.key}
              type="button"
              className={`plat-dot ${i === index ? 'active' : ''}`}
              onClick={() => setIndex(i)}
              aria-label={`Ir para o slide ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
