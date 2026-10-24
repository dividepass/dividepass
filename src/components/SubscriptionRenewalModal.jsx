import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Copy, CreditCard, Loader2, QrCode, Shield, Wallet, X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { formatDateBR } from '../lib/dateFormat';
import './SubscriptionRenewalModal.css';

const SUPABASE_URL = supabase.supabaseUrl;
const SUPABASE_ANON_KEY = supabase.supabaseKey;

const GATEWAYS_WITH_PIX = ['iopay', 'pagarme', 'asaas', 'stripe'];
const GATEWAYS_WITH_CARD = ['iopay', 'pagarme'];

const CYCLE_LABELS = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
  custom: 'Personalizado',
  days: 'Por dias',
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

const formatDate = (value) => (value ? formatDateBR(value) : '—');

/**
 * Renovação de assinatura vencida.
 *
 * Gera um novo pagamento do ciclo (PIX ou cartão), acompanha a confirmação no
 * gateway e só então a assinatura é atualizada — a data da próxima cobrança
 * só avança depois que o dinheiro entra.
 */
export default function SubscriptionRenewalModal({
  open,
  subscription,
  group,
  amount,
  onClose,
  onPaid,
}) {
  const { user } = useAuth();

  const [method, setMethod] = useState('pix');
  const [cards, setCards] = useState([]);
  const [cardId, setCardId] = useState(null);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [gateway, setGateway] = useState('iopay');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [polling, setPolling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);

  const pollRef = useRef(null);
  const timerRef = useRef(null);

  const serviceName = subscription?.service?.name || subscription?.service?.full_name || 'Assinatura';
  const groupName = group?.name || subscription?.group?.name || '';
  const total = Number(amount || subscription?.amount || 0);
  const cycle = subscription?.billing_cycle || 'monthly';

  const cycleLabel = useCallback(() => {
    if (cycle === 'custom' && subscription?.custom_cycle_months) {
      return `${subscription.custom_cycle_months} meses`;
    }
    if (cycle === 'days' && subscription?.custom_cycle_days) {
      return `${subscription.custom_cycle_days} dias`;
    }
    return CYCLE_LABELS[cycle] || cycle;
  }, [cycle, subscription]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    pollRef.current = null;
    timerRef.current = null;
    setPolling(false);
  }, []);

  /* Reinicia o modal a cada abertura. */
  useEffect(() => {
    if (!open) return;
    setMethod('pix');
    setError('');
    setResult(null);
    setDone(false);
    setElapsed(0);
    stopPolling();
  }, [open, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  /* Gateway ativo — define os métodos disponíveis. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'active_gateway')
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data?.value) setGateway(data.value);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  /* Cartões salvos — só quando o gateway aceita cartão. */
  useEffect(() => {
    if (!open) return;
    if (!GATEWAYS_WITH_CARD.includes(gateway) || !user) return;
    let cancelled = false;

    (async () => {
      setCardsLoading(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return;
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/iopay-cards`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ user_id: user.id }),
        });
        const data = await resp.json();
        if (cancelled) return;
        if (data.cards?.length) {
          setCards(data.cards);
          const preferred = data.cards.find((c) => c.is_default || c.default) || data.cards[0];
          setCardId(preferred.id_card || preferred.id);
        }
      } catch (e) {
        console.error('[Renovação] Erro ao carregar cartões:', e);
      } finally {
        if (!cancelled) setCardsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, gateway, user]);

  const handleSuccess = useCallback(() => {
    stopPolling();
    setDone(true);
    setResult(null);
  }, [stopPolling]);

  const startPolling = useCallback((txId) => {
    stopPolling();
    setPolling(true);
    setElapsed(0);

    timerRef.current = setInterval(() => setElapsed((prev) => prev + 1), 1000);

    const MAX_WAIT = 10 * 60 * 1000;
    const POLL_INTERVAL = 10 * 1000;
    const startedAt = Date.now();

    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > MAX_WAIT) {
        stopPolling();
        setError('O pagamento não foi confirmado a tempo. Se você já pagou, a assinatura é atualizada em instantes.');
        return;
      }
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token || !txId) return;

        const resp = await fetch(`${SUPABASE_URL}/functions/v1/check-iopay-tx`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            transaction_id: txId,
            group_id: subscription.group_id,
            user_id: user.id,
            payment_type: 'subscription',
            billing_cycle: subscription.billing_cycle || null,
            custom_cycle_days: subscription.custom_cycle_days || null,
            custom_cycle_months: subscription.custom_cycle_months || null,
          }),
        });

        let txResult;
        try {
          txResult = await resp.json();
        } catch {
          return; // resposta inválida: continua tentando
        }

        if (txResult.pix_copy_paste) {
          setResult((prev) => (prev ? { ...prev, pix_copy_paste: txResult.pix_copy_paste } : prev));
        }

        if (txResult.confirmed) {
          handleSuccess();
          return;
        }

        if (txResult.confirm_error) {
          stopPolling();
          setError(`Erro ao confirmar o pagamento: ${txResult.confirm_error}`);
          return;
        }

        if (['failed', 'cancelled', 'refunded', 'error'].includes(txResult.status)) {
          stopPolling();
          setError('O pagamento não foi aprovado. Tente novamente ou escolha outro método.');
        }
      } catch (e) {
        console.error('[Renovação] Erro no polling:', e);
      }
    }, POLL_INTERVAL);
  }, [subscription, user, stopPolling, handleSuccess]);

  const handlePay = async () => {
    if (!subscription || !user) return;
    setSubmitting(true);
    setError('');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Você precisa estar logado.');

      const payload = {
        group_id: subscription.group_id,
        user_id: user.id,
        payment_type: 'subscription',
        payment_method: method,
        gateway,
        billing_cycle: subscription.billing_cycle || 'monthly',
        custom_cycle_days: subscription.custom_cycle_days || null,
        custom_cycle_months: subscription.custom_cycle_months || null,
        amount: total,
        renewal: true,
        reason: `Renovação - ${serviceName}`.substring(0, 50),
      };
      if (method === 'card' && cardId) payload.id_card = cardId;

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Erro ao gerar o pagamento.');

      if (method === 'pix') {
        if (!data.pix_copy_paste && !data.pix_qrcode_url && !data.pix_qrcode) {
          throw new Error('Resposta sem dados do PIX.');
        }
        setResult(data);
        startPolling(data.transaction_id);
      } else {
        setResult({ ...data, is_card: true });
        if (data.status === 'paid' || data.status === 'approved') {
          handleSuccess();
        } else {
          startPolling(data.transaction_id);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const copyPixCode = () => {
    if (result?.pix_copy_paste) navigator.clipboard.writeText(result.pix_copy_paste);
  };

  if (!open || !subscription) return null;

  return (
    <div className="ren-modal-overlay" onClick={() => { stopPolling(); onClose(); }}>
      <div className="ren-modal" onClick={(e) => e.stopPropagation()}>
        <button className="ren-modal-close" onClick={() => { stopPolling(); onClose(); }} aria-label="Fechar">
          <X size={20} />
        </button>

        {done ? (
          <>
            <div className="ren-modal-header is-success">
              <CheckCircle2 size={28} />
              <div>
                <h3>Assinatura renovada</h3>
                <p>{serviceName} — {formatCurrency(total)}</p>
              </div>
            </div>
            <div className="ren-modal-body">
              <p className="ren-success-text">
                Pagamento confirmado. Sua assinatura foi atualizada e o acesso às credenciais
                volta a funcionar agora.
              </p>
              <button
                type="button"
                className="btn btn-primary ren-confirm-btn"
                onClick={() => { onPaid?.(); onClose(); }}
              >
                Continuar
              </button>
            </div>
          </>
        ) : result ? (
          <>
            <div className="ren-modal-header">
              <QrCode size={28} />
              <div>
                <h3>{result.is_card ? 'Processando pagamento' : 'Pague via PIX'}</h3>
                <p>{serviceName} — {formatCurrency(total)}</p>
              </div>
            </div>
            <div className="ren-modal-body ren-pix-body">
              {!result.is_card && (
                <>
                  {result.pix_qrcode_url ? (
                    <img src={result.pix_qrcode_url} alt="QR Code PIX" className="ren-qrcode" />
                  ) : result.pix_qrcode ? (
                    <img src={`data:image/png;base64,${result.pix_qrcode}`} alt="QR Code PIX" className="ren-qrcode" />
                  ) : (
                    <QrCode size={80} style={{ margin: '0 auto 1rem', color: 'var(--primary)' }} />
                  )}

                  {result.pix_copy_paste && (
                    <div className="ren-copy-section">
                      <label>Código PIX (copie e cole)</label>
                      <div className="ren-copy-row">
                        <input type="text" readOnly value={result.pix_copy_paste} />
                        <button type="button" className="btn btn-primary btn-sm" onClick={copyPixCode}>
                          <Copy size={14} /> Copiar
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {polling && (
                <div className="ren-polling-info">
                  <Loader2 size={16} className="spinning" />
                  <span>
                    Aguardando pagamento... {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                  </span>
                </div>
              )}

              {error && (
                <div className="ren-error">
                  <AlertCircle size={16} /> {error}
                </div>
              )}

              <p className="ren-secure-note">
                <Shield size={14} /> A assinatura só é atualizada depois que o pagamento for confirmado.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="ren-modal-header">
              <Wallet size={28} />
              <div>
                <h3>Renovar assinatura</h3>
                <p>{serviceName}{groupName ? ` — ${groupName}` : ''}</p>
              </div>
            </div>

            <div className="ren-modal-body">
              <div className="ren-warning">
                <AlertCircle size={16} />
                <span>
                  {subscription.status === 'cancelled' ? (
                    <>
                      Sua assinatura está cancelada. O acesso às credenciais fica bloqueado
                      até a reativação.
                    </>
                  ) : (
                    <>
                      A renovação venceu em {formatDate(subscription.next_charge_at || subscription.expires_at)}.
                      O acesso às credenciais fica bloqueado até a regularização.
                    </>
                  )}
                </span>
              </div>

              <div className="ren-method-list">
                {GATEWAYS_WITH_PIX.includes(gateway) && (
                  <button
                    type="button"
                    className={`ren-method ${method === 'pix' ? 'active' : ''}`}
                    onClick={() => setMethod('pix')}
                  >
                    <QrCode size={20} />
                    <span>
                      <strong>PIX</strong>
                      <small>QR Code ou código para copiar — aprovação imediata</small>
                    </span>
                  </button>
                )}

                {GATEWAYS_WITH_CARD.includes(gateway) && (
                  <button
                    type="button"
                    className={`ren-method ${method === 'card' ? 'active' : ''}`}
                    onClick={() => setMethod('card')}
                  >
                    <CreditCard size={20} />
                    <span>
                      <strong>Cartão de crédito</strong>
                      <small>Cobrar no cartão salvo</small>
                    </span>
                  </button>
                )}
              </div>

              {method === 'card' && (
                <div className="ren-cards">
                  <p className="ren-cards-title">Cartão</p>
                  {cardsLoading ? (
                    <p className="ren-hint">Carregando cartões…</p>
                  ) : cards.length === 0 ? (
                    <p className="ren-hint">Você não tem cartão salvo. Escolha o PIX.</p>
                  ) : (
                    cards.map((card) => {
                      const cid = card.id_card || card.id;
                      return (
                        <button
                          type="button"
                          key={cid}
                          className={`ren-card-row ${cardId === cid ? 'selected' : ''}`}
                          onClick={() => setCardId(cid)}
                        >
                          <CreditCard size={16} />
                          <span className="ren-card-number">•••• {card.last4_digits || card.last4 || '????'}</span>
                          <span className="ren-card-brand">{card.card_brand || card.brand || 'Cartão'}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              <div className="ren-summary">
                <span>Ciclo</span>
                <strong>{cycleLabel()}</strong>
                <span>Total a pagar</span>
                <strong>{formatCurrency(total)}</strong>
              </div>

              {error && (
                <div className="ren-error">
                  <AlertCircle size={16} /> {error}
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary ren-confirm-btn"
                onClick={handlePay}
                disabled={submitting || (method === 'card' && !cardId)}
              >
                {submitting ? (
                  <Loader2 size={16} className="spinning" />
                ) : method === 'pix' ? (
                  <QrCode size={16} />
                ) : (
                  <CreditCard size={16} />
                )}
                Pagar {formatCurrency(total)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
