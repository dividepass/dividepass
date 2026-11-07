import { Link, useLocation } from 'react-router-dom';
import { MessageCircle, Mail, ArrowUpRight } from 'lucide-react';
import logoImg from '../assets/logo.png';
import { SUPORTE_EMAIL } from '../lib/siteLinks';
import { useWhatsappVipUrl } from '../hooks/useWhatsappVipUrl';

/**
 * Rodapé do site.
 *
 * `variant="auto"` (padrão) acompanha o tema do app (claro/escuro) e usa os
 * tokens semanticos do design system. `variant="dark"` fixa o visual escuro
 * — usado nas páginas públicas de SEO, que têm fundo fixo escuro e não
 * seguem o tema.
 */
export default function SiteFooter({ variant = 'auto' }) {
  const location = useLocation();
  const whatsappVipUrl = useWhatsappVipUrl();
  const dark = variant === 'dark';

  // Na landing o scroll é suave, sem recarregar a página. Em outras páginas
  // o link segue o comportamento normal do navegador (href "/#id").
  const irParaSecao = (id) => (e) => {
    if (location.pathname !== '/') return;
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    window.history.replaceState(null, '', `/#${id}`);
  };

  const ano = new Date().getFullYear();

  const shellClass = dark
    ? 'border-white/10 bg-white/[0.02] text-white/45'
    : 'border-border bg-card text-muted-foreground';
  const titleClass = dark ? 'text-white' : 'text-foreground';
  const linkHoverClass = dark ? 'hover:text-[#818cf8]' : 'hover:text-primary';
  const socialClass = dark
    ? 'border-white/10 text-white/45 hover:border-[#818cf8] hover:bg-white/5 hover:text-white'
    : 'border-border text-muted-foreground hover:border-primary hover:bg-primary/10 hover:text-foreground';

  const colunas = [
    {
      titulo: 'Plataforma',
      links: [
        { label: 'Como Funciona', href: '/#como-funciona', secao: 'como-funciona' },
        { label: 'Serviços', href: '/#servicos', secao: 'servicos' },
        { label: 'Depoimentos', href: '/#depoimentos', secao: 'depoimentos' },
        { label: 'Perguntas frequentes', href: '/#faq', secao: 'faq' },
      ],
    },
    {
      titulo: 'Sua conta',
      links: [
        { label: 'Criar conta grátis', to: '/register' },
        { label: 'Entrar', to: '/login' },
        { label: 'Criar um grupo', to: '/dashboard/my-groups/create' },
        { label: 'Suporte', to: '/dashboard/support' },
      ],
    },
    {
      titulo: 'Sobre',
      links: [
        { label: 'Sobre a DividePass', to: '/sobre' },
        { label: 'Central de dúvidas', to: '/faq' },
        { label: SUPORTE_EMAIL, href: `mailto:${SUPORTE_EMAIL}` },
        { label: 'Grupo VIP', href: whatsappVipUrl, externo: true },
      ],
    },
  ];

  return (
    <footer className={`relative z-[1] border-t px-6 py-14 pb-7 ${shellClass}`}>
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-[2fr_repeat(3,1fr)] lg:gap-12">
          <div className="md:col-span-2 lg:col-span-1">
            <Link to="/" className={`inline-flex items-center gap-2.5 text-xl font-extrabold tracking-tight ${titleClass}`}>
              <img src={logoImg} alt="" className="size-9 object-contain" />
              DividePass
            </Link>

            <p className="mt-4 max-w-sm text-sm leading-relaxed">
              Assinaturas digitais divididas. Entre num grupo, pague só a sua
              parte e receba o acesso na hora.
            </p>

            <a
              className={`mt-5 inline-flex items-center gap-2 rounded-xl border border-violet-400/35 bg-violet-500/12 px-4 py-2.5 text-sm font-semibold transition-all hover:-translate-y-0.5 hover:border-violet-400/60 hover:bg-violet-500/22 ${titleClass}`}
              href={whatsappVipUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden="true">💜</span>
              Grupo VIP WhatsApp
              <ArrowUpRight size={16} />
            </a>

            <div className="mt-5 flex gap-2.5">
              <a
                className={`flex size-9 items-center justify-center rounded-[10px] border transition-all ${socialClass}`}
                href={whatsappVipUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Grupo VIP no WhatsApp"
                title="Grupo VIP no WhatsApp"
              >
                <MessageCircle size={18} />
              </a>
              <a
                className={`flex size-9 items-center justify-center rounded-[10px] border transition-all ${socialClass}`}
                href={`mailto:${SUPORTE_EMAIL}`}
                aria-label="Falar com o suporte"
                title={SUPORTE_EMAIL}
              >
                <Mail size={18} />
              </a>
            </div>
          </div>

          {colunas.map((coluna) => (
            <div key={coluna.titulo} className="flex flex-col gap-2.5">
              <h4 className={`mb-1 text-[0.95rem] font-bold ${titleClass}`}>{coluna.titulo}</h4>
              {coluna.links.map((link) => {
                const conteudo = link.label
                if (link.to) {
                  return (
                    <Link
                      key={link.label}
                      to={link.to}
                      className={`text-sm transition-colors ${linkHoverClass}`}
                    >
                      {conteudo}
                    </Link>
                  );
                }
                return (
                  <a
                    key={link.label}
                    href={link.href}
                    onClick={link.secao ? irParaSecao(link.secao) : undefined}
                    {...(link.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className={`text-sm transition-colors ${linkHoverClass}`}
                  >
                    {conteudo}
                  </a>
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4 border-t pt-6 text-sm md:justify-between">
          <span>© {ano} DividePass. Todos os direitos reservados.</span>
          <span className="inline-flex items-center gap-1.5">
            Feito com <span aria-hidden="true">💜</span> no Brasil
          </span>
        </div>
      </div>
    </footer>
  );
}
