import { useState, useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { useAuth } from '../../hooks/useAuth';
import {
  ChevronDown, ChevronLeft,
  LayoutDashboard, Search, Users, Key, CreditCard, Wallet, CreditCardIcon,
  History, Headphones, Gift, Star, Shield, Sun, Moon, LogOut
} from 'lucide-react';
import { getStoredTheme, getSystemTheme, applyTheme } from '../../lib/themeUtils';
import logoImg from '../../assets/logo.png';
import PwaInstallGate from '../../components/PwaInstallGate';
import PushNotificationGate from '../../components/PushNotificationGate';
import './UserLayout.css';

const APP_VERSION = '1.0.0.2';

function UserLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [theme, setTheme] = useState(() => getStoredTheme() || getSystemTheme());
  const { currentUser, getActiveServices } = useAppDataContext();
  const { signOut, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const activeCount = getActiveServices().length;
  const displayName = profile?.nickname || currentUser?.name || 'Usuário';
  const avatarUrl = profile?.avatar_url || null;

  // Header shrink on scroll
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setScrolled(window.scrollY > 50);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Sync theme
  useEffect(() => {
    applyTheme(theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      if (!getStoredTheme()) setTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  const isActive = (path) => {
    if (path === '/dashboard') return location.pathname === path ? 'active' : '';
    return location.pathname.startsWith(path) ? 'active' : '';
  };

  const isFinanceActive = location.pathname.startsWith('/dashboard/billing')
    || location.pathname.startsWith('/dashboard/wallet')
    || location.pathname.startsWith('/dashboard/subscription-history')
    || location.pathname.startsWith('/dashboard/my-cards');

  const closeMenu = () => setMenuOpen(false);

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="layout-container">
      <PwaInstallGate />
      <PushNotificationGate />

      <header className={`mobile-topbar ${scrolled ? 'scrolled' : ''}`}>
        <button
          className="mobile-topbar-back"
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate('/dashboard');
          }}
          aria-label="Voltar"
        >
          <ChevronLeft size={22} />
        </button>

        <Link to="/dashboard" className="mobile-topbar-logo" aria-label="DividePass">
          <img src={logoImg} alt="DividePass" className="mobile-topbar-logo-img" />
          <span>Divide<span>Pass</span></span>
        </Link>

        <button className="mobile-topbar-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu">
          {menuOpen ? '✕' : '☰'}
        </button>
      </header>

      <button className="mobile-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>
        {menuOpen ? '✕' : '☰'}
      </button>

      {menuOpen && <div className="mobile-overlay" onClick={closeMenu}></div>}

      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <Link to="/dashboard" className="logo">
          <img src={logoImg} alt="DividePass" className="logo-img" />
          <span>Divide<span>Pass</span></span>
        </Link>

        <nav className="nav-menu">
          <Link onClick={closeMenu} to="/dashboard" className={`nav-item ${isActive('/dashboard')}`}>
            <LayoutDashboard size={18} />Visão Geral
          </Link>
          <Link onClick={closeMenu} to="/dashboard/catalog" className={`nav-item ${isActive('/dashboard/catalog')}`}>
            <Search size={18} />Catálogo
          </Link>
          <Link onClick={closeMenu} to="/dashboard/my-groups" className={`nav-item ${isActive('/dashboard/my-groups')}`}>
            <Users size={18} />Meus Grupos
          </Link>
          <Link onClick={closeMenu} to="/dashboard/credentials" className={`nav-item ${isActive('/dashboard/credentials')}`}>
            <Key size={18} />Minhas Credenciais
          </Link>

          <div className={`nav-group ${isFinanceActive ? 'active' : ''}`}>
            <button className={`nav-item nav-group-toggle ${isFinanceActive ? 'active' : ''}`} onClick={() => setFinanceOpen(!financeOpen)}>
              <CreditCard size={18} />Financeiro
              <ChevronDown size={16} className={`nav-group-arrow ${financeOpen ? 'open' : ''}`} />
            </button>
            {financeOpen && (
              <div className="nav-group-items">
                <Link onClick={closeMenu} to="/dashboard/billing" className={`nav-item nav-sub ${isActive('/dashboard/billing')}`}>
                  Assinaturas e Faturas
                </Link>
                <Link onClick={closeMenu} to="/dashboard/wallet" className={`nav-item nav-sub ${isActive('/dashboard/wallet')}`}>
                  <Wallet size={16} />Carteira
                </Link>
                <Link onClick={closeMenu} to="/dashboard/my-cards" className={`nav-item nav-sub ${isActive('/dashboard/my-cards')}`}>
                  <CreditCardIcon size={16} />Meus Cartões
                </Link>
                <Link onClick={closeMenu} to="/dashboard/subscription-history" className={`nav-item nav-sub ${isActive('/dashboard/subscription-history')}`}>
                  <History size={16} />Histórico de Assinaturas
                </Link>
              </div>
            )}
          </div>

          <Link onClick={closeMenu} to="/dashboard/support" className={`nav-item ${isActive('/dashboard/support')}`}>
            <Headphones size={18} />Suporte
          </Link>
          <Link onClick={closeMenu} to="/dashboard/share" className={`nav-item ${isActive('/dashboard/share')}`}>
            <Gift size={18} />Convidar Amigos
          </Link>
          <Link onClick={closeMenu} to="/dashboard/testimonial" className={`nav-item ${isActive('/dashboard/testimonial')}`}>
            <Star size={18} />Depoimento
          </Link>

          {isAdmin && (
            <Link onClick={closeMenu} to="/admin" className="nav-item nav-admin-link">
              <Shield size={18} />Painel Admin
            </Link>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info" onClick={() => { closeMenu(); navigate('/dashboard/profile'); }} style={{ cursor: 'pointer' }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="avatar avatar-img" />
            ) : (
              <div className="avatar">{currentUser?.name?.[0] || 'U'}</div>
            )}
            <div className="user-details">
              <strong>{displayName}</strong>
              <span>{activeCount} {activeCount === 1 ? 'assinatura ativa' : 'assinaturas ativas'}</span>
            </div>
          </div>

          <div className="sidebar-theme-row">
            <button
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              <span>{theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</span>
            </button>
          </div>

          <button onClick={handleLogout} className="nav-item logout">
            <LogOut size={18} />Sair
          </button>

          <div className="sidebar-version">v{APP_VERSION}</div>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

export default UserLayout;
