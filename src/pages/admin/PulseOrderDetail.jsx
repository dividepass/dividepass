import { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Loader2, ArrowLeft, Package, Wallet, Clock,
  AlertTriangle, RefreshCw, Copy, Check, User, ExternalLink,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import './PulseCatalog.css';

/*
 * DETALHE DO PEDIDO DA PULSE
 * ===========================
 *
 * Página com id na URL (`/admin/pulse/pedidos/:id`) — o detalhe nunca é
 * drawer, para o operador saber onde está e poder voltar.
 *
 * Mostra a linha do tempo do pedido, a entrega (quando existe) e o que
 * fazer quando deu erro.
 */

const EDGE_ADMIN = 'pulse-admin';

async function chamarAdmin(acao, corpo = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada. Entre novamente.');
  const resposta = await supabase.functions.invoke(EDGE_ADMIN, {
    body: { action: acao, ...corpo },
  });
  if (resposta.error) throw new Error(resposta.error.message || 'Falha na chamada.');
  const dados = resposta.data;
  if (dados && dados.ok === false) throw new Error(dados.erro || 'A operação não deu certo.');
  return dados;
}

const moeda = (v) => (v == null ? '—' : `R$ ${Number(v).toFixed(2).replace('.', ',')}`);

const rotuloStatus = {
  pendente: 'Pendente',
  processando: 'Processando',
  entregue: 'Entregue',
  erro: 'Erro',
  devolvido: 'Saldo devolvido',
  cancelado: 'Cancelado',
};

function CopiaCampo({ valor, rotulo }) {
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
    <div className="pulse-cred">
      {rotulo && <span className="pulse-cred-label">{rotulo}</span>}
      <code>{valor}</code>
      <button className="pulse-cred-copy" onClick={copiar} title="Copiar">
        {copiado ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function PulseOrderDetail() {
  const { id } = useParams();
  const navegar = useNavigate();
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setCarregando(true);
      const r = await chamarAdmin('order', { id });
      setDados(r);
      setErro('');
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    // IIFE async: mesma convenção das outras telas do painel.
    (async () => {
      await carregar();
    })();
  }, [carregar]);

  const reprocessar = async () => {
    try {
      setProcessando(true);
      const r = await chamarAdmin('reprocess', { id });
      if (r.resultado?.entregue) {
        toast.success('Entrega aplicada.');
      } else {
        toast.info(`Status do pedido: ${r.resultado?.status || '—'}`);
      }
      await carregar();
    } catch (e) {
      toast.error(e.message || String(e));
    } finally {
      setProcessando(false);
    }
  };

  const pedido = dados?.pedido;

  return (
    <div className="fade-in">
      <div className="admin-header">
        <div>
          <button className="pulse-back" onClick={() => navegar('/admin/pulse')}>
            <ArrowLeft size={15} /> Voltar
          </button>
          <h1>Pedido {pedido?.external_id || '—'}</h1>
          <p className="page-subtitle">
            {pedido ? `Transação ${pedido.transaction_code} · ${new Date(pedido.created_at).toLocaleString('pt-BR')}` : 'Carregando...'}
          </p>
        </div>
        <div className="admin-header-actions">
          <button className="btn btn-secondary" onClick={carregar} disabled={carregando}>
            {carregando ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            Recarregar
          </button>
          {pedido && pedido.status !== 'entregue' && (
            <button className="btn btn-primary" onClick={reprocessar} disabled={processando}>
              {processando ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              Tentar concluir
            </button>
          )}
        </div>
      </div>

      {erro && (
        <div className="admin-card pulse-alert pulse-alert-error">
          <AlertTriangle size={18} />
          <div>
            <strong>Não consegui abrir o pedido.</strong>
            <p>{erro}</p>
          </div>
        </div>
      )}

      {carregando && !pedido && (
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>Carregando pedido...</span>
        </div>
      )}

      {pedido && (
        <>
          <div className="pulse-cards">
            <div className="admin-card pulse-stat">
              <Package size={18} />
              <div>
                <span>Status</span>
                <strong className="pulse-status-text">{rotuloStatus[pedido.status] || pedido.status}</strong>
                <small>{pedido.tentativas || 0} tentativa(s)</small>
              </div>
            </div>
            <div className="admin-card pulse-stat">
              <Wallet size={18} />
              <div>
                <span>Custo na Pulse</span>
                <strong>{moeda(pedido.custo)}</strong>
                <small>Pago pelo cliente: {moeda(pedido.preco_pago)}</small>
              </div>
            </div>
            <div className="admin-card pulse-stat">
              <Clock size={18} />
              <div>
                <span>Atualizado</span>
                <strong>{new Date(pedido.updated_at || pedido.created_at).toLocaleTimeString('pt-BR')}</strong>
                <small>{pedido.pulse_order_id ? `Pulse ${pedido.pulse_order_id.slice(0, 12)}…` : 'Sem id na Pulse'}</small>
              </div>
            </div>
          </div>

          {pedido.ultimo_erro && (
            <div className="admin-card pulse-alert pulse-alert-warn">
              <AlertTriangle size={18} />
              <div>
                <strong>Último erro ({pedido.error_code || 'sem código'})</strong>
                <p>{pedido.ultimo_erro}</p>
              </div>
            </div>
          )}

          <div className="admin-card">
            <h2>Entrega</h2>
            {(dados.entregas || []).length === 0 ? (
              <p className="pulse-muted">
                Ainda sem entrega. A Pulse entrega automaticamente; o webhook e o
                polling cuidam de bringar a conta até aqui.
              </p>
            ) : (
              <div className="pulse-creds">
                {dados.entregas.map((e) => (
                  <div key={e.id} className="pulse-cred-box">
                    <div className="pulse-cred-box-head">
                      {e.package_title || e.package_id || 'Produto'}
                      <span className="pulse-tag pulse-tag-muted">{e.credential_type}</span>
                    </div>
                    {e.login_email && <CopiaCampo rotulo="E-mail" valor={e.login_email} />}
                    {e.login_password && <CopiaCampo rotulo="Senha" valor={e.login_password} />}
                    {e.credential_url && <CopiaCampo rotulo="Link" valor={e.credential_url} />}
                    {e.credential_notes && <CopiaCampo rotulo="Chave / Obs." valor={e.credential_notes} />}
                    {e.credits != null && <small className="pulse-sub">{e.credits} créditos</small>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="admin-card">
            <h2>Linha do tempo</h2>
            {(dados.eventos || []).length === 0 ? (
              <p className="pulse-muted">Sem eventos registrados.</p>
            ) : (
              <div className="pulse-timeline">
                {dados.eventos.map((ev) => (
                  <div key={ev.id} className="pulse-event">
                    <span className="pulse-event-dot" />
                    <div>
                      <strong>{ev.tipo}</strong>
                      <p>{ev.mensagem}</p>
                      <small>{new Date(ev.created_at).toLocaleString('pt-BR')}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="admin-card">
            <h2>Vínculos</h2>
            <div className="pulse-links">
              {pedido.group_id && (
                <Link to={`/admin/grupos/${pedido.group_id}`} className="btn btn-ghost btn-sm">
                  <User size={14} /> Ver grupo
                </Link>
              )}
              {pedido.package_id && (
                <a
                  href={`https://nepatnfgqlcvunmrpddr.supabase.co/functions/v1/reseller-api`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost btn-sm"
                >
                  <ExternalLink size={14} /> Id do pacote
                </a>
              )}
            </div>
            <small className="pulse-sub">
              O id do pacote é o <code>package_id</code> da Pulse. O <code>external_id</code>{' '}
              (<strong>{pedido.external_id}</strong>) é o id deste pedido na revenda — é ele que
              garante que uma repetição não cobre o cliente duas vezes.
            </small>
          </div>
        </>
      )}
    </div>
  );
}

export default PulseOrderDetail;
