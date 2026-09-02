import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Users, CreditCard, Headphones, ArrowRight, CheckCircle } from 'lucide-react';
import './SeoPages.css';

function Sobre() {
  useEffect(() => {
    document.title = 'Sobre a DividePass - Como Funciona a Plataforma';
  }, []);

  return (
    <div className="seo-page">
      <div className="seo-hero">
        <h1>Sobre a DividePass</h1>
        <p className="seo-subtitle">Conectando pessoas para economizar em assinaturas digitais desde 2024.</p>
      </div>

      <div className="seo-content">
        <section className="seo-section">
          <h2>O que e a DividePass?</h2>
          <p>
            A DividePass e uma plataforma brasileira que facilita o compartilhamento e o rateio de assinaturas
            digitais. Nossa missao e permitir que mais pessoas tenham acesso a servicos de streaming, musicas,
            inteligencia artificial e ferramentas de produtividade pagando significativamente menos.
          </p>
          <p>
            Com a DividePass, usuarios podem criar ou participar de grupos de assinatura, dividindo o custo
            total entre todos os membros. Isso permite economias de ate <strong>75%</strong> no valor mensal
            de servicos como Netflix, Spotify, Disney+, ChatGPT Plus e muitos outros.
          </p>
        </section>

        <section className="seo-section">
          <h2>Como Funciona?</h2>
          <div className="seo-steps">
            <div className="seo-step">
              <div className="step-number">1</div>
              <h3>Crie sua conta</h3>
              <p>Cadastre-se gratuitamente na plataforma em segundos.</p>
            </div>
            <div className="seo-step">
              <div className="step-number">2</div>
              <h3>Escolha um grupo</h3>
              <p>Navegue pelo catalogo e encontre o servico que deseja compartilhar.</p>
            </div>
            <div className="seo-step">
              <div className="step-number">3</div>
              <h3>Pague sua parte</h3>
              <p>Realize o pagamento de forma segura por meio de um dos nossos gateways.</p>
            </div>
            <div className="seo-step">
              <div className="step-number">4</div>
              <h3>Acesse o servico</h3>
              <p>Receba as credenciais e comece a usar imediatamente.</p>
            </div>
          </div>
        </section>

        <section className="seo-section">
          <h2>Quem pode utilizar?</h2>
          <p>
            Qualquer pessoa no Brasil que deseja economizar em assinaturas digitais pode usar a DividePass.
            Tanto usuarios individuais quanto criadores de grupos se beneficiam da plataforma.
          </p>
          <ul className="seo-list">
            <li><CheckCircle size={18} /> Usuarios que querem pagar menos em streamings</li>
            <li><CheckCircle size={18} /> Criadores de grupos que querem gerenciar compartilhamentos</li>
            <li><CheckCircle size={18} /> Estudantes e familias que buscam economia</li>
            <li><CheckCircle size={18} /> Qualquer pessoa que utilize servicos digitais</li>
          </ul>
        </section>

        <section className="seo-section">
          <h2>Seguranca e Confiabilidade</h2>
          <div className="seo-features">
            <div className="seo-feature">
              <Shield size={24} />
              <h3>Pagamentos Seguros</h3>
              <p>Processados por gateways como Mercado Pago, Stripe, Asaas, IOPay e Pagar.me.</p>
            </div>
            <div className="seo-feature">
              <Users size={24} />
              <h3>Membros Verificados</h3>
              <p>Credenciais protegidas e acessiveis apenas para membros ativos do grupo.</p>
            </div>
            <div className="seo-feature">
              <CreditCard size={24} />
              <h3>Cobranca Automatica</h3>
              <p>Renovacoes e cobrancas recorrentes gerenciadas pela plataforma.</p>
            </div>
            <div className="seo-feature">
              <Headphones size={24} />
              <h3>Suporte Dedicado</h3>
              <p>Equipe pronta para ajudar com qualquer problema ou duvida.</p>
            </div>
          </div>
        </section>

        <section className="seo-section">
          <h2>Nossos Valores</h2>
          <ul className="seo-list">
            <li><CheckCircle size={18} /> <strong>Transparencia:</strong> todos os valores e regras sao claros</li>
            <li><CheckCircle size={18} /> <strong>Seguranca:</strong> dados e pagamentos protegidos</li>
            <li><CheckCircle size={18} /> <strong>Economia:</strong> o foco e reduzir custos para todos</li>
            <li><CheckCircle size={18} /> <strong>Acessibilidade:</strong> plataforma facil de usar</li>
          </ul>
        </section>

        <div className="seo-cta">
          <h2>Comece a economizar agora</h2>
          <p>Junte-se a milhares de usuarios que ja estao economizando com a DividePass.</p>
          <Link to="/register" className="seo-btn-primary">
            Criar Conta Gratis
            <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Sobre;
