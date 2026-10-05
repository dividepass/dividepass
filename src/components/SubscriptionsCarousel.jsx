import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

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

  if (!items || items.length === 0) return null;

  const openCredentials = (service, group) => {
    navigate(`/dashboard/credentials/${service.slug || service.id}?group=${group.id}`);
  };

  return (
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
              {items
                .slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE)
                .map(({ service, group }) => (
                  <button
                    key={group.id}
                    type="button"
                    className="sac-card"
                    onClick={() => openCredentials(service, group)}
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
                    <span className="sac-card-status">
                      <span className="sac-card-dot" />
                      Ativo
                    </span>
                  </button>
                ))}
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
  );
}