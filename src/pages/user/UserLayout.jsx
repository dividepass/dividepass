import { useEffect, useState } from 'react';
import { Link, Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { useAuth } from '../../hooks/useAuth';
import { useAppTheme } from '../../hooks/useAppTheme';
import {
  ChevronDown, ChevronLeft,
  LayoutDashboard, Search, Users, Key, Package, CreditCard, Wallet, CreditCardIcon,
  History, Headphones, Gift, Star, Shield, Sun, Moon, LogOut, Menu, User as UserIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { APP_VERSION } from '../../lib/version';
import logoImg from '../../assets/logo.png';
import PwaInstallGate from '../../components/PwaInstallGate';
import PushNotificationGate from '../../components/PushNotificationGate';

/**
 * Shell do area logada do usuario.
 *
 * Design novo (Tailwind v4 + shadcn/Radix + Motion). O que nao pode mudar:
 * - a largura da sidebar (280px) — o `--shell-offset` do `App.css` depende
 *   dela para o rodape fixo das formularios;
 * - os caminhos das rotas;
 * - o redirect de quem ainda nao terminou o onboarding.
 */

const FINANCE_LINKS = [
  { to: '/dashboard/billing', label: 'Assinaturas e Faturas' },
  { to: '/dashboard/wallet', label: 'Carteira', icon: Wallet },
  { to: '/dashboard/my-cards', label: 'Meus Cartoes', icon: CreditCardIcon },
  { to: '/dashboard/my-cupons', label: 'Meus Cupons', icon: Gift },
  { to: '/dashboard/subscription-history', label: 'Historico de Assinaturas', icon: History },
];

function navItemClass(active) {
  return [
    'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-150',
    'text-muted-foreground hover:bg-accent hover:text-foreground',
    active ? 'bg-primary/10 text-primary' : '',
  ].join(' ');
}

/**
 * Link da navegacao com indicador animado.
 *
 * O `layoutId` e unico por instancia (desktop x mobile): se as duas
 * copias usassem o mesmo id, o Motion registraria dois filhos com o mesmo
 * layoutId e o indicador "pularia" entre as duas arvores.
 */
function NavLink({ to, label, icon: Icon, active, onNavigate, indicatorId }) {
  return (
    <Link
      onClick={onNavigate}
      to={to}
      className={navItemClass(active)}
      aria-current={active ? 'page' : undefined}
    >
      {active ? (
        <motion.span
          layoutId={indicatorId}
          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        />
      ) : null}
      {Icon ? <Icon size={18} aria-hidden="true" /> : null}
      <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * Conteudo da navegacao — usado na sidebar do desktop e dentro do Sheet
 * do mobile. Vive fora do componente para nao ser remontado a cada render.
 */
function NavContent({
  isActive,
  isFinanceActive,
  financeOpen,
  setFinanceOpen,
  onNavigate,
  indicatorId,
  displayName,
  avatarUrl,
  currentUser,
  activeCount,
  isAdmin,
  theme,
  toggleTheme,
  onProfile,
  onLogout,
}) {
  return (
    <>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
        <NavLink to="/dashboard" label="Visao Geral" icon={LayoutDashboard} active={isActive('/dashboard')} onNavigate={onNavigate} indicatorId={indicatorId} />
        <NavLink to="/dashboard/catalog" label="Catalogo" icon={Search} active={isActive('/dashboard/catalog')} onNavigate={onNavigate} indicatorId={indicatorId} />
        <NavLink to="/dashboard/my-groups" label="Meus Grupos" icon={Users} active={isActive('/dashboard/my-groups')} onNavigate={onNavigate} indicatorId={indicatorId} />
        <NavLink to="/dashboard/credentials" label="Minhas Credenciais" icon={Key} active={isActive('/dashboard/credentials')} onNavigate={onNavigate} indicatorId={indicatorId} />
        <NavLink to="/dashboard/entregas" label="Minhas Entregas" icon={Package} active={isActive('/dashboard/entregas')} onNavigate={onNavigate} indicatorId={indicatorId} />

        <Collapsible open={financeOpen} onOpenChange={setFinanceOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={navItemClass(isFinanceActive)}
              aria-current={isFinanceActive ? 'page' : undefined}
            >
              <CreditCard size={18} aria-hidden="true" />
              <span className="flex-1 text-left">Financeiro</span>
              <motion.span
                animate={{ rotate: financeOpen ? 180 : 0 }}
                transition={{ duration: 0.18 }}
                className="text-muted-foreground"
              >
                <ChevronDown size={16} aria-hidden="true" />
              </motion.span>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent className="mt-1 flex flex-col gap-0.5">
            {FINANCE_LINKS.map((link) => (
              <Link
                key={link.to}
                onClick={onNavigate}
                to={link.to}
                className={navItemClass(isActive(link.to))}
                aria-current={isActive(link.to) ? 'page' : undefined}
              >
                {link.icon ? <link.icon size={16} aria-hidden="true" /> : null}
                <span className="truncate">{link.label}</span>
              </Link>
            ))}
          </CollapsibleContent>
        </Collapsible>

        <NavLink to="/dashboard/support" label="Suporte" icon={Headphones} active={isActive('/dashboard/support')} onNavigate={onNavigate} indicatorId={indicatorId} />
        <NavLink to="/dashboard/share" label="Convidar Amigos" icon={Gift} active={isActive('/dashboard/share')} onNavigate={onNavigate} indicatorId={indicatorId} />
        <NavLink to="/dashboard/testimonial" label="Depoimento" icon={Star} active={isActive('/dashboard/testimonial')} onNavigate={onNavigate} indicatorId={indicatorId} />

        {isAdmin ? (
          <Link
            onClick={onNavigate}
            to="/admin"
            className="mt-2 flex items-center gap-3 rounded-xl border border-economy/25 bg-economy/10 px-3 py-2.5 text-sm font-semibold text-economy transition-colors hover:bg-economy/15"
          >
            <Shield size={18} aria-hidden="true" />
            Painel Admin
          </Link>
        ) : null}
      </nav>

      <div className="border-t border-border px-3 py-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                  {(currentUser?.name?.[0] || 'U').toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {activeCount} {activeCount === 1 ? 'assinatura ativa' : 'assinaturas ativas'}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onProfile}>
              <UserIcon size={16} aria-hidden="true" />
              Meu perfil
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleTheme}>
              {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
              {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onLogout}>
              <LogOut size={16} aria-hidden="true" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <p className="mt-3 px-2 text-xs text-muted-foreground">v{APP_VERSION}</p>
      </div>
    </>
  );
}

function UserLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const { currentUser, getActiveServices } = useAppDataContext();
  const { signOut, profile } = useAuth();
  const { theme, toggleTheme } = useAppTheme();
  const isAdmin = profile?.role === 'admin';

  // Enquanto o onboarding não terminou, nada dentro de /dashboard é
  // acessível. Virou rota dedicada em vez de modal justamente porque um
  // overlay podia ser dispensado com um clique e o usuário nunca voltava.
  // O redirect fica depois de todos os hooks (ver o return mais abaixo).
  const onboardingPending = !!profile && !profile.onboarding_completed_at;

  const activeCount = getActiveServices().length;
  const displayName = profile?.nickname || currentUser?.name || 'Usuario';
  const avatarUrl = profile?.avatar_url || null;

  const isActive = (path) => {
    if (path === '/dashboard') return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  const isFinanceActive =
    location.pathname.startsWith('/dashboard/billing') ||
    location.pathname.startsWith('/dashboard/wallet') ||
    location.pathname.startsWith('/dashboard/subscription-history') ||
    location.pathname.startsWith('/dashboard/my-cards');

  // O grupo Financeiro abre sozinho quando a rota atual esta dentro dele.
  useEffect(() => {
    if (isFinanceActive) setFinanceOpen(true);
  }, [location.pathname, isFinanceActive]);

  const closeMenu = () => setMenuOpen(false);

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/dashboard');
  };

  // Depois de todos os hooks: um return antes deles violaria a ordem de
  // chamada dos hooks e quebraria a página em qualquer re-render.
  if (onboardingPending) return <Navigate to="/onboarding" replace />;

  const navProps = {
    isActive,
    isFinanceActive,
    financeOpen,
    setFinanceOpen,
    displayName,
    avatarUrl,
    currentUser,
    activeCount,
    isAdmin,
    theme,
    toggleTheme,
    onProfile: () => navigate('/dashboard/profile'),
    onLogout: handleLogout,
  };

  return (
    <div className="layout-container flex min-h-screen bg-background">
      <PwaInstallGate />
      <PushNotificationGate />

      {/* Topo fixo no mobile/tablet.
          O corte é em 850px: abaixo disso a navegação vira gaveta (o botão
          ☰ do topo) e a barra lateral some — em 768–850px ainda era desktop
          e a tela ficava apertada. */}
      <header className="fixed inset-x-2 top-2 z-40 grid grid-cols-[42px_1fr_42px] items-center gap-2 rounded-2xl border border-border bg-card/90 px-1.5 py-1.5 shadow-lg backdrop-blur-xl min-[851px]:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={goBack}
          aria-label="Voltar"
          className="rounded-full"
        >
          <ChevronLeft size={22} />
        </Button>

        <Link to="/dashboard" className="flex min-w-0 items-center justify-center gap-2" aria-label="DividePass">
          <img src={logoImg} alt="" className="size-6 shrink-0 object-contain" />
          <span className="truncate text-base font-extrabold tracking-tight text-foreground">
            Divide<span className="text-primary">Pass</span>
          </span>
        </Link>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Abrir menu" className="rounded-full">
              <Menu size={22} />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="flex w-[286px] flex-col gap-0 border-l border-border bg-card p-0">
            <Link
              to="/dashboard"
              onClick={closeMenu}
              className="flex items-center gap-2 px-5 py-5"
              aria-label="DividePass"
            >
              <img src={logoImg} alt="" className="size-9 object-contain" />
              <span className="text-xl font-extrabold tracking-tight text-foreground">
                Divide<span className="text-primary">Pass</span>
              </span>
            </Link>
            <NavContent {...navProps} onNavigate={closeMenu} indicatorId="dp-nav-indicator-mobile" />
          </SheetContent>
        </Sheet>
      </header>

      {/* Sidebar fixa no desktop (a partir de 851px) */}
      <aside className="sticky top-0 hidden h-screen w-[280px] shrink-0 flex-col border-r border-border bg-card min-[851px]:flex">
        <Link to="/dashboard" className="flex items-center gap-2 px-6 py-6" aria-label="DividePass">
          <img src={logoImg} alt="" className="size-9 object-contain" />
          <span className="text-xl font-extrabold tracking-tight text-foreground">
            Divide<span className="text-primary">Pass</span>
          </span>
        </Link>
        <NavContent {...navProps} onNavigate={closeMenu} indicatorId="dp-nav-indicator-desktop" />
      </aside>

      <main className="main-content min-w-0 flex-1 px-3 pb-10 pt-20 min-[851px]:h-screen min-[851px]:overflow-y-auto min-[851px]:overflow-x-hidden min-[851px]:px-10 min-[851px]:pt-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default UserLayout;
