import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ACCESS_OVERDUE,
  isSubscriptionVisible,
  needsRenewalReminder,
  subscriptionAccessLabel,
  subscriptionAccessState,
} from '../lib/subscriptionAccess';
import { useAppDataContext } from '../contexts/AppDataContext';
import SubscriptionRenewalModal from './SubscriptionRenewalModal';
import RenewalReminderCard from './RenewalReminderCard';
import './SubscriptionsCarousel.css';

const PAGE_SIZE = 4;
const AUTOPLAY_INTERVAL = 5000;
const RESUME_DELAY = 3000;

export default function SubscriptionsCarousel({ items }) {
  const [currentPage, setCurrentPage] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStart = useRef(null);
  const touchEnd = useRef(null);
  const autoplayRef = useRef(null);
  const navigate = useNavigate();
  const { refresh } = useAppDataContext();

  // Assinatura cancelada não entra no carrossel: o caminho dela é o histórico.
  const visibleItems = (items || []).filter((item) => isSubscriptionVisible(item));

  // Renovação em aberto (o modal de pagamento já existe e é reaproveitado).
  const [renewTarget, setRenewTarget] = useState(null);

  const totalPages = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));

  // Se a lista encolher, a página atual pode passar do limite: clamp em vez de
  // resetar com setState dentro de efeito.
  const safePage = totalPages > 0 ? Math.min(currentPage, totalPages - 1) : 0;

  useEffect(() => {
    clearInterval(autoplayRef.current);
    if (isPaused || totalPages <= 1) return;
    autoplayRef.current = setInterval(() => {
      setCurrentPage(prev => (prev + 1) % totalPages);
    }, AUTOPLAY_INTERVAL);
    return () => clearInterval(autoplayRef.current);
  }, [isPaused, totalPages]);

  const pauseTemporarily = () => {
    setIsPaused(true);
    clearInterval(autoplayRef.current);
    setTimeout(() => setIsPaused(false), RESUME_DELAY);
  };

  const goToPage = (index) => {
    setCurrentPage(index);
    pauseTemporarily();
  };

  const handleTouchStart = (e) => {
    touchEnd.current = null;
    touchStart.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e) => {
    touchEnd.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;
    const distance = touchStart.current - touchEnd.current;
    touchStart.current = null;
    touchEnd.current = null;
    if (Math.abs(distance) < 50) return;
    pauseTemporarily();
    setCurrentPage(prev =>
      distance > 0
        ? (prev + 1) % totalPages
        : (prev - 1 + totalPages) % totalPages
    );
  };

  if (visibleItems.length === 0) return null;

  const openCredentials = (service, group) => {
    navigate(`/dashboard/credentials/${service.slug || service.id}?group=${group.id}`);
  };

  return (
    <>
    <div
      className="sac-container"
      onMouseEnter={() => {
        setIsPaused(true);
        clearInterval(autoplayRef.current);
      }}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="sac-viewport">
        <div className="sac-track" style={{ transform: `translateX(-${safePage * 100}%)` }}>
          {Array.from({ length: totalPages }).map((_, pageIndex) => (
            <div key={pageIndex} className="sac-page">
              {visibleItems
                .slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE)
                .map((item) => {
                  const { service, group } = item;
                  // O estado vem do módulo compartilhado: a assinatura pode
                  // estar ativa no banco e ainda assim estar atrasada.
                  const state = subscriptionAccessState(item);
                  const label = subscriptionAccessLabel(item);
                  const overdue = state === ACCESS_OVERDUE;
                  const showReminder = needsRenewalReminder(item);

                  return (
                    <div
                      key={group.id}
                      className={`sac-card ${overdue ? 'is-overdue' : ''} ${showReminder ? 'has-reminder' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openCredentials(service, group)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openCredentials(service, group);
                        }
                      }}
                      style={{ '--service-color': service.color }}
                    >
                      <div className="sac-card-logo" style={{ backgroundColor: service.color }}>
                        {service.icon_url ? (
                          <img src={service.icon_url} alt={service.name} />
                        ) : (
                          service.icon
                        )}
                      </div>
                      <span className="sac-card-name">{service.fullName || service.name}</span>
                      <span className={`sac-card-status ${overdue ? 'is-overdue' : ''}`}>
                        <span className="sac-card-dot" />
                        {label}
                      </span>
                      {showReminder && (
                        <RenewalReminderCard
                          subscription={item}
                          group={group}
                          onRenew={() => setRenewTarget({
                            subscription: item,
                            group,
                            amount: Number(item.amount || 0),
                          })}
                        />
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="sac-dots" role="tablist" aria-label="Navegação das assinaturas">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === safePage}
              aria-label={`Ir para página ${i + 1}`}
              className={`sac-dot ${i === safePage ? 'active' : ''}`}
              onClick={() => goToPage(i)}
            />
          ))}
        </div>
      )}
    </div>

    {/* Renovação: o mesmo modal das outras telas (PIX/cartão). Fica fora do
        container do carrossel para não herdar o swipe de navegação. */}
    {renewTarget && (
      <SubscriptionRenewalModal
        key="renewal-modal"
        open
        subscription={renewTarget.subscription}
        group={renewTarget.group}
        amount={renewTarget.amount}
        onClose={() => setRenewTarget(null)}
        onPaid={() => {
          setRenewTarget(null);
          refresh?.();
        }}
      />
    )}
    </>
  );
}