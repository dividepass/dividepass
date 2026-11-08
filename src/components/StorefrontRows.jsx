import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { fetchTopSoldServices, fmtBRL } from '../lib/dashboardInsights';
import { CATEGORIAS_SEM_TODOS } from '../lib/categorias';
import useAutoScroll from '../hooks/useAutoScroll';
import TopicCards from './TopicCards';
import CatalogBannerSlider from './CatalogBannerSlider';
import './dashboard-insights.css';

/**
 * Vitrine da home — o mesmo desenho do app de comida (iFood), adaptado para
 * a DividePass:
 *
 *   1. MAIS POPULARES — ícones redondos com o nome embaixo (vem logo depois
 *      do botão do WhatsApp: é o que a pessoa mais procura);
 *   2. TÓPICOS — ícones redondos por categoria; tocar leva para os serviços
 *      daquela categoria;
 *   3. BANNER — carrossel de ofertas e plataformas em alta (arrastável);
 *   4. MELHORES OFERTAS — cards quadrados com o preço e o preço oficial.
 *
 * Tudo em fileira que rola pro lado — e que anda SOZINHA, um passo a cada
 * 5 segundos, parando quando a pessoa encosta o mouse ou o dedo.
 *
 * No desktop a vitrine fica escondida: lá a home continua com o layout largo
 * (hero grande, carrossel com ranking e as seções completas).
 */
export default function StorefrontRows({ services = [], groups = [], topics = CATEGORIAS_SEM_TODOS }) {
  const [topItems, setTopItems] = useState([]);
  const circlesRef = useAutoScroll({ interval: 5000 });
  const cardsRef = useAutoScroll({ interval: 5000 });

  useEffect(() => {
    let alive = true;
    fetchTopSoldServices({ limit: 8, services, groups })
      .then((result) => {
        if (!alive) return;
        setTopItems(result.items || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [services, groups]);

  /* Populares: quem tem mais gente dentro dos grupos. */
  const populares = useMemo(() => {
    const membrosPor = new Map();
    groups.forEach((group) => {
      if (!group?.service_id) return;
      const ativos = (group.members || []).filter((m) => m.status === 'active').length;
      membrosPor.set(group.service_id, (membrosPor.get(group.service_id) || 0) + ativos);
    });

    return (services || [])
      .map((service) => ({
        service,
        membros: membrosPor.get(service.id) || 0,
      }))
      .filter((row) => row.membros > 0)
      .sort((a, b) => b.membros - a.membros)
      .slice(0, 10);
  }, [services, groups]);

  const ofertas = useMemo(
    () => topItems.filter((item) => item.fromPrice > 0).slice(0, 8),
    [topItems]
  );

  if (!populares.length && !ofertas.length) return null;

  return (
    <div className="storefront">
      {populares.length > 0 && (
        <section className="storefront-section">
          <div className="storefront-head">
            <h2>Mais populares</h2>
            <Link to="/dashboard/catalog" className="storefront-more">
              Ver mais <ArrowRight size={13} />
            </Link>
          </div>

          <div className="storefront-circles" ref={circlesRef}>
            {populares.map(({ service, membros }) => (
              <Link
                key={service.id}
                to={`/dashboard/catalog/${service.slug || service.id}`}
                className="storefront-circle"
                title={`${service.name} — ${membros} ${membros === 1 ? 'pessoa dividindo' : 'pessoas dividindo'}`}
              >
                <span
                  className="storefront-circle-icon"
                  style={{ backgroundColor: service.color || 'var(--surface-soft)' }}
                >
                  {service.icon_url ? (
                    <img src={service.icon_url} alt="" loading="lazy" />
                  ) : (
                    <span>{service.icon || (service.name || '?').charAt(0).toUpperCase()}</span>
                  )}
                </span>
                <span className="storefront-circle-name">{service.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {topics.length > 0 && (
        <TopicCards
          topics={topics}
          hrefFor={(key) => `/dashboard/catalog?categoria=${key}`}
        />
      )}

      <CatalogBannerSlider services={services} groups={groups} />

      {ofertas.length > 0 && (
        <section className="storefront-section">
          <div className="storefront-head">
            <h2>Melhores ofertas</h2>
            <Link to="/dashboard/catalog" className="storefront-more">
              Ver mais <ArrowRight size={13} />
            </Link>
          </div>

          <div className="storefront-cards" ref={cardsRef}>
            {ofertas.map((item) => (
              <Link
                key={item.id}
                to={`/dashboard/catalog/${item.slug || item.id}`}
                className="storefront-card"
              >
                <span
                  className="storefront-card-media"
                  style={{ backgroundColor: item.color || 'var(--surface-soft)' }}
                >
                  {item.iconUrl ? (
                    <img src={item.iconUrl} alt="" loading="lazy" />
                  ) : (
                    <span>{(item.name || '?').charAt(0).toUpperCase()}</span>
                  )}
                  {item.savingsPct > 0 && (
                    <span className="storefront-card-off">-{item.savingsPct}%</span>
                  )}
                </span>
                <span className="storefront-card-name">{item.name}</span>
                <span className="storefront-card-price">
                  {fmtBRL(item.fromPrice)}
                  <small>/mês</small>
                </span>
                {item.officialPrice > 0 && (
                  <span className="storefront-card-old">
                    <s>{fmtBRL(item.officialPrice)}</s> no site oficial
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
