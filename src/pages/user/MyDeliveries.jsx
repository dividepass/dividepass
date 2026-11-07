import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Package, Loader2, Copy, Check, KeyRound, Link2, Ticket, Cloud,
  Clock, AlertTriangle, RefreshCw, Sparkles,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import './MyDeliveries.css';

/*
 * MINHAS ENTREGAS
 * ===============
 *
 * Os produtos que vieram da Pulse Coding (revenda). A compra acontece
 * depois que o pagamento do DividePass é confirmado; a entrega (conta, link,
 * licença ou código) chega aqui.
 *
 * A leitura é sempre pela edge function `pulse-entrega`, que devolve
 * APENAS o que é deste usuário — o navegador nunca vê a entrega de outra
 * pessoa e nunca fala direto com a API da Pulse.
 */

const EDGE_ENTREGA = 'pulse-entrega';

async function carregarEntregas() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada. Entre novamente.');

  const resposta = await supabase.functions.invoke(EDGE_ENTREGA, { body: {} });
  if (resposta.error) throw new Error(resposta.error.message || 'Falha ao carregar.');
  return resposta.data || {};
}

const rotuloTipo = {
  email_password: { texto: 'Conta', icone: KeyRound },
  link: { texto: 'Link', icone: Link2 },
  code: { texto: 'Licença', icone: Ticket },
  custom: { texto: 'Código', icone: Cloud },
};

function Campo({ rotulo, valor, tipo }) {
  const [copiado, setCopiado] = useState(false);
  if (!valor) return null;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(String(valor));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      toast.error('Não consegui copiar. Selecione o texto à mão.');
    }
  };

  return (
    <div className="md-field">
      <span className="md-field-label">{rotulo}</span>
      <div className="md-field-row">
        {tipo === 'link' ? (
          <a href={valor} target="_blank" rel="noreferrer" className="md-field-value md-link">
            {valor}
          </a>
        ) : (
          <code className="md-field-value">{valor}</code>
        )}
        <button className="md-copy" onClick={copiar} title="Copiar" aria-label="Copiar">
          {copiado ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
    </div>
  );
}

function MyDeliveries() {
  const [entregas, setEntregas] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    try {
      setCarregando(true);
      const r = await carregarEntregas();
      setEntregas(r.entregas || []);
      setPedidos(r.pedidos || []);
      setErro('');
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    // IIFE async: mesma convenção das outras telas do cliente.
    (async () => {
      await carregar();
    })();
  }, [carregar]);

  // Pedidos que ainda não foram entregues viram "em andamento".
  const emAndamento = pedidos.filter((p) => p.status === 'pendente' || p.status === 'processando');
  const comErro = pedidos.filter((p) => p.status === 'erro');

  return (
    <div className="fade-in deliveries-page">
      <div className="page-header">
        <h1>Minhas Entregas</h1>
        <p>
          Os acessos que você comprou pela revenda. Cada compra gera a sua
          conta — é pessoal e não pode ser compartilhada.
        </p>
      </div>

      {erro && (
        <div className="md-alert md-alert-error">
          <AlertTriangle size={18} />
          <div>
            <strong>Não consegui carregar suas entregas.</strong>
            <p>{erro}</p>
          </div>
        </div>
      )}

      {emAndamento.length > 0 && (
        <div className="md-alert md-alert-wait">
          <Clock size={18} />
          <div>
            <strong>{emAndamento.length} entrega(s) em andamento</strong>
            <p>
              O pagamento foi confirmado e já estamos buscando seu acesso no
              fornecedor. Ele aparece aqui automaticamente em instantes.
            </p>
          </div>
        </div>
      )}

      {comErro.length > 0 && (
        <div className="md-alert md-alert-error">
          <AlertTriangle size={18} />
          <div>
            <strong>{comErro.length} pedido(s) não concluído(s)</strong>
            <p>
              Houve um problema na compra. Nossa equipe já foi avisada — se você
              não receber o acesso em breve, fale com o suporte.
            </p>
          </div>
        </div>
      )}

      {carregando ? (
        <div className="md-empty">
          <Loader2 size={32} className="spin" />
          <p>Carregando suas entregas...</p>
        </div>
      ) : entregas.length === 0 ? (
        <div className="md-empty">
          <Package size={44} />
          <h2>Nenhuma entrega por aqui</h2>
          <p>
            Quando você assinar um serviço do tipo "Via Parceiro", o acesso
            aparece nesta tela assim que a compra é concluída.
          </p>
          <Link to="/dashboard/catalog" className="md-cta">
            <Sparkles size={16} /> Ver o catálogo
          </Link>
        </div>
      ) : (
        <div className="md-list">
          {entregas.map((e) => {
            const info = rotuloTipo[e.credential_type] || rotuloTipo.email_password;
            const Icone = info.icone;
            return (
              <div key={e.id} className="md-card">
                <div className="md-card-head">
                  <div className="md-card-icon"><Icone size={18} /></div>
                  <div className="md-card-title">
                    <strong>{e.produto || 'Acesso'}</strong>
                    {e.grupo_nome && <small>{e.grupo_nome}</small>}
                  </div>
                  <span className="md-badge">{info.texto}</span>
                </div>

                <div className="md-card-body">
                  <Campo rotulo="E-mail" valor={e.login_email} />
                  <Campo rotulo="Senha" valor={e.login_password} />
                  <Campo rotulo="Link" valor={e.credential_url} tipo="link" />
                  {!e.credential_url && !e.login_password && (
                    <Campo rotulo="Chave" valor={e.credential_notes} />
                  )}
                  {e.credits != null && (
                    <div className="md-credits">{e.credits} créditos incluídos</div>
                  )}
                  {e.expira_em && (
                    <small className="md-expira">Válido até {new Date(`${e.expira_em}T12:00:00`).toLocaleDateString('pt-BR')}</small>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {entregas.length > 0 && (
        <div className="md-foot">
          <button className="md-refresh" onClick={carregar} disabled={carregando}>
            {carregando ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            Atualizar
          </button>
          <p className="md-warn">
            <AlertTriangle size={14} />
            Troque a senha no primeiro acesso e não compartilhe com ninguém. Se
            usar a conta em um dispositivo desconhecido, avise o suporte.
          </p>
        </div>
      )}
    </div>
  );
}

export default MyDeliveries;
