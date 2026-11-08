import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import { fetchTopSoldServices, fmtBRL } from '../lib/dashboardInsights';
import './dashboard-insights.css';

/**
 * "Top mais vendidos" — o carrossel de destaque da Visão Geral.
 *
 * MESMA IDEIA DO CONCORRENTE (card "Top 10 mais vendidos"): o que a galera
 * mais compra aparece PRIMEIRO, com preço, desconto e botão de compra. Aqui
 * o ranking é real: conta as assinaturas confirmadas (pagamento `paid`).
 *
 * A origem do dado é a função `dividepass_top_sold_services` (SQL em
 * database/EXECUTAR-2026-11-08-dashboard-visao-geral.sql). Enquanto ela não
 * existe em produção, a lib cai no ranking alternativo (popularidade pelos
 * grupos) — a tela nunca fica vazia nem quebrada.
 */
export default function TopSellingServices({ services = [], groups = [], limit = 10 }) {
  // `null` = ainda buscando. Os itens antigos ficam na tela enquanto a nova
  // busca acontece (sem piscar a seção inteira).
  const [items, setItems] = useState(null);
  const [source, setSource] = useState('db');
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const trackRef = useRef(null);

  // Assinatura estável dos arrays: os contextos devolvem nova referência a
  // cada render, e sem isso a busca dispararia em loop.
  const signature = useMemo(
    () => `${services.map((s) => s.id).join(',')}|${groups.length}`,
    [services, groups]
  );

  useEffect(() => {
    let alive = true;
    fetchTopSoldServices({ limit, services, groups })
      .then((result) => {
        if (!alive) return;
        setItems(result.items || []);
        setSource(result.source || 'db');
      })
      .catch(() => {
        if (!alive) return;
        setItems([]);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, limit]);

  const updateArrows = () => {
    const el = trackRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  };

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [items?.length]);

  const scrollBy = (dir) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 520, behavior: 'smooth' });
  };

  if (items === null) return null;
  if (!items.length) return null;

  return (
    <section className="ins-section top-sell">
      <div className="ins-head">
        <div className="ins-head-main">
          <span className="ins-head-icon">
            <Trophy size={20} />
          </span>
          <div>
            <h2>
              Top {items.length}{' '}
              {source === 'db' ? 'mais vendidos' : 'mais procurados'}
            </h2>
            <p>
              {source === 'db'
                ? 'O que a galera mais compra na DividePass'
                : 'As plataformas com mais gente dividindo agora'}
            </p>
          </div>
        </div>
        <Link to="/dashboard/catalog" className="ins-head-link">
          Ver catálogo completo <ArrowRight size={14} />
        </Link>
      </div>

      <div className="top-sell-viewport">
        {canLeft && (
          <button
            type="button"
            className="top-sell-nav top-sell-nav--prev"
            onClick={() => scrollBy(-1)}
            aria-label="Ver anteriores"
          >
            <ChevronLeft size={18} />
          </button>
        )}

        <div className="top-sell-track" ref={trackRef}>
          {items.map((item, index) => {
            const href = `/dashboard/catalog/${item.slug || item.id}`;
            const temPreco = item.fromPrice > 0;

            return (
              <Link key={item.id} to={href} className="top-sell-card">
                <div className="top-sell-media">
                  {item.iconUrl ? (
                    <img src={item.iconUrl} alt={item.name} loading="lazy" />
                  ) : (
                    <span className="top-sell-media-letter">
                      {(item.name || '?').charAt(0).toUpperCase()}
                    </span>
                  )}

                  <span className={`top-sell-rank ${index === 0 ? 'top-sell-rank--first' : ''}`}>
                    {source === 'db'
                      ? index === 0
                        ? '★ 1º mais vendido'
                        : `${index + 1}º mais vendido`
                      : index === 0
                        ? '★ 1º mais procurado'
                        : `${index + 1}º mais procurado`}
                  </span>

                  {item.savingsPct > 0 && (
                    <span className="top-sell-badge">-{item.savingsPct}%</span>
                  )}
                </div>

                <div className="top-sell-body">
                  <h3 className="top-sell-title">{item.name}</h3>
                  <p className="top-sell-meta">
                    {item.soldCount > 0
                      ? item.source === 'fallback'
                        ? `${item.soldCount} ${item.soldCount === 1 ? 'pessoa' : 'pessoas'} dividindo`
                        : `${item.soldCount} ${item.soldCount === 1 ? 'assinatura' : 'assinaturas'}`
                      : item.groupsCount > 0
                        ? `${item.groupsCount} ${item.groupsCount === 1 ? 'grupo aberto' : 'grupos abertos'}`
                        : 'Grupos em formação'}
                  </p>

                  {temPreco && item.officialPrice > 0 && (
                    <span className="top-sell-old">
                      <s>{fmtBRL(item.officialPrice)}</s>
                      <span className="top-sell-off">-{item.savingsPct}%</span>
                    </span>
                  )}

                  {temPreco ? (
                    <span className="top-sell-price">
                      {fmtBRL(item.fromPrice)}
                      <small>/mês</small>
                    </span>
                  ) : (
                    <span className="top-sell-price">—</span>
                  )}

                  <span className="top-sell-cta">
                    Comprar <ArrowRight size={14} />
                  </span>
                  <span className="top-sell-details">Ver detalhes</span>
                </div>
              </Link>
            );
          })}
        </div>

        {canRight && (
          <button
            type="button"
            className="top-sell-nav top-sell-nav--next"
            onClick={() => scrollBy(1)}
            aria-label="Ver próximos"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </section>
  );
}
