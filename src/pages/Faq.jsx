import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, ArrowRight, Search } from 'lucide-react';
import './SeoPages.css';

const FAQ_DATA = [
  {
    category: 'Geral',
    questions: [
      {
        q: 'O que e a DividePass?',
        a: 'A DividePass e uma plataforma brasileira que conecta usuarios a grupos de assinaturas digitais, permitindo dividir o custo e economizar ate 75% em servicos como Netflix, Spotify, Disney+, ChatGPT Plus e mais.'
      },
      {
        q: 'Como funciona a DividePass?',
        a: 'Voce cria ou participa de um grupo de assinatura. O administrador do grupo compartilha as credenciais de acesso e cada memro paga apenas sua parte. A plataforma gerencia cobrancas, renovacoes e suporte automaticamente.'
      },
      {
        q: 'A DividePass e segura?',
        a: 'Sim. Os pagamentos sao processados por gateways seguros (Mercado Pago, Stripe, Asaas, IOPay, Pagar.me). Credenciais sao protegidas e acessiveis apenas para membros ativos. Todos os dados sao criptografados.'
      },
      {
        q: 'Quanto posso economizar?',
        a: 'Usuarios podem economizar ate 75% no valor de assinaturas digitais. Por exemplo, uma assinatura individual de R$55,90 do Netflix pode custar apenas R$13,98 por membro em um grupo de 4 pessoas.'
      }
    ]
  },
  {
    category: 'Conta e Cadastro',
    questions: [
      {
        q: 'Como criar uma conta?',
        a: 'Clique em "Criar Conta" na pagina inicial, preencha seus dados e confirme seu email. O cadastro e gratuito e leva menos de 1 minuto.'
      },
      {
        q: 'Esqueci minha senha, o que faco?',
        a: 'Clique em "Esqueci minha senha" na pagina de login. Voce recebera um email com um link para redefinir sua senha.'
      },
      {
        q: 'Preciso confirmar meu email?',
        a: 'Sim. A confirmacao de email e necessaria para garantir a seguranca da sua conta. Caso nao receba o email, verifique sua caixa de spam.'
      }
    ]
  },
  {
    category: 'Grupos e Assinaturas',
    questions: [
      {
        q: 'Como criar um grupo?',
        a: 'Apos登录, acesse "Meus Grupos" e clique em "Criar Grupo". Escolha o servico, configure o plano, valor, numero de vagas e regras. Seu grupo estara disponivel para outros usuarios.'
      },
      {
        q: 'Como entrar em um grupo?',
        a: 'Navegue pelo catalogo, encontre o grupo desejado e clique em "Participar". Apos o pagamento, voce recebera as credenciais de acesso.'
      },
      {
        q: 'O que e a taxa de adesao?',
        a: 'A taxa de adesao e um cobranca unica paga uma unica vez ao entrar no grupo. Ela e opcional e configurada pelo administrador do grupo.'
      },
      {
        q: 'Posso sair de um grupo a qualquer momento?',
        a: 'Sim. Voce pode cancelar sua participacao a qualquer momento. Apos o cancelamento, seu acesso as credenciais sera revogado.'
      },
      {
        q: 'Como funciona a renovacao?',
        a: 'A cobranca recorrente e feita automaticamente pela plataforma. Caso o pagamento nao seja processado, a tentativa sera reagendada com politica de retry.'
      }
    ]
  },
  {
    category: 'Pagamentos',
    questions: [
      {
        q: 'Quais formas de pagamento sao aceitas?',
        a: 'Aceitamos cartao de credito, PIX e boleto atraves dos gateways Mercado Pago, Stripe, Asaas, IOPay e Pagar.me.'
      },
      {
        q: 'Os pagamentos sao seguros?',
        a: 'Sim. Todos os pagamentos sao processados por gateways certificados e com criptografia SSL. A DividePass nao armazena dados de cartao.'
      },
      {
        q: 'Posso usar cupom de desconto?',
        a: 'Sim. Se o administrador do grupo ou da plataforma disponibilizar cupons, voce pode aplicar durante o checkout.'
      },
      {
        q: 'Como funciona o reembolso?',
        a: 'Caso o servico nao esteja disponivel apos o pagamento, voce pode solicitar reembolso atraves do suporte.'
      }
    ]
  },
  {
    category: 'Servicos Disponiveis',
    questions: [
      {
        q: 'Quais servicos estao disponiveis?',
        a: 'A DividePass suporta Netflix, Disney+, Spotify, Amazon Prime Video, HBO Max, ChatGPT Plus, Adobe Creative Cloud, Microsoft 365, YouTube Premium, Canva Pro, Crunchyroll, Deezer, Paramount+, Duolingo e GitHub Copilot.'
      },
      {
        q: 'Voces adicionam novos servicos?',
        a: 'Sim. Estamos sempre trabalhando para adicionar novos servicos. Voce pode solicitar um servico atraves do suporte.'
      },
      {
        q: 'O que sao os perfis de credenciais?',
        a: 'Alguns grupos permitem multiplos perfis dentro de uma mesma assinatura. Cada membro pode ter seu proprio perfil com preferencias independentes.'
      }
    ]
  }
];

function Faq() {
  const [openIndex, setOpenIndex] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    document.title = 'Perguntas Frequentes - DividePass FAQ';
  }, []);

  const allQuestions = FAQ_DATA.flatMap(cat =>
    cat.questions.map(q => ({ ...q, category: cat.category }))
  );

  const filtered = search
    ? allQuestions.filter(q =>
        q.q.toLowerCase().includes(search.toLowerCase()) ||
        q.a.toLowerCase().includes(search.toLowerCase())
      )
    : null;

  return (
    <div className="seo-page">
      <div className="seo-hero">
        <h1>Perguntas Frequentes</h1>
        <p className="seo-subtitle">Encontre respostas para as duvidas mais comuns sobre a DividePass.</p>
        <div className="faq-search">
          <Search size={18} />
          <input
            type="text"
            placeholder="Buscar pergunta..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="seo-content">
        {search ? (
          <section className="seo-section">
            <h2>Resultados para "{search}"</h2>
            {filtered.length === 0 ? (
              <p>Nenhuma pergunta encontrada. <Link to="/faq">Ver todas as perguntas</Link></p>
            ) : (
              <div className="faq-list">
                {filtered.map((item, i) => (
                  <div key={i} className="faq-item">
                    <button className="faq-question" onClick={() => setOpenIndex(openIndex === i ? null : i)}>
                      <span>{item.q}</span>
                      {openIndex === i ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                    {openIndex === i && <div className="faq-answer"><p>{item.a}</p></div>}
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : (
          FAQ_DATA.map((cat, catIdx) => (
            <section key={catIdx} className="seo-section">
              <h2>{cat.category}</h2>
              <div className="faq-list">
                {cat.questions.map((item, i) => {
                  const globalIdx = catIdx * 100 + i;
                  return (
                    <div key={i} className="faq-item">
                      <button className="faq-question" onClick={() => setOpenIndex(openIndex === globalIdx ? null : globalIdx)}>
                        <span>{item.q}</span>
                        {openIndex === globalIdx ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </button>
                      {openIndex === globalIdx && <div className="faq-answer"><p>{item.a}</p></div>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}

        <div className="seo-cta">
          <h2>Ainda tem duvidas?</h2>
          <p>Nosso suporte esta pronto para ajudar voce.</p>
          <Link to="/login" className="seo-btn-primary">
            Acessar Suporte
            <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Faq;
