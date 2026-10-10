import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import ThemeToggle from '../../components/ThemeToggle';
import AdminNotifications from './AdminNotifications';
import logoImg from '../../assets/logo.png';
import './AdminLayout.css';

const APP_VERSION = '1.0.0.2';

function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (path) => {
    return location.pathname === path ? 'active' : '';
  };

  const closeMenu = () => setMenuOpen(false);

  const handleLogout = async (e) => {
    e.preventDefault();
    await signOut();
    navigate('/');
  };

  return (
    <div className="admin-layout">
      {/* Botão Mobile Admin */}
      <button className="admin-mobile-btn" onClick={() => setMenuOpen(!menuOpen)}>
        {menuOpen ? '✕' : '☰'}
      </button>

      {menuOpen && <div className="admin-mobile-overlay" onClick={closeMenu}></div>}

      <aside className={`admin-sidebar ${menuOpen ? 'open' : ''}`}>
        <Link to="/admin" className="admin-logo">
          <img src={logoImg} alt="DP" className="admin-logo-img" />
          <span>Admin</span>
        </Link>
        <nav className="admin-nav">
          <Link onClick={closeMenu} to="/admin" className={`nav-item ${isActive('/admin')}`}>Dashboard</Link>
          <Link onClick={closeMenu} to="/admin/users" className={`nav-item ${isActive('/admin/users')}`}>Usuários</Link>
          <Link onClick={closeMenu} to="/admin/platforms" className={`nav-item ${isActive('/admin/platforms')}`}>Plataformas</Link>
          <Link onClick={closeMenu} to="/admin/billing" className={`nav-item ${isActive('/admin/billing')}`}>Cobranças 💳</Link>
          <Link onClick={closeMenu} to="/admin/support" className={`nav-item ${isActive('/admin/support')}`}>Suporte 🛎️</Link>
          <Link onClick={closeMenu} to="/admin/announcements" className={`nav-item ${isActive('/admin/announcements')}`}>Avisos 📢</Link>
          <Link onClick={closeMenu} to="/admin/coupons" className={`nav-item ${isActive('/admin/coupons')}`}>Cupons 🏷️</Link>
          <Link onClick={closeMenu} to="/admin/surveys" className={`nav-item ${isActive('/admin/surveys')}`}>Pesquisas 📝</Link>
          <Link onClick={closeMenu} to="/admin/onboarding" className={`nav-item ${isActive('/admin/onboarding')}`}>Onboarding 🎯</Link>
          <Link onClick={closeMenu} to="/admin/testimonials" className={`nav-item ${isActive('/admin/testimonials')}`}>Depoimentos ⭐</Link>
          <Link onClick={closeMenu} to="/admin/savings" className={`nav-item ${isActive('/admin/savings')}`}>Economia 📈</Link>
          <Link onClick={closeMenu} to="/admin/service-plans" className={`nav-item ${isActive('/admin/service-plans')}`}>Planos 📋</Link>
          <Link onClick={closeMenu} to="/admin/events" className={`nav-item ${isActive('/admin/events')}`}>Eventos 📊</Link>
          <Link onClick={closeMenu} to="/admin/expenses" className={`nav-item ${isActive('/admin/expenses')}`}>Despesas 💰</Link>
          <Link onClick={closeMenu} to="/admin/settings" className={`nav-item ${isActive('/admin/settings')}`}>Configurações ⚙️</Link>
        </nav>
        <div className="admin-footer">
          <div className="admin-footer-row">
            <AdminNotifications />
            <ThemeToggle className="sidebar-theme-toggle" />
          </div>
          <button onClick={handleLogout} className="nav-item logout">Sair do Painel</button>
          <div style={{ textAlign: 'center', padding: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)', opacity: 0.6 }}>v{APP_VERSION}</div>
        </div>
      </aside>
      
      <main className="admin-content">
        <div className="admin-page-wrap">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default AdminLayout;
