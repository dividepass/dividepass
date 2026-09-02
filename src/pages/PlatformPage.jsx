import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowRight, Users, Shield, Clock, CheckCircle, ExternalLink, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import './SeoPages.css';

const ENHANCED = {
  'netflix': {
    features: ['Filmes e series exclusivos em 4K', 'Multiplos perfis personalizados', 'Download para assistir offline', 'Sem anuncios em todos os planos', 'Recomendacoes por IA'],
    howItWorks: 'Ao participar de um grupo de Netflix na DividePass, voce recebe as credenciais de acesso e pode assistir normalmente em qualquer dispositivo. O pagamento e feito de forma segura e a renovacao e automatica.',
    faq: [
      { q: 'Posso usar minha propria perfil?', a: 'Depende da configuracao do grupo. Alguns grupos permitem perfis individuais, outros compartilham um perfil unico.' },
      { q: 'Qual plano e compartilhado?', a: 'Geralmente o plano Premium (4K, 4 dispositivos) ou Standard (1080p, 2 dispositivos).' },
      { q: 'E permitido pelo Netflix?', a: 'O compartilhamento dentro do mesmo pais e permitido nos planos que suportam multiplos dispositivos simultaneos.' }
    ],
  },
  'disney-plus': {
    features: ['Conteudo original Disney, Pixar e Marvel', 'Filmes de Star Wars e National Geographic', 'Qualidade 4K e HDR Dolby Vision', 'Download offline no aplicativo', 'Até 4 perfis simultaneos'],
    howItWorks: 'Participe de um grupo Disney+ e receba acesso imediato a todo o catalogo. A DividePass gerencia o pagamento e a renovacao automaticamente.',
    faq: [
      { q: 'Posso baixar conteudo para assistir offline?', a: 'Sim, todos os planos suportam download no aplicativo movel e tablet.' },
      { q: 'Quantas pessoas podem assistir ao mesmo tempo?', a: 'Depende do plano compartilhado, geralmente 2 a 4 dispositivos simultaneos.' }
    ],
  },
  'spotify': {
    features: ['Musica e podcasts sem anuncios', 'Download offline ilimitado', 'Qualidade de audio ate 320kbps', 'Modo offline e economy mode', 'Navegacao sem limites entre artistas'],
    howItWorks: 'Entre em um grupo de Spotify Premium e tenha acesso a toda a biblioteca de mais de 100 milhoes de musicas sem anuncios.',
    faq: [
      { q: 'Posso usar meu proprio perfil?', a: 'Sim, cada membro pode ter seu proprio perfil com suas playlists e musicas favoritas.' },
      { q: 'Funciona em todos os dispositivos?', a: 'Sim, funciona em celular, computador, smart TV, Alexa e qualquer dispositivo compativel.' }
    ],
  },
  'prime-video': {
    features: ['Conteudo original Amazon Prime', 'X-Ray para informacoes em tempo real', 'Download offline ilimitado', 'Qualidade 4K e HDR', 'Inclui todos os beneficios do Amazon Prime'],
    howItWorks: 'Participe de um grupo Prime Video e tenha acesso a todo o catalogo. O plano tambem inclui frete gratis na Amazon e outros beneficios.',
    faq: [
      { q: 'O plano inclui Amazon Prime completo?', a: 'Sim, ao assinar o Prime Video voce tambem recebe frete gratis, Amazon Music e muito mais.' },
      { q: 'Quantas pessoas podem assistir simultaneamente?', a: 'Geralmente 3 dispositivos ao mesmo tempo no plano compartilhado.' }
    ],
  },
  'hbo-max': {
    features: ['HBO originais e premiados', 'Filmes da Warner Bros em estreia', 'Conteudo DC exclusivo', 'Qualidade 4K disponivel', 'Download offline para viagens'],
    howItWorks: 'Entre em um grupo Max e tenha acesso a todo o conteudo premium de HBO, Warner Bros e DC.',
    faq: [
      { q: 'O nome mudou de HBO Max para Max?', a: 'Sim, o HBO Max foi renomeado para Max, mas todo o conteudo e mantido.' },
      { q: 'Posso assistir em 4K?', a: 'Sim, o plano compartilhado geralmente inclui qualidade 4K e HDR.' }
    ],
  },
  'chatgpt-plus': {
    features: ['Acesso ao GPT-4o e GPT-4 Turbo', 'DALL-E para geracao de imagens', 'Analise avancada de dados e codigos', 'Navegacao web em tempo real', 'GPTs personalizados e salvos'],
    howItWorks: 'Participe de um grupo ChatGPT Plus e receba acesso a todas as funcionalidades avancadas de inteligencia artificial.',
    faq: [
      { q: 'E seguro compartilhar minha conta?', a: 'A DividePass gerencia o acesso de forma segura, garantindo que apenas membros ativos tenham acesso.' },
      { q: 'Posso usar meus GPTs personalizados?', a: 'Depende da configuracao do grupo. Alguns grupos compartilham perfis individuais.' }
    ],
  },
  'youtube-premium': {
    features: ['Videos sem anuncios em todos os dispositivos', 'Reproduzir em segundo plano e tela travada', 'YouTube Music Premium incluso', 'Download offline para assistir depois', 'Acesso a YouTube Originals'],
    howItWorks: 'Entre em um grupo YouTube Premium e aproveite todos os beneficios sem anuncios.',
    faq: [
      { q: 'Funciona no celular e computador?', a: 'Sim, funciona em todos os dispositivos onde voce esta logado na conta.' },
      { q: 'O YouTube Music Premium esta incluido?', a: 'Sim, o YouTube Premium inclui acesso completo ao YouTube Music.' }
    ],
  },
  'adobe-creative-cloud': {
    features: ['Photoshop, Illustrator e Premiere Pro', 'After Effects e Lightroom', '100GB de armazenamento na nuvem', 'Adobe Fonts e Creative Cloud Libraries', 'Atualizacoes constantes incluidas'],
    howItWorks: 'Participe de um grupo Adobe e tenha acesso a todas as ferramentas profissionais de design e criacao.',
    faq: [
      { q: 'Funciona para uso comercial?', a: 'Sim, as licencas podem ser usadas para projetos comerciais e pessoais.' },
      { q: 'Recebo atualizacoes automaticas?', a: 'Sim, todas as atualizacoes sao incluidas sem custo adicional.' }
    ],
  },
  'microsoft-365': {
    features: ['Word, Excel e PowerPoint completos', '1TB de armazenamento OneDrive', 'Outlook e Teams inclusos', 'Atualizacoes automaticas constantes', 'Suporte para ate 6 contas'],
    howItWorks: 'Entre em um grupo Microsoft 365 e tenha acesso a todas as ferramentas Office com 1TB de nuvem.',
    faq: [
      { q: 'Quantas contas estao incluidas?', a: 'O plano familiar inclui ate 6 contas individuais com 1TB de OneDrive cada.' },
      { q: 'Funciona em Mac e Windows?', a: 'Sim, funciona em ambos os sistemas operacionais, iOS e Android.' }
    ],
  },
  'canva-pro': {
    features: ['Mais de 100 milhoes de templates premium', 'Fotos, videos e elementos exclusivos', 'Remocao de fundo com IA', 'Brand Kit para identidade visual', 'Armazenamento ilimitado'],
    howItWorks: 'Participe de um grupo Canva Pro e tenha acesso a todas as ferramentas premium de design.',
    faq: [
      { q: 'Posso usar para projetos comerciais?', a: 'Sim, todos os recursos podem ser usados para projetos pessoais e comerciais.' },
      { q: 'Meus designs ficam salvos?', a: 'Sim, todos os seus designs sao salvos na sua conta individual na nuvem.' }
    ],
  },
  'crunchyroll': {
    features: ['Milhares de animes legendados e dublados', 'Episodios recentes direto do Japao', 'Simulcasts semanalmente', 'Sem anuncios durante o episodio', 'Download offline para assistir depois'],
    howItWorks: 'Entre em um grupo Crunchyroll e tenha acesso a todo o catalogo de animes.',
    faq: [
      { q: 'Tem animes dublados em portugues?', a: 'Sim, muitos titulos populares possuem dublagem e legendas em portugues.' },
      { q: 'Os episodios sao atualizados rapido?', a: 'Sim, episodios sao disponibilizados poucos horas apos a exibicao no Japao.' }
    ],
  },
  'deezer': {
    features: ['Mais de 90 milhoes de musicas', 'Qualidade FLAC (sem compressao)', 'Flow personalizado por IA', 'Download offline ilimitado', 'Podcasts e audiobooks inclusos'],
    howItWorks: 'Participe de um grupo Deezer Premium e tenha acesso a toda a biblioteca em alta qualidade de audio.',
    faq: [
      { q: 'Qual a diferenca para o Spotify?', a: 'O Deezer oferece qualidade FLAC (sem compressao) e o Flow, uma playlist personalizada por IA.' },
      { q: 'Funciona em smart speakers?', a: 'Sim, funciona com Alexa, Google Home e outros dispositivos de áudio inteligente.' }
    ],
  },
  'paramount-plus': {
    features: ['Conteudo exclusivo Paramount', 'CBS, Nickelodeon e MTV', 'Filmes em estreia rapidamente', 'Canais ao vivo e sob demanda', 'Multiplos perfis para a familia'],
    howItWorks: 'Entre em um grupo Paramount+ e aproveite todo o conteudo das marcas Paramount.',
    faq: [
      { q: 'Tem conteudo ao vivo?', a: 'Sim, incluindo canais ao vivo, transmissoes de eventos especiais e esportes.' },
      { q: 'Posso assistir em 4K?', a: 'Sim, titulos selecionados estao disponiveis em 4K UHD.' }
    ],
  },
  'duolingo': {
    features: ['Aprendizado completamente sem anuncios', 'Testes de habilidade ilimitados', 'Correcao detalhada de erros', 'Download de aulas para estudar offline', 'Relatorios de progresso detalhados'],
    howItWorks: 'Participe de um grupo Duolingo e tenha acesso a todos os recursos premium para aprender idiomas.',
    faq: [
      { q: 'Quantos idiomas posso aprender?', a: 'Todos os 40+ idiomas disponiveis na plataforma, incluindo ingles, espanhol e frances.' },
      { q: 'Funciona offline?', a: 'Sim, voce pode baixar aulas completas para praticar sem conexao com a internet.' }
    ],
  },
  'github-copilot': {
    features: ['Sugestao de codigo em tempo real', 'Suporte a 30+ linguagens', 'Integracao com VS Code e JetBrains', 'Chat com IA para explicar codigo', 'Documentacao e exemplos automaticos'],
    howItWorks: 'Participe de um grupo GitHub Copilot e tenha acesso ao melhor assistente de IA para programacao.',
    faq: [
      { q: 'Suporta quais linguagens?', a: 'Python, JavaScript, TypeScript, Ruby, Go, Java, C#, Rust e muitas outras.' },
      { q: 'Funciona no meu IDE?', a: 'Sim, integra com VS Code, JetBrains, Neovim, Vim e outros editores populares.' }
    ],
  },
};

function PlatformPage() {
  const { slug } = useParams();
  const [platform, setPlatform] = useState(null);
  const [groupPrice, setGroupPrice] = useState(null);
  const [totalGroups, setTotalGroups] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openFaq, setOpenFaq] = useState(null);

  useEffect(() => {
    loadPlatform();
  }, [slug]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  const loadPlatform = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbError } = await supabase
        .from('streaming_services')
        .select('id, name, full_name, color, icon, icon_url, slug, description, official_price, official_url, category, status')
        .eq('slug', slug)
        .eq('status', 'active')
        .single();

      if (dbError || !data) {
        setError('Plataforma nao encontrada ou inativa.');
        setLoading(false);
        return;
      }

      setPlatform(data);
      document.title = `${data.full_name || data.name} - Compartilhe e Economize na DividePass`;

      const { data: groups } = await supabase
        .from('groups')
        .select('price_per_slot')
        .eq('service_id', data.id)
        .eq('status', 'open')
        .eq('approval_status', 'approved');

      if (groups && groups.length > 0) {
        const prices = groups.map(g => Number(g.price_per_slot)).filter(p => p > 0);
        setTotalGroups(groups.length);
        if (prices.length > 0) setGroupPrice(Math.min(...prices));
      }
    } catch (e) {
      setError('Erro ao carregar plataforma.');
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="seo-page">
        <div className="seo-loading">
          <Loader2 size={36} className="spin" />
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  if (error || !platform) {
    return (
      <div className="seo-page">
        <div className="seo-hero">
          <AlertCircle size={56} style={{ color: '#ef4444', marginBottom: '1rem', opacity: 0.8 }} />
          <h1>Plataforma nao encontrada</h1>
          <p className="seo-subtitle">{error || 'A plataforma que voce procura nao existe ou esta inativa.'}</p>
          <Link to="/" className="seo-btn-primary" style={{ marginTop: '2rem' }}>
            Voltar ao Inicio
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  }

  const enhanced = ENHANCED[slug] || {};
  const color = platform.color || '#4F46E5';
  const displayName = platform.full_name || platform.name;
  const officialPrice = Number(platform.official_price) || 0;
  const sharedPrice = groupPrice || 0;
  const savingsPct = officialPrice > 0 && sharedPrice > 0
    ? Math.round(((officialPrice - sharedPrice) / officialPrice) * 100)
    : 0;

  const fmtBRL = (v) => `R$ ${v.toFixed(2).replace('.', ',')}`;

  return (
    <div className="seo-page">
      <div className="seo-hero" style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}12 0%, transparent 60%)` }}>
        <div className="platform-hero">
          <div className="platform-hero-icon" style={{ background: `linear-gradient(135deg, ${color}30, ${color}15)` }}>
            {platform.icon_url ? (
              <img src={platform.icon_url} alt={platform.name} />
            ) : (
              <span>{platform.icon || platform.name[0]}</span>
            )}
          </div>
          <div className="platform-hero-info">
            <h1>{displayName}</h1>
            <p className="seo-subtitle">
              {platform.description || `Compartilhe ${platform.name} com outros usuarios e economize ate 75% na assinatura.`}
            </p>
            {sharedPrice > 0 && (
              <div className="platform-price-tag">
                {officialPrice > 0
                  ? `Economize ate ${savingsPct}% com DividePass`
                  : `A partir de ${fmtBRL(sharedPrice)} por mes`
                }
              </div>
            )}
            {platform.official_url && (
              <a href={platform.official_url} target="_blank" rel="noopener noreferrer" className="platform-official-link">
                <ExternalLink size={13} /> Site oficial
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="seo-content">
        <section className="seo-section">
          <h2>Sobre o {platform.name}</h2>
          <p>
            {platform.description
              ? `${platform.description} A DividePass permite compartilhar a assinatura de ${platform.name} com outros usuarios, dividindo o custo total e economizando significativamente.`
              : `A DividePass permite compartilhar a assinatura de ${platform.name} com outros usuarios, dividindo o custo total e economizando significativamente.`
            }
          </p>
          <p style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.4)' }}>
            Pagamento seguro via Mercado Pago, Stripe, Asaas, IOPay ou Pagar.me. Renovacao automatica e suporte dedicado.
          </p>
        </section>

        {officialPrice > 0 && sharedPrice > 0 && (
          <section className="seo-section">
            <h2>Quanto Voce Economiza?</h2>
            <div className="platform-price-grid">
              <div className="platform-price-card">
                <Clock size={20} style={{ color: 'rgba(255,255,255,0.4)' }} />
                <h3>Sozinho</h3>
                <p className="price-value">{fmtBRL(officialPrice)}</p>
                <p className="price-unit">por mes</p>
              </div>
              <div className="platform-price-card highlight">
                <Users size={20} style={{ color: '#34d399' }} />
                <h3>Com DividePass</h3>
                <p className="price-value">a partir de {fmtBRL(sharedPrice)}</p>
                <p className="price-unit">diversos grupos com valores diferentes</p>
              </div>
              <div className="platform-price-card">
                <Shield size={20} style={{ color: 'rgba(255,255,255,0.4)' }} />
                <h3>Sua Economia</h3>
                <p className="price-value" style={{ color: '#34d399' }}>ate {savingsPct}%</p>
                <p className="price-unit">de desconto</p>
              </div>
            </div>
          </section>
        )}

        {sharedPrice > 0 && !officialPrice && (
          <section className="seo-section">
            <h2>Quanto Voce Paga?</h2>
            <div className="platform-price-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="platform-price-card highlight">
                <Users size={20} style={{ color: '#34d399' }} />
                <h3>Com DividePass</h3>
                <p className="price-value">a partir de {fmtBRL(sharedPrice)}</p>
                <p className="price-unit">diversos grupos com valores diferentes</p>
              </div>
              <div className="platform-price-card">
                <Shield size={20} style={{ color: 'rgba(255,255,255,0.4)' }} />
                <h3>Grupos Disponiveis</h3>
                <p className="price-value" style={{ color: '#818cf8' }}>{totalGroups}</p>
                <p className="price-unit">{totalGroups === 1 ? 'grupo ativo' : 'grupos ativos'}</p>
              </div>
            </div>
          </section>
        )}

        <section className="seo-section">
          <h2>Como Funciona</h2>
          <p>{enhanced.howItWorks || `Participe de um grupo de ${platform.name} na DividePass e tenha acesso ao servico por uma fracao do custo.`}</p>
          <div className="seo-steps">
            <div className="seo-step">
              <div className="step-number">1</div>
              <h3>Escolha um grupo</h3>
              <p>Encontre um grupo ativo de {platform.name} no catalogo</p>
            </div>
            <div className="seo-step">
              <div className="step-number">2</div>
              <h3>Pague sua parte</h3>
              <p>{sharedPrice > 0 ? fmtBRL(sharedPrice) : 'Valor do grupo'} por mes via gateway seguro</p>
            </div>
            <div className="seo-step">
              <div className="step-number">3</div>
              <h3>Receba as credenciais</h3>
              <p>Acesso imediato via painel seguro da plataforma</p>
            </div>
            <div className="seo-step">
              <div className="step-number">4</div>
              <h3>Aproveite!</h3>
              <p>Use normalmente e renove automaticamente</p>
            </div>
          </div>
        </section>

        {enhanced.features && enhanced.features.length > 0 && (
          <section className="seo-section">
            <h2>Recursos Incluidos</h2>
            <ul className="seo-list">
              {enhanced.features.map((f, i) => (
                <li key={i}><CheckCircle size={18} /> {f}</li>
              ))}
            </ul>
          </section>
        )}

        {enhanced.faq && enhanced.faq.length > 0 && (
          <section className="seo-section">
            <h2>Duvidas Frequentes</h2>
            <div className="faq-list">
              {enhanced.faq.map((item, i) => (
                <div key={i} className="faq-item">
                  <button
                    className="faq-question"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  >
                    <span>{item.q}</span>
                    {openFaq === i ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                  {openFaq === i && (
                    <div className="faq-answer">
                      <p>{item.a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="seo-cta">
          <h2>Quero Economizar com {platform.name}</h2>
          <p>Junte-se a milhares de usuarios e pague muito menos.</p>
          <div className="seo-cta-buttons">
            <Link to="/register" className="seo-btn-primary">
              Criar Conta Grátis
              <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="seo-btn-secondary">
              Já tenho conta
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PlatformPage;
