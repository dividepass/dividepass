import { Link } from 'react-router-dom';
import { LayoutGrid, KeyRound, Wallet, UserRound } from 'lucide-react';
import './dashboard-insights.css';

/**
 * ATALHOS — as quatro telas que a pessoa mais usa, na cara do gol.
 *
 * Mesmo desenho dos tópicos (ícone redondo + nome embaixo), então não
 * parece um bloco diferente no meio da home: é só mais uma fileira de
 * atalhos, na primeira coisa que se vê ao abrir o app.
 *
 * Rotas conferidas no App.jsx:
 *   /dashboard/catalog     — o catálogo com todas as plataformas
 *   /dashboard/credentials — as credenciais dos grupos
 *   /dashboard/billing     — as assinaturas e cobranças
 *   /dashboard/profile     — o perfil da pessoa
 */
const ATALHOS = [
  {
    label: 'Catálogo',
    to: '/dashboard/catalog',
    Icon: LayoutGrid,
    cor: '#4F46E5',
  },
  {
    label: 'Credenciais',
    to: '/dashboard/credentials',
    Icon: KeyRound,
    cor: '#0EA5E9',
  },
  {
    label: 'Assinaturas',
    to: '/dashboard/billing',
    Icon: Wallet,
    cor: '#10B981',
  },
  {
    label: 'Perfil',
    to: '/dashboard/profile',
    Icon: UserRound,
    cor: '#F59E0B',
  },
];

export default function QuickShortcuts() {
  return (
    <section className="quick-shortcuts" aria-label="Atalhos">
      <div className="quick-shortcuts-track">
        {ATALHOS.map(({ label, to, Icon, cor }) => (
          <Link key={to} to={to} className="quick-card">
            <span
              className="quick-card-icon"
              style={{ '--quick-cor': cor, backgroundColor: `${cor}1F`, color: cor }}
            >
              <Icon size={21} strokeWidth={2} aria-hidden />
            </span>
            <span className="quick-card-label">{label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
