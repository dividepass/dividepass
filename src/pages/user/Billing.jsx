import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { X, Calendar, CreditCard, CheckCircle, Clock, AlertCircle, Receipt, QrCode, Copy, Loader2, Eye, EyeOff, Shield } from 'lucide-react';
import './Billing.css';

function Billing() {
  const { user } = useAuth();
  const { activeSubscriptions, loading: appLoading } = useAppDataContext();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);

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
      const { data, error: err } = await supabase
        .from('payments')
        .select('*, group:group_id (name, service:service_id (name, full_name, icon, color))')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (err) throw err;
      setPayments(data || []);
      setError('');
    } catch (err) {
      console.error('Erro ao carregar pagamentos:', err);
      setError('friendly');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPayments(); }, [user]);

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

  const handlePayInvoicePix = async (invoice) => {
    setPayingInvoice(invoice);
    setPixLoading(true);
    setPixError('');
    setPixResult(null);
    setElapsed(0);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Você precisa estar logado.');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          group_id: invoice.group_id,
          user_id: user.id,
          payment_type: 'invoice',
          payment_method: 'pix',
          invoice_id: invoice.id,
          amount: invoice.amount,
          reason: `Fatura #${invoice.id.slice(0, 8).toUpperCase()}`,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao gerar PIX');

      if (data.pix_copy_paste || data.pix_qrcode_url || data.pix_qrcode) {
        setPixResult(data);
        startInvoicePolling(data.transaction_id, invoice.id);
      } else {
        throw new Error('Resposta sem dados PIX');
      }
    } catch (err) {
      setPixError(err.message);
    } finally {
      setPixLoading(false);
    }
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
              {activeSubscriptions.map((sub) => (
                <div key={sub.id} className="billing-sub-card">
                  <div className="billing-sub-icon" style={{ backgroundColor: sub.service?.color || '#4F46E5' }}>
                    {sub.service?.icon || 'S'}
                  </div>
                  <div className="billing-sub-info">
                    <h4>{sub.service?.name || sub.service?.full_name || 'Serviço'}</h4>
                    <p>{sub.group?.name || 'Grupo'}</p>
                    <span className="billing-sub-price">{formatCurrency(sub.amount)}/mês</span>
                  </div>
                  <span className="status-badge pago">Ativa</span>
                </div>
              ))}
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
                  <button className="btn btn-primary btn-sm" onClick={() => handlePayInvoicePix(inv)} disabled={pixLoading && payingInvoice?.id === inv.id}>
                    {pixLoading && payingInvoice?.id === inv.id ? <Loader2 size={14} className="spinning" /> : <QrCode size={14} />}
                    Pagar com PIX
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
