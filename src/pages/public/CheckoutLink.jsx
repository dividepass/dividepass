import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, CheckCircle, AlertTriangle, Copy, QrCode, CreditCard, Shield, Clock, ChevronRight, ArrowLeft } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import IOPayCardForm from '../../components/IOPayCardForm';
import jsQR from 'jsqr';
import './CheckoutLink.css';

function formatCurrency(value) {
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
}

function CheckoutLink() {
  const { referenceCode } = useParams();
  const [charge, setCharge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [step, setStep] = useState('loading'); // loading | select | pix | card | processing | success | error
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [pixData, setPixData] = useState(null);
  const [cardError, setCardError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [polling, setPolling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pollResult, setPollResult] = useState(null);
  const pollingRef = useRef(null);
  const elapsedRef = useRef(null);
  const cardFormRef = useRef(null);

  const decodePixQrCode = useCallback(async (base64OrUrl) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const src = base64OrUrl.startsWith('data:') ? base64OrUrl : `data:image/png;base64,${base64OrUrl}`;
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = src; });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
      return code?.data || null;
    } catch { return null; }
  }, []);

  // Fetch charge on mount
  useEffect(() => {
    const fetchCharge = async () => {
      try {
        const { data, error: dbErr } = await supabase
          .from('custom_charges')
          .select('*')
          .eq('reference_code', referenceCode)
          .maybeSingle();

        if (dbErr) throw dbErr;
        if (!data) { setError('Cobrança não encontrada.'); setStep('error'); return; }
        if (data.status === 'paid') { setConfirmed(true); setCharge(data); setStep('success'); return; }
        if (data.status === 'expired' || (data.expires_at && new Date(data.expires_at) < new Date())) {
          await supabase.from('custom_charges').update({ status: 'expired' }).eq('id', data.id);
          setError('Esta cobrança expirou.'); setCharge(data); setStep('error'); return;
        }

        setCharge(data);

        // Determine initial step
        if (data.pix_copy_paste || data.pix_qrcode_url || data.pix_qrcode_base64) {
          // Already has PIX data — show PIX
          setSelectedMethod('pix');
          setPixData({
            pix_copy_paste: data.pix_copy_paste,
            pix_qrcode_url: data.pix_qrcode_url,
            pix_qrcode: data.pix_qrcode_base64,
          });
          setStep('pix');
        } else if (data.gateway_transaction_id) {
          // Transaction already initiated — poll for status
          setStep('processing');
          startPolling();
        } else {
          // No payment method yet — show selection
          setStep('select');
        }

        setLoading(false);
      } catch (e) {
        setError(e.message);
        setStep('error');
        setLoading(false);
      }
    };
    fetchCharge();
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [referenceCode]);

  const startPolling = useCallback(() => {
    setPolling(true);
    setElapsed(0);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => setElapsed(p => p + 1), 1000);

    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-custom-charge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ reference_code: referenceCode }),
        });
        const result = await resp.json();
        setPollResult(result);
        if (result.confirmed) {
          clearInterval(pollingRef.current);
          clearInterval(elapsedRef.current);
          setConfirmed(true);
          setPolling(false);
          setStep('success');
        } else if (result.status === 'expired') {
          clearInterval(pollingRef.current);
          clearInterval(elapsedRef.current);
          setError('Pagamento expirado');
          setPolling(false);
          setStep('error');
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    }, 10000);
  }, [referenceCode]);

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, []);

  const handleSelectMethod = async (method) => {
    setSelectedMethod(method);
    setProcessing(true);
    setCardError('');

    if (method === 'pix') {
      try {
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pay-custom-charge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ reference_code: referenceCode, payment_method: 'pix' }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          setError(data.error || 'Erro ao gerar PIX');
          setStep('error');
          setProcessing(false);
          return;
        }
        if (data.confirmed) {
          setConfirmed(true);
          setStep('success');
          setProcessing(false);
          return;
        }
        setPixData({
          pix_copy_paste: data.pix_copy_paste,
          pix_qrcode_url: data.pix_qrcode_url,
          pix_qrcode: data.pix_qrcode,
        });
        setCharge(prev => ({ ...prev, gateway_transaction_id: data.transaction_id }));
        setStep('pix');
        setProcessing(false);
        startPolling();
      } catch (e) {
        setError(e.message);
        setStep('error');
        setProcessing(false);
      }
    } else {
      setStep('card');
      setProcessing(false);
    }
  };

  const handleCardPayment = async (cardData) => {
    setProcessing(true);
    setCardError('');
    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pay-custom-charge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
          reference_code: referenceCode,
          payment_method: 'card',
          card_number: cardData.card_number,
          card_holder_name: cardData.card_holder_name,
          card_exp_month: cardData.card_exp_month,
          card_exp_year: cardData.card_exp_year,
          card_cvv: cardData.card_cvv,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setCardError(data.error || 'Erro ao processar cartão');
        setProcessing(false);
        return;
      }
      if (data.status === 'succeeded' || data.status === 'approved' || data.status === 'paid' || data.status === 'captured') {
        setConfirmed(true);
        setStep('success');
      } else {
        setCharge(prev => ({ ...prev, gateway_transaction_id: data.transaction_id }));
        setStep('processing');
        setProcessing(false);
        startPolling();
      }
    } catch (e) {
      setCardError(e.message);
      setProcessing(false);
    }
  };

  const [pixDecoded, setPixDecoded] = useState(null);
  useEffect(() => {
    if (pixData?.pix_copy_paste) return;
    if (pixData?.pix_qrcode && !pixDecoded) {
      let cancelled = false;
      (async () => {
        const decoded = await decodePixQrCode(pixData.pix_qrcode);
        if (!cancelled && decoded) setPixDecoded(decoded);
      })();
      return () => { cancelled = true; };
    }
  }, [pixData, pixDecoded, decodePixQrCode]);

  if (step === 'loading') {
    return (
      <div className="checkout-link-page">
        <div className="checkout-link-card">
          <Loader2 size={40} className="spin" style={{ color: 'var(--primary)' }} />
          <p>Carregando cobrança...</p>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="checkout-link-page">
        <div className="checkout-link-card">
          <div className="cl-error-icon"><AlertTriangle size={40} style={{ color: 'var(--danger)' }} /></div>
          <h2>Erro</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (step === 'success' || confirmed) {
    return (
      <div className="checkout-link-page">
        <div className="checkout-link-card cl-success-card">
          <div className="success-animation">
            <CheckCircle size={64} style={{ color: 'var(--success)' }} />
          </div>
          <h2>Pagamento Confirmado!</h2>
          <p>Seu pagamento de <strong>{formatCurrency(charge?.amount)}</strong> foi confirmado com sucesso.</p>
          <p className="cl-success-desc">{charge?.description}</p>
        </div>
      </div>
    );
  }

  const pixCode = pixData?.pix_copy_paste || pixDecoded;

  return (
    <div className="checkout-link-page">
      <div className="checkout-link-card">
        <div className="checkout-link-header">
          <div className="cl-logo-icon">
            <QrCode size={28} />
          </div>
          <h1>DividePass</h1>
          <p>{charge?.description}</p>
        </div>

        <div className="checkout-link-amount">
          <span>Valor a pagar</span>
          <strong>{formatCurrency(charge?.amount)}</strong>
        </div>

        {charge?.expires_at && (
          <div className="checkout-link-expiry">
            <Clock size={14} />
            <span>Expira em {new Date(charge.expires_at).toLocaleString('pt-BR')}</span>
          </div>
        )}

        {/* PAYMENT METHOD SELECTION */}
        {step === 'select' && (
          <div className="cl-select-method">
            <p className="cl-select-label">Escolha a forma de pagamento</p>
            <button className="cl-method-btn" onClick={() => handleSelectMethod('card')} disabled={processing}>
              <CreditCard size={20} />
              <div className="cl-method-info">
                <span className="cl-method-name">Cartão de Crédito</span>
                <span className="cl-method-desc">Pagamento parcelado via IOPay</span>
              </div>
              <ChevronRight size={18} className="cl-method-arrow" />
            </button>
            <button className="cl-method-btn" onClick={() => handleSelectMethod('pix')} disabled={processing}>
              <QrCode size={20} />
              <div className="cl-method-info">
                <span className="cl-method-name">PIX</span>
                <span className="cl-method-desc">Pagamento instantâneo</span>
              </div>
              <ChevronRight size={18} className="cl-method-arrow" />
            </button>
          </div>
        )}

        {/* PROCESSING */}
        {step === 'processing' && (
          <div className="cl-processing">
            <Loader2 size={36} className="spin" style={{ color: 'var(--primary)' }} />
            <p>{processing ? 'Processando pagamento...' : 'Aguardando confirmação do pagamento...'}</p>
            {polling && (
              <div className="checkout-link-polling">
                <Loader2 size={14} className="spin" />
                <span>{elapsed >= 60 ? `${(elapsed / 60).toFixed(0)} min` : `${elapsed}s`}</span>
              </div>
            )}
          </div>
        )}

        {/* CARD PAYMENT */}
        {step === 'card' && (
          <div className="cl-card-section">
            <button className="cl-back-btn" onClick={() => { setStep('select'); setSelectedMethod(null); setCardError(''); }}>
              <ArrowLeft size={16} /> Voltar
            </button>
            <IOPayCardForm
              amount={charge?.amount}
              onCardDataReady={handleCardPayment}
              onError={setCardError}
              disabled={processing}
            />
            {cardError && <div className="cl-card-error"><AlertTriangle size={14} /> {cardError}</div>}
          </div>
        )}

        {/* PIX PAYMENT */}
        {step === 'pix' && pixData && (
          <div className="checkout-link-pix">
            {(pixData.pix_qrcode || pixData.pix_qrcode_url) && (
              <div className="pix-qr-wrapper">
                {pixData.pix_qrcode ? (
                  <img src={`data:image/png;base64,${pixData.pix_qrcode}`} alt="QR Code PIX" className="pix-qr-img" />
                ) : (
                  <img src={pixData.pix_qrcode_url} alt="QR Code PIX" className="pix-qr-img" />
                )}
              </div>
            )}

            <p className="pix-instruction">Escaneie o QR Code ou copie o código PIX abaixo</p>

            {pixCode ? (
              <>
                <div className="pix-copy-box">{pixCode}</div>
                <button className="btn btn-primary btn-full cl-copy-btn" onClick={() => navigator.clipboard.writeText(pixCode)}>
                  <Copy size={14} /> Copiar Código PIX
                </button>
              </>
            ) : (
              <p className="pix-loading">Decodificando QR Code...</p>
            )}

            {polling && (
              <div className="checkout-link-polling">
                <Loader2 size={16} className="spin" />
                <span>Aguardando pagamento...{elapsed >= 60 ? ` ${(elapsed / 60).toFixed(0)} min` : ` ${elapsed}s`}</span>
              </div>
            )}
          </div>
        )}

        <div className="checkout-link-footer">
          <Shield size={14} />
          <span>Pagamento seguro via IOPay</span>
        </div>
      </div>
    </div>
  );
}

export default CheckoutLink;
