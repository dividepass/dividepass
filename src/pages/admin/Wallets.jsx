import { useState, useEffect } from 'react';
import {
  Search, Wallet, DollarSign, Clock, Eye, ArrowLeft,
  CheckCircle, Loader2, TrendingUp, Ban, X, ArrowDownRight,
  Receipt, BarChart3, AlertTriangle, CheckSquare, XSquare,
  FileText
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './Wallets.css';

const TABS = [
  { key: 'pending', label: 'Pendentes', icon: Clock },
  { key: 'completed', label: 'Realizados', icon: CheckCircle },
  { key: 'rejected', label: 'Recusados', icon: XSquare },
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

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      if (!cancelled) setLoading(true);
      setError('');

      try {
        const [walletsRes, transactionsRes, withdrawalsRes, usersRes, groupsRes, paymentsRes] = await Promise.all([
          supabase.from('user_wallets').select('*').order('updated_at', { ascending: false }),
          supabase.from('wallet_transactions').select('*').order('created_at', { ascending: false }),
          supabase.from('wallet_withdrawals').select('*').order('requested_at', { ascending: false }),
          supabase.from('users').select('id, name, email'),
          supabase.from('groups').select('id, name'),
          supabase.from('payments').select('*').order('created_at', { ascending: false }),
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
  const netRevenue = totalReceived - totalPaidOut;

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
      const { error: updateError } = await supabase
        .from('wallet_withdrawals')
        .update({ status: 'completed', processed_at: new Date().toISOString() })
        .eq('id', withdrawal.id);

      if (updateError) throw updateError;

      await supabase.from('wallet_transactions').insert({
        user_id: withdrawal.user_id,
        type: 'withdrawal',
        amount: withdrawal.amount,
        description: `Saque processado`,
        reference_type: 'withdrawal',
        reference_id: withdrawal.id,
        status: 'completed',
      });

      await supabase.rpc('credit_wallet', {
        p_user_id: withdrawal.user_id,
        p_amount: -Number(withdrawal.amount),
        p_description: 'Saque processado',
        p_reference_type: 'withdrawal',
        p_reference_id: withdrawal.id,
      });

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
      const { error: updateError } = await supabase
        .from('wallet_withdrawals')
        .update({
          status: 'rejected',
          processed_at: new Date().toISOString(),
          notes: rejectReason || null,
        })
        .eq('id', rejectTarget.id);

      if (updateError) throw updateError;

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
          </div>

          {/* Tabs */}
          <div className="wallets-tabs">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const count = tab.key === 'pending' ? pendingWithdrawals.length
                : tab.key === 'completed' ? completedWithdrawals.length
                : tab.key === 'rejected' ? rejectedWithdrawals.length
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

          {/* Search Bar (for withdrawal tabs) */}
          {activeTab !== 'finance' && (
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
                    <span>Lucro Líquido</span>
                    <strong>{formatCurrency(netRevenue)}</strong>
                    <small>Recebido - Saques Pagos</small>
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
