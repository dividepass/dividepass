import { useState, useEffect } from 'react';
import {
  Search, Wallet, DollarSign, Clock, Eye, ArrowLeft,
  CheckCircle, Loader2, TrendingUp, Ban, X, ArrowDownRight,
  Receipt, BarChart3, AlertTriangle, CheckSquare, XSquare,
  FileText
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { processarSaque } from '../../lib/walletApi';
import './Wallets.css';

const TABS = [
  { key: 'pending', label: 'Pendentes', icon: Clock },
  { key: 'completed', label: 'Realizados', icon: CheckCircle },
  { key: 'rejected', label: 'Recusados', icon: XSquare },
  { key: 'payout', label: 'Repasse por grupo', icon: ArrowDownRight },
  { key: 'wallets', label: 'Carteiras', icon: Wallet },
  { key: 'finance', label: 'Financeiro', icon: BarChart3 },
];

function Wallets() {
  const [wallets, setWallets] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [users, setUsers] = useState({});
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [processing, setProcessing] = useState(null);
  const [activeTab, setActiveTab] = useState('pending');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [financeFilter, setFinanceFilter] = useState(null);
  const [fees, setFees] = useState({ gateway: 4.98, platform: 3.95 });
  const [groupList, setGroupList] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      if (!cancelled) setLoading(true);
      setError('');

      try {
        const [walletsRes, transactionsRes, withdrawalsRes, usersRes, groupsRes, paymentsRes, settingsRes] = await Promise.all([
          supabase.from('user_wallets').select('*').order('updated_at', { ascending: false }),
          supabase.from('wallet_transactions').select('*').order('created_at', { ascending: false }),
          supabase.from('wallet_withdrawals').select('*').order('requested_at', { ascending: false }),
          supabase.from('users').select('id, name, email, role'),
          supabase.from('groups').select('id, name, owner_id, is_official'),
          supabase.from('payments').select('*').order('created_at', { ascending: false }),
          supabase.from('app_settings').select('key, value').in('key', ['gateway_fee_percent', 'platform_fee_percent']),
        ]);

        if (walletsRes.error) throw walletsRes.error;
        if (transactionsRes.error) throw transactionsRes.error;
        if (withdrawalsRes.error) throw withdrawalsRes.error;
        if (usersRes.error) throw usersRes.error;

        if (!cancelled) {
          setWallets(walletsRes.data || []);
          setTransactions(transactionsRes.data || []);
          setPayments(paymentsRes.data || []);
          setWithdrawals(withdrawalsRes.data || []);

          const usersMap = {};
          (usersRes.data || []).forEach(u => { usersMap[u.id] = u; });
          setUsers(usersMap);

          const groupsMap = {};
          (groupsRes.data || []).forEach(g => { groupsMap[g.id] = g.name; });
          setGroups(groupsMap);
          setGroupList(groupsRes.data || []);

          const settingsMap = {};
          (settingsRes.data || []).forEach(s => { settingsMap[s.key] = s.value; });
          setFees({
            gateway: Number(settingsMap.gateway_fee_percent ?? 4.98) || 4.98,
            platform: Number(settingsMap.platform_fee_percent ?? 3.95) || 3.95,
          });
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, []);

  const formatCurrency = (value) => `R$ ${Number(value || 0).toFixed(2)}`;
  const formatDateTime = (date) => date ? new Date(date).toLocaleString('pt-BR') : '—';

  const pendingWithdrawals = withdrawals.filter(w => w.status === 'pending');
  const completedWithdrawals = withdrawals.filter(w => w.status === 'completed');
  const rejectedWithdrawals = withdrawals.filter(w => w.status === 'rejected');

  const paidPayments = payments.filter(p => p.status === 'paid');
  const totalReceived = paidPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const totalEntrance = paidPayments.filter(p => p.payment_type === 'entrance').reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const totalSubscription = paidPayments.filter(p => p.payment_type === 'subscription').reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const totalPaidOut = completedWithdrawals.reduce((sum, w) => sum + Number(w.amount || 0), 0);
  const totalPending = pendingWithdrawals.reduce((sum, w) => sum + Number(w.amount || 0), 0);
  const totalBalance = wallets.reduce((sum, w) => sum + Number(w.balance || 0), 0);

  // ---------------------------------------------------------------------------
  // Repasse por grupo: quanto cada grupo de terceiro gerou e quanto disso
  // realmente entrou na carteira de quem criou o grupo.
  // ---------------------------------------------------------------------------
  const taxaTotal = fees.gateway + fees.platform;
  const gruposDeTerceiros = groupList.filter(g => g.owner_id && !g.is_official);

  const repassePorGrupo = gruposDeTerceiros.map(g => {
    const pagamentosDoGrupo = paidPayments.filter(p => p.group_id === g.id);
    const bruto = pagamentosDoGrupo.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const taxas = bruto * (taxaTotal / 100);
    const liquidoEsperado = bruto - taxas;

    const creditos = transactions.filter(t =>
      t.group_id === g.id && t.type === 'credit' && t.status === 'completed'
    );
    const creditado = creditos.reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const saquesDoDono = withdrawals.filter(w => w.user_id === g.owner_id);
    const saquesPendentes = saquesDoDono.filter(w => w.status === 'pending')
      .reduce((sum, w) => sum + Number(w.amount || 0), 0);
    const saquesPagos = saquesDoDono.filter(w => w.status === 'completed')
      .reduce((sum, w) => sum + Number(w.amount || 0), 0);

    const saldoCarteira = Number(wallets.find(w => w.user_id === g.owner_id)?.balance || 0);
    const aRepassar = Math.max(creditado - saquesPagos, 0);
    const naoCreditado = liquidoEsperado - creditado;

    // Grupo da plataforma: oficial ou de propriedade da conta admin. O dinheiro
    // desses grupos e receita da propria plataforma - nao tem repasse.
    const ehDaPlataforma = Boolean(g.is_official) || users[g.owner_id]?.role === 'admin';

    let situacao = 'ok';
    if (ehDaPlataforma) situacao = 'plataforma';
    else if (bruto > 0 && Math.abs(naoCreditado) > 0.01) situacao = 'pendente';
    if (!ehDaPlataforma && saquesPendentes > 0) situacao = 'em-analise';

    return {
      groupId: g.id,
      nome: g.name || '—',
      ownerId: g.owner_id,
      dono: users[g.owner_id]?.name || users[g.owner_id]?.email || 'Dono sem cadastro',
      donoEmail: users[g.owner_id]?.email || '',
      pagamentos: pagamentosDoGrupo.length,
      bruto,
      taxas,
      liquidoEsperado,
      creditado,
      naoCreditado,
      saquesPendentes,
      saquesPagos,
      saldoCarteira,
      aRepassar,
      situacao,
      ehDaPlataforma,
    };
  }).filter(r => r.bruto > 0 || r.creditado > 0 || r.saquesPagos > 0 || r.aRepassar > 0);

  // Totais do repasse: so o que e de grupo de terceiro.
  const gruposDeTerceiroComMovimento = repassePorGrupo.filter(r => !r.ehDaPlataforma);
  const totalBrutoTerceiros = gruposDeTerceiroComMovimento.reduce((s, r) => s + r.bruto, 0);
  const totalCreditadoTerceiros = gruposDeTerceiroComMovimento.reduce((s, r) => s + r.creditado, 0);
  const totalNaoCreditado = gruposDeTerceiroComMovimento.reduce((s, r) => s + Math.max(r.naoCreditado, 0), 0);
  const totalArepassar = gruposDeTerceiroComMovimento.reduce((s, r) => s + r.aRepassar, 0);
  const totalRecebidoPlataforma = repassePorGrupo.filter(r => r.ehDaPlataforma).reduce((s, r) => s + r.bruto, 0)
    + paidPayments.filter(p => {
      const g = groupList.find(x => x.id === p.group_id);
      return g?.is_official;
    }).reduce((s, p) => s + Number(p.amount || 0), 0);

  // O que a plataforma recebeu nao e lucro: parte disso e o repasse dos
  // criadores de grupo. O lucro da plataforma e o que sobra depois da taxa do
  // gateway e do que foi creditado aos donos de grupo.
  const totalTaxasGateway = totalReceived * (fees.gateway / 100);
  const receitaLiquidaPlataforma = totalReceived - totalTaxasGateway - totalCreditadoTerceiros;
  const caixaEmMaos = totalReceived - totalPaidOut;
  const netRevenue = receitaLiquidaPlataforma;

  const filteredWallets = wallets.filter(w => {
    const user = users[w.user_id];
    if (!user) return false;
    return (
      user.name?.toLowerCase().includes(search.toLowerCase()) ||
      user.email?.toLowerCase().includes(search.toLowerCase())
    );
  });

  const handleMarkPaid = async (withdrawal) => {
    if (!window.confirm(`Confirmar pagamento de R$ ${Number(withdrawal.amount).toFixed(2)} para ${users[withdrawal.user_id]?.name || 'usuário'}?`)) return;

    setProcessing(withdrawal.id);
    try {
      // O saldo fica reservado quando o pedido usa a RPC request_withdrawal.
      // Sem reserva (pedido antigo ou banco sem a migration) o debito e feito
      // aqui, no ato do pagamento.
      const reservado = transactions.some(t =>
        t.reference_type === 'withdrawal' && t.reference_id === withdrawal.id
      );

      const result = await processarSaque({
        withdrawalId: withdrawal.id,
        action: 'paid',
        notes: null,
        reservado,
        amount: withdrawal.amount,
        userId: withdrawal.user_id,
      });

      if (!result.ok) throw new Error(result.error);

      setWithdrawals(prev =>
        prev.map(w => w.id === withdrawal.id
          ? { ...w, status: 'completed', processed_at: new Date().toISOString() }
          : w
        )
      );

      // Platform event: withdrawal approved
      try {
        const wdUser = users[withdrawal.user_id];
        await supabase.from('platform_events').insert({
          event_type: 'withdrawal_approved',
          title: 'Saque aprovado',
          message: `Saque de R$ ${Number(withdrawal.amount).toFixed(2)} de ${wdUser?.name || 'usuário'} foi aprovado e pago.`,
          metadata: JSON.stringify({ user_id: withdrawal.user_id, amount: withdrawal.amount, withdrawal_id: withdrawal.id }),
          created_by: (await supabase.auth.getUser()).data.user?.id,
        });
      } catch (e) { console.error('Platform event error:', e); }
    } catch (err) {
      setError('Erro ao processar pagamento: ' + err.message);
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (withdrawal) => {
    setRejectTarget(withdrawal);
    setRejectReason('');
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    setProcessing(rejectTarget.id);
    try {
      // Se o pedido foi feito pela RPC, o saldo estava reservado: a recusa
      // devolve o valor para a carteira do usuario.
      const reservado = transactions.some(t =>
        t.reference_type === 'withdrawal' && t.reference_id === rejectTarget.id
      );

      const result = await processarSaque({
        withdrawalId: rejectTarget.id,
        action: 'rejected',
        notes: rejectReason || null,
        reservado,
        amount: rejectTarget.amount,
        userId: rejectTarget.user_id,
      });

      if (!result.ok) throw new Error(result.error);

      setWithdrawals(prev =>
        prev.map(w => w.id === rejectTarget.id
          ? { ...w, status: 'rejected', processed_at: new Date().toISOString(), notes: rejectReason }
          : w
        )
      );
      setRejectTarget(null);
      setRejectReason('');

      // Platform event: withdrawal rejected
      try {
        const wdUser = users[rejectTarget.user_id];
        await supabase.from('platform_events').insert({
          event_type: 'withdrawal_rejected',
          title: 'Saque recusado',
          message: `Saque de R$ ${Number(rejectTarget.amount).toFixed(2)} de ${wdUser?.name || 'usuário'} foi recusado. ${rejectReason ? 'Motivo: ' + rejectReason : ''}`,
          metadata: JSON.stringify({ user_id: rejectTarget.user_id, amount: rejectTarget.amount, withdrawal_id: rejectTarget.id, reason: rejectReason }),
          created_by: (await supabase.auth.getUser()).data.user?.id,
        });
      } catch (e) { console.error('Platform event error:', e); }
    } catch (err) {
      setError('Erro ao rejeitar saque: ' + err.message);
    } finally {
      setProcessing(null);
    }
  };

  const getGroupName = (tx) => tx.group_id ? (groups[tx.group_id] || '—') : '—';

  // Dados para o admin pagar: a chave PIX ou os dados bancarios do pedido.
  // Em producao chegam em payment_details; depois da migration, tambem nas
  // colunas proprias.
  const dadosDoSaque = (wd) => {
    let extra = {};
    try { extra = JSON.parse(wd.payment_details || '{}'); } catch { extra = {}; }
    if (wd.payment_method !== 'bank') {
      const pix = wd.pix_key || extra.pix_key || '';
      return { rotulo: pix || 'Sem chave PIX', detalhe: wd.pix_type || extra.pix_type || '' };
    }
    const conta = wd.bank_account || extra.bank_account || '';
    return {
      rotulo: wd.bank_name || extra.bank_name || 'Banco não informado',
      detalhe: [extra.bank_agency || wd.bank_agency, conta, extra.bank_holder || wd.bank_holder]
        .filter(Boolean).join(' · '),
    };
  };

  if (selectedTransaction) {
    const tx = selectedTransaction;
    const user = users[tx.user_id] || {};
    return (
      <div className="fade-in wallets-page">
        <button className="back-btn" onClick={() => setSelectedTransaction(null)}>
          <ArrowLeft size={18} /> Voltar
        </button>
        <div className="admin-header">
          <div>
            <h1>Detalhes da Transação</h1>
            <p className="page-subtitle">{tx.description || tx.type}</p>
          </div>
        </div>
        <div className="admin-card">
          <div className="tx-detail-grid">
            {[
              ['ID', tx.id],
              ['Usuário', `${user.name || '—'} (${user.email || '—'})`],
              ['Tipo', tx.type],
              ['Valor', `${tx.type === 'credit' ? '+' : '-'} ${formatCurrency(tx.amount)}`],
              ['Grupo', getGroupName(tx)],
              ['Descrição', tx.description || '—'],
              ['Status', tx.status],
              ['Referência', tx.reference_type || '—'],
              ['Data', formatDateTime(tx.created_at)],
            ].map(([label, value]) => (
              <div className="tx-detail-row" key={label}>
                <span className="tx-detail-label">{label}</span>
                <span className="tx-detail-value">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (selectedUser) {
    const user = users[selectedUser.user_id] || {};
    const userTx = transactions.filter(t => t.user_id === selectedUser.user_id);
    const userWd = withdrawals.filter(w => w.user_id === selectedUser.user_id);

    return (
      <div className="fade-in wallets-page">
        <button className="back-btn" onClick={() => setSelectedUser(null)}>
          <ArrowLeft size={18} /> Voltar
        </button>
        <div className="admin-header">
          <div>
            <h1>Carteira de {user.name}</h1>
            <p className="page-subtitle">{user.email}</p>
          </div>
        </div>
        <div className="wallet-detail-stats">
          <div className="stat-card">
            <Wallet size={22} />
            <div>
              <span>{formatCurrency(selectedUser.balance)}</span>
              <small>Saldo Atual</small>
            </div>
          </div>
          <div className="stat-card">
            <TrendingUp size={22} />
            <div>
              <span>{formatCurrency(selectedUser.total_earned)}</span>
              <small>Total Recebido</small>
            </div>
          </div>
        </div>
        <h2 className="section-title">Transações</h2>
        <div className="admin-card table-responsive">
          {userTx.length === 0 ? (
            <div className="empty-table"><p>Nenhuma transação encontrada.</p></div>
          ) : (
            <table className="wallets-table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Descrição</th>
                  <th>Grupo</th>
                  <th>Status</th>
                  <th>Data</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {userTx.map(tx => (
                  <tr key={tx.id}>
                    <td><span className={`type-badge ${tx.type}`}>{tx.type}</span></td>
                    <td><strong className={tx.type === 'credit' ? 'text-success' : 'text-danger'}>
                      {tx.type === 'credit' ? '+' : '-'} {formatCurrency(tx.amount)}
                    </strong></td>
                    <td>{tx.description || '—'}</td>
                    <td>{getGroupName(tx)}</td>
                    <td><span className={`status-badge ${tx.status}`}>{tx.status}</span></td>
                    <td><span className="date-cell">{formatDateTime(tx.created_at)}</span></td>
                    <td>
                      <button className="view-btn" onClick={() => setSelectedTransaction(tx)}>
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <h2 className="section-title">Saques</h2>
        <div className="admin-card table-responsive">
          {userWd.length === 0 ? (
            <div className="empty-table"><p>Nenhum saque encontrado.</p></div>
          ) : (
            <table className="wallets-table">
              <thead>
                <tr>
                  <th>Valor</th>
                  <th>Método</th>
                  <th>Status</th>
                  <th>Solicitado em</th>
                  <th>Pago em</th>
                </tr>
              </thead>
              <tbody>
                {userWd.map(wd => (
                  <tr key={wd.id}>
                    <td><strong>{formatCurrency(wd.amount)}</strong></td>
                    <td>{wd.payment_method || '—'}</td>
                    <td><span className={`status-badge ${wd.status}`}>{wd.status}</span></td>
                    <td><span className="date-cell">{formatDateTime(wd.requested_at)}</span></td>
                    <td><span className="date-cell">{formatDateTime(wd.processed_at)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in wallets-page">
      <div className="admin-header">
        <div>
          <h1>Gestão de Saques</h1>
          <p className="page-subtitle">Aprovar, rejeitar e acompanhar saques dos criadores de grupo</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Reject Modal */}
      {rejectTarget && (
        <div className="modal-overlay" onClick={() => setRejectTarget(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Rejeitar Saque</h3>
              <button onClick={() => setRejectTarget(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p>Saque de <strong>{formatCurrency(rejectTarget.amount)}</strong> para <strong>{users[rejectTarget.user_id]?.name}</strong></p>
              <div className="manage-form-group" style={{ padding: 0, marginTop: '1rem' }}>
                <label>Motivo da recusa (opcional)</label>
                <textarea
                  rows={3}
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Ex: Dados bancários inválidos, valor indisponível..."
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' }}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setRejectTarget(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={confirmReject} disabled={processing === rejectTarget.id}>
                {processing === rejectTarget.id ? <Loader2 size={14} className="spin" /> : <XSquare size={14} />}
                Confirmar Recusa
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-state">
          <Loader2 size={32} className="spin" />
          <p>Carregando...</p>
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="wallets-stats">
            <div className="stat-card">
              <Clock size={22} style={{ color: 'var(--warning, #F59E0B)' }} />
              <div>
                <span>{pendingWithdrawals.length}</span>
                <small>Pendentes</small>
              </div>
            </div>
            <div className="stat-card">
              <CheckCircle size={22} style={{ color: 'var(--success, #10B981)' }} />
              <div>
                <span>{completedWithdrawals.length}</span>
                <small>Realizados</small>
              </div>
            </div>
            <div className="stat-card">
              <XSquare size={22} style={{ color: 'var(--danger, #EF4444)' }} />
              <div>
                <span>{rejectedWithdrawals.length}</span>
                <small>Recusados</small>
              </div>
            </div>
            <div className="stat-card">
              <Wallet size={22} />
              <div>
                <span>{formatCurrency(totalBalance)}</span>
                <small>Saldo Total Usuários</small>
              </div>
            </div>
            <div className="stat-card">
              <ArrowDownRight size={22} style={{ color: 'var(--warning, #F59E0B)' }} />
              <div>
                <span>{formatCurrency(totalArepassar)}</span>
                <small>A Repassar</small>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="wallets-tabs">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const count = tab.key === 'pending' ? pendingWithdrawals.length
                : tab.key === 'completed' ? completedWithdrawals.length
                : tab.key === 'rejected' ? rejectedWithdrawals.length
                : tab.key === 'payout' ? repassePorGrupo.filter(r => !r.ehDaPlataforma && r.situacao !== 'ok').length
                : tab.key === 'wallets' ? wallets.length
                : null;
              return (
                <button
                  key={tab.key}
                  className={`wallets-tab ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <Icon size={16} />
                  <span>{tab.label}</span>
                  {count !== null && <span className="wallets-tab-count">{count}</span>}
                </button>
              );
            })}
          </div>

          {/* Search Bar (for withdrawal tabs and the wallet list) */}
          {['pending', 'completed', 'rejected', 'wallets'].includes(activeTab) && (
            <div className="wallets-toolbar">
              <div className="search-box">
                <Search size={18} />
                <input
                  type="text"
                  placeholder="Buscar por nome ou e-mail..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Pending Tab */}
          {activeTab === 'pending' && (
            <div className="admin-card table-responsive">
              {pendingWithdrawals.length === 0 ? (
                <div className="empty-table"><p>Nenhum saque pendente.</p></div>
              ) : (
                <table className="wallets-table">
                  <thead>
                    <tr>
                      <th>Usuário</th>
                      <th>Valor</th>
                      <th>Método</th>
                      <th>Pagar em</th>
                      <th>Solicitado em</th>
                      <th>Notas</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingWithdrawals.filter(wd => {
                      const u = users[wd.user_id];
                      if (!u) return false;
                      const q = search.toLowerCase();
                      return !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
                    }).map(wd => (
                      <tr key={wd.id}>
                        <td>
                          <div className="user-cell">
                            <div className="user-avatar">{(users[wd.user_id]?.name || '?')[0].toUpperCase()}</div>
                            <div>
                              <strong>{users[wd.user_id]?.name || '—'}</strong>
                              <span>{users[wd.user_id]?.email || '—'}</span>
                            </div>
                          </div>
                        </td>
                        <td><strong className="text-success">{formatCurrency(wd.amount)}</strong></td>
                        <td>{wd.payment_method || 'PIX'}</td>
                        <td>
                          <strong>{dadosDoSaque(wd).rotulo || '—'}</strong>
                          {dadosDoSaque(wd).detalhe && (
                            <small style={{ display: 'block', color: 'var(--text-muted)' }}>{dadosDoSaque(wd).detalhe}</small>
                          )}
                        </td>
                        <td><span className="date-cell">{formatDateTime(wd.requested_at)}</span></td>
                        <td className="date-cell">{wd.notes || '—'}</td>
                        <td>
                          <div className="actions-cell">
                            <button
                              className="action-btn success"
                              onClick={() => handleMarkPaid(wd)}
                              disabled={processing === wd.id}
                              title="Aprovar e marcar como pago"
                            >
                              {processing === wd.id ? <Loader2 size={16} className="spin" /> : <CheckCircle size={16} />}
                            </button>
                            <button
                              className="action-btn danger"
                              onClick={() => handleReject(wd)}
                              disabled={processing === wd.id}
                              title="Rejeitar saque"
                            >
                              <Ban size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Completed Tab */}
          {activeTab === 'completed' && (
            <div className="admin-card table-responsive">
              {completedWithdrawals.length === 0 ? (
                <div className="empty-table"><p>Nenhum saque realizado.</p></div>
              ) : (
                <table className="wallets-table">
                  <thead>
                    <tr>
                      <th>Usuário</th>
                      <th>Valor</th>
                      <th>Método</th>
                      <th>Solicitado em</th>
                      <th>Pago em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedWithdrawals.filter(wd => {
                      const u = users[wd.user_id];
                      if (!u) return false;
                      const q = search.toLowerCase();
                      return !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
                    }).map(wd => (
                      <tr key={wd.id}>
                        <td>
                          <div className="user-cell">
                            <div className="user-avatar">{(users[wd.user_id]?.name || '?')[0].toUpperCase()}</div>
                            <div>
                              <strong>{users[wd.user_id]?.name || '—'}</strong>
                              <span>{users[wd.user_id]?.email || '—'}</span>
                            </div>
                          </div>
                        </td>
                        <td><strong>{formatCurrency(wd.amount)}</strong></td>
                        <td>{wd.payment_method || 'PIX'}</td>
                        <td><span className="date-cell">{formatDateTime(wd.requested_at)}</span></td>
                        <td><span className="date-cell">{formatDateTime(wd.processed_at)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Rejected Tab */}
          {activeTab === 'rejected' && (
            <div className="admin-card table-responsive">
              {rejectedWithdrawals.length === 0 ? (
                <div className="empty-table"><p>Nenhum saque recusado.</p></div>
              ) : (
                <table className="wallets-table">
                  <thead>
                    <tr>
                      <th>Usuário</th>
                      <th>Valor</th>
                      <th>Motivo</th>
                      <th>Solicitado em</th>
                      <th>Recusado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejectedWithdrawals.filter(wd => {
                      const u = users[wd.user_id];
                      if (!u) return false;
                      const q = search.toLowerCase();
                      return !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
                    }).map(wd => (
                      <tr key={wd.id}>
                        <td>
                          <div className="user-cell">
                            <div className="user-avatar">{(users[wd.user_id]?.name || '?')[0].toUpperCase()}</div>
                            <div>
                              <strong>{users[wd.user_id]?.name || '—'}</strong>
                              <span>{users[wd.user_id]?.email || '—'}</span>
                            </div>
                          </div>
                        </td>
                        <td><strong className="text-danger">{formatCurrency(wd.amount)}</strong></td>
                        <td className="date-cell">{wd.notes || 'Sem motivo informado'}</td>
                        <td><span className="date-cell">{formatDateTime(wd.requested_at)}</span></td>
                        <td><span className="date-cell">{formatDateTime(wd.processed_at)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Repasse por grupo: o dinheiro dos grupos criados por terceiros */}
          {activeTab === 'payout' && (
            <>
              <div className="finance-grid">
                <div className="finance-card finance-card-green">
                  <TrendingUp size={20} />
                  <div>
                    <span>Recebido de grupos</span>
                    <strong>{formatCurrency(totalBrutoTerceiros)}</strong>
                    <small>{repassePorGrupo.length} grupos com movimento</small>
                  </div>
                </div>
                <div className="finance-card finance-card-blue">
                  <DollarSign size={20} />
                  <div>
                    <span>Creditado nas carteiras</span>
                    <strong>{formatCurrency(totalCreditadoTerceiros)}</strong>
                    <small>dinheiro que o dono do grupo já recebeu</small>
                  </div>
                </div>
                <div className="finance-card finance-card-yellow">
                  <Clock size={20} />
                  <div>
                    <span>A repassar</span>
                    <strong>{formatCurrency(totalArepassar)}</strong>
                    <small>saldo dos criadores de grupo</small>
                  </div>
                </div>
                <div className="finance-card finance-card-red">
                  <AlertTriangle size={20} />
                  <div>
                    <span>Não creditado</span>
                    <strong>{formatCurrency(totalNaoCreditado)}</strong>
                    <small>recebido e ainda fora da carteira</small>
                  </div>
                </div>
                <div className="finance-card finance-card-purple">
                  <TrendingUp size={20} />
                  <div>
                    <span>Recebido pela plataforma</span>
                    <strong>{formatCurrency(totalRecebidoPlataforma)}</strong>
                    <small>grupos próprios: é receita da plataforma</small>
                  </div>
                </div>
              </div>

              <h2 className="section-title">
                <ArrowDownRight size={18} />
                Repasse por grupo
              </h2>
              <div className="admin-card table-responsive">
                {repassePorGrupo.length === 0 ? (
                  <div className="empty-table">
                    <p>Nenhum grupo de terceiro com movimento até agora.</p>
                    <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                      {formatCurrency(totalRecebidoPlataforma)} já foram recebidos, mas tudo veio de grupos da própria plataforma.
                    </p>
                  </div>
                ) : (
                  <table className="wallets-table">
                    <thead>
                      <tr>
                        <th>Grupo</th>
                        <th>Dono</th>
                        <th>Pagamentos</th>
                        <th>Recebido</th>
                        <th>Taxas</th>
                        <th>Líquido</th>
                        <th>Creditado</th>
                        <th>Saldo</th>
                        <th>Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repassePorGrupo.map(r => (
                        <tr key={r.groupId}>
                          <td><strong>{r.nome}</strong></td>
                          <td>
                            {r.dono}
                            {r.donoEmail && <small style={{ display: 'block', color: 'var(--text-muted)' }}>{r.donoEmail}</small>}
                          </td>
                          <td>{r.pagamentos}</td>
                          <td>{formatCurrency(r.bruto)}</td>
                          <td className="text-muted">-{formatCurrency(r.taxas)}</td>
                          <td>{formatCurrency(r.liquidoEsperado)}</td>
                          <td>
                            <strong className={r.creditado > 0 ? 'text-success' : ''}>
                              {formatCurrency(r.creditado)}
                            </strong>
                          </td>
                          <td>{formatCurrency(r.saldoCarteira)}</td>
                          <td>
                            {r.situacao === 'ok' && <span className="type-badge credit">ok</span>}
                            {r.situacao === 'pendente' && <span className="type-badge withdrawal">não creditado</span>}
                            {r.situacao === 'em-analise' && <span className="type-badge debit">saque pendente</span>}
                            {r.situacao === 'plataforma' && <span className="type-badge refund">plataforma</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {/* Carteiras: saldo de cada usuario */}
          {activeTab === 'wallets' && (
            <div className="admin-card table-responsive">
              {filteredWallets.length === 0 ? (
                <div className="empty-table">
                  <p>Nenhuma carteira com saldo.</p>
                </div>
              ) : (
                <table className="wallets-table">
                  <thead>
                    <tr>
                      <th>Usuário</th>
                      <th>Saldo</th>
                      <th>Total recebido</th>
                      <th>Saques pendentes</th>
                      <th>Grupos</th>
                      <th>Atualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWallets.map(w => {
                      const u = users[w.user_id] || {};
                      const pendentes = withdrawals
                        .filter(wd => wd.user_id === w.user_id && wd.status === 'pending')
                        .reduce((s, wd) => s + Number(wd.amount || 0), 0);
                      const gruposDoDono = groupList.filter(g => g.owner_id === w.user_id).length;
                      return (
                        <tr key={w.user_id}>
                          <td>
                            <strong>{u.name || 'Sem cadastro'}</strong>
                            {u.email && <small style={{ display: 'block', color: 'var(--text-muted)' }}>{u.email}</small>}
                          </td>
                          <td><strong>{formatCurrency(w.balance)}</strong></td>
                          <td>{formatCurrency(w.total_earned)}</td>
                          <td>{pendentes > 0 ? formatCurrency(pendentes) : '—'}</td>
                          <td>{gruposDoDono || '—'}</td>
                          <td>{formatDateTime(w.updated_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Financeiro Tab */}
          {activeTab === 'finance' && (
            <>
              <div className="finance-grid">
                <div className={`finance-card finance-card-green ${financeFilter === 'received' ? 'finance-card-active' : ''}`} onClick={() => setFinanceFilter(financeFilter === 'received' ? null : 'received')} style={{ cursor: 'pointer' }}>
                  <TrendingUp size={20} />
                  <div>
                    <span>Total Recebido</span>
                    <strong>{formatCurrency(totalReceived)}</strong>
                    <small>{paidPayments.length} transações pagas</small>
                  </div>
                </div>
                <div className={`finance-card finance-card-blue ${financeFilter === 'entrance' ? 'finance-card-active' : ''}`} onClick={() => setFinanceFilter(financeFilter === 'entrance' ? null : 'entrance')} style={{ cursor: 'pointer' }}>
                  <Receipt size={20} />
                  <div>
                    <span>Taxas de Adesão</span>
                    <strong>{formatCurrency(totalEntrance)}</strong>
                    <small>{paidPayments.filter(p => p.payment_type === 'entrance').length} pagas</small>
                  </div>
                </div>
                <div className={`finance-card finance-card-purple ${financeFilter === 'subscription' ? 'finance-card-active' : ''}`} onClick={() => setFinanceFilter(financeFilter === 'subscription' ? null : 'subscription')} style={{ cursor: 'pointer' }}>
                  <DollarSign size={20} />
                  <div>
                    <span>Assinaturas</span>
                    <strong>{formatCurrency(totalSubscription)}</strong>
                    <small>{paidPayments.filter(p => p.payment_type === 'subscription').length} pagas</small>
                  </div>
                </div>
                <div className={`finance-card finance-card-blue ${financeFilter === 'paid_out' ? 'finance-card-active' : ''}`} onClick={() => setFinanceFilter(financeFilter === 'paid_out' ? null : 'paid_out')} style={{ cursor: 'pointer' }}>
                  <Wallet size={20} />
                  <div>
                    <span>Saques Pagos</span>
                    <strong>{formatCurrency(totalPaidOut)}</strong>
                    <small>{completedWithdrawals.length} saques</small>
                  </div>
                </div>
                <div className="finance-card finance-card-yellow">
                  <Clock size={20} />
                  <div>
                    <span>Saques Pendentes</span>
                    <strong>{formatCurrency(totalPending)}</strong>
                    <small>{pendingWithdrawals.length} aguardando</small>
                  </div>
                </div>
                <div className="finance-card finance-card-teal">
                  <BarChart3 size={20} />
                  <div>
                    <span>Lucro da Plataforma</span>
                    <strong>{formatCurrency(netRevenue)}</strong>
                    <small>Recebido - taxa do gateway - repasse a grupos</small>
                  </div>
                </div>
                <div className="finance-card finance-card-yellow">
                  <ArrowDownRight size={20} />
                  <div>
                    <span>A Repassar</span>
                    <strong>{formatCurrency(totalArepassar)}</strong>
                    <small>{gruposDeTerceiroComMovimento.length} grupos de terceiros</small>
                  </div>
                </div>
              </div>

              <h2 className="section-title">
                <FileText size={18} />
                {financeFilter === 'received' ? 'Transações Pagas' :
                 financeFilter === 'entrance' ? 'Taxas de Adesão Pagas' :
                 financeFilter === 'subscription' ? 'Assinaturas Pagas' :
                 financeFilter === 'paid_out' ? 'Saques Realizados' :
                 'Últimas Transações'}
              </h2>
              <div className="admin-card table-responsive">
                {(() => {
                  let filtered = payments;
                  if (financeFilter === 'received') filtered = paidPayments;
                  else if (financeFilter === 'entrance') filtered = paidPayments.filter(p => p.payment_type === 'entrance');
                  else if (financeFilter === 'subscription') filtered = paidPayments.filter(p => p.payment_type === 'subscription');
                  else if (financeFilter === 'paid_out') {
                    return (
                      <table className="wallets-table">
                        <thead>
                          <tr>
                            <th>Usuário</th>
                            <th>Valor</th>
                            <th>Status</th>
                            <th>Data</th>
                          </tr>
                        </thead>
                        <tbody>
                          {completedWithdrawals.slice(0, 50).map(w => (
                            <tr key={w.id}>
                              <td>
                                <div className="user-cell">
                                  <div className="user-avatar">{(users[w.user_id]?.name || '?')[0].toUpperCase()}</div>
                                  <div>
                                    <strong>{users[w.user_id]?.name || '—'}</strong>
                                    <span>{users[w.user_id]?.email || '—'}</span>
                                  </div>
                                </div>
                              </td>
                              <td><strong className="text-danger">- {formatCurrency(w.amount)}</strong></td>
                              <td><span className="status-badge active">Pago</span></td>
                              <td><span className="date-cell">{formatDateTime(w.processed_at || w.requested_at)}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  }

                  if (filtered.length === 0) {
                    return <div className="empty-table"><p>Nenhuma transação encontrada.</p></div>;
                  }
                  return (
                    <table className="wallets-table">
                      <thead>
                        <tr>
                          <th>Usuário</th>
                          <th>Tipo</th>
                          <th>Valor</th>
                          <th>Grupo</th>
                          <th>Método</th>
                          <th>Status</th>
                          <th>Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.slice(0, 50).map(p => (
                          <tr key={p.id}>
                            <td>
                              <div className="user-cell">
                                <div className="user-avatar">{(users[p.user_id]?.name || '?')[0].toUpperCase()}</div>
                                <div>
                                  <strong>{users[p.user_id]?.name || '—'}</strong>
                                  <span>{users[p.user_id]?.email || '—'}</span>
                                </div>
                              </div>
                            </td>
                            <td><span className={`type-badge ${p.payment_type === 'entrance' ? 'credit' : 'debit'}`}>
                              {p.payment_type === 'entrance' ? 'Adesão' : p.payment_type === 'subscription' ? 'Assinatura' : p.payment_type || '—'}
                            </span></td>
                            <td><strong className="text-success">+ {formatCurrency(p.amount)}</strong></td>
                            <td>{groups[p.group_id] || '—'}</td>
                            <td>{p.method || '—'}</td>
                            <td><span className={`status-badge ${p.status === 'paid' ? 'active' : 'pending'}`}>
                              {p.status === 'paid' ? 'Pago' : p.status || '—'}
                            </span></td>
                            <td><span className="date-cell">{formatDateTime(p.created_at)}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default Wallets;
