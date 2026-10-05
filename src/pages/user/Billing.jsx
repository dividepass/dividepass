import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { X, Calendar, CreditCard, CheckCircle, Clock, AlertCircle, Receipt, QrCode, Copy, Loader2, Eye, EyeOff, Shield, Wallet } from 'lucide-react';
import './Billing.css';

function Billing() {
  const { user } = useAuth();
  const { activeSubscriptions, loading: appLoading } = useAppDataContext();

  // Definidos fora do componente: evita depender de identificador recriado a cada render
  const GATEWAYS_WITH_PIX = ['iopay', 'pagarme', 'asaas', 'stripe'];
  const GATEWAYS_WITH_CARD = ['iopay', 'pagarme'];
  const [payments, setPayments] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  // Modal de escolha de método de pagamento
  const [payTarget, setPayTarget] = useState(null);
  const [payMethod, setPayMethod] = useState('pix');
  const [savedCards, setSavedCards] = useState([]);
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [activeGateway, setActiveGateway] = useState('mercadopago');

  // PIX payment state
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [pixResult, setPixResult] = useState(null);
  const [pixLoading, setPixLoading] = useState(false);
  const [pixError, setPixError] = useState('');
  const [polling, setPolling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const pollingRef = useRef(null);
  const timerRef = useRef(null);

  const fetchPayments = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const [payRes, invRes] = await Promise.all([
        supabase
          .from('payments')
          .select('*, group:group_id (name, service:service_id (name, full_name, icon, color))')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('invoices')
          .select('id, group_id, amount, due_date, status, paid_at, created_at, payment_method, gateway_transaction_id')
          .eq('user_id', user.id)
          .order('due_date', { ascending: true }),
      ]);
      if (payRes.error) throw payRes.error;
      setPayments(payRes.data || []);
      setInvoices(invRes.data || []);
      setError('');
    } catch (err) {
      console.error('Erro ao carregar pagamentos:', err);
      setError('friendly');
    } finally {
      setLoading(false);
    }
  };

  // Gateway ativo define quais métodos de pagamento existem
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'active_gateway')
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data?.value) setActiveGateway(data.value);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Cartões salvos do usuário (necessário para pagar fatura no cartão)
  const loadSavedCards = useCallback(async () => {
    if (!user || !GATEWAYS_WITH_CARD.includes(activeGateway)) return;
    try {
      setCardsLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return;
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/iopay-cards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: user.id }),
      });
      const data = await resp.json();
      if (data.cards) {
        setSavedCards(data.cards);
        const preferred = data.cards.find((c) => c.is_default || c.default) || data.cards[0];
        if (preferred) setSelectedCardId(preferred.id_card || preferred.id);
      }
    } catch (e) {
      console.error('[Billing] Erro ao carregar cartões:', e);
    } finally {
      setCardsLoading(false);
    }
  }, [user, activeGateway]);

  useEffect(() => { fetchPayments(); }, [user]);

  // Estado de cobrança de cada assinatura, derivado das faturas do grupo.
  // A fatura é a fonte da verdade: tem due_date (vencimento) e status.
  const billingByGroup = useMemo(() => {
    const map = {};
    for (const inv of invoices) {
      if (!inv.group_id) continue;
      if (!map[inv.group_id]) map[inv.group_id] = [];
      map[inv.group_id].push(inv);
    }
    for (const groupId of Object.keys(map)) {
      const list = map[groupId];
      const pending = list
        .filter((i) => i.status === 'pending' || i.status === 'overdue')
        .sort((a, b) => new Date(a.due_date || 0) - new Date(b.due_date || 0));
      const paid = list
        .filter((i) => i.status === 'paid')
        .sort((a, b) => new Date(b.due_date || b.paid_at || 0) - new Date(a.due_date || a.paid_at || 0));

      if (pending.length > 0) {
        map[groupId] = {
          status: pending.some((i) => i.status === 'overdue') ? 'overdue' : 'pending',
          dueDate: pending[0].due_date,
          total: pending.reduce((sum, i) => sum + Number(i.amount || 0), 0),
          count: pending.length,
          invoices: pending,
        };
      } else if (paid.length > 0) {
        map[groupId] = {
          status: 'paid',
          dueDate: paid[0].due_date || paid[0].paid_at,
          total: Number(paid[0].amount || 0),
          count: 0,
          invoices: [],
        };
      } else {
        map[groupId] = null;
      }
    }
    return map;
  }, [invoices]);

  // Cartões são carregados sob demanda, ao abrir o modal de pagamento
  useEffect(() => {
    if (payTarget && GATEWAYS_WITH_CARD.includes(activeGateway) && savedCards.length === 0) {
      void loadSavedCards();
    }
  }, [payTarget, activeGateway, savedCards.length, loadSavedCards]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatCurrency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('pt-BR') : '-';

  const getStatusClass = (status) => {
    if (status === 'paid' || status === 'pago') return 'pago';
    if (status === 'pending' || status === 'pendente') return 'pendente';
    if (status === 'overdue' || status === 'vencido') return 'vencido';
    return status;
  };

  const getStatusLabel = (status) => {
    if (status === 'paid' || status === 'pago') return 'Pago';
    if (status === 'pending' || status === 'pendente') return 'Pendente';
    if (status === 'overdue' || status === 'vencido') return 'Vencido';
    return status;
  };

  // Cria o pagamento da fatura no método escolhido (PIX ou cartão).
  // Uma fatura por vez: o gateway cobra o valor exato da invoice.
  const handlePayInvoice = async (invoice, method, cardId) => {
    setPayingInvoice(invoice);
    setPixLoading(true);
    setPixError('');
    setPixResult(null);
    setElapsed(0);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Você precisa estar logado.');

      const payload = {
        group_id: invoice.group_id,
        user_id: user.id,
        payment_type: 'invoice',
        payment_method: method,
        gateway: activeGateway,
        invoice_id: invoice.id,
        amount: invoice.amount,
        reason: `Fatura #${invoice.id.slice(0, 8).toUpperCase()}`,
      };
      if (method === 'card' && cardId) payload.id_card = cardId;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao gerar pagamento');

      if (method === 'pix') {
        if (data.pix_copy_paste || data.pix_qrcode_url || data.pix_qrcode) {
          setPixResult(data);
          startInvoicePolling(data.transaction_id, invoice.id);
        } else {
          throw new Error('Resposta sem dados PIX');
        }
      } else {
        // Cartão: resposta já vem com o status da transação
        setPixResult({ ...data, is_card: true });
        if (data.status === 'paid' || data.status === 'approved') {
          setPayingInvoice(null);
          setPixResult(null);
          fetchPayments();
        } else {
          startInvoicePolling(data.transaction_id, invoice.id);
        }
      }
    } catch (err) {
      setPixError(err.message);
    } finally {
      setPixLoading(false);
    }
  };

  const handlePayInvoicePix = (invoice) => handlePayInvoice(invoice, 'pix');

  // Abre o modal de escolha de método
  const openPaymentModal = (billing, sub) => {
    const invoice = billing.invoices[0];
    if (!invoice) return;
    setPayMethod('pix');
    setPixError('');
    setPayTarget({ invoice, subscription: sub, billing });
  };

  const confirmPayment = () => {
    if (!payTarget) return;
    const { invoice } = payTarget;
    setPayTarget(null);
    void handlePayInvoice(invoice, payMethod, payMethod === 'card' ? selectedCardId : null);
  };

  const startInvoicePolling = (txId, paymentId) => {
    setPolling(true);
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    if (pollingRef.current) clearInterval(pollingRef.current);

    timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);

    let attempts = 0;
    pollingRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 120) {
        clearInterval(pollingRef.current);
        clearInterval(timerRef.current);
        setPolling(false);
        return;
      }
      try {
        const { data: pay } = await supabase.from('payments').select('status').eq('id', paymentId).single();
        if (pay?.status === 'paid') {
          clearInterval(pollingRef.current);
          clearInterval(timerRef.current);
          setPolling(false);
          setPayingInvoice(null);
          setPixResult(null);
          fetchPayments();
        }
      } catch (e) { console.error('Poll error:', e); }
    }, 5000);
  };

  const copyPixCode = () => {
    if (pixResult?.pix_copy_paste) {
      navigator.clipboard.writeText(pixResult.pix_copy_paste);
    }
  };

  const stopPolling = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setPolling(false);
  };

  const pendingInvoices = payments.filter(i => i.status === 'pending' || i.status === 'overdue');
  const isLoading = appLoading || loading;

  return (
    <div className="fade-in billing-page">
      <div className="page-header">
        <h1>Assinaturas e Faturas</h1>
        <p>Acompanhe seus pagamentos e próximas cobranças.</p>
      </div>

      <div className="billing-content">
        <div className="billing-subscriptions">
          <h2>Assinaturas Ativas</h2>
          {activeSubscriptions.length === 0 ? (
            <div className="billing-empty"><p>Você não tem assinaturas ativas.</p></div>
          ) : (
            <div className="billing-subscriptions-grid">
              {activeSubscriptions.map((sub) => {
                const billing = billingByGroup[sub.group_id] || null;
                const isPending = billing && (billing.status === 'pending' || billing.status === 'overdue');
                const dueDate = billing?.dueDate || sub.next_charge_at || sub.expires_at;

                return (
                  <div
                    key={sub.id}
                    className={`billing-sub-card ${isPending ? 'billing-sub-card-pending' : ''}`}
                    style={{ '--service-color': sub.service?.color || '#4F46E5' }}
                  >
                    <div className="billing-sub-icon" style={{ backgroundColor: sub.service?.color || '#4F46E5' }}>
                      {sub.service?.icon || 'S'}
                    </div>
                    <div className="billing-sub-info">
                      <h4>{sub.service?.name || sub.service?.full_name || 'Serviço'}</h4>
                      <p>{sub.group?.name || 'Grupo'}</p>
                      <span className="billing-sub-price">{formatCurrency(sub.amount)}/mês</span>

                      <div className="billing-sub-due">
                        <Calendar size={13} />
                        <span>
                          Vencimento: <strong>{formatDate(dueDate)}</strong>
                        </span>
                      </div>

                      <span className={`status-badge ${isPending ? (billing.status === 'overdue' ? 'vencido' : 'pendente') : 'pago'}`}>
                        {isPending ? (billing.status === 'overdue' ? 'Vencida' : 'Pendente') : 'Paga'}
                      </span>
                    </div>

                    {isPending && (
                      <div className="billing-sub-pending-box">
                        <span className="billing-sub-pending-label">
                          {billing.count > 1
                            ? `${billing.count} faturas em aberto`
                            : 'Total a pagar'}
                        </span>
                        <span className="billing-sub-pending-total">{formatCurrency(billing.total)}</span>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm billing-sub-pay-btn"
                          onClick={() => openPaymentModal(billing, sub)}
                        >
                          <Wallet size={14} /> Pagar agora!
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {pendingInvoices.length > 0 && (
          <div className="billing-pending-section">
            <h2>Pagamentos Pendentes</h2>
            <div className="billing-pending-list">
              {pendingInvoices.map((inv) => (
                <div key={inv.id} className="billing-pending-card">
                  <div className="billing-pending-info">
                    <div className="billing-pending-group">
                      {inv.service?.icon && (
                        <span className="billing-pending-icon" style={{ backgroundColor: inv.service.color || '#4F46E5' }}>
                          {inv.service.icon}
                        </span>
                      )}
                      <div>
                        <strong>{inv.group?.name || 'Grupo'}</strong>
                        <span className="billing-pending-service">{inv.service?.name || inv.service?.full_name || 'Serviço'}</span>
                      </div>
                    </div>
                    <span className="billing-pending-id">#{inv.id.slice(0, 8).toUpperCase()}</span>
                    <span>Criado em {formatDate(inv.created_at)}</span>
                    <span className="billing-pending-amount">{formatCurrency(inv.amount)}</span>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => { setPayMethod('pix'); setPayTarget({ invoice: inv, subscription: null, billing: { total: Number(inv.amount || 0), dueDate: inv.due_date, count: 1, invoices: [inv] } }); }} disabled={pixLoading && payingInvoice?.id === inv.id}>
                    {pixLoading && payingInvoice?.id === inv.id ? <Loader2 size={14} className="spinning" /> : <QrCode size={14} />}
                    Pagar agora!
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="invoice-history">
          <h2>Histórico de Faturas</h2>
          <div className="table-responsive">
            <table className="invoice-table">
              <thead>
                <tr>
                  <th>Fatura</th>
                  <th>Grupo / Serviço</th>
                  <th>Vencimento</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan="6" className="loading-cell">Carregando histórico...</td></tr>
                ) : error === 'friendly' ? (
                  <tr><td colSpan="6" className="error-cell">
                    <span>Não foi possível carregar seu histórico agora.</span>
                    <button className="btn btn-sm" style={{ marginLeft: '0.75rem' }} onClick={fetchPayments}>
                      Tentar novamente
                    </button>
                  </td></tr>
                ) : payments.length === 0 ? (
                  <tr><td colSpan="6" className="empty-cell">Nenhum pagamento encontrado.</td></tr>
                ) : (
                  payments.map((pay) => (
                    <tr key={pay.id}>
                      <td><strong>#{pay.id.slice(0, 8).toUpperCase()}</strong></td>
                      <td>
                        <div className="invoice-group-info">
                          {pay.service?.icon && (
                            <span className="invoice-group-icon" style={{ backgroundColor: pay.service.color || '#4F46E5' }}>
                              {pay.service.icon}
                            </span>
                          )}
                          <div>
                            <strong>{pay.group?.name || 'Grupo'}</strong>
                            <span>{pay.service?.name || pay.service?.full_name || 'Serviço'}</span>
                          </div>
                        </div>
                      </td>
                      <td>{pay.paid_at ? formatDate(pay.paid_at) : formatDate(pay.created_at)}</td>
                      <td>{formatCurrency(pay.amount)}</td>
                      <td>
                        <span className={`status-badge ${getStatusClass(pay.status)}`}>
                          {getStatusLabel(pay.status)}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-primary btn-sm pay-btn" onClick={() => setSelectedInvoice(pay)}>
                          <Receipt size={16} /> Detalhes
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal de escolha do método de pagamento */}
      {payTarget && (
        <div className="invoice-modal-overlay" onClick={() => setPayTarget(null)}>
          <div className="invoice-modal" onClick={(e) => e.stopPropagation()}>
            <button className="invoice-modal-close" onClick={() => setPayTarget(null)}>
              <X size={20} />
            </button>
            <div className="invoice-modal-header">
              <Wallet size={28} />
              <div>
                <h3>Escolha como pagar</h3>
                <p>
                  {payTarget.subscription?.service?.name || 'Assinatura'} — {formatCurrency(payTarget.billing.total)}
                </p>
              </div>
            </div>
            <div className="invoice-modal-body">
              <div className="pay-method-list">
                {GATEWAYS_WITH_PIX.includes(activeGateway) && (
                  <button
                    type="button"
                    className={`pay-method-option ${payMethod === 'pix' ? 'active' : ''}`}
                    onClick={() => setPayMethod('pix')}
                  >
                    <QrCode size={20} />
                    <span className="pay-method-text">
                      <strong>PIX</strong>
                      <small>QR Code ou código para copiar — aprovação imediata</small>
                    </span>
                  </button>
                )}

                {GATEWAYS_WITH_CARD.includes(activeGateway) && (
                  <button
                    type="button"
                    className={`pay-method-option ${payMethod === 'card' ? 'active' : ''}`}
                    onClick={() => setPayMethod('card')}
                  >
                    <CreditCard size={20} />
                    <span className="pay-method-text">
                      <strong>Cartão de crédito</strong>
                      <small>Cobrar no cartão salvo</small>
                    </span>
                  </button>
                )}
              </div>

              {payMethod === 'card' && (
                <div className="saved-cards-section">
                  <p className="saved-cards-title">Cartão</p>
                  {cardsLoading ? (
                    <p className="pay-method-hint">Carregando cartões…</p>
                  ) : savedCards.length === 0 ? (
                    <p className="pay-method-hint">
                      Você não tem cartão salvo. Adicione um na página de assinatura ou escolha PIX.
                    </p>
                  ) : (
                    savedCards.map((card) => {
                      const cid = card.id_card || card.id;
                      return (
                        <button
                          type="button"
                          key={cid}
                          className={`saved-card-row ${selectedCardId === cid ? 'selected' : ''}`}
                          onClick={() => setSelectedCardId(cid)}
                        >
                          <CreditCard size={16} />
                          <span className="saved-card-info">
                            <span className="saved-card-number">•••• {card.last4_digits || card.last4 || '????'}</span>
                            <span className="saved-card-brand">{card.card_brand || card.brand || 'Cartão'}</span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              <div className="pay-method-summary">
                <span>Vencimento</span>
                <strong>{formatDate(payTarget.billing.dueDate)}</strong>
                <span>Total</span>
                <strong>{formatCurrency(payTarget.billing.total)}</strong>
              </div>

              <button
                type="button"
                className="btn btn-primary pay-confirm-btn"
                onClick={confirmPayment}
                disabled={pixLoading || (payMethod === 'card' && !selectedCardId)}
              >
                {pixLoading ? <Loader2 size={16} className="spinning" /> : payMethod === 'pix' ? <QrCode size={16} /> : <CreditCard size={16} />}
                Pagar {formatCurrency(payTarget.billing.total)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIX Payment Modal */}
      {payingInvoice && pixResult && (
        <div className="invoice-modal-overlay" onClick={() => { stopPolling(); setPayingInvoice(null); setPixResult(null); }}>
          <div className="invoice-modal pix-modal" onClick={(e) => e.stopPropagation()}>
            <button className="invoice-modal-close" onClick={() => { stopPolling(); setPayingInvoice(null); setPixResult(null); }}>
              <X size={20} />
            </button>
            <div className="invoice-modal-header">
              <QrCode size={28} />
              <div>
                <h3>Pague via PIX</h3>
                <p>Fatura #{payingInvoice.id.slice(0, 8).toUpperCase()} — {formatCurrency(payingInvoice.amount)}</p>
              </div>
            </div>
            <div className="invoice-modal-body pix-body">
              {pixResult.pix_qrcode_url ? (
                <img src={pixResult.pix_qrcode_url} alt="QR Code PIX" className="pix-qrcode-img" />
              ) : pixResult.pix_qrcode ? (
                <img src={`data:image/png;base64,${pixResult.pix_qrcode}`} alt="QR Code PIX" className="pix-qrcode-img" />
              ) : (
                <QrCode size={80} style={{ margin: '0 auto 1rem', color: 'var(--primary)' }} />
              )}

              {pixResult.pix_copy_paste && (
                <div className="pix-copy-section">
                  <label>Código PIX (Copie e cole)</label>
                  <div className="pix-copy-row">
                    <input type="text" readOnly value={pixResult.pix_copy_paste} className="pix-copy-input" />
                    <button className="btn btn-primary btn-sm" onClick={copyPixCode}>
                      <Copy size={14} /> Copiar
                    </button>
                  </div>
                </div>
              )}

              {polling && (
                <div className="pix-polling-info">
                  <Loader2 size={16} className="spinning" />
                  <span>Aguardando pagamento... {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
                </div>
              )}

              {pixError && (
                <div className="pix-error">
                  <AlertCircle size={16} /> {pixError}
                </div>
              )}

              <p className="secure-note"><Shield size={14} /> O pagamento é verificado automaticamente a cada 30 segundos.</p>
            </div>
          </div>
        </div>
      )}

      {/* PIX Error Modal */}
      {payingInvoice && pixError && !pixResult && (
        <div className="invoice-modal-overlay" onClick={() => { setPayingInvoice(null); setPixError(''); }}>
          <div className="invoice-modal" onClick={(e) => e.stopPropagation()}>
            <button className="invoice-modal-close" onClick={() => { setPayingInvoice(null); setPixError(''); }}>
              <X size={20} />
            </button>
            <div className="invoice-modal-header">
              <AlertCircle size={28} style={{ color: '#EF4444' }} />
              <div>
                <h3>Erro ao gerar PIX</h3>
                <p>{pixError}</p>
              </div>
            </div>
            <div className="invoice-modal-body">
              <button className="btn btn-primary" onClick={() => { setPayingInvoice(null); setPixError(''); }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div className="invoice-modal-overlay" onClick={() => setSelectedInvoice(null)}>
          <div className="invoice-modal" onClick={(e) => e.stopPropagation()}>
            <button className="invoice-modal-close" onClick={() => setSelectedInvoice(null)}>
              <X size={20} />
            </button>
            <div className="invoice-modal-header">
              <Receipt size={28} />
              <div>
                <h3>Fatura #{selectedInvoice.id.slice(0, 8).toUpperCase()}</h3>
                <p>{getStatusLabel(selectedInvoice.status)}</p>
              </div>
            </div>
            <div className="invoice-modal-body">
              <div className="invoice-modal-group">
                {selectedInvoice.service?.icon && (
                  <span className="invoice-modal-icon" style={{ backgroundColor: selectedInvoice.service.color || '#4F46E5' }}>
                    {selectedInvoice.service.icon}
                  </span>
                )}
                <div>
                  <strong>{selectedInvoice.group?.name || 'Grupo'}</strong>
                  <span>{selectedInvoice.service?.name || selectedInvoice.service?.full_name || 'Serviço'}</span>
                </div>
              </div>
              <div className="invoice-modal-row">
                <Calendar size={18} />
                <span>Data</span>
                <strong>{selectedInvoice.paid_at ? formatDate(selectedInvoice.paid_at) : formatDate(selectedInvoice.created_at)}</strong>
              </div>
              <div className="invoice-modal-row">
                <CreditCard size={18} />
                <span>Valor</span>
                <strong>{formatCurrency(selectedInvoice.amount)}</strong>
              </div>
              {selectedInvoice.paid_at && (
                <div className="invoice-modal-row">
                  <CheckCircle size={18} />
                  <span>Pago em</span>
                  <strong>{formatDate(selectedInvoice.paid_at)}</strong>
                </div>
              )}
              {selectedInvoice.status === 'pending' && (
                <>
                  <div className="invoice-modal-row pending">
                    <Clock size={18} />
                    <span>Aguardando pagamento</span>
                  </div>
                  <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => { setSelectedInvoice(null); handlePayInvoicePix(selectedInvoice); }}>
                    <QrCode size={16} /> Pagar com PIX
                  </button>
                </>
              )}
              {selectedInvoice.status === 'overdue' && (
                <>
                  <div className="invoice-modal-row overdue">
                    <AlertCircle size={18} />
                    <span>Fatura vencida. Regularize para manter o acesso.</span>
                  </div>
                  <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => { setSelectedInvoice(null); handlePayInvoicePix(selectedInvoice); }}>
                    <QrCode size={16} /> Pagar com PIX
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Billing;
