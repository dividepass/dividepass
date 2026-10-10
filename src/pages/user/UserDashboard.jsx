import { useState, useMemo, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, X, Pin, Star, Download, Smartphone, CheckCircle2, MessageSquare, TrendingUp, ChevronDown, AlertCircle, Info, Camera } from 'lucide-react';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { useAuth } from '../../hooks/useAuth';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { supabase } from '../../lib/supabase';
import { saveAvatar } from '../../lib/uploadAvatar';
import ServicesCarousel from '../../components/ServicesCarousel';
import SubscriptionsCarousel from '../../components/SubscriptionsCarousel';
import { calculateUserSavings, getSavingsSummary, getAdminAlerts, fmtPercentage } from '../../utils/savingsService';
import './UserDashboard.css';

// Formatador BRL local (evita import de savings.js que causa TDZ error)
function fmtBRL(value) {
  if (value == null || isNaN(value)) return 'R$ 0,00';
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
}

const CATEGORIES = [
  { key: 'all', label: 'Todos', icon: '🔍' },
  { key: 'streaming', label: 'Streaming', icon: '📺' },
  { key: 'musica', label: 'Música', icon: '🎵' },
  { key: 'ia', label: 'IA', icon: '🤖' },
  { key: 'cursos', label: 'Cursos', icon: '🎓' },
  { key: 'produtividade', label: 'Produtividade', icon: '💼' },
  { key: 'ferramentas', label: 'Ferramentas', icon: '🛠' },
  { key: 'leitura', label: 'Leitura', icon: '📚' },
  { key: 'games', label: 'Games', icon: '🎮' },
  { key: 'saude', label: 'Saúde', icon: '🏋️' },
  { key: 'seguranca', label: 'Segurança', icon: '🔒' },
];

const CATEGORY_KEYWORDS = {
  streaming: ['filmes', 'series', 'video', 'streaming', 'tv', 'netflix', 'disney', 'max', 'prime', 'globoplay', 'paramount', 'apple tv', 'crunchyroll', 'mubi'],
  musica: ['musica', 'music', 'podcast', 'audio', 'spotify', 'deezer', 'tidal', 'audible'],
  ia: ['ia', 'ai', 'inteligencia', 'artificial', 'chatgpt', 'claude', 'gemini', 'midjourney', 'perplexity', 'cursor', 'elevenlabs', 'runway', 'gpt'],
  cursos: ['curso', 'cursos', 'educacao', 'aprender', 'estudar', 'alura', 'udemy', 'coursera', 'domestika', 'duolingo', 'rocketseat', 'aula'],
  produtividade: ['produtividade', 'trabalho', 'colaboracao', 'microsoft', 'google', 'notion', 'trello', 'clickup', 'slack', 'office'],
  ferramentas: ['design', 'edicao', 'marketing', 'canva', 'adobe', 'figma', 'semrush', 'envato', 'grammarly', 'criativo'],
  leitura: ['livro', 'leitura', 'kindle', 'scribd', 'readly', 'ebook', 'revista'],
  games: ['jogo', 'jogos', 'game', 'games', 'xbox', 'playstation', 'nintendo', 'geforce', 'gamer'],
  saude: ['saude', 'fitness', 'exercicio', 'bem estar', 'wellhub', 'strava', 'headspace', 'calm', 'academia'],
  seguranca: ['seguranca', 'vpn', 'senha', 'senhas', 'nordvpn', 'surfshark', 'bitwarden', '1password', 'protecao'],
};


// ── Componente: linha de comparativo por serviço ──────────────────────
function SavingsServiceRow({ item, unavailable, expandedId, onToggle }) {
  const rowKey = `${item.serviceId}__${item.planId || 'default'}`;
  const isExpanded = expandedId === rowKey;
  const isNegative = item.isNegative;

  if (unavailable) {
    return (
      <div className="savings-service-row unavailable">
        <div className="savings-service-main">
          <div className="savings-service-icon" style={{ backgroundColor: item.serviceColor }}>
            {item.serviceIconUrl ? (
              <img src={item.serviceIconUrl} alt={item.serviceName} />
            ) : (
              <span>{item.serviceIcon || item.serviceName[0]}</span>
            )}
          </div>
          <div className="savings-service-info">
            <span className="savings-service-name">{item.serviceName}</span>
            {item.planName && <span className="savings-service-plan">{item.planName}</span>}
          </div>
          <div className="savings-service-unavailable-badge">
            <AlertCircle size={12} />
            Preço de referência indisponível
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`savings-service-row ${isExpanded ? 'expanded' : ''} ${isNegative ? 'negative' : ''}`}>
      <button className="savings-service-main" onClick={() => onToggle(rowKey)}>
        <div className="savings-service-icon" style={{ backgroundColor: item.serviceColor }}>
          {item.serviceIconUrl ? (
            <img src={item.serviceIconUrl} alt={item.serviceName} />
          ) : (
            <span>{item.serviceIcon || item.serviceName[0]}</span>
          )}
        </div>
        <div className="savings-service-info">
          <span className="savings-service-name">{item.serviceName}</span>
          <span className="savings-service-plan">{item.planName}</span>
        </div>

        {/* Mobile: preços empilhados | Desktop: inline */}
        <div className="savings-service-prices">
          <div className="savings-price-inline">
            <span className="savings-price-direct">{fmtBRL(item.officialPrice)}</span>
            <span className="savings-price-divide">{fmtBRL(item.dividePassPrice)}</span>
            <span className={`savings-badge ${isNegative ? 'badge-negative' : 'badge-savings'}`}>
              {isNegative ? '+' : '−'}{fmtBRL(Math.abs(item.monthlySavings))}
            </span>
          </div>
        </div>

        <ChevronDown size={14} className={`savings-chevron ${isExpanded ? 'rotated' : ''}`} />
      </button>

      {isExpanded && (
        <div className="savings-detail">
          <div className="savings-detail-row">
            <div className="savings-detail-col">
              <span className="savings-detail-label">Direto na plataforma</span>
              <span className="savings-detail-value strikethrough muted">{fmtBRL(item.officialPrice)}/mês</span>
            </div>
            <div className="savings-detail-col">
              <span className="savings-detail-label">DividePass</span>
              <span className="savings-detail-value dp">{fmtBRL(item.dividePassPrice)}/mês</span>
            </div>
            <div className="savings-detail-col">
              <span className="savings-detail-label">Economia mensal</span>
              <span className={`savings-detail-value ${isNegative ? 'negative' : 'savings'}`}>
                {isNegative ? '+' : '−'}{fmtBRL(Math.abs(item.monthlySavings))}
              </span>
            </div>
            <div className="savings-detail-col">
              <span className="savings-detail-label">Em 12 meses</span>
              <span className={`savings-detail-value ${isNegative ? 'negative' : 'savings'}`}>
                {isNegative ? 'Custa ' : ''}{fmtBRL(Math.abs(item.annualSavings))}{isNegative ? ' a mais' : ' economizados'}
              </span>
            </div>
          </div>
          {item.staleness?.needsReview && (
            <div className="savings-staleness-warning">
              <AlertCircle size={12} />
              Preço pode estar desatualizado — administrado está avisado
            </div>
          )}
          {isNegative && (
            <div className="savings-negative-alert">
              ⚠️ Valor DividePass acima do preço oficial — verificado automaticamente
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UserDashboard() {
  const { profile, refreshProfile } = useAuth();
  const { currentUser, getActiveServices, getAvailableServices, isSubscribedToService, announcements, dismissAnnouncement, groups, streamingServices } = useAppDataContext();
  const { isStandalone, promptInstall } = usePwaInstall();
  const categoryBarRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [hideInstallCard, setHideInstallCard] = useState(() => localStorage.getItem('hide_dashboard_install_card') === '1');
  const [dismissedIds, setDismissedIds] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('dismissed_announcements') || '[]'));
    } catch {
      return new Set();
    }
  });
  // Backend é fonte da verdade: assume "sem depoimento" enquanto verifica (mais seguro)
  const [hasTestimonial, setHasTestimonial] = useState(false);
  const [hideTestimonialCard, setHideTestimonialCard] = useState(false);
  // Não renderizar o card até a verificação do DB terminar (evita flickering)
  const [testimonialCheckDone, setTestimonialCheckDone] = useState(false);

  // Toggle para breakdown de economia
  const [showSavingsBreakdown, setShowSavingsBreakdown] = useState(false);
  const [expandedServiceId, setExpandedServiceId] = useState(null);
  const [showAllSavings, setShowAllSavings] = useState(false);

  // paidPayments PRIMEIRO — usado por hasRealPayments e totalSaved
  const [paidPayments, setPaidPayments] = useState([]);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);

  // hasRealPayments depende de paidPayments
  const hasRealPayments = useMemo(() =>
    paidPayments.some(p => Number(p.official_price) > 0),
  [paidPayments]);

  const totalSaved = useMemo(() => {
    if (!paidPayments?.length) return 0;
    return paidPayments.reduce((total, payment) => {
      if (!payment || payment.status !== 'paid' || payment.payment_type !== 'subscription') return total;
      const officialPrice = Number(payment.official_price) || 0;
      const paidAmount = Number(payment.paid_amount) || Number(payment.amount) || 0;
      if (!officialPrice) return total;
      const cycleMonths = payment.billing_cycle === 'quarterly' ? 3 :
        payment.billing_cycle === 'semiannual' ? 6 :
        payment.billing_cycle === 'annual' ? 12 : 1;
      return total + Math.max(0, (officialPrice * cycleMonths) - paidAmount);
    }, 0);
  }, [paidPayments]);

  // activeServicesAll depende de getActiveServices (context) — não tem dependencias de hooks aqui
  const activeServicesAll = getActiveServices();

  // savingsData depende de activeServicesAll
  const realSavingsByService = useMemo(() => {
    return [];
  }, []);

  const savingsData = useMemo(() => {
    return calculateUserSavings(activeServicesAll);
  }, [activeServicesAll]);

  const summary = useMemo(() => getSavingsSummary(savingsData), [savingsData]);
  const adminAlerts = useMemo(() => getAdminAlerts(savingsData), [savingsData]);
  const hasAnyData = summary.hasValidData || savingsData.unavailable.length > 0;

  // monthSaved depende de hasRealPayments, realSavingsByService, summary
  const monthSaved = useMemo(() => {
    if (hasRealPayments && realSavingsByService.length > 0) {
      return realSavingsByService.reduce((sum, s) => sum + (s.monthlySavings || 0), 0);
    }
    return summary.monthlySavings || 0;
  }, [hasRealPayments, realSavingsByService, summary.monthlySavings]);

  // visibleSavings depende de savingsData
  const visibleSavings = showAllSavings
    ? savingsData.subscriptions
    : savingsData.subscriptions.slice(0, 3);
  const hasMoreSavings = savingsData.subscriptions.length > 3;

  // Reavaliar dismiss ao trocar de conta (userId muda)
  useEffect(() => {
    if (!profile?.id) {
      setHideTestimonialCard(false);
      return;
    }
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const newKey = `hide_testimonial_card_${profile.id}`;
    const legacyKeys = [
      'hide_testimonial_card',       // versão antiga global
      'testimonialDismissed',        // versão muito antiga (alguma campanha)
    ];

    // Migrar legado: se existir chave antiga sem userId, converter para o novo formato
    for (const legacyKey of legacyKeys) {
      const legacyStored = localStorage.getItem(legacyKey);
      if (legacyStored && !localStorage.getItem(newKey)) {
        const legacyValue = legacyStored.trim();
        if (legacyValue === '1' || legacyValue === 'true') {
          // Antigo "bloqueio permanente" — remover para não prender usuário pra sempre
          localStorage.removeItem(legacyKey);
          setHideTestimonialCard(false);
          return;
        }
        const legacyTs = parseInt(legacyValue, 10);
        if (!isNaN(legacyTs) && legacyTs > 0) {
          // Timestamp antigo — migrar para nova chave
          localStorage.setItem(newKey, legacyValue);
          localStorage.removeItem(legacyKey);
          const dismissedAt = legacyTs;
          if (Date.now() - dismissedAt > SEVEN_DAYS_MS) {
            localStorage.removeItem(newKey);
            setHideTestimonialCard(false);
          } else {
            setHideTestimonialCard(true);
          }
          return;
        }
      }
    }

    const stored = localStorage.getItem(newKey);
    if (stored) {
      const dismissedAt = parseInt(stored, 10);
      if (Date.now() - dismissedAt > SEVEN_DAYS_MS) {
        localStorage.removeItem(newKey);
        setHideTestimonialCard(false);
      } else {
        setHideTestimonialCard(true);
      }
    } else {
      setHideTestimonialCard(false);
    }
  }, [profile?.id]);

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Verificar se usuário já enviou depoimento (backend é fonte da verdade)
  useEffect(() => {
    if (!profile?.id) {
      setTestimonialCheckDone(true);
      return;
    }
    setTestimonialCheckDone(false);
    setHasTestimonial(false); // assume "sem" enquanto verifica
    supabase
      .from('testimonials')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .then(({ count, error }) => {
        // Se falhar, assume "sem depoimento" (mais seguro: mostra card por padrão)
        if (error) {
          console.warn('[TestimonialCard] Erro ao verificar depoimento:', error.message);
        }
        setHasTestimonial(!error && count > 0);
        setTestimonialCheckDone(true);
      });
  }, [profile?.id]);

  // Buscar pagamentos do usuário para economia real
  useEffect(() => {
    if (!profile?.id) {
      setPaymentsLoaded(true);
      return;
    }
    setPaymentsLoaded(false);
    supabase
      .from('payments')
      .select(`
        id, amount, official_price, paid_amount, status, payment_type,
        created_at, paid_at, group:groups(service_id)
      `)
      .eq('user_id', profile.id)
      .eq('status', 'paid')
      .eq('payment_type', 'subscription')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.warn('[Economia] Erro ao buscar pagamentos:', error.message);
        }
        setPaidPayments(data || []);
        setPaymentsLoaded(true);
      });
  }, [profile?.id]);

  // Criar mapa de serviços para detalhamento
  const servicesMap = useMemo(() => {
    const map = {};
    streamingServices.forEach(s => { map[s.id] = s; });
    return map;
  }, [streamingServices]);

  const handleHideTestimonialCard = () => {
    if (!profile?.id) return;
    setHideTestimonialCard(true);
    // Store timestamp per user — re-show after 7 days
    localStorage.setItem(`hide_testimonial_card_${profile.id}`, String(Date.now()));
  };

  const handleInstallApp = async () => {
    const result = await promptInstall();
    if (result.outcome === 'accepted') {
      localStorage.setItem('hide_dashboard_install_card', '1');
      setHideInstallCard(true);
    }
  };

  const handleHideInstallCard = (checked) => {
    setHideInstallCard(checked);
    localStorage.setItem('hide_dashboard_install_card', checked ? '1' : '0');
  };
  const availableServices = getAvailableServices();
  const hasActiveServices = activeServicesAll.length > 0;
  const shouldShowTestimonialCard = testimonialCheckDone && !hasTestimonial && !hideTestimonialCard;
  const shouldShowInstallCard = hasActiveServices && !hideInstallCard && !profile?.pwa_installed_at && !isStandalone;

  // ── Pedido de foto de perfil (primeiro acesso) ──────────────────────
  // Só aparece para quem ainda não tem avatar. "Agora não" esconde por 30 dias.
  const avatarPromptKey = profile?.id ? `hide_avatar_prompt_${profile.id}` : null;
  const [hideAvatarPrompt, setHideAvatarPrompt] = useState(() => {
    if (!avatarPromptKey) return true;
    const raw = localStorage.getItem(avatarPromptKey);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < 30 * 24 * 60 * 60 * 1000;
  });
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const avatarInputRef = useRef(null);

  const shouldShowAvatarPrompt = !hideAvatarPrompt && !profile?.avatar_url && !!profile?.id;

  useEffect(() => {
    if (avatarPromptKey) {
      setHideAvatarPrompt(localStorage.getItem(avatarPromptKey) !== null);
    }
  }, [avatarPromptKey]);

  const handleDismissAvatarPrompt = () => {
    setHideAvatarPrompt(true);
    if (avatarPromptKey) localStorage.setItem(avatarPromptKey, String(Date.now()));
  };

  const handleAvatarFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !profile?.id) return;

    setAvatarUploading(true);
    setAvatarError('');

    try {
      await saveAvatar(file, profile.id);
      await refreshProfile();
      handleDismissAvatarPrompt();
    } catch (err) {
      setAvatarError(err.message || 'Não foi possível enviar a foto.');
    } finally {
      setAvatarUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const filteredServices = useMemo(() => {
    let services = availableServices;
    const q = search.toLowerCase().trim();
    if (q) {
      services = services.filter(s => {
        const name = (s.name || '').toLowerCase();
        const desc = (s.description || '').toLowerCase();
        const matchedCat = Object.entries(CATEGORY_KEYWORDS).find(([, keywords]) =>
          keywords.some(kw => q.includes(kw) || kw.includes(q))
        );
        if (matchedCat) {
          return s.category === matchedCat[0] || name.includes(q) || desc.includes(q);
        }
        return name.includes(q) || desc.includes(q);
      });
    }
    if (selectedCategory !== 'all') {
      services = services.filter(s => s.category === selectedCategory);
    }

    services.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return 0;
    });

    return services;
  }, [availableServices, search, selectedCategory]);

  const updateScrollArrows = () => {
    const el = categoryBarRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };

  useEffect(() => {
    const el = categoryBarRef.current;
    if (!el) return;
    updateScrollArrows();
    el.addEventListener('scroll', updateScrollArrows, { passive: true });
    window.addEventListener('resize', updateScrollArrows);
    return () => {
      el.removeEventListener('scroll', updateScrollArrows);
      window.removeEventListener('resize', updateScrollArrows);
    };
  }, []);

  const scrollCategories = (dir) => {
    const el = categoryBarRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 200, behavior: 'smooth' });
  };

  const visibleAnnouncements = useMemo(() => {
    return announcements.filter(a => !dismissedIds.has(a.id));
  }, [announcements, dismissedIds]);

  const handleDismiss = async (id) => {
    setDismissedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      const arr = [...next];
      localStorage.setItem('dismissed_announcements', JSON.stringify(arr));
      return next;
    });
    await dismissAnnouncement(id);
  };

  const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  const announceTypeClass = (type) => {
    const map = { info: 'info', warning: 'warning', success: 'success', urgent: 'urgent' };
    return map[type] || 'info';
  };

  return (
    <div className="fade-in">
      {visibleAnnouncements.length > 0 && (
        <div className="announcements-banner-list">
          {visibleAnnouncements.map(a => (
            <div key={a.id} className={`announcement-banner ${announceTypeClass(a.type)}`}>
              <div className="announcement-banner-content">
                <strong>{a.title}</strong>
                <span>{a.message}</span>
              </div>
              <button
                className="announcement-dismiss-btn"
                onClick={() => handleDismiss(a.id)}
                title="Dispensar"
              >
                Vi
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="page-header">
        <h1>Olá, {currentUser?.name?.split(' ')[0] || 'Usuário'}! 👋</h1>
        <p>{hasActiveServices ? 'Aqui está o resumo das suas assinaturas ativas.' : 'Escolha um serviço no catálogo para começar.'}</p>
      </div>

      {/* Minhas Assinaturas — primeiro, com scroll horizontal automático */}
      {hasActiveServices && (
        <section className="active-services-section">
          <div className="section-title-row">
            <div>
              <h2>Minhas Assinaturas</h2>
              <p className="section-subtitle">Os serviços que você tem ativo agora</p>
            </div>
          </div>

          <SubscriptionsCarousel items={activeServicesAll} />

          <Link to="/dashboard/credentials" className="view-all-link">
            Ver todas as {activeServicesAll.length} assinaturas
          </Link>
        </section>
      )}

      {/* Grupos Disponíveis */}
      <section className="available-groups-section">
        <div className="section-title-row">
          <div>
            <h2>🔥 Grupos disponíveis</h2>
            <p className="section-subtitle">Serviços que já possuem grupos formados</p>
          </div>
        </div>
        <ServicesCarousel services={streamingServices} groups={groups} basePath="/dashboard/catalog/" />
      </section>

      {/* Comparativo Real de Economia */}
      {paymentsLoaded && hasActiveServices && hasAnyData && (
        <section className="savings-comp-section">
          <div className="savings-comp-header">
            <div>
              <h2 className="savings-comp-title">Quanto você está economizando</h2>
              {!showSavingsBreakdown && (
                <p className="savings-comp-subtitle">
                  Compare o preço das assinaturas diretamente nas plataformas com o que você paga na DividePass.
                </p>
              )}
            </div>
            <button
              type="button"
              className="savings-expand-toggle"
              onClick={() => setShowSavingsBreakdown(v => !v)}
              aria-expanded={showSavingsBreakdown}
            >
              {showSavingsBreakdown ? 'Mostrar menos ▲' : 'Clique aqui e saiba mais ▼'}
            </button>
          </div>

          {/* Colapsado: só o número principal, sem poluir a visão */}
          {!showSavingsBreakdown && summary.hasValidData && (
            <button
              type="button"
              className="savings-collapsed-card"
              onClick={() => setShowSavingsBreakdown(true)}
            >
              <div className="savings-collapsed-item">
                <span className="savings-collapsed-label">Economia por mês</span>
                <span className="savings-collapsed-value">
                  {fmtBRL(summary.monthlySavings)}<small>/mês</small>
                </span>
              </div>
              <div className="savings-collapsed-pct">{fmtPercentage(summary.savingsPercentage)} de economia</div>
            </button>
          )}

          {showSavingsBreakdown && (
            <>
              {/* Resumo principal — 3 perguntas respondidas */}
              {summary.hasValidData && (
                <div className="savings-summary-card">
                  <div className="savings-summary-row">
                    <div className="savings-summary-col">
                      <span className="savings-summary-q">Quanto eu pagaria sozinho?</span>
                      <span className="savings-summary-original">{fmtBRL(summary.totalOfficialMonthly)}<small>/mês</small></span>
                    </div>
                    <div className="savings-summary-vs">vs</div>
                    <div className="savings-summary-col">
                      <span className="savings-summary-q">Quanto pago na DividePass?</span>
                      <span className="savings-summary-dp">{fmtBRL(summary.totalDividePassMonthly)}<small>/mês</small></span>
                    </div>
                    <div className="savings-summary-divider" />
                    <div className="savings-summary-col savings-col-highlight">
                      <span className="savings-summary-q savings-q-highlight">Minha economia</span>
                      <span className="savings-summary-savings">{fmtBRL(summary.monthlySavings)}<small>/mês</small></span>
                    </div>
                  </div>
                  <div className="savings-summary-footer">
                    <span className="savings-summary-pct">{fmtPercentage(summary.savingsPercentage)} de economia</span>
                    <span className="savings-summary-annual">R$ {fmtBRL(summary.annualSavings).replace('R$ ', '')} em 12 meses</span>
                  </div>
                </div>
              )}

              {/* Breakdown por serviço — mobile: cards | desktop: inline */}
              <div className="savings-comp-list">
                {visibleSavings.map(item => (
                  <SavingsServiceRow
                    key={item.subscriptionId}
                    item={item}
                    expandedId={expandedServiceId}
                    onToggle={(id) => setExpandedServiceId(expandedServiceId === id ? null : id)}
                  />
                ))}

                {hasMoreSavings && (
                  <button
                    className="savings-show-more-btn"
                    onClick={() => setShowAllSavings(v => !v)}
                  >
                    {showAllSavings
                      ? 'Ver menos ▲'
                      : `Ver mais ${savingsData.subscriptions.length - 3} serviços ▼`}
                  </button>
                )}

                {savingsData.unavailable.length > 0 && (
                  <div className="savings-unavailable-group">
                    <p className="savings-unavailable-label">
                      Sem preço de referência — não entram no cálculo
                    </p>
                    {savingsData.unavailable.map(item => (
                      <SavingsServiceRow
                        key={item.subscriptionId}
                        item={item}
                        unavailable
                        expandedId={expandedServiceId}
                        onToggle={(id) => setExpandedServiceId(expandedServiceId === id ? null : id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Disclaimer */}
              <div className="savings-disclaimer">
                <Info size={11} />
                <span>Comparação baseada nos preços oficiais dos serviços no Brasil — pode variar conforme plano, impostos ou promoções.</span>
              </div>
            </>
          )}
        </section>
      )}

      {/* Card de foto de perfil: só enquanto o usuário não tem avatar */}
      {shouldShowAvatarPrompt && (
        <section className="avatar-prompt-card">
          <div className="avatar-prompt-icon">
            <Camera size={22} />
          </div>
          <div className="avatar-prompt-content">
            <strong>Adicione uma foto de perfil</strong>
            <p>Usuários com foto confiam mais na plataforma — e o seu depoimento aparece com ela na página inicial.</p>
            {avatarError && <small className="avatar-prompt-error">{avatarError}</small>}
          </div>
          <div className="avatar-prompt-action">
            <button
              className="btn btn-primary btn-sm avatar-prompt-cta"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
            >
              <Camera size={15} />
              {avatarUploading ? 'Enviando...' : 'Enviar foto'}
            </button>
            <button className="avatar-prompt-dismiss" onClick={handleDismissAvatarPrompt}>
              Agora não
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarFile}
              hidden
            />
          </div>
        </section>
      )}

      {/* Card de depoimento: depois de Minhas Assinaturas OU antes do Catálogo */}
      {shouldShowTestimonialCard && (
        <section className="testimonial-prompt-card">
          <div className="testimonial-prompt-icon">
            <MessageSquare size={22} />
          </div>
          <div className="testimonial-prompt-content">
            <strong>Sua opinião vale desconto!</strong>
            <p>Conte como está sendo sua experiência com a DividePass e ganhe <strong>R$ 5 de desconto</strong> na sua próxima assinatura. Sua avaliação nos ajuda a melhorar cada vez mais.</p>
          </div>
          <div className="testimonial-prompt-action">
            <Link to="/dashboard/testimonial" className="btn btn-primary btn-sm testimonial-cta-btn">
              Avaliar e ganhar R$ 5
            </Link>
            <button className="testimonial-prompt-dismiss" onClick={handleHideTestimonialCard}>
              Agora não
            </button>
          </div>
        </section>
      )}

      {/* Catálogo Completo */}
      <section className="available-services-section">
        <div className="section-title-row">
          <h2>Explorar todos os serviços</h2>
        </div>

        {/* Search + Category Filter */}
        <div className="dashboard-catalog-filters">
          <div className="dashboard-search-wrap">
            <Search size={18} />
            <input
              type="text"
              placeholder="Buscar serviço ou categoria..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="dashboard-search-clear" onClick={() => setSearch('')}>
                <X size={16} />
              </button>
            )}
          </div>

          <div className="dashboard-category-wrapper">
            {canScrollLeft && (
              <button className="dashboard-category-arrow left" onClick={() => scrollCategories(-1)}>
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="dashboard-category-bar" ref={categoryBarRef}>
              {CATEGORIES.map(cat => (
                <button
                  key={cat.key}
                  className={`dashboard-category-pill ${selectedCategory === cat.key ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat.key)}
                >
                  <span className="category-pill-icon">{cat.icon}</span>
                  <span className="category-pill-label">{cat.label}</span>
                </button>
              ))}
            </div>
            {canScrollRight && (
              <button className="dashboard-category-arrow right" onClick={() => scrollCategories(1)}>
                <ChevronRight size={18} />
              </button>
            )}
          </div>
        </div>

        <div className="available-services-grid">
          {filteredServices.length === 0 ? (
            <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
              <p>Nenhum serviço encontrado.</p>
            </div>
          ) : (
            filteredServices.map(service => {
              const subscribed = isSubscribedToService(service.id);
              return (
                <Link
                  key={service.id}
                  to={subscribed ? `/dashboard/credentials/${service.slug || service.id}` : `/dashboard/catalog/${service.slug || service.id}`}
                  className={`available-service-card-wrapper ${subscribed ? 'card-subscribed' : ''} ${service.pinned ? 'card-pinned' : ''} ${service.featured ? 'card-featured' : ''}`}
                >
                  <div
                    className="available-service-header-icon"
                    style={{ backgroundColor: service.color }}
                  >
                    {service.icon_url ? (
                      <img src={service.icon_url} alt={service.name} className="available-service-logo-lg" />
                    ) : (
                      <div className="available-service-icon-lg">{service.icon || service.name[0]}</div>
                    )}
                    {service.pinned && <div className="service-badge-pin"><Pin size={10} /></div>}
                    {service.featured && <div className="service-badge-star"><Star size={10} /></div>}
                  </div>
                  <span className="available-service-name">{service.name}</span>
                </Link>
              );
            })
          )}
        </div>
      </section>

      {shouldShowInstallCard && (
        <section className="install-app-card install-app-card-bottom">
          <div className="install-app-card-copy">
            <div className="install-app-badge">
              <Smartphone size={16} />
              <span>Instalação do app</span>
            </div>
            <h2>Instale o DividePass no seu celular</h2>
            <p>
              Crie um atalho e abra o dashboard como um app. Você pode continuar no navegador se preferir.
            </p>
            <ul>
              <li><CheckCircle2 size={16} /> Acesso com 1 toque</li>
              <li><CheckCircle2 size={16} /> Ícone na tela inicial</li>
              <li><CheckCircle2 size={16} /> Interface em tela cheia</li>
            </ul>
          </div>
          <div className="install-app-card-actions">
            <button
              className="btn btn-primary install-app-btn"
              onClick={handleInstallApp}
            >
              <Download size={18} /> Salvar e instalar o app
            </button>
            <label className="install-app-hide">
              <input
                type="checkbox"
                checked={hideInstallCard}
                onChange={(e) => handleHideInstallCard(e.target.checked)}
              />
              <span>Não mostrar mais esse card</span>
            </label>
          </div>
        </section>
      )}
    </div>
  );
}

export default UserDashboard;
