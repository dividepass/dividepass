import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight, Target, Users, Tag } from 'lucide-react';
import { categoryLabel } from '../lib/onboardingQuestions';
import { fmtBRL } from '../lib/dashboardInsights';
import './dashboard-insights.css';

/**
 * Hero da Visão Geral — a PRIMEIRA coisa que a pessoa vê ao entrar no
 * dashboard, já direcionada para o que ela disse que interessa.
 *
 * O recorte vem do ONBOARDING: as plataformas que a pessoa marcou em
 * "Quais destas plataformas você tem interesse de entrar em grupos?" ficam
 * no topo, com o melhor preço disponível na DividePass. Quando não há
 * resposta de onboarding (conta antiga, onboarding pulado), o hero cai no
 * serviço com mais grupos — nunca fica vazio.
 *
 * É um SLIDE: como a pessoa marcou várias plataformas, o card vai passando
 * por elas uma a uma (a cada 5 segundos), em vez de mostrar só a primeira
 * e esconder o resto. Quando chega no fim, volta para o começo.
 */
export default function DashboardHero({
  firstName = '',
  services = [],
  groups = [],
  interests = [],
}) {
  const dados = useMemo(() => {
    const porId = new Map(services.map((s) => [s.id, s]));

    const gruposPorServico = new Map();
    groups.forEach((group) => {
      if (!group?.service_id) return;
      const atual = gruposPorServico.get(group.service_id) || { grupos: [], membros: 0 };
      atual.grupos.push(group);
      atual.membros += (group.members || []).filter(
        (m) => m.status === 'active' || m.status === 'pending'
      ).length;
      gruposPorServico.set(group.service_id, atual);
    });

    const precoDe = (serviceId) => {
      const info = gruposPorServico.get(serviceId);
      if (!info) return 0;
      const precos = info.grupos
        .map((g) => Number(g.price_per_slot))
        .filter((p) => Number.isFinite(p) && p > 0);
      return precos.length ? Math.min(...precos) : 0;
    };

    // Candidatos: as plataformas do onboarding que existem no catálogo.
    const candidatos = [];
    (interests || []).forEach((item) => {
      if (!item?.serviceId) return;
      const service = porId.get(item.serviceId);
      if (!service) return;
      const info = gruposPorServico.get(item.serviceId);
      candidatos.push({
        service,
        kind: item.kind,
        temGrupo: !!info,
        grupos: info?.grupos.length || 0,
        membros: info?.membros || 0,
        preco: precoDe(item.serviceId),
        // 'current' (uso hoje) pesa mais que 'interested' (tenho interesse)
        peso: (item.kind === 'current' ? 10 : 6) + (info ? 3 : 0),
      });
    });

    candidatos.sort((a, b) => {
      if (b.peso !== a.peso) return b.peso - a.peso;
      if (b.grupos !== a.grupos) return b.grupos - a.grupos;
      if (a.preco && b.preco) return a.preco - b.preco;
      return 0;
    });

    // Sem onboarding (ou sem serviço mapeado): o mais popular do catálogo.
    const fallback = services
      .map((service) => {
        const info = gruposPorServico.get(service.id);
        if (!info || !info.grupos.length) return null;
        return {
          service,
          kind: null,
          temGrupo: true,
          grupos: info.grupos.length,
          membros: info.membros,
          preco: precoDe(service.id),
          peso: 1,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.grupos - a.grupos || b.membros - a.membros)[0];

    const destaque = candidatos.find((c) => c.temGrupo) || candidatos[0] || fallback || null;

    /* SLIDES: as plataformas do onboarding que TÊM grupo (com preço) são
       as que o slide mostra — cada uma com o seu número. Se a pessoa não
       marcou nada (ou o onboarding está incompleto), o slide usa as
       plataformas mais usadas do catálogo, para nunca ficar vazio. */
    const slides = candidatos
      .filter((c) => c.temGrupo && c.preco > 0)
      .slice(0, 5);
    if (!slides.length && fallback) slides.push(fallback);
    if (!slides.length && destaque) slides.push(destaque);

    // Categorias que a pessoa marcou (viram as "chips" do herói).
    const chips = [];
    const vistas = new Set();
    (interests || []).forEach((item) => {
      const service = porId.get(item?.serviceId);
      if (!service?.category) return;
      const label = categoryLabel(service.category);
      if (vistas.has(label)) return;
      vistas.add(label);
      chips.push({ label, on: service.id === destaque?.service?.id });
    });

    return { destaque, chips, gruposPorServico, slides };
  }, [services, groups, interests]);

  const { chips, slides } = dados;
  const [index, setIndex] = useState(0);
  const pausado = useRef(false);

  /* Troca de slide a cada 5 segundos (com a pessoa parando para ler). */
  useEffect(() => {
    if (!slides || slides.length < 2) return undefined;
    const timer = setInterval(() => {
      if (pausado.current) return;
      setIndex((i) => (i + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [slides]);

  const atual = slides?.[index] || slides?.[0] || null;

  if (!atual) return null;

  const { service } = atual;
  const oficial = Number(service.official_price) || 0;
  const preco = atual.preco || 0;
  const desconto = oficial > 0 && preco > 0 ? Math.round(((oficial - preco) / oficial) * 100) : 0;
  const href = `/dashboard/catalog/${service.slug || service.id}`;
  const vemDoOnboarding = !!atual.kind;

  /* O selo do slide diz o motivo de ele estar ali. */
  const eyebrow =
    atual.kind === 'current'
      ? 'Você já usa'
      : vemDoOnboarding
        ? 'Escolhido para você'
        : 'Mais procurado agora';

  return (
    <section
      className="dash-hero"
      onMouseEnter={() => { pausado.current = true; }}
      onMouseLeave={() => { pausado.current = false; }}
    >
      {/* LINK QUE COBRE O CARD INTEIRO.
          Clicar no card leva para a plataforma — não só no botão. O botão
          fica por cima (z-index) para continuar funcionando no desktop. */}
      <Link
        to={href}
        className="dash-hero-overlay"
        aria-label={`Ver grupos de ${service.name}`}
      />

      <div className="dash-hero-inner">
        <div>
          <div className="dash-hero-eyebrow-row">
            <span className="dash-hero-eyebrow">
              <Sparkles size={13} />
              {eyebrow}
            </span>
            {/* No desktop o selo de desconto fica no logo (lá embaixo). No
                celular ele ia para fora do círculo e era CORTADO pelo
                overflow do logo — então ele vem para cá, do lado do selo
                do slide. */}
            {desconto > 0 && (
              <span className="dash-hero-off dash-hero-off--inline">-{desconto}% OFF</span>
            )}
          </div>

          <h1 className="dash-hero-title">Olá, {firstName}! 👋</h1>

          <h2 className="dash-hero-pick">
            <em>{service.name}</em> por menos
          </h2>

          <p className="dash-hero-text">
            {vemDoOnboarding
              ? `Você marcou esta plataforma. ${atual.grupos} ${atual.grupos === 1 ? 'grupo aberto' : 'grupos abertos'} agora.`
              : `A plataforma com mais grupos abertos. ${atual.grupos} ${atual.grupos === 1 ? 'grupo' : 'grupos'} para entrar.`}
          </p>

          {chips.length > 0 && (
            <div className="dash-hero-chips">
              {chips.slice(0, 5).map((chip) => (
                <span
                  key={chip.label}
                  className={`dash-hero-chip ${chip.on ? 'dash-hero-chip--on' : ''}`}
                >
                  {chip.on ? <Target size={12} /> : <Tag size={12} />}
                  {chip.label}
                </span>
              ))}
            </div>
          )}

          <div className="dash-hero-actions">
            <Link to={href} className="dash-hero-btn">
              Ver grupos <ArrowRight size={15} />
            </Link>
            <Link to="/dashboard/catalog" className="dash-hero-btn dash-hero-btn--ghost">
              Ver catálogo
            </Link>
          </div>

          <div className="dash-hero-stats">
            {preco > 0 && (
              <div className="dash-hero-stat">
                <b>{fmtBRL(preco)}/mês</b>
                <span>a partir de</span>
              </div>
            )}
            {desconto > 0 && (
              <div className="dash-hero-stat">
                <b>{desconto}% off</b>
                <span>vs. preço oficial</span>
              </div>
            )}
            <div className="dash-hero-stat">
              <b>{atual.grupos}</b>
              <span>{atual.grupos === 1 ? 'grupo aberto' : 'grupos abertos'}</span>
            </div>
            {atual.membros > 0 && (
              <div className="dash-hero-stat">
                <b>
                  <Users size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                  {atual.membros}
                </b>
                <span>já dividindo</span>
              </div>
            )}
          </div>
        </div>

        <div
          className="dash-hero-art"
          style={{ '--hero-glow': `${service.color || '#4F46E5'}40` }}
        >
          {service.icon_url ? (
            <img src={service.icon_url} alt={service.name} />
          ) : (
            <span className="dash-hero-art-letter">
              {(service.name || '?').charAt(0).toUpperCase()}
            </span>
          )}
          {desconto > 0 && <span className="dash-hero-off">-{desconto}% OFF</span>}
        </div>
      </div>

      {/* Quantos slides existem — o bonequinho mostra onde cada um está.
          No celular é o único sinal de que o card troca sozinho. */}
      {slides.length > 1 && (
        <div className="dash-hero-dots" role="tablist" aria-label="Plataformas em destaque">
          {slides.map((slide, i) => (
            <button
              key={slide.service.id}
              type="button"
              className={`dash-hero-dot ${i === index ? 'active' : ''}`}
              aria-label={slide.service.name}
              aria-selected={i === index}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
