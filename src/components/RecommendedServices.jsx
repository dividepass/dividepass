import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import ServiceLogo from './ServiceLogo';
import { useEngagement } from '../hooks/useEngagement';
import { buildRecommendations, resolveSponsorTarget } from '../lib/catalogEngagement';
import './engagement.css';

/**
 * "Recomendados para você" — a faixa do topo do dashboard.
 *
 * Decisão de produto (2026-10-30): o card grande consumia a tela inteira do
 * celular e empurrava todo o resto para baixo. Agora cada item é só
 * **logo + nome**, em scroll horizontal. As ofertas patrocinadas entram **no
 * meio** da mesma faixa, com um leve destaque — quem paga aparece, sem roubar
 * a tela de quem está só navegando.
 *
 * A ordenação continua vindo de `buildRecommendations`, que explica o motivo
 * de cada indicação; aqui o motivo serve só de `title` (tooltip) no card.
 */
export default function RecommendedServices({
  services = [],
  groups = [],
  subscriptions = [],
  limit = 10,
}) {
  const { watchlist, votes, interests, sponsoredOffers } = useEngagement();

  const recommendations = useMemo(() => {
    const subscribedIds = new Set(
      (subscriptions || [])
        .map((sub) => sub.service_id || sub.service?.id)
        .filter(Boolean)
    );

    // Serviços com oferta patrocinada ativa entram como "destaque de parceiro".
    const sponsoredIds = new Set();
    sponsoredOffers.forEach((offer) => {
      const placement = offer.placement;
      if (placement !== 'recommendation' && placement !== 'both') return;
      if (offer.service?.id) sponsoredIds.add(offer.service.id);
      if (offer.group?.service_id) sponsoredIds.add(offer.group.service_id);
    });

    // Quem patrocina ganha boost nos grupos que ele administra: o grupo
    // dele sobe dentro dos recomendados porque o parceiro turbinou e pagou.
    const boostServiceIds = new Set();
    sponsoredOffers.forEach((offer) => {
      if (offer.group?.service_id) boostServiceIds.add(offer.group.service_id);
      if (!offer.sponsor_user_id) return;
      groups
        .filter((group) => group.owner_id === offer.sponsor_user_id)
        .forEach((group) => boostServiceIds.add(group.service_id));
    });

    return buildRecommendations({
      services,
      groups,
      interests,
      votes,
      watchlist,
      subscribedIds,
      sponsoredIds,
      boostServiceIds,
      limit,
    });
  }, [services, groups, subscriptions, interests, votes, watchlist, sponsoredOffers, limit]);

  /**
   * Uma faixa só: serviços recomendados com as ofertas patrocinadas
   * encaixadas no MEIO, entre os cards comuns.
   *
   * Se o serviço patrocinado também é recomendado, o chip comum sai da lista
   * e só aparece a versão com destaque — nada de repetir a mesma logo duas
   * vezes (uma apagada, outra acesa).
   */
  const items = useMemo(() => {
    const offerItems = sponsoredOffers
      .filter((offer) => offer.placement === 'recommendation' || offer.placement === 'both')
      .filter((offer) => offer.service?.id)
      .slice(0, 3)
      .map((offer) => ({
        type: 'offer',
        key: `offer-${offer.id}`,
        offer,
        service: offer.service,
        reason: offer.badge || 'Oferta em destaque',
      }));

    const offeredIds = new Set(offerItems.map((item) => item.service.id));

    const serviceItems = recommendations
      .filter((item) => !offeredIds.has(item.service.id))
      .map((item) => ({
        type: 'service',
        key: `service-${item.service.id}`,
        service: item.service,
        reason: item.reasonLabel,
      }));

    if (offerItems.length === 0) return serviceItems;

    const middle = Math.ceil(serviceItems.length / 2);
    return [
      ...serviceItems.slice(0, middle),
      ...offerItems,
      ...serviceItems.slice(middle),
    ];
  }, [recommendations, sponsoredOffers]);

  if (items.length === 0) return null;

  return (
    <section className="recommended-section">
      <div className="recommended-head">
        <div className="recommended-head-row">
          <h2 className="recommended-title">
            <Sparkles size={18} /> Recomendados para você
          </h2>
          <span className="recommended-tagline">Encontre mais. Pague menos.</span>
        </div>
        <p className="recommended-sub">
          Descubra serviços digitais que combinam com você.
        </p>
      </div>

      <div className="highlight-strip">
        {items.map((item) => {
          if (item.type === 'offer') {
            const target = resolveSponsorTarget(item.offer);
            const label = item.service?.name || item.offer.headline;
            // Selo curto: um texto longo ("Oferta em destaque") vaza por cima
            // do vizinho na faixa. O texto completo fica no tooltip e no card
            // de "Ofertas de parceiros".
            const rawBadge = (item.offer.badge || 'Patrocinado').trim();
            const badge = rawBadge.length <= 13 ? rawBadge : 'Patrocinado';
            const content = (
              <>
                <span className="highlight-chip-ribbon">{badge}</span>
                <ServiceLogo service={item.service} className="highlight-chip-logo" />
                <span className="highlight-chip-name">{label}</span>
              </>
            );

            if (!target) {
              return (
                <span
                  key={item.key}
                  className="highlight-chip highlight-chip--offer"
                  title={item.offer.headline}
                >
                  {content}
                </span>
              );
            }

            return target.external ? (
              <a
                key={item.key}
                className="highlight-chip highlight-chip--offer"
                href={target.href}
                target="_blank"
                rel="noopener noreferrer"
                title={item.offer.headline}
              >
                {content}
              </a>
            ) : (
              <Link
                key={item.key}
                className="highlight-chip highlight-chip--offer"
                to={target.to}
                title={item.offer.headline}
              >
                {content}
              </Link>
            );
          }

          return (
            <Link
              key={item.key}
              className="highlight-chip"
              to={`/dashboard/catalog/${item.service.slug || item.service.id}`}
              title={item.reason}
            >
              <ServiceLogo service={item.service} className="highlight-chip-logo" />
              <span className="highlight-chip-name">{item.service.name}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
