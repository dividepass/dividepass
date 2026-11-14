import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, RefreshCw, Plug, Wallet, Package, ShoppingBag, Search,
  AlertTriangle, CheckCircle2, XCircle, ExternalLink, Zap, Info,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import './PulseCatalog.css';

/*
 * PULSE CODING — PAINEL DO ADMIN
 * ===============================
 *
 * O catálogo da Pulse importado para o DividePass. Por aqui o dono:
 *
 *   - vê o SALDO na revenda (e descobre cedo se acabou);
 *   - sincroniza o catálogo (preço, estoque, disponibilidade);
 *   - vê cada pacote com o preço de venda, o custo e a MARGEM;
 *   - re-mapeia um grupo quando a Pulse troca o id de um pacote;
 *   - acompanha os pedidos e o que foi entregue.
 *
 * DETALHE É PÁGINA, NÃO DRAWER
 * ----------------------------
 * Clicar num pedido abre `/admin/pulse/pedidos/:id`. Isso é regra do projeto:
 * detalhe com id na URL, para o operador saber onde está e poder voltar.
 */

const EDGE_ADMIN = 'pulse-admin';

async function chamarAdmin(acao, corpo = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada. Entre novamente.');

  const resposta = await supabase.functions.invoke(EDGE_ADMIN, {
    body: { action: acao, ...corpo },
  });

  if (resposta.error) {
    const msg = resposta.error.message || '';
    // "Failed to send a request to the Edge Function" é o erro do SUPABASE
    // quando a função não existe no projeto (não foi publicada) — não é
    // problema de chave. A mensagem certaina evita caçar o segredo errado.
    if (/Failed to send a request/i.test(msg) || /Edge Function/i.test(msg)) {
      throw new Error(
        'A função "pulse-admin" não está publicada no Supabase. ' +
        'Publique com: node scripts/publicar-functions.mjs --only=pulse-admin,pulse-entrega,pulse-webhook,pulse-poll --real',
      );
    }
    throw new Error(msg || 'Falha na chamada.');
  }
  const dados = resposta.data;
  if (dados && dados.ok === false) {
    throw new Error(dados.erro || dados.error || 'A operação não deu certo.');
  }
  return dados;
}

const moeda = (v) =>
  v == null ? '—' : `R$ ${Number(v).toFixed(2).replace('.', ',')}`;

function PulseCatalog() {
  const [pacotes, setPacotes] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [saldo, setSaldo] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('catalogo');
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');

  const carregar = useCallback(async () => {
    try {
      setCarregando(true);
      const [painel, listaPedidos] = await Promise.all([
        chamarAdmin('packages'),
        chamarAdmin('orders', { limit: 50 }),
      ]);
      setPacotes(painel.pacotes || []);
      setPedidos(listaPedidos.pedidos || []);
      setErro('');
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    // IIFE async: mesma convenção das outras telas do painel (o setState
    // acontece dentro da função assíncrona, não no corpo do efeito).
    (async () => {
      await carregar();
    })();
  }, [carregar]);

  const carregarSaldo = useCallback(async () => {
    try {
      const r = await chamarAdmin('balance');
      setSaldo(r.saldo || null);
    } catch {
      setSaldo(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await carregarSaldo();
    })();
  }, [carregarSaldo]);

  const sincronizar = async (dryRun = false) => {
    try {
      setSincronizando(true);
      const r = await chamarAdmin('sync', { dry_run: dryRun });
      const rel = r.relatorio || {};
      if (dryRun) {
        toast.info(
          `Simulação: ${rel.total || 0} pacotes · ${rel.criados || 0} vendáveis · ` +
          `${rel.indisponiveis || 0} indisponíveis · ${rel.ignorados || 0} ignorados`,
        );
      } else {
        toast.success(
          `Catálogo sincronizado: ${rel.criados || 0} vendáveis, ` +
          `${rel.indisponiveis || 0} indisponíveis, ${rel.plataformas_criadas || 0} plataformas novas.`,
        );
        await carregar();
        await carregarSaldo();
      }
    } catch (e) {
      toast.error(e.message || String(e));
    } finally {
      setSincronizando(false);
    }
  };

  /**
   * Sincroniza SÓ o STATUS dos grupos (é o que o cron de 5 em 5 horas faz).
   *
   * A sincronização completa ("Sincronizar") importa catálogo, preço e
   * plataforma; esta aqui é a de sempre: "Na vitrine" libera o grupo,
   * "Indisponível" desativa. Serve para não esperar o cron quando o
   * parceiro muda o cardápio.
   */
  const sincronizarStatus = async () => {
    try {
      setSincronizando(true);
      const { data, error } = await supabase.functions.invoke('pulse-status', {
        body: {},
      });
      if (error) throw error;
      const rel = data?.relatorio || {};
      const comGente = rel.desativados_com_gente || [];
      toast.success(
        `Status sincronizado: ${rel.na_vitrine || 0} na vitrine · ` +
        `${rel.indisponiveis || 0} indisponíveis · ${rel.desativados || 0} desativados · ` +
        `${rel.reativados || 0} reativados.`,
      );
      // Grupo desativado que ainda tinha gente pagante: as assinaturas
      // continuam renovando, mas ninguém mais entra. O dono precisa ver.
      if (comGente.length) {
        toast.warning(
          `Desativado com gente pagante: ${comGente
            .map((g) => `${g.nome} (${g.assinaturas} assinatura(s), ${g.membros} membro(s))`)
            .join(' · ')}. As assinaturas continuam renovando.`,
          { duration: 12000 },
        );
      }
      await carregar();
    } catch (e) {
      toast.error(e.message || String(e));
    } finally {
      setSincronizando(false);
    }
  };

  const pacotesFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return pacotes.filter((p) => {
      if (filtroStatus === 'vendaveis' && !p.visible) return false;
      if (filtroStatus === 'indisponiveis' && p.visible) return false;
      if (filtroStatus === 'sem_margem' && !(p.margem != null && Number(p.margem) <= 0)) return false;
      if (filtroStatus === 'sem_grupo' && p.group_id) return false;
      if (!termo) return true;
      return [p.title, p.category, p.plataforma_nome, p.package_id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(termo);
    });
  }, [pacotes, busca, filtroStatus]);

  const resumo = useMemo(() => {
    const vendaveis = pacotes.filter((p) => p.visible).length;
    const indisponiveis = pacotes.filter((p) => !p.visible && p.status !== 'ignorado').length;
    const ignorados = pacotes.filter((p) => p.status === 'ignorado').length;
    const semMargem = pacotes.filter((p) => p.margem != null && Number(p.margem) <= 0 && p.visible).length;
    const semGrupo = pacotes.filter((p) => !p.group_id && p.status !== 'ignorado').length;
    const entregues = pedidos.filter((p) => p.status === 'entregue').length;
    const pendentes = pedidos.filter((p) => p.status === 'pendente' || p.status === 'processando').length;
    const comErro = pedidos.filter((p) => p.status === 'erro').length;
    return { vendaveis, indisponiveis, ignorados, semMargem, semGrupo, entregues, pendentes, comErro };
  }, [pacotes, pedidos]);

  return (
    <div className="fade-in">
      <div className="admin-header">
        <div>
          <h1>Pulse Coding</h1>
          <p className="page-subtitle">
            Revenda: catálogo importado, compras automáticas e entregas para os clientes.
          </p>
        </div>
        <div className="admin-header-actions">
          <button
            className="btn btn-secondary"
            onClick={() => sincronizar(true)}
            disabled={sincronizando}
          >
            {sincronizando ? <Loader2 size={16} className="spin" /> : <Info size={16} />}
            Simular sync
          </button>
          <button
            className="btn btn-secondary"
            onClick={sincronizarStatus}
            disabled={sincronizando}
            title="Sincroniza só o status dos grupos (o que o cron de 5 em 5 horas faz): Na vitrine libera, Indisponível desativa."
          >
            {sincronizando ? <Loader2 size={16} className="spin" /> : <Zap size={16} />}
            Sincronizar status
          </button>
          <button
            className="btn btn-primary"
            onClick={() => sincronizar(false)}
            disabled={sincronizando}
          >
            {sincronizando ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            Sincronizar
          </button>
        </div>
      </div>

      {erro && (
        <div className="admin-card pulse-alert pulse-alert-error">
          <AlertTriangle size={18} />
          <div>
            <strong>Não consegui falar com o painel da Pulse.</strong>
            <p>{erro}</p>
            <p className="pulse-alert-hint">
              Se a mensagem for <code>Failed to send a request to the Edge Function</code>,
              a função não está publicada no Supabase. Se for sobre o segredo, o
              <code> PULSE_API_KEY </code> precisa estar cadastrado em
              Secretos da Edge Function (<code>node scripts/configurar-pulse.mjs --aplicar</code>).
            </p>
          </div>
        </div>
      )}

      {/* ── Cartões de resumo ─────────────────────────────────────────── */}
      <div className="pulse-cards">
        <div className="admin-card pulse-stat">
          <Wallet size={18} />
          <div>
            <span>Saldo na revenda</span>
            <strong>{saldo ? moeda(saldo.available_for_orders ?? saldo.balance) : '—'}</strong>
            {saldo && Number(saldo.available_for_orders ?? 0) <= 0 && (
              <small className="pulse-stat-warn">Sem saldo: nenhuma compra sai.</small>
            )}
          </div>
        </div>

        <div className="admin-card pulse-stat">
          <Package size={18} />
          <div>
            <span>Na vitrine</span>
            <strong>{resumo.vendaveis}</strong>
            <small>{resumo.indisponiveis} indisponíveis · {resumo.ignorados} ignorados</small>
          </div>
        </div>

        <div className="admin-card pulse-stat">
          <ShoppingBag size={18} />
          <div>
            <span>Pedidos</span>
            <strong>{pedidos.length}</strong>
            <small>{resumo.entregues} entregues · {resumo.pendentes} pendentes</small>
          </div>
        </div>

        <div className="admin-card pulse-stat">
          <Zap size={18} />
          <div>
            <span>Atenção</span>
            <strong>{resumo.semMargem + resumo.semGrupo + resumo.comErro}</strong>
            <small>{resumo.semMargem} sem margem · {resumo.semGrupo} sem grupo · {resumo.comErro} com erro</small>
          </div>
        </div>
      </div>

      {/* ── Abas ──────────────────────────────────────────────────────── */}
      <div className="ad-scroll-row pulse-tabs">
        {[
          { id: 'catalogo', label: `Catálogo (${pacotes.length})` },
          { id: 'pedidos', label: `Pedidos (${pedidos.length})` },
        ].map((t) => (
          <button
            key={t.id}
            className={`pulse-tab ${aba === t.id ? 'pulse-tab-active' : ''}`}
            onClick={() => setAba(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {aba === 'catalogo' && (
        <>
          <div className="admin-card">
            <div className="ad-filter-grid">
              <div className="pulse-search">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Buscar produto, plataforma ou id…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <select
                className="form-select"
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
              >
                <option value="todos">Todos os pacotes</option>
                <option value="vendaveis">Só os que estão na vitrine</option>
                <option value="indisponiveis">Só indisponíveis</option>
                <option value="sem_margem">Só os sem margem</option>
                <option value="sem_grupo">Só os sem grupo</option>
              </select>
            </div>
          </div>

          {carregando ? (
            <div className="loading-state">
              <div className="loading-spinner" />
              <span>Carregando catálogo...</span>
            </div>
          ) : pacotesFiltrados.length === 0 ? (
            <div className="admin-card pulse-empty">
              <Plug size={28} />
              <strong>Nenhum pacote por aqui.</strong>
              <p>
                Rode a sincronização para importar o catálogo da Pulse. Os grupos
                "Via Parceiro" são criados automaticamente.
              </p>
              <button className="btn btn-primary" onClick={() => sincronizar(false)} disabled={sincronizando}>
                {sincronizando ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                Sincronizar agora
              </button>
            </div>
          ) : (
            <div className="admin-card ad-cards">
              <div className="table-responsive">
                <table className="ad-card-table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Plataforma</th>
                      <th>Venda</th>
                      <th>Custo</th>
                      <th>Margem</th>
                      <th>Cobrança</th>
                      <th>Estoque</th>
                      <th>Status</th>
                      <th>Grupo</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pacotesFiltrados.map((p) => {
                      const semMargem = p.margem != null && Number(p.margem) <= 0;
                      return (
                        <tr key={p.package_id}>
                          <td className="ad-lead">
                            <div className="pulse-title">{p.title}</div>
                            <small className="pulse-sub">{p.category}</small>
                          </td>
                          <td data-label="Plataforma">
                            {p.plataforma_nome || <span className="pulse-muted">—</span>}
                          </td>
                          <td data-label="Venda">{moeda(p.sale_price)}</td>
                          <td data-label="Custo">{moeda(p.custo)}</td>
                          <td data-label="Margem">
                            <span className={semMargem ? 'pulse-tag pulse-tag-warn' : 'pulse-tag pulse-tag-ok'}>
                              {moeda(p.margem)}
                            </span>
                          </td>
                          <td data-label="Cobrança">
                            <span className={
                              p.natureza === 'recorrente' ? 'pulse-tag pulse-tag-ok' : 'pulse-tag pulse-tag-muted'
                            }>
                              {p.natureza === 'recorrente' ? 'Recorrente' : 'Pagamento único'}
                            </span>
                            {p.entrega_tipo === 'manual' && (
                              <span className="pulse-tag pulse-tag-warn" title="A entrega deste produto é feita a mao">
                                Entrega manual
                              </span>
                            )}
                          </td>
                          <td data-label="Estoque">{p.stock ?? '—'}</td>
                          <td data-label="Status">
                            {p.status === 'ignorado' ? (
                              <span className="pulse-tag pulse-tag-muted">Ignorado</span>
                            ) : p.visible ? (
                              <span className="pulse-tag pulse-tag-ok">Na vitrine</span>
                            ) : (
                              <span className="pulse-tag pulse-tag-off">Indisponível</span>
                            )}
                          </td>
                          {/* O estado do GRUPO no DividePass (o que o cliente
                              vê). "Na vitrine" = liberado e clicável;
                              "Esgotado" = indisponível (ninguém paga, ninguém
                              entra). A sincronização de 5 em 5 horas é quem
                              mantém os dois em pé. */}
                          <td data-label="Grupo">
                            {!p.group_id ? (
                              <span className="pulse-muted">—</span>
                            ) : (
                              <span className={
                                p.grupo_status === 'closed'
                                  ? 'pulse-tag pulse-tag-off'
                                  : p.grupo_status === 'forming'
                                    ? 'pulse-tag pulse-tag-warn'
                                    : 'pulse-tag pulse-tag-ok'
                              }>
                                {p.grupo_status === 'closed'
                                  ? 'Esgotado'
                                  : p.grupo_status === 'forming'
                                    ? 'Formando'
                                    : 'Na vitrine'}
                              </span>
                            )}
                          </td>
                          <td className="ad-actions">
                            {p.group_id ? (
                              <Link
                                to={`/admin/pulse/pedidos?grupo=${p.group_id}`}
                                className="btn btn-ghost btn-sm"
                              >
                                Pedidos
                              </Link>
                            ) : (
                              <span className="pulse-muted">sem grupo</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {aba === 'pedidos' && (
        <div className="admin-card ad-cards">
          {pedidos.length === 0 ? (
            <div className="pulse-empty">
              <ShoppingBag size={28} />
              <strong>Nenhum pedido ainda.</strong>
              <p>Os pedidos aparecem aqui quando um cliente paga um grupo "Via Parceiro".</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="ad-card-table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Produto</th>
                    <th>Custo</th>
                    <th>Status</th>
                    <th>Quando</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pedidos.map((ped) => (
                    <tr key={ped.id}>
                      <td className="ad-lead">
                        <div className="pulse-title">{ped.external_id}</div>
                        <small className="pulse-sub">{ped.transaction_code}</small>
                      </td>
                      <td data-label="Produto">
                        <span className="pulse-muted">{ped.package_id?.slice(0, 8) || '—'}</span>
                      </td>
                      <td data-label="Custo">{moeda(ped.custo)}</td>
                      <td data-label="Status">
                        <span className={
                          ped.status === 'entregue' ? 'pulse-tag pulse-tag-ok'
                            : ped.status === 'erro' ? 'pulse-tag pulse-tag-warn'
                            : 'pulse-tag pulse-tag-off'
                        }>
                          {ped.status === 'entregue' ? <CheckCircle2 size={12} />
                            : ped.status === 'erro' ? <XCircle size={12} />
                            : <Loader2 size={12} className="spin" />}
                          {ped.status}
                        </span>
                      </td>
                      <td data-label="Quando">
                        {new Date(ped.created_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="ad-actions">
                        <Link to={`/admin/pulse/pedidos/${ped.id}`} className="btn btn-ghost btn-sm">
                          Abrir <ExternalLink size={13} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PulseCatalog;
