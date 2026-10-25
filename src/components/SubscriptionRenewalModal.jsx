import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Copy, CreditCard, Loader2, Plus, QrCode, Shield, Wallet, X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { formatDateBR } from '../lib/dateFormat';
import { CYCLE_LABELS, cycleMonths, cycleTotalFromMonthly } from '../lib/subscriptionCycles';
import AddCardModal from './AddCardModal';
import './SubscriptionRenewalModal.css';

const SUPABASE_URL = supabase.supabaseUrl;
const SUPABASE_ANON_KEY = supabase.supabaseKey;

const GATEWAYS_WITH_PIX = ['iopay', 'pagarme', 'asaas', 'stripe'];
const GATEWAYS_WITH_CARD = ['iopay', 'pagarme'];

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
  const [cardsError, setCardsError] = useState('');
  const [showAddCard, setShowAddCard] = useState(false);
  const [gateway, setGateway] = useState('iopay');

  /* Grupo: preço mensal da vaga e ciclos disponíveis. */
  const [groupInfo, setGroupInfo] = useState(null);
  /* Ciclo escolhido pelo usuário, guardado junto com a assinatura para que
     trocar de assinatura não carregue a escolha antiga. */
  const [cycleChoice, setCycleChoice] = useState(null);

  /* Cupom digitado pelo usuário. */
  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState(null);
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [polling, setPolling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);

  const pollRef = useRef(null);
  const timerRef = useRef(null);

  const serviceName = subscription?.service?.name || subscription?.service?.full_name || 'Assinatura';
  const groupName = group?.name || subscription?.group?.name || groupInfo?.name || '';
  const subscriptionCycle = subscription?.billing_cycle || 'monthly';

  /* Preço MENSAL da vaga. `groups.price_per_slot` e a fonte da verdade:
     `user_subscriptions.amount` e o TOTAL do ciclo e podia estar gravado
     errado (o admin gravava o preco mensal no campo do ciclo). */
  const monthlyPrice = Number(groupInfo?.price_per_slot || 0);

  /* Ciclos que o grupo aceita (vem de `groups.available_cycles`). */
  const cycleOptions = useMemo(() => {
    const fromGroup = Array.isArray(groupInfo?.available_cycles) ? groupInfo.available_cycles : null;
    const list = (fromGroup && fromGroup.length ? fromGroup : [subscriptionCycle])
      .filter((c) => CYCLE_LABELS[c]);
    return list.length ? list : [subscriptionCycle];
  }, [groupInfo, subscriptionCycle]);

  /* O ciclo ja vem marcado no ciclo que a pessoa tinha na assinatura. */
  const cycle = (cycleChoice && cycleChoice.subId === subscription?.id)
    ? cycleChoice.cycle
    : subscriptionCycle;
  const cycleMonthsCount = cycleMonths(cycle, subscription?.custom_cycle_months);

  /* Total = preço mensal x meses do ciclo escolhido. */
  const grossTotal = useMemo(() => {
    if (monthlyPrice > 0) {
      return cycleTotalFromMonthly(monthlyPrice, cycleMonthsCount);
    }
    // Grupo sem preço carregado: usa o total gravado na assinatura.
    return Number(subscription?.amount || amount || 0);
  }, [monthlyPrice, cycleMonthsCount, subscription, amount]);

  /* Desconto: cupom digitado agora, ou o desconto recorrente ja gravado
     (valido enquanto o ciclo nao mudar). */
  const discount = useMemo(() => {
    if (coupon) {
      const value = Number(coupon.discount_value || 0);
      const raw = coupon.discount_type === 'fixed'
        ? value
        : grossTotal * (value / 100);
      return Math.min(grossTotal, Math.round(raw * 100) / 100);
    }
    if (cycle === subscriptionCycle) {
      return Math.min(grossTotal, Number(subscription?.discount_amount || 0));
    }
    return 0;
  }, [coupon, grossTotal, cycle, subscriptionCycle, subscription]);

  const total = Math.max(0, grossTotal - discount);

  const cycleLabel = useCallback((cycleKey) => {
    if (cycleKey === 'custom' && subscription?.custom_cycle_months) {
      return `${subscription.custom_cycle_months} meses`;
    }
    if (cycleKey === 'days' && subscription?.custom_cycle_days) {
      return `${subscription.custom_cycle_days} dias`;
    }
    return CYCLE_LABELS[cycleKey] || cycleKey;
  }, [subscription]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    pollRef.current = null;
    timerRef.current = null;
    setPolling(false);
  }, []);

  /* O modal é remontado a cada abertura (o pai passa uma `key` que muda),
     então o estado já nasce limpo — sem `setState` dentro de effect. */

  useEffect(() => () => stopPolling(), [stopPolling]);

  /* Dados do grupo: preço mensal da vaga e ciclos disponíveis.
     Sem isso o popup não consegue multiplicar o preço pelo ciclo. */
  useEffect(() => {
    if (!open || !subscription?.group_id) return;
    let cancelled = false;

    supabase
      .from('groups')
      .select('id, name, price_per_slot, billing_cycle, available_cycles, cycle_discount')
      .eq('id', subscription.group_id)
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('[Renovação] Erro ao carregar o grupo:', error);
          return;
        }
        const row = data && data[0];
        if (row) setGroupInfo(row);
      })
      .catch((e) => console.error('[Renovação] Erro ao carregar o grupo:', e));

    return () => { cancelled = true; };
  }, [open, subscription?.group_id]);

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

  /* Cartões salvos — só quando o gateway aceita cartão.
     A listagem da IOPay é um GET: enviar POST cai no branch de acoes da
     edge function e devolve "Acao invalida", zerando a lista de cartoes. */
  const fetchCards = useCallback(async () => {
    if (!GATEWAYS_WITH_CARD.includes(gateway) || !user) return [];
    setCardsLoading(true);
    setCardsError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return [];

      const res = await supabase.functions.invoke('iopay-cards', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      const list = res.data?.cards || [];
      setCards(list);
      setCardId((prev) => {
        // Mantem a selecao atual se ela ainda existir na lista.
        if (prev && list.some((c) => (c.id_card || c.id) === prev)) return prev;
        const preferred = list.find((c) => c.is_default || c.default) || list[0];
        return preferred ? (preferred.id_card || preferred.id) : null;
      });
      return list;
    } catch (e) {
      console.error('[Renovação] Erro ao carregar cartões:', e);
      setCardsError('Não foi possível carregar seus cartões.');
      return [];
    } finally {
      setCardsLoading(false);
    }
  }, [gateway, user]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await fetchCards();
    })();
    return () => { cancelled = true; };
  }, [open, fetchCards]);

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
        billing_cycle: cycle,
        custom_cycle_days: cycle === 'days' ? (subscription.custom_cycle_days || null) : null,
        custom_cycle_months: cycle === 'custom' ? (subscription.custom_cycle_months || null) : null,
        amount: total,
        renewal: true,
        reason: `Renovação - ${serviceName}`.substring(0, 50),
      };
      if (method === 'card' && cardId) payload.id_card = cardId;
      /* O desconto é recalculado pelo servidor (a tabela `coupons` é a fonte
         da verdade) — aqui só enviamos qual cupom aplicar. */
      if (coupon?.id) payload.coupon_id = coupon.id;

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

  /**
   * Valida o cupom digitado.
   *
   * A tabela `coupons` é legível por qualquer pessoa autenticada (policy
   * "Anyone can validate coupon code"), então dá para mostrar o desconto
   * antes de pagar. O valor final é recalculado pelo servidor.
   */
  const applyCoupon = useCallback(async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setCoupon(null);
      setCouponError('');
      return;
    }

    setCouponLoading(true);
    setCouponError('');
    try {
      const { data, error } = await supabase
        .from('coupons')
        .select('id, code, description, discount_type, discount_value, min_amount, applies_to, expires_at, active')
        .eq('code', code)
        .limit(1);

      if (error) throw error;

      const found = data && data[0];
      if (!found) {
        setCoupon(null);
        setCouponError('Cupom não encontrado.');
        return;
      }
      if (!found.active) {
        setCoupon(null);
        setCouponError('Este cupom não está mais ativo.');
        return;
      }
      if (found.expires_at && new Date(found.expires_at) < new Date()) {
        setCoupon(null);
        setCouponError('Este cupom expirou.');
        return;
      }
      if (found.applies_to && found.applies_to !== 'all' && found.applies_to !== 'subscription') {
        setCoupon(null);
        setCouponError('Este cupom não vale para assinatura.');
        return;
      }
      if (Number(found.min_amount || 0) > grossTotal) {
        setCoupon(null);
        setCouponError(`Este cupom vale a partir de ${formatCurrency(found.min_amount)}.`);
        return;
      }

      setCoupon(found);
    } catch (e) {
      console.error('[Renovação] Erro ao validar cupom:', e);
      setCoupon(null);
      setCouponError('Não foi possível validar o cupom.');
    } finally {
      setCouponLoading(false);
    }
  }, [couponCode, grossTotal]);

  /* Cartao cadastrado dentro do fluxo de renovacao: recarrega a lista e ja
     deixa o novo cartao selecionado para o pagamento. */
  const handleCardAdded = useCallback(async (result) => {
    setShowAddCard(false);
    const list = await fetchCards();
    const newId = result?.id_card;

    if (newId) {
      setCardId(newId);
      // A listagem da IOPay pode ainda nao refletir o cartao recem-criado.
      // Nesse caso ele entra localmente para o usuario ver o que sera cobrado.
      setCards((prev) => (
        prev.some((c) => (c.id_card || c.id) === newId)
          ? prev
          : [...prev, { id_card: newId, last4_digits: result.last4 || '••••', brand: 'Cartão' }]
      ));
    } else if (list.length) {
      const preferred = list.find((c) => c.is_default || c.default) || list[0];
      setCardId(preferred.id_card || preferred.id);
    }

    setMethod('card');
  }, [fetchCards]);

  if (!open || !subscription) return null;

  return (
    <>
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
                  ) : cardsError ? (
                    <p className="ren-hint">{cardsError}</p>
                  ) : cards.length === 0 ? (
                    <div className="ren-cards-empty">
                      <p className="ren-hint">
                        Você não tem cartão salvo. Cadastre um cartão para pagar esta renovação.
                      </p>
                      <button
                        type="button"
                        className="ren-add-card-btn"
                        onClick={() => setShowAddCard(true)}
                      >
                        <Plus size={16} /> Adicionar Cartão
                      </button>
                    </div>
                  ) : (
                    <>
                      {cards.map((card) => {
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
                      })}
                      <button
                        type="button"
                        className="ren-add-card-btn is-secondary"
                        onClick={() => setShowAddCard(true)}
                      >
                        <Plus size={16} /> Adicionar outro cartão
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="ren-cycle-block">
                <label className="ren-block-label">Ciclo de pagamento</label>
                <div className="ren-cycle-options">
                  {cycleOptions.map((option) => (
                    <button
                      type="button"
                      key={option}
                      className={`ren-cycle-option ${cycle === option ? 'active' : ''}`}
                      onClick={() => setCycleChoice({ subId: subscription?.id, cycle: option })}
                    >
                      <strong>{cycleLabel(option)}</strong>
                      <small>
                        {option === 'days'
                          ? `${subscription?.custom_cycle_days || 1} dias`
                          : `${cycleMonths(option, subscription?.custom_cycle_months)} ${cycleMonths(option, subscription?.custom_cycle_months) === 1 ? 'mês' : 'meses'}`}
                      </small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="ren-coupon-block">
                <label className="ren-block-label" htmlFor="ren-coupon-input">Cupom de desconto</label>
                <div className="ren-coupon-row">
                  <input
                    id="ren-coupon-input"
                    type="text"
                    value={couponCode}
                    placeholder="Digite o cupom (opcional)"
                    onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCoupon(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } }}
                    disabled={Boolean(result)}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={applyCoupon}
                    disabled={couponLoading || !couponCode.trim()}
                  >
                    {couponLoading ? <Loader2 size={14} className="spinning" /> : 'Aplicar'}
                  </button>
                </div>
                {coupon && !couponError && (
                  <p className="ren-coupon-ok">
                    <CheckCircle2 size={14} /> Cupom {coupon.code} aplicado — {coupon.description || 'desconto'}
                  </p>
                )}
                {couponError && (
                  <p className="ren-coupon-error">
                    <AlertCircle size={14} /> {couponError}
                  </p>
                )}
              </div>

              <div className="ren-summary">
                <span>Preço mensal</span>
                <strong>{formatCurrency(monthlyPrice || 0)}</strong>
                {cycle !== 'days' && cycleMonthsCount > 1 && (
                  <>
                    <span>Ciclo</span>
                    <strong>{cycleLabel(cycle)} ({cycleMonthsCount} meses)</strong>
                  </>
                )}
                {discount > 0 && (
                  <>
                    <span>Desconto</span>
                    <strong className="ren-summary-discount">− {formatCurrency(discount)}</strong>
                  </>
                )}
                <span className="ren-summary-total-label">Total a pagar</span>
                <strong className="ren-summary-total">{formatCurrency(total)}</strong>
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

    {/* Modal de cadastro de cartao — renderizado como irmao do overlay de
        renovacao para nao fechar o fluxo ao clicar no fundo dele. */}
    {showAddCard && (
      <AddCardModal
        onClose={() => setShowAddCard(false)}
        onSuccess={handleCardAdded}
      />
    )}
    </>
  );
}
