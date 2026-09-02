import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import './ServicesCarousel.css';

const CAROUSEL_SIZE = 3;
const AUTOPLAY_INTERVAL = 5000;

export default function ServicesCarousel({ services, groups, basePath = '/' }) {
  const [currentPage, setCurrentPage] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStart = useRef(null);
  const touchEnd = useRef(null);
  const containerRef = useRef(null);
  const autoplayRef = useRef(null);

  const servicesWithGroups = useMemo(() => {
    if (!groups?.length || !services?.length) return [];
    const groupServiceIds = new Set(groups.map(g => g.service_id));
    return services
      .filter(s => groupServiceIds.has(s.id))
      .map(s => {
        const serviceGroups = groups.filter(g => g.service_id === s.id);
        const totalGroups = serviceGroups.length;
        const totalSpots = serviceGroups.reduce((acc, g) => {
          const activeMembers = g.members?.filter(m => m.status === 'active' || m.status === 'pending').length || 0;
          const maxSize = g.max_size || s.max_group_size || 0;
          return acc + (maxSize > 0 ? Math.max(0, maxSize - activeMembers) : 0);
        }, 0);
        return { ...s, totalGroups, totalSpots };
      })
      .sort((a, b) => b.totalGroups - a.totalGroups);
  }, [groups, services]);

  const totalPages = Math.ceil(servicesWithGroups.length / CAROUSEL_SIZE);

  useEffect(() => {
    setCurrentPage(0);
  }, [servicesWithGroups.length]);

  useEffect(() => {
    if (isPaused || totalPages <= 1) {
      clearInterval(autoplayRef.current);
      return;
    }
    autoplayRef.current = setInterval(() => {
      setCurrentPage(prev => (prev + 1) % totalPages);
    }, AUTOPLAY_INTERVAL);
    return () => clearInterval(autoplayRef.current);
  }, [isPaused, totalPages]);

  const goToPage = (index) => {
    setCurrentPage(index);
    setIsPaused(true);
    clearInterval(autoplayRef.current);
    setTimeout(() => setIsPaused(false), 3000);
  };

  const handleTouchStart = (e) => {
    touchEnd.current = null;
    touchStart.current = e.targetTouches[0].clientX;
  };

  const handleTouchMove = (e) => {
    touchEnd.current = e.targetTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;
    const distance = touchStart.current - touchEnd.current;
    const minSwipeDistance = 50;
    if (Math.abs(distance) < minSwipeDistance) return;
    setIsPaused(true);
    clearInterval(autoplayRef.current);
    if (distance > 0) {
      setCurrentPage(prev => (prev + 1) % totalPages);
    } else {
      setCurrentPage(prev => (prev - 1 + totalPages) % totalPages);
    }
    setTimeout(() => setIsPaused(false), 3000);
  };

  if (servicesWithGroups.length === 0) return null;

  return (
    <div
      className="sc-container"
      ref={containerRef}
      onMouseEnter={() => {
        setIsPaused(true);
        clearInterval(autoplayRef.current);
      }}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="sc-viewport">
        <div
          className="sc-track"
          style={{ transform: `translateX(-${currentPage * 100}%)` }}
        >
          {Array.from({ length: totalPages }).map((_, pageIndex) => (
            <div key={pageIndex} className="sc-page">
              {servicesWithGroups
                .slice(pageIndex * CAROUSEL_SIZE, pageIndex * CAROUSEL_SIZE + CAROUSEL_SIZE)
                .map(service => (
                  <Link
                    key={service.id}
                    to={`${basePath}${service.slug || service.id}`}
                    className="sc-card"
                  >
                    <div className="sc-card-icon" style={{ backgroundColor: service.color }}>
                      {service.icon_url ? (
                        <img src={service.icon_url} alt={service.name} />
                      ) : (
                        <span>{service.icon || service.name[0]}</span>
                      )}
                    </div>
                    <span className="sc-card-name">{service.name}</span>
                    <span className="sc-card-status">
                      <span className="sc-card-dot" />
                      Disponível
                    </span>
                  </Link>
                ))}
            </div>
          ))}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="sc-dots" role="tablist" aria-label="Navegação do carrossel">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === currentPage}
              aria-label={`Ir para página ${i + 1}`}
              className={`sc-dot ${i === currentPage ? 'active' : ''}`}
              onClick={() => goToPage(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
