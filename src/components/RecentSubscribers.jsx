import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, ShieldCheck } from 'lucide-react';
import { fetchRecentSubscribers, timeAgo } from '../lib/dashboardInsights';
import './dashboard-insights.css';

/**
 * "Últimas assinaturas" — quem entrou nos grupos por último.
 *
 * O nome vem MASCARADO do banco ("Allan M***") e o círculo mostra a inicial
 * do primeiro nome quando a pessoa não tem foto de perfil. É prova social:
 * mostra que a plataforma está viva, sem expor dado de ninguém.
 *
 * `serviceId` filtra por plataforma (é o que a página da plataforma usa);
 * sem ele, lista as últimas assinaturas da DividePass toda.
 */
export default function RecentSubscribers({
  serviceId = null,
  limit = 8,
  serviceName = null,
  compact = false,
  showHeader = true,
  items: providedItems = undefined,
}) {
  // `null` = ainda buscando.
  const [fetched, setFetched] = useState(null);

  useEffect(() => {
    // Quem já buscou (a página da plataforma busca uma vez e usa nos dois
    // lugares) passa os itens prontos — aqui não busca de novo.
    if (providedItems !== undefined) return undefined;

    let alive = true;
    fetchRecentSubscribers({ serviceId, limit })
      .then((result) => {
        if (!alive) return;
        setFetched(result.items || []);
      })
      .catch(() => {
        if (!alive) return;
        setFetched([]);
      });
    return () => {
      alive = false;
    };
  }, [serviceId, limit, providedItems]);

  const items = providedItems !== undefined ? providedItems || [] : fetched || [];
  const loading = providedItems === undefined && fetched === null;

  const subtitulo = useMemo(
    () =>
      serviceName
        ? `Quem entrou nos grupos de ${serviceName} recentemente`
        : 'Assinaturas confirmadas nas últimas horas',
    [serviceName]
  );

  if (loading) return null;

  if (!items.length) {
    if (compact) return null;
    return (
      <section className="ins-section">
        {showHeader && (
          <div className="ins-head">
            <div className="ins-head-main">
              <span className="ins-head-icon ins-head-icon--green">
                <ShoppingBag size={20} />
              </span>
              <div>
                <h2>Últimas assinaturas</h2>
                <p>{subtitulo}</p>
              </div>
            </div>
          </div>
        )}
        <div className="recent-card">
          <p className="recent-empty">
            Ainda não há assinaturas confirmadas aqui. Seja o primeiro a entrar!
          </p>
        </div>
      </section>
    );
  }

  /* ── Versão compacta: faixa de avatares (usada no dashboard) ── */
  if (compact) {
    return (
      <div className="recent-strip">
        {items.map((row, index) => (
          <Link
            key={`${row.id}-${row.serviceSlug}-${index}`}
            to={row.serviceSlug ? `/dashboard/catalog/${row.serviceSlug}` : '/dashboard/catalog'}
            className="recent-chip"
            title={`${row.displayName} assinou ${row.serviceName || ''}`}
          >
            <span className="recent-avatar">
              {row.avatarUrl ? <img src={row.avatarUrl} alt="" loading="lazy" /> : row.initial}
            </span>
            <span className="recent-chip-name">{row.displayName}</span>
          </Link>
        ))}
      </div>
    );
  }

  /* ── Versão em lista (página da plataforma) ── */
  return (
    <section className="ins-section">
      {showHeader && (
        <div className="ins-head">
          <div className="ins-head-main">
            <span className="ins-head-icon ins-head-icon--green">
              <ShoppingBag size={20} />
            </span>
            <div>
              <h2>Últimas assinaturas</h2>
              <p>{subtitulo}</p>
            </div>
          </div>
        </div>
      )}

      <div className="recent-card">
        <div className="recent-list">
          {items.map((row, index) => (
            <div className="recent-item" key={`${row.id}-${row.serviceSlug}-${index}`}>
              <span className="recent-avatar">
                {row.avatarUrl ? <img src={row.avatarUrl} alt="" loading="lazy" /> : row.initial}
              </span>
              <span className="recent-info">
                <span className="recent-name">{row.displayName}</span>
                <span className="recent-what">
                  assinou <b>{row.serviceName || row.groupName || 'um grupo'}</b>
                  {row.joinedAt ? ` · ${timeAgo(row.joinedAt)}` : ''}
                </span>
              </span>
              <ShieldCheck size={15} style={{ color: 'var(--economy)', flex: '0 0 auto' }} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
