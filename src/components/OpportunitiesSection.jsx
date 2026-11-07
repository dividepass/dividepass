import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Users, Sparkles } from 'lucide-react';
import ServiceLogo from './ServiceLogo';
import SponsoredOffers from './SponsoredOffers';
import { useEngagement } from '../hooks/useEngagement';
import { buildOpenOpportunities, buildSavingsOptions } from '../lib/catalogEngagement';
import './engagement.css';

function fmtBRL(value) {
  if (value == null || isNaN(value)) return '—';
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
}

/**
 * "Ofertas e oportunidades"
 *
 * Três blocos que respondem "o que eu faço agora?":
 *   1. Novas vagas — grupos que abriram com espaço sobrando
 *   2. Ofertas de parceiros — os destaques patrocinados (versão compacta)
 *   3. Alternativas para economizar — onde dividir sai bem mais barato
 */
export default function OpportunitiesSection({
  services = [],
  groups = [],
  servicePlans = [],
}) {
  const { sponsoredOffers } = useEngagement();

  const { opportunities, savings } = useMemo(() => {
    const sponsoredServiceIds = new Set();
    sponsoredOffers.forEach((offer) => {
      if (offer.service?.id) sponsoredServiceIds.add(offer.service.id);
      if (offer.group?.service_id) sponsoredServiceIds.add(offer.group.service_id);
    });

    return {
      opportunities: buildOpenOpportunities({
        groups,
        services,
        limit: 4,
        boostServiceIds: sponsoredServiceIds,
      }),
      savings: buildSavingsOptions({ services, groups, servicePlans, limit: 4 }),
    };
  }, [services, groups, servicePlans, sponsoredOffers]);

  const partnerOffers = useMemo(
    () =>
      sponsoredOffers
        .filter((offer) => offer.placement === 'catalog' || offer.placement === 'both')
        .slice(0, 3),
    [sponsoredOffers]
  );

  const hasAnything =
    opportunities.length > 0 || savings.length > 0 || partnerOffers.length > 0;

  if (!hasAnything) return null;

  return (
    <section className="opp-section">
      <div className="opp-header">
        <h2>Ofertas e oportunidades</h2>
        <p>Descubra ofertas de parceiros, novos grupos e alternativas para economizar.</p>
      </div>

      <div className="opp-grid">
        {/* Novas vagas */}
        <div className="opp-card">
          <h3 className="opp-card-title">
            <Users size={16} /> Novas vagas
          </h3>

          {opportunities.length === 0 ? (
            <p className="opp-empty">Nenhum grupo com vaga aberta no momento.</p>
          ) : (
            <div className="opp-list">
              {opportunities.map(({ group, service, spots }) => {
                const to = `/dashboard/groups/${group.slug || group.id}`;
                return (
                  <Link key={group.id} className="opp-row" to={to}>
                    <ServiceLogo service={service} className="opp-row-logo" />
                    <span className="opp-row-main">
                      <span className="opp-row-name">{group.name}</span>
                      <span className="opp-row-sub">{service?.name}</span>
                    </span>
                    <span className="opp-row-price">{fmtBRL(group.price_per_slot)}</span>
                    <span className="opp-row-badge">
                      {spots === Infinity ? 'Vaga livre' : `${spots} ${spots === 1 ? 'vaga' : 'vagas'}`}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Ofertas de parceiros */}
        <div className="opp-card">
          <h3 className="opp-card-title">
            <Sparkles size={16} /> Ofertas de parceiros
          </h3>

          {partnerOffers.length === 0 ? (
            <p className="opp-empty">
              Nenhuma oferta de parceiro no momento. Volte em breve!
            </p>
          ) : (
            <div className="opp-list">
              <SponsoredOffers
                offers={partnerOffers}
                placement="catalog"
                variant="compact"
                showHeader={false}
              />
            </div>
          )}
        </div>

        {/* Alternativas para economizar */}
        <div className="opp-card">
          <h3 className="opp-card-title">
            <TrendingUp size={16} /> Alternativas para economizar
          </h3>

          {savings.length === 0 ? (
            <p className="opp-empty">
              Ainda não temos preço oficial cadastrado para comparar.
            </p>
          ) : (
            <div className="opp-list">
              {savings.map((option) => (
                <Link
                  key={option.service.id}
                  className="opp-savings-row"
                  to={`/dashboard/catalog/${option.service.slug || option.service.id}`}
                >
                  <ServiceLogo service={option.service} className="opp-row-logo" />
                  <span className="opp-savings-main">
                    <span className="opp-savings-name">{option.service.name}</span>
                    <span className="opp-savings-prices">
                      <span className="opp-savings-old">{fmtBRL(option.official)}</span>
                      <span className="opp-savings-new">{fmtBRL(option.dividePassPrice)}</span>
                    </span>
                  </span>
                  <span className="opp-savings-badge">−{option.percent}%</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
