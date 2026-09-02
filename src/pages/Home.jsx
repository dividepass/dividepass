import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import logoImg from '../assets/logo.png';
import {
  ChevronRight,
  ChevronLeft,
  Play,
  Zap,
  Users,
  CreditCard,
  Lock,
  Star,
  Menu,
  X,
  HelpCircle,
  ArrowRight,
  Search,
  Pin,
  UserPlus,
  Compass,
  Key,
  Sparkles,
  PlusCircle,
} from 'lucide-react';
import ThemeToggle from '../components/ThemeToggle';
import ServicesCarousel from '../components/ServicesCarousel';
// fmtBRL e getCycleMonths inlined para evitar TDZ no bundler
const fmtBRL = (value) => {
  if (value == null || isNaN(value)) return 'R$ 0,00';
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
};
const getCycleMonths = (billingCycle, customMonths = null) => {
  switch (billingCycle) {
    case 'monthly':    return 1;
    case 'quarterly':  return 3;
    case 'semiannual': return 6;
    case 'annual':     return 12;
    case 'custom':     return customMonths || 1;
    default:           return 1;
  }
};
import { supabase } from '../lib/supabase';
import './Home.css';

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

const steps = [
  {
    icon: UserPlus,
    title: 'Crie sua conta',
    description: 'Cadastre-se gratuitamente em poucos minutos.',
  },
  {
    icon: Compass,
    title: 'Encontre uma plataforma',
    description: 'Encontre a plataforma ou assinatura que você quer acessar e economize dividindo o valor.',
  },
  {
    icon: Users,
    title: 'Entre em um grupo',
    description: 'Escolha uma vaga disponível e entre em um grupo já formado.',
  },
  {
    icon: Key,
    title: 'Receba as credenciais',
    description: 'Após a confirmação, você recebe as informações necessárias para acessar a assinatura.',
  },
  {
    icon: Sparkles,
    title: 'Aproveite e economize',
    description: 'Acesse sua assinatura e aproveite pagando apenas a sua parte.',
  },
];

const stepHighlight = {
  icon: PlusCircle,
  title: 'Já tem uma assinatura?',
  description: 'Crie um grupo, disponibilize as vagas que não usa e divida o valor da assinatura com outras pessoas.',
};

const faqs = [
  {
    question: 'O que é a DividePass?',
    answer: 'A DividePass conecta pessoas que querem economizar com grupos de assinatura digitais ativos, garantindo credenciais seguras, suporte contínuo e renovação automática.'
  },
  {
    question: 'É seguro compartilhar assinaturas pela DividePass?',
    answer: 'Sim! Utilizamos criptografia de ponta a ponta e gateways de pagamento certificados. Suas credenciais são entregues de forma segura.'
  },
  {
    question: 'Posso perder acesso ao serviço?',
    answer: 'Não. Caso haja qualquer problema com o grupo, o DividePass garante a continuidade do seu acesso, buscando automaticamente um novo grupo compatível.'
  },
  {
    question: 'E se alguém sair do grupo?',
    answer: 'O sistema automaticamente redistribui os custos ou encontra um novo membro. Você não perde o acesso.'
  },
  {
    question: 'Existe garantia?',
    answer: 'Sim! 7 dias de garantia para novos usuários. Se não ficar satisfeito, devolvemos 100% do valor pago.'
  },
  {
    question: 'Quanto tempo leva para receber as credenciais?',
    answer: 'Após a confirmação do pagamento, as credenciais são liberadas em poucos minutos no seu painel.'
  },
  {
    question: 'Como funciona o suporte?',
    answer: 'Suporte via chat e e-mail. Nossa equipe responde em até 24 horas.'
  },
  {
    question: 'Posso cancelar quando quiser?',
    answer: 'Sim, a qualquer momento pelo painel. Sem multas ou taxas.'
  },
  {
    question: 'Quais formas de pagamento são aceitas?',
    answer: 'Aceitamos PIX e cartão de crédito, processados por gateways seguros e certificados.'
  }
];

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState(-1);
  const [allServices, setAllServices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const categoryBarRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [servicesVisible, setServicesVisible] = useState(24);
  const [testimonialIndex, setTestimonialIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const stepsFlowRef = useRef(null);
  const [monthUsers, setMonthUsers] = useState([]);
  const [monthCount, setMonthCount] = useState(0);
  const [monthSavingsTotal, setMonthSavingsTotal] = useState(0);
  const [monthSavingsUsers, setMonthSavingsUsers] = useState(0);
  const [userCount, setUserCount] = useState(0);

  useEffect(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    supabase.from('users')
      .select('id, name, email, avatar_url')
      .gte('created_at', startOfMonth)
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => { if (data) setMonthUsers(data); });

    supabase.from('users')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfMonth)
      .then(({ count }) => { if (count != null) setMonthCount(count); });

    supabase.from('streaming_services')
      .select('id, name, full_name, slug, icon, icon_url, color, category, pinned, featured, max_group_size, official_price')
      .eq('status', 'active')
      .order('name')
      .then(({ data }) => {
        if (data) {
          data.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            if (a.featured && !b.featured) return -1;
            if (!a.featured && b.featured) return 1;
            return 0;
          });
          setAllServices(data);
        }
      });

    // Stats de economia: pagamentos REAIS deste mês OU fallback com assinaturas ativas
    Promise.all([
      // Tentativa 1: pagamentos com official_price
      supabase
        .from('payments')
        .select(`
          id, user_id, amount, official_price, paid_amount,
          billing_cycle, custom_months, status, payment_type, created_at,
          group:group_id(service_id)
        `)
        .eq('status', 'paid')
        .eq('payment_type', 'subscription')
        .gte('created_at', startOfMonth),
      // Tentativa 2: assinaturas ativas com serviço
      supabase
        .from('user_subscriptions')
        .select('id, user_id, amount, billing_cycle, custom_months, service:service_id(official_price)')
        .eq('status', 'active'),
    ]).then(([paymentsRes, subsRes]) => {
      const payments = paymentsRes.data || [];
      const subs = subsRes.data || [];

      // Prioridade 1: pagamentos com official_price
      const withPrice = payments.filter(p => Number(p.official_price) > 0);
      if (withPrice.length > 0) {
        const totalSavings = withPrice.reduce((sum, p) => {
          const official = Number(p.official_price) || 0;
          const paid = Number(p.paid_amount) || Number(p.amount) || 0;
          const cycleMonths = getCycleMonths(p.billing_cycle, p.custom_months);
          const totalOfficial = official * cycleMonths;
          return sum + Math.max(0, totalOfficial - paid);
        }, 0);
        const uniqueUsers = new Set(withPrice.map(p => p.user_id)).size;
        setMonthSavingsTotal(totalSavings);
        setMonthSavingsUsers(uniqueUsers);
        return;
      }

      // Prioridade 2: fallback com assinaturas ativas
      if (subs.length > 0) {
        const totalSavings = subs.reduce((sum, s) => {
          const official = Number(s.service?.official_price) || 0;
          const userAmount = Number(s.amount) || 0;
          if (!official || !userAmount) return sum;
          const cycleMonths = getCycleMonths(s.billing_cycle, s.custom_months);
          if (!cycleMonths || cycleMonths <= 0) return sum;
          // Economia mensal normalizada: oficial_mensal - (pago_total / meses)
          const monthlyUser = userAmount / cycleMonths;
          return sum + Math.max(0, official - monthlyUser);
        }, 0);
        const uniqueUsers = new Set(subs.map(s => s.user_id)).size;
        if (totalSavings > 0) {
          setMonthSavingsTotal(totalSavings);
          setMonthSavingsUsers(uniqueUsers);
        }
      }
    });

    supabase.from('groups')
      .select('id, service_id, status, members:group_members(status), max_size')
      .in('status', ['open', 'forming'])
      .then(({ data }) => { if (data) setGroups(data); });

    supabase.from('testimonials')
      .select('id, user_name, user_role, text, rating')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(6)
      .then(({ data }) => { if (data) setTestimonials(data); });

    supabase.from('users')
      .select('id', { count: 'exact', head: true })
      .then(({ count }) => { if (count != null) setUserCount(count); });
  }, []);

  const filteredServices = allServices.filter(s => {
    const q = search.toLowerCase().trim();
    if (q) {
      const nameMatch = (s.name || '').toLowerCase().includes(q);
      const fullMatch = (s.full_name || '').toLowerCase().includes(q);
      const catMatch = s.category && CATEGORY_KEYWORDS[s.category]?.some(kw => kw.includes(q) || q.includes(kw));
      if (!nameMatch && !fullMatch && !catMatch) return false;
    }
    if (selectedCategory !== 'all' && s.category !== selectedCategory) return false;
    return true;
  });

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
  }, [allServices]);

  const scrollCategories = (dir) => {
    const el = categoryBarRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 200, behavior: 'smooth' });
  };

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Testimonial auto-rotate
  useEffect(() => {
    if (testimonials.length <= 1) return;
    const interval = setInterval(() => {
      setTestimonialIndex(prev => (prev + 1) % testimonials.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [testimonials.length]);

  // Track steps carousel scroll position
  useEffect(() => {
    const el = stepsFlowRef.current;
    if (!el) return;
    const handleScroll = () => {
      const cardWidth = el.querySelector('.step-card')?.offsetWidth || 1;
      const gap = 12; // 0.75rem gap
      const scrollLeft = el.scrollLeft;
      const index = Math.round(scrollLeft / (cardWidth + gap));
      setStepIndex(Math.min(index, steps.length - 1));
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      setIsMenuOpen(false);
    }
  };

  return (
    <div className="home-container">
      <div className="ambient-light" />
      <div className="grid-pattern" />

      {isMenuOpen && <div className="navbar-backdrop" onClick={() => setIsMenuOpen(false)} />}

      <header className={`navbar ${scrolled ? 'navbar-scrolled' : ''}`}>
        <div className="navbar-content">
          <Link to="/" className="logo">
            <img src={logoImg} alt="DividePass" className="logo-img" />
            <span>DividePass</span>
          </Link>

          <nav className="navbar-nav-desktop">
            <button onClick={() => scrollToSection('como-funciona')} className="nav-link">Como Funciona</button>
            <button onClick={() => scrollToSection('servicos')} className="nav-link">Serviços</button>
            <button onClick={() => scrollToSection('depoimentos')} className="nav-link">Depoimentos</button>
            <button onClick={() => scrollToSection('faq')} className="nav-link">FAQ</button>
          </nav>

          <div className="navbar-actions">
            <ThemeToggle />
            <Link to="/login" className="btn btn-outline navbar-login-btn">Entrar</Link>
            <Link to="/register" className="btn btn-primary navbar-register-btn">Criar Conta</Link>
            <button className="menu-toggle" onClick={() => setIsMenuOpen(!isMenuOpen)} aria-label="Toggle menu">
              {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </header>

      <nav className={`navbar-nav-mobile ${isMenuOpen ? 'navbar-nav-mobile-open' : ''}`}>
        <div className="navbar-nav-header">
          <Link to="/" className="logo" onClick={() => setIsMenuOpen(false)}>
            <img src={logoImg} alt="DividePass" className="logo-img" />
            <span>DividePass</span>
          </Link>
          <button className="menu-close" onClick={() => setIsMenuOpen(false)} aria-label="Fechar menu">
            <X size={24} />
          </button>
        </div>
        <div className="navbar-nav-links">
          <button onClick={() => scrollToSection('como-funciona')} className="nav-link">Como Funciona</button>
          <button onClick={() => scrollToSection('servicos')} className="nav-link">Serviços</button>
          <button onClick={() => scrollToSection('depoimentos')} className="nav-link">Depoimentos</button>
          <button onClick={() => scrollToSection('faq')} className="nav-link">FAQ</button>
        </div>
        <div className="nav-mobile-actions">
          <div className="nav-mobile-theme"><ThemeToggle /></div>
          <Link onClick={() => setIsMenuOpen(false)} to="/login" className="btn btn-outline btn-full">Entrar</Link>
          <Link onClick={() => setIsMenuOpen(false)} to="/register" className="btn btn-primary btn-full">Criar Conta</Link>
        </div>
      </nav>

      <main className="main-content">
        {/* HERO */}
        <section className="hero">
          <h1 className="hero-title">
            Assinaturas digitais
            <br />
            <span className="text-gradient">até 75% mais baratas</span>
          </h1>

          <p className="hero-subtitle">
            A DividePass conecta você a grupos de assinaturas digitais para economizar em serviços como Netflix, Spotify, Disney+, ChatGPT Plus e muitos outros. Tenha acesso de forma simples e segura, com entrega em minutos, suporte contínuo e renovação automática.
          </p>

          <div className="hero-buttons">
            <Link to="/register" className="btn btn-primary btn-lg">
              Economize agora!
              <ArrowRight size={20} />
            </Link>
            <button onClick={() => scrollToSection('como-funciona')} className="btn btn-outline btn-lg">
              <Play size={18} fill="currentColor" />
              Ver Como Funciona
            </button>
          </div>

          {(monthCount > 0 || monthSavingsTotal > 0) && (
            <div className="hero-trust">
              {monthCount > 0 && (
                <div className="hero-stat-card">
                  <div className="hero-trust-avatars">
                    {monthUsers.slice(0, 3).map((user, i) => {
                      const initials = (user.name || user.email || 'U').charAt(0).toUpperCase();
                      const colors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];
                      const bg = colors[i % colors.length];
                      return (
                        <div
                          key={user.id}
                          className="hero-trust-avatar"
                          title={user.name || user.email}
                          style={{ background: user.avatar_url ? 'transparent' : bg }}
                        >
                          {user.avatar_url ? (
                            <img src={user.avatar_url} alt={user.name || 'Usuário'} />
                          ) : (
                            <span>{initials}</span>
                          )}
                        </div>
                      );
                    })}
                    {monthCount > 3 && (
                      <div
                        className="hero-trust-avatar hero-trust-avatar-more"
                        title={`+${monthCount - 3} usuários`}
                      >
                        +{monthCount - 3}
                      </div>
                    )}
                  </div>
                  <span className="hero-stat-value">{monthCount}</span>
                  <span className="hero-stat-label">novos usuários este mês</span>
                </div>
              )}
              {monthSavingsTotal > 0 && (
                <div className="hero-stat-card hero-stat-card-highlight">
                  <span className="hero-stat-emoji">💰</span>
                  <span className="hero-stat-value">{fmtBRL(monthSavingsTotal)}</span>
                  <span className="hero-stat-label">economizados pelos assinantes este mês</span>
                </div>
              )}
              {monthSavingsTotal > 0 && monthSavingsUsers > 0 && (
                <div className="hero-stat-card">
                  <span className="hero-stat-emoji">📊</span>
                  <span className="hero-stat-value">{fmtBRL(monthSavingsTotal / monthSavingsUsers)}</span>
                  <span className="hero-stat-label">economia média por assinante</span>
                </div>
              )}
            </div>
          )}

          {monthSavingsTotal > 0 && (
            <p className="hero-savings-disclaimer">
              Valores calculados com base nas assinaturas válidas, nos valores efetivamente pagos e nos preços oficiais de cada plataforma.
            </p>
          )}
        </section>

        {/* GRUPOS DISPONÍVEIS */}
        <section className="home-available-groups">
          <div className="section-header">
            <span className="section-tag">🔥 Grupos disponíveis</span>
            <p className="section-description">Serviços que já possuem grupos formados</p>
          </div>
          <ServicesCarousel services={allServices} groups={groups} basePath="/" />
        </section>

        {/* CATÁLOGO */}
        <section id="servicos" className="services-section">
          <div className="section-header">
            <span className="section-tag">Serviços</span>
            <h2 className="section-title">Explorar todos os serviços</h2>
          </div>

          <div className="home-search-wrap">
            <Search size={18} />
            <input
              type="text"
              placeholder="Buscar serviço ou categoria..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="home-search-clear" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="home-category-wrapper">
            {canScrollLeft && (
              <button className="home-category-arrow left" onClick={() => scrollCategories(-1)}>
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="home-category-bar" ref={categoryBarRef}>
              {CATEGORIES.map(cat => (
                <button
                  key={cat.key}
                  className={`home-category-pill ${selectedCategory === cat.key ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat.key)}
                >
                  <span className="home-pill-icon">{cat.icon}</span>
                  <span className="home-pill-label">{cat.label}</span>
                </button>
              ))}
            </div>
            {canScrollRight && (
              <button className="home-category-arrow right" onClick={() => scrollCategories(1)}>
                <ChevronRight size={18} />
              </button>
            )}
          </div>

          <div className={`home-services-wrapper ${filteredServices.length > servicesVisible ? 'has-fade' : ''}`}>
            <div className="home-services-grid">
              {filteredServices.length === 0 ? (
                <div className="home-empty">Nenhum serviço encontrado.</div>
              ) : (
                filteredServices.slice(0, servicesVisible).map((service, index) => (
                  <Link
                    key={service.id}
                    to={`/${service.slug || service.id}`}
                    className={`home-service-card ${service.pinned ? 'home-card-pinned' : ''} ${service.featured ? 'home-card-featured' : ''}`}
                    style={{ animationDelay: `${index * 0.04}s` }}
                  >
                    <div className="home-service-header" style={{ backgroundColor: service.color }}>
                      {service.icon_url ? (
                        <img src={service.icon_url} alt={service.name} className="home-service-logo" />
                      ) : (
                        <div className="home-service-icon-text">{service.icon || service.name[0]}</div>
                      )}
                      {service.pinned && <div className="home-badge-pin"><Pin size={10} /></div>}
                      {service.featured && <div className="home-badge-star">⭐</div>}
                    </div>
                    <span className="home-service-name">{service.name}</span>
                  </Link>
                ))
              )}
            </div>
          </div>
          {filteredServices.length > servicesVisible && (
            <div className="home-show-more">
              <button className="btn btn-outline" onClick={() => setServicesVisible(prev => prev + 24)}>
                Ver mais plataformas
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </section>

        {/* COMO FUNCIONA */}
        <section id="como-funciona" className="how-it-works-section">
          <div className="section-header">
            <span className="section-tag">Como Funciona</span>
            <h2 className="section-title">Em 5 passos você já está economizando</h2>
          </div>

          {/* Desktop: grid direto */}
          <div className="steps-flow">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={index} className="step-card">
                  <div className="step-icon"><Icon size={22} /></div>
                  <div className="step-number">0{index + 1}</div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                  {index < steps.length - 1 && (
                    <div className="step-arrow" aria-hidden="true">→</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Mobile/tablet: carrossel horizontal com highlight dentro */}
          <div className="steps-scroll-wrapper">
            <div className="steps-flow-mobile" ref={stepsFlowRef}>
              {steps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <div key={index} className="step-card">
                    <div className="step-icon"><Icon size={22} /></div>
                    <div className="step-number">0{index + 1}</div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                );
              })}
            </div>
            <div className="steps-dots" aria-label="Navegação dos passos">
              {steps.map((_, i) => (
                <button
                  key={i}
                  className={`steps-dot ${i === stepIndex ? 'active' : ''}`}
                  aria-label={`Passo ${i + 1}`}
                />
              ))}
            </div>
            <div className="step-highlight-card">
              <div className="step-highlight-icon"><PlusCircle size={24} /></div>
              <h3>{stepHighlight.title}</h3>
              <p>{stepHighlight.description}</p>
              <Link to="/dashboard/groups/new" className="step-highlight-cta">
                Criar um grupo
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </section>

        {/* DEPOIMENTOS */}
        {testimonials.length > 0 && (
          <section id="depoimentos" className="testimonials-section">
            <div className="section-header">
              <span className="section-tag">Depoimentos</span>
              <h2 className="section-title">O que nossos usuários dizem</h2>
            </div>

            <div className="testimonials-carousel">
              <div className="testimonials-track" style={{ transform: `translateX(-${testimonialIndex * 100}%)` }}>
                {testimonials.map((testimonial) => (
                  <div key={testimonial.id} className="testimonial-card">
                    <div className="testimonial-stars">
                      {Array.from({ length: testimonial.rating }).map((_, i) => (
                        <Star key={i} size={14} fill="currentColor" />
                      ))}
                    </div>
                    <p className="testimonial-text">"{testimonial.text}"</p>
                    <div className="testimonial-author">
                      <div className="testimonial-avatar">{testimonial.user_name?.[0] || '?'}</div>
                      <div>
                        <strong>{testimonial.user_name}</strong>
                        <span>{testimonial.user_role || 'Usuário'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {testimonials.length > 1 && (
                <div className="testimonials-dots">
                  {testimonials.map((_, i) => (
                    <button
                      key={i}
                      className={`testimonials-dot ${i === testimonialIndex ? 'active' : ''}`}
                      onClick={() => setTestimonialIndex(i)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* FAQ */}
        <section id="faq" className="faq-section">
          <div className="section-header">
            <span className="section-tag">FAQ</span>
            <h2 className="section-title">Dúvidas frequentes</h2>
          </div>

          <div className="faq-list">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className={`faq-item ${openFaq === index ? 'faq-item-open' : ''}`}
              >
                <button
                  className="faq-question"
                  onClick={() => setOpenFaq(openFaq === index ? -1 : index)}
                >
                  <HelpCircle size={18} />
                  <span>{faq.question}</span>
                  <ChevronRight size={18} className="faq-chevron" />
                </button>
                <div className="faq-answer">
                  <p>{faq.answer}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="cta-section">
          <div className="cta-card">
            <div className="cta-content">
              <h2>Pronto para começar a economizar?</h2>
              <p>Crie sua conta gratuitamente em menos de 1 minuto.</p>
              <div className="cta-buttons">
                <Link to="/register" className="btn btn-primary btn-lg">
                  Criar Conta Grátis
                  <ArrowRight size={20} />
                </Link>
                <Link to="/login" className="btn btn-outline btn-lg">
                  Já tenho conta
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
