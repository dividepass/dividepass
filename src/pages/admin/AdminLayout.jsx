import { useMemo, useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  ChartLine,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  MessageSquare,
  PiggyBank,
  Receipt,
  Settings,
  Star,
  Target,
  Ticket,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { APP_VERSION } from '../../lib/version';
import ThemeToggle from '../../components/ThemeToggle';
import AdminNotifications from './AdminNotifications';
import logoImg from '../../assets/logo.png';
import './AdminLayout.css';

/**
 * Navegação do admin agrupada por INTENÇÃO DE USO, não por tabela do banco.
 * Tudo que existia antes continua acessível — e três páginas que eram
 * inalcançáveis pelo menu entram: Assinaturas, Lista de espera e Carteiras.
 */
const NAV_SECTIONS = [
  {
    label: 'Operação',
    items: [
      { to: '/admin', label: 'Painel', icon: LayoutDashboard, end: true },
      { to: '/admin/support', label: 'Suporte', icon: LifeBuoy },
      { to: '/admin/announcements', label: 'Avisos', icon: Megaphone },
      { to: '/admin/emails', label: 'E-mails', icon: Mail },
      { to: '/admin/events', label: 'Eventos', icon: Activity },
    ],
  },
  {
    label: 'Pessoas',
    items: [
      { to: '/admin/users', label: 'Usuários', icon: Users },
      { to: '/admin/onboarding', label: 'Onboarding', icon: Target },
      { to: '/admin/interest', label: 'Lista de espera', icon: ListChecks },
      { to: '/admin/surveys', label: 'Pesquisas', icon: ClipboardList },
      { to: '/admin/testimonials', label: 'Depoimentos', icon: Star },
      { to: '/admin/feedback', label: 'Feedbacks', icon: MessageSquare, badge: 'feedback' },
    ],
  },
  {
    label: 'Plataforma',
    items: [
      { to: '/admin/platforms', label: 'Plataformas', icon: Layers },
      { to: '/admin/service-plans', label: 'Planos', icon: FileText },
      { to: '/admin/coupons', label: 'Cupons', icon: Ticket },
      { to: '/admin/subscriptions', label: 'Assinaturas', icon: CreditCard },
      { to: '/admin/evolution', label: 'Evolução', icon: ChartLine },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { to: '/admin/billing', label: 'Cobranças', icon: Wallet },
      { to: '/admin/wallets', label: 'Carteiras', icon: PiggyBank },
      { to: '/admin/savings', label: 'Economia', icon: TrendingUp },
      { to: '/admin/expenses', label: 'Despesas', icon: Receipt },
    ],
  },
  {
    label: 'Ajustes',
    items: [
      { to: '/admin/settings', label: 'Configurações', icon: Settings },
    ],
  },
];

/**
 * Sub-páginas de seções que são um HUB de verdade. Antes não havia como
 * sair de /admin/billing/calendar para /admin/billing — a seção era um beco
 * sem saída.
 */
const SECTION_TABS = {
  '/admin/billing': [
    { to: '/admin/billing', label: 'Visão geral', end: true },
    { to: '/admin/billing/calendar', label: 'Calendário' },
    { to: '/admin/billing/failures', label: 'Falhas' },
    { to: '/admin/billing/crons', label: 'Crons' },
  ],
};

/** Item de menu ativo = o mais específico cujo prefixo casa com a URL. */
function matchItem(pathname) {
  let found = null;
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      const hit = item.end
        ? pathname === item.to
        : pathname === item.to || pathname.startsWith(item.to + '/');
      if (hit && (!found || item.to.length > found.item.to.length)) {
        found = { section, item };
      }
    }
  }
  return found;
}

function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [newFeedbackCount, setNewFeedbackCount] = useState(0);

  // Badge de feedbacks novos: deixa o item do menu discoverível mesmo sem
  // o admin abrir a página. Falha silenciosa — é cosmético.
  useEffect(() => {
    let alive = true;

    const loadCount = async () => {
      try {
        const { count, error } = await supabase
          .from('user_feedback')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'new');

        if (!error && alive) setNewFeedbackCount(count || 0);
      } catch {
        /* badge é cosmético: nunca deve derrubar o painel */
      }
    };

    loadCount();
    const timer = setInterval(loadCount, 60000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  const handleLogout = async (e) => {
    e.preventDefault();
    await signOut();
    navigate('/');
  };

  const current = useMemo(() => matchItem(location.pathname), [location.pathname]);
  const tabs = current ? SECTION_TABS[current.item.to] : null;

  return (
    <div className="admin-layout">
      <button
        className="admin-mobile-btn"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
        aria-expanded={menuOpen}
      >
        {menuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {menuOpen && <div className="admin-mobile-overlay" onClick={closeMenu} />}

      <aside className={`admin-sidebar ${menuOpen ? 'open' : ''}`}>
        <Link to="/admin" className="admin-logo" onClick={closeMenu}>
          <img src={logoImg} alt="" className="admin-logo-img" />
          <span className="admin-logo-text">
            <strong>DividePass</strong>
            <em>Painel admin</em>
          </span>
        </Link>

        <nav className="admin-nav" aria-label="Navegação do admin">
          {NAV_SECTIONS.map((section, sectionIndex) => (
            <div
              className={`admin-nav-group ${sectionIndex > 0 ? 'has-rule' : ''}`}
              key={section.label}
            >
              <span className="admin-nav-group-label">{section.label}</span>

              {section.items.map((item) => {
                const Icon = item.icon;
                const active = item.end
                  ? location.pathname === item.to
                  : location.pathname === item.to || location.pathname.startsWith(item.to + '/');

                return (
                  <Link
                    onClick={closeMenu}
                    to={item.to}
                    key={item.to}
                    className={`nav-item ${active ? 'active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon size={16} className="nav-item-icon" aria-hidden />
                    <span>{item.label}</span>
                    {item.badge === 'feedback' && newFeedbackCount > 0 && (
                      <span
                        className="nav-item-badge"
                        title={`${newFeedbackCount} feedback(s) novo(s) sem revisão`}
                      >
                        {newFeedbackCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="admin-footer">
          <div className="admin-footer-row">
            <AdminNotifications />
            <ThemeToggle className="sidebar-theme-toggle" />
          </div>
          <button onClick={handleLogout} className="nav-item logout">
            <LogOut size={16} className="nav-item-icon" aria-hidden />
            <span>Sair do painel</span>
          </button>
          <div className="admin-version">v{APP_VERSION}</div>
        </div>
      </aside>

      <main className="admin-content">
        {/* Trilha de contexto + sub-navegação da seção. Vale para todas as
            22 páginas, sem precisar editar uma por uma. */}
        <div className="admin-context-bar">
          <div className="admin-context-trail">
            {current ? (
              <>
                <span className="admin-context-section">{current.section.label}</span>
                <ChevronRight size={13} className="admin-context-sep" aria-hidden />
                <span className="admin-context-page">{current.item.label}</span>
              </>
            ) : (
              <span className="admin-context-page">Painel admin</span>
            )}
          </div>

          {tabs && (
            <nav className="admin-context-tabs" aria-label={`Seção ${current.item.label}`}>
              {tabs.map((tab) => (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={`admin-context-tab ${
                    location.pathname === tab.to ||
                    (!tab.end && location.pathname.startsWith(tab.to + '/'))
                      ? 'active'
                      : ''
                  }`}
                >
                  {tab.label}
                </Link>
              ))}
            </nav>
          )}
        </div>

        <div className="admin-page-wrap">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default AdminLayout;
