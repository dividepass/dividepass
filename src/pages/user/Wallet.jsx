import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Wallet as WalletIcon, ArrowDownLeft, ArrowUpRight, Loader2, X, CheckCircle,
  DollarSign, TrendingUp, Banknote, CreditCard, Info
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import './Wallet.css';

function Wallet() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [balance, setBalance] = useState(0);
  const [totalReceived, setTotalReceived] = useState(0);
  const [totalWithdrawn, setTotalWithdrawn] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawMethod, setWithdrawMethod] = useState('pix');
  const [pixKey, setPixKey] = useState('');
  const [pixType, setPixType] = useState('cpf');
  const [bankName, setBankName] = useState('');
  const [bankAgency, setBankAgency] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankHolder, setBankHolder] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const fetchWallet = async () => {
      if (!user) return;
      try {
        setLoading(true);

        const [balanceRes, transactionsRes, withdrawalsRes] = await Promise.all([
          supabase.from('user_wallets').select('balance').eq('user_id', user.id).maybeSingle(),
          supabase.from('wallet_transactions').select('*, group:group_id (name, service:service_id (name, color))').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
          supabase.from('wallet_withdrawals').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        ]);

        if (balanceRes.data) {
          setBalance(parseFloat(balanceRes.data.balance) || 0);
        }

        const txData = transactionsRes.data || [];
        setTransactions(txData);

        const received = txData.filter(t => t.type === 'credit').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
        const withdrawnData = withdrawalsRes.data || [];
        const withdrawn = withdrawnData.filter(w => w.status !== 'cancelled').reduce((s, w) => s + (parseFloat(w.amount) || 0), 0);

        setTotalReceived(received);
        setTotalWithdrawn(withdrawn);
        setWithdrawals(withdrawnData);
      } catch (err) {
        console.error('Erro ao carregar carteira:', err);
        setError('Não foi possível carregar sua carteira. Tente novamente.');
      } finally {
        setLoading(false);
      }
    };

    fetchWallet();
  }, [user]);

  const handleWithdraw = async (e) => {
    e.preventDefault();
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) return;
    if (amount > balance) {
      setError('Saldo insuficiente para este saque.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const payload = {
        user_id: user.id,
        amount,
        payment_method: withdrawMethod,
        status: 'pending',
      };

      if (withdrawMethod === 'pix') {
        payload.pix_key = pixKey;
        payload.pix_type = pixType;
      } else {
        payload.bank_name = bankName;
        payload.bank_agency = bankAgency;
        payload.bank_account = bankAccount;
        payload.bank_holder = bankHolder;
      }

      const { error: insertError } = await supabase.from('wallet_withdrawals').insert(payload);
      if (insertError) throw insertError;

      setBalance(prev => prev - amount);
      setTotalWithdrawn(prev => prev + amount);
      setWithdrawals(prev => [{ ...payload, created_at: new Date().toISOString(), id: 'temp' }, ...prev]);
      setShowWithdrawForm(false);
      setWithdrawAmount('');
      setPixKey('');
      setBankName('');
      setBankAgency('');
      setBankAccount('');
      setBankHolder('');
      setToast('Solicitação de saque enviada com sucesso!');
    } catch (err) {
      console.error('Erro ao solicitar saque:', err);
      setError('Não foi possível processar sua solicitação. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const getFriendlyDescription = (tx) => {
    const desc = (tx.description || '').toLowerCase();
    const serviceName = tx.group?.service?.name;
    if (desc.includes('assinatura') || desc.includes('subscription')) {
      return serviceName ? `Pagamento de assinatura · ${serviceName}` : 'Pagamento de assinatura';
    }
    if (desc.includes('taxa') && desc.includes('adesão') || desc.includes('adesao')) {
      return serviceName ? `Taxa de adesão · ${serviceName}` : 'Taxa de adesão';
    }
    if (desc.includes('iopay')) {
      // strip "iopay" suffix for cleaner display
      return (tx.description || 'Transação').replace(/\s*[-–]\s*iopay\s*$/i, '').trim();
    }
    return tx.description || (tx.type === 'credit' ? 'Recebimento' : 'Transação');
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const getWithdrawStatusBadge = (status) => {
    const map = {
      pending: 'pendente',
      processing: 'pendente',
      completed: 'pago',
      cancelled: 'vencido',
    };
    return map[status] || 'pendente';
  };

  const getWithdrawStatusLabel = (status) => {
    const map = {
      pending: 'Pendente',
      processing: 'Processando',
      completed: 'Pago',
      cancelled: 'Cancelado',
    };
    return map[status] || status;
  };

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando carteira...</p>
      </div>
    );
  }

  return (
    <div className="fade-in wallet-page">
      {toast && (
        <div className="toast-success">
          <CheckCircle size={18} />
          <span>{toast}</span>
          <button onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      )}

      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1>Carteira</h1>
            <p>Gerencie seus ganhos e solicite saques.</p>
          </div>
          <button className="btn btn-outline" onClick={() => navigate('/dashboard/my-cards')}>
            <CreditCard size={16} /> Meus Cartões
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="wallet-balance-card">
        <div className="wallet-balance-main">
          <WalletIcon size={28} />
          <div>
            <span>Saldo disponível</span>
            <h2>{formatCurrency(balance)}</h2>
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowWithdrawForm(true)}
          disabled={balance <= 0}
        >
          <Banknote size={18} />
          Solicitar Saque
        </button>
      </div>

      <div className="wallet-stats-row">
        <div className="wallet-stat-card">
          <TrendingUp size={20} />
          <div>
            <span>Total recebido</span>
            <strong>{formatCurrency(totalReceived)}</strong>
          </div>
        </div>
        <div className="wallet-stat-card">
          <ArrowUpRight size={20} />
          <div>
            <span>Total sacado</span>
            <strong>{formatCurrency(totalWithdrawn)}</strong>
          </div>
        </div>
      </div>

      {/* Transactions */}
      <div className="wallet-section">
        <h2>Histórico de Transações</h2>
        {transactions.length === 0 ? (
          <div className="wallet-empty">
            <p>Nenhuma transação encontrada.</p>
          </div>
        ) : (
          <div className="wallet-tx-list">
            {transactions.map(tx => (
              <div key={tx.id} className="wallet-tx-row">
                <div className={`wallet-tx-icon ${tx.type === 'credit' ? 'credit' : 'debit'}`}>
                  {tx.type === 'credit' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                </div>
                <div className="wallet-tx-info">
                  <strong>{getFriendlyDescription(tx)}</strong>
                  {tx.group?.name && (
                    <span>{tx.group.name}</span>
                  )}
                </div>
                <div className="wallet-tx-amounts">
                  <span className={`wallet-tx-amount ${tx.type === 'credit' ? 'positive' : 'negative'}`}>
                    {tx.type === 'credit' ? '+' : '-'} {formatCurrency(tx.amount)}
                  </span>
                  <span className="wallet-tx-date">{formatDate(tx.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Withdrawals */}
      <div className="wallet-section">
        <h2>Histórico de Saques</h2>
        {withdrawals.length === 0 ? (
          <div className="wallet-empty">
            <p>Nenhum saque solicitado.</p>
          </div>
        ) : (
          <div className="wallet-tx-list">
            {withdrawals.map(w => (
              <div key={w.id} className="wallet-tx-row">
                <div className="wallet-tx-icon debit">
                  <ArrowUpRight size={16} />
                </div>
                <div className="wallet-tx-info">
                  <strong>Saque via {w.payment_method === 'pix' ? 'PIX' : 'Transferência Bancária'}</strong>
                  <span>{w.payment_method === 'pix' ? w.pix_key : w.bank_name}</span>
                </div>
                <div className="wallet-tx-amounts">
                  <span className="wallet-tx-amount negative">- {formatCurrency(w.amount)}</span>
                  <span className={`status-badge ${getWithdrawStatusBadge(w.status)}`}>
                    {getWithdrawStatusLabel(w.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Withdraw Modal */}
      {showWithdrawForm && (
        <div className="wallet-modal-overlay" onClick={() => setShowWithdrawForm(false)}>
          <div className="wallet-modal" onClick={e => e.stopPropagation()}>
            <button className="wallet-modal-close" onClick={() => setShowWithdrawForm(false)}>
              <X size={20} />
            </button>

            <div className="wallet-modal-header">
              <Banknote size={28} />
              <div>
                <h3>Solicitar Saque</h3>
                <p>Saldo disponível: {formatCurrency(balance)}</p>
              </div>
            </div>

            <form onSubmit={handleWithdraw} className="wallet-modal-body">
              <div className="manage-form-group">
                <label>Valor do saque (R$) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={balance}
                  value={withdrawAmount}
                  onChange={e => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="manage-form-group">
                <label>Método de pagamento *</label>
                <div className="wallet-method-toggle">
                  <button
                    type="button"
                    className={`wallet-method-btn ${withdrawMethod === 'pix' ? 'active' : ''}`}
                    onClick={() => setWithdrawMethod('pix')}
                  >
                    <CreditCard size={16} />
                    PIX
                  </button>
                  <button
                    type="button"
                    className={`wallet-method-btn ${withdrawMethod === 'bank' ? 'active' : ''}`}
                    onClick={() => setWithdrawMethod('bank')}
                  >
                    <DollarSign size={16} />
                    Transferência Bancária
                  </button>
                </div>
              </div>

              {withdrawMethod === 'pix' ? (
                <>
                  <div className="manage-form-group">
                    <label>Tipo de chave *</label>
                    <select value={pixType} onChange={e => setPixType(e.target.value)}>
                      <option value="cpf">CPF</option>
                      <option value="cnpj">CNPJ</option>
                      <option value="email">E-mail</option>
                      <option value="phone">Telefone</option>
                      <option value="random">Chave Aleatória</option>
                    </select>
                  </div>
                  <div className="manage-form-group">
                    <label>Chave PIX *</label>
                    <input
                      value={pixKey}
                      onChange={e => setPixKey(e.target.value)}
                      placeholder="Sua chave PIX"
                      required
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="manage-form-group">
                    <label>Banco *</label>
                    <input
                      value={bankName}
                      onChange={e => setBankName(e.target.value)}
                      placeholder="Nome do banco"
                      required
                    />
                  </div>
                  <div className="wallet-form-row">
                    <div className="manage-form-group">
                      <label>Agência *</label>
                      <input
                        value={bankAgency}
                        onChange={e => setBankAgency(e.target.value)}
                        placeholder="0000"
                        required
                      />
                    </div>
                    <div className="manage-form-group">
                      <label>Conta *</label>
                      <input
                        value={bankAccount}
                        onChange={e => setBankAccount(e.target.value)}
                        placeholder="00000-0"
                        required
                      />
                    </div>
                  </div>
                  <div className="manage-form-group">
                    <label>Titular da conta *</label>
                    <input
                      value={bankHolder}
                      onChange={e => setBankHolder(e.target.value)}
                      placeholder="Nome como está na conta"
                      required
                    />
                  </div>
                </>
              )}

              <div className="wallet-info-box">
                <Info size={16} />
                <span>O saque será processado em até 3 dias úteis após a solicitação.</span>
              </div>

              <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
                {submitting ? <Loader2 size={16} className="spin" /> : <Banknote size={16} />}
                Confirmar Saque
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Wallet;
