import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Loader2, Shield, ChevronLeft, CreditCard, CheckCircle, ScrollText, Clock, QrCode, Copy, RotateCcw, AlertTriangle, Plus, Eye, EyeOff, Tag, X } from 'lucide-react';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { reportGoogleAdsConversion } from '../../lib/googleAds';
import IOPayCardForm from '../../components/IOPayCardForm';
import jsQR from 'jsqr';
import '../../components/IOPayCardForm.css';
import './Checkout.css';

const CYCLE_OPTIONS = {
  monthly: { label: 'Mensal', months: 1 },
  quarterly: { label: 'Trimestral', months: 3 },
  semiannual: { label: 'Semestral', months: 6 },
  annual: { label: 'Anual', months: 12 },
};

function monthsForCycle(cycle, group) {
  if (cycle === 'custom') return group?.custom_cycle_months || 1;
  if (cycle === 'days') return 1;
  return CYCLE_OPTIONS[cycle]?.months ?? 1;
}

function daysForCycle(cycle, group) {
  if (cycle === 'days') return group?.custom_cycle_days || 1;
  return 0;
}

function getNextBillingDate(cycle, group) {
  const now = new Date();
  const days = daysForCycle(cycle, group);
  if (days > 0) {
    now.setDate(now.getDate() + days);
  } else {
    const months = monthsForCycle(cycle, group);
    now.setMonth(now.getMonth() + months);
  }
  const day = now.getDate();
  const months = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return `${day} de ${months[now.getMonth()]} de ${now.getFullYear()}`;
}

function getCycleLabel(cycle, group) {
  if (cycle === 'days') return group?.custom_cycle_label || `${group?.custom_cycle_days || '?'} dias`;
  if (cycle === 'custom') return group?.custom_cycle_label || `${group?.custom_cycle_months || '?'} meses`;
  return CYCLE_OPTIONS[cycle]?.label || cycle;
}

function formatCurrency(value) {
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
}

function getCardLast4(card) {
  const num = card.last4_digits || card.first4_digits || card.number || card.card_number || '';
  if (num.length >= 4) return num.slice(-4);
  return '????';
}

function getCardBrand(card) {
  return card.card_brand || card.brand || card.card_brand || 'Cartão';
}

const GATEWAY_NAMES = {
  mercadopago: 'Mercado Pago',
  stripe: 'Stripe',
  asaas: 'Asaas',
  iopay: 'IOPay',
  pagarme: 'Pagar.me',
};

const GATEWAYS_REDIRECT = ['mercadopago', 'stripe'];
const GATEWAYS_WITH_PIX = ['iopay', 'pagarme', 'asaas', 'stripe'];
const GATEWAYS_WITH_CARD_FORM = ['iopay', 'pagarme'];

function Checkout() {
  const { groupSlug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { getGroupBySlug, refresh } = useAppDataContext();
  const referralCode = searchParams.get('ref');

  const paymentStatus = searchParams.get('payment');

  const [processing, setProcessing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [paymentAttempted, setPaymentAttempted] = useState(false);
  const [error, setError] = useState('');
  const [remoteGroup, setRemoteGroup] = useState(undefined);
  const [memberStatus, setMemberStatus] = useState(null);
  const [activeGateway, setActiveGateway] = useState('mercadopago');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [gatewayResult, setGatewayResult] = useState(null);
  const [gatewayWaiting, setGatewayWaiting] = useState(false);
  const [pollingTimedOut, setPollingTimedOut] = useState(false);
  const [pollingElapsed, setPollingElapsed] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [pixCopyDecoded, setPixCopyDecoded] = useState(null);
  const [cardFormResetKey, setCardFormResetKey] = useState(0);
  const [savedCards, setSavedCards] = useState([]);
  const [showAddCard, setShowAddCard] = useState(false);
  const [revealedCards, setRevealedCards] = useState({});
  const pollingIntervalRef = useRef(null);
  const elapsedTimerRef = useRef(null);
  const autoVerifyTimerRef = useRef(null);
  const manualVerifyRef = useRef(null);
  const paymentTxRef = useRef(null);
  const paymentTypeRef = useRef(null);
  const googleAdsConversionSentRef = useRef(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponResult, setCouponResult] = useState(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState(null);
  const [testimonialRewardNotice, setTestimonialRewardNotice] = useState(null);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      if (autoVerifyTimerRef.current) clearTimeout(autoVerifyTimerRef.current);
    };
  }, []);

  const [selectedCycleState, setSelectedCycleState] = useState(null);

  const localDetails = getGroupBySlug(groupSlug);
  const details = localDetails || remoteGroup || null;

  const selectedCycle = (() => {
    const d = localDetails || remoteGroup;
    const available = d?.group?.available_cycles?.length
      ? d.group.available_cycles
      : (d?.group?.billing_cycle ? [d.group.billing_cycle] : ['monthly']);
    const preferred = d?.group?.billing_cycle || available[0];
    if (selectedCycleState && available.includes(selectedCycleState)) return selectedCycleState;
    return preferred || 'monthly';
  })();

  // Fetch group data
  useEffect(() => {
    if (localDetails) return;
    let cancelled = false;

    const fetchGroup = async () => {
      let groupData = null;

      const tryBySlug = await supabase
        .from('groups')
        .select(`*, service:service_id (*), members:group_members (*), credential:group_credentials (*), owner:owner_id (id, name, email)`)
        .eq('slug', groupSlug)
        .eq('status', 'open')
        .maybeSingle();

      if (!cancelled && tryBySlug.data) {
        groupData = tryBySlug.data;
      }

      if (!cancelled && !groupData) {
        const tryById = await supabase
          .from('groups')
          .select(`*, service:service_id (*), members:group_members (*), credential:group_credentials (*), owner:owner_id (id, name, email)`)
          .eq('id', groupSlug)
          .eq('status', 'open')
          .maybeSingle();

        if (!cancelled && tryById.data) {
          groupData = tryById.data;
        }
      }

      if (!cancelled && !groupData) {
        const tryByName = await supabase
          .from('groups')
          .select(`*, service:service_id (*), members:group_members (*), credential:group_credentials (*), owner:owner_id (id, name, email)`)
          .ilike('name', groupSlug)
          .eq('status', 'open')
          .maybeSingle();

        if (!cancelled && tryByName.data) {
          groupData = tryByName.data;
        }
      }

      if (cancelled || !groupData) {
        if (!cancelled) setRemoteGroup(null);
        return;
      }

      const service = groupData.service || null;

      if (!cancelled) {
        setRemoteGroup({
          group: { ...groupData, credentials: groupData.credential || {} },
          service,
          spots: groupData.has_slot_limit === false
            ? Infinity
            : Math.max(0, (groupData.max_size || service?.max_group_size) - (groupData.members?.filter(m => m.status === 'active').length || 0)),
        });
      }
    };

    fetchGroup();
    return () => { cancelled = true; };
  }, [groupSlug, localDetails]);

  // Fetch active gateway
  useEffect(() => {
    const fetchGateway = async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'active_gateway')
        .maybeSingle();
      if (data?.value) setActiveGateway(data.value);
    };
    fetchGateway();
  }, []);

  // Auto-apply testimonial reward if available
  useEffect(() => {
    if (!user || !details?.group) return;
    let cancelled = false;

    const applyTestimonialReward = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return;

        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-coupons`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'testimonial_available' }),
        });
        const data = await resp.json();
        if (cancelled || !data.available) return;

        // Apply the reward directly
        const applyResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-coupons`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            action: 'validate',
            code: data.code,
            payment_type: 'subscription',
            amount: details.group.price_per_slot || 0,
            group_id: details.group.id,
          }),
        });
        const applyData = await applyResp.json();
        if (cancelled) return;

        if (applyData.valid) {
          setCouponResult(applyData);
          setCouponCode(data.code);
          setTestimonialRewardNotice({
            discount_value: applyData.discount_value,
            expires_at: data.expires_at,
          });
        }
      } catch (e) {
        console.error('[Checkout] Testimonial reward check error:', e);
      }
    };

    applyTestimonialReward();
    return () => { cancelled = true; };
  }, [user?.id, details?.group?.id]);

  // Fetch saved IOPay cards
  useEffect(() => {
    if (!user || activeGateway !== 'iopay') return;
    let cancelled = false;
    const fetchCards = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return;
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/iopay-cards`, {
          headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        });
        const data = await resp.json();
        if (!cancelled) setSavedCards(data.cards || []);
      } catch (e) {
        console.error('[Checkout] Failed to load saved cards:', e);
        if (!cancelled) setSavedCards([]);
      }
    };
    fetchCards();
    return () => { cancelled = true; };
  }, [user, activeGateway]);

  // Fetch member status if logged in
  useEffect(() => {
    if (!user || !details?.group?.id) return;
    let cancelled = false;

    const fetchMember = async () => {
      const { data } = await supabase
        .from('group_members')
        .select('payment_status, entrance_paid_at, subscription_deadline, status')
        .eq('group_id', details.group.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!cancelled) setMemberStatus(data);
    };

    fetchMember();
    return () => { cancelled = true; };
  }, [user, details?.group?.id]);

  // Handle payment return
  useEffect(() => {
    if (!paymentStatus || !user || !details?.group?.id) return;

    if (paymentStatus === 'entrance_success') {
      const refresh = async () => {
        const { data } = await supabase
          .from('group_members')
          .select('payment_status, entrance_paid_at, subscription_deadline, status')
          .eq('group_id', details.group.id)
          .eq('user_id', user.id)
          .maybeSingle();
        setMemberStatus(data);
      };
      refresh();
    } else if (paymentStatus === 'subscription_success') {
      navigate('/dashboard/credentials');
    }
  }, [paymentStatus, user, details, navigate]);

  // Reset gateway state when entrance is already paid
  const entrancePaidHook = details?.group?.has_entrance_fee && Number(details?.group?.entrance_fee || 0) > 0 && (memberStatus?.payment_status === 'entrance_paid' || memberStatus?.payment_status === 'awaiting_subscription' || memberStatus?.payment_status === 'active');
  useEffect(() => {
    if (entrancePaidHook) {
      setGatewayResult(null);
      setGatewayWaiting(false);
      setPollingTimedOut(false);
    }
  }, [entrancePaidHook]);

  const handleValidateCoupon = async (paymentType, amount) => {
    if (!couponCode || couponCode.length < 3) return;
    setValidatingCoupon(true);
    setCouponError('');
    setCouponResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-coupons`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'validate',
          code: couponCode,
          payment_type: paymentType,
          amount,
          group_id: details?.group?.id,
        }),
      });
      const data = await resp.json();
      if (data.valid) {
        setCouponResult(data);
        setCouponError('');
      } else {
        setCouponResult(null);
        setCouponError(data.error || 'Cupom inválido');
      }
    } catch (e) {
      setCouponResult(null);
      setCouponError('Erro ao validar cupom');
    }
    setValidatingCoupon(false);
  };

  const handleCheckPayment = async () => {
    setChecking(true);
    setError('');
    try {
      const { data } = await supabase
        .from('group_members')
        .select('payment_status, entrance_paid_at, subscription_deadline, status')
        .eq('group_id', details.group.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        setMemberStatus(data);
        if (data.payment_status === 'active') {
          navigate('/dashboard/credentials');
          return;
        } else if (data.payment_status === 'entrance_paid' || data.payment_status === 'awaiting_subscription') {
          setError('');
        } else {
          setError('Pagamento ainda não confirmado. Aguarde alguns instantes e tente novamente.');
        }
      }
    } catch (err) {
      console.error('[Checkout] Check payment error:', err);
      setError('Erro ao verificar pagamento.');
    } finally {
      setChecking(false);
    }
  };

  const handleEntrancePayment = async (cardData = null, selectedIdCard = null) => {
    setProcessing(true);
    setPaymentAttempted(true);
    setError('');
    setGatewayResult(null);
    setPollingTimedOut(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Você precisa estar logado.');

      const gwPaymentMethod = GATEWAYS_WITH_PIX.includes(activeGateway) ? paymentMethod : undefined;

      const payload = {
        group_id: details.group.id,
        user_id: user.id,
        payment_type: 'entrance',
        reason: `Taxa de Adesão - ${service?.name || service?.full_name}`,
        payment_method: gwPaymentMethod,
        gateway: activeGateway,
      };

      if (couponResult?.valid) {
        payload.coupon_id = couponResult.coupon_id;
        payload.discount_amount = couponResult.discount_amount;
        payload.final_amount = couponResult.final_amount;
      }

      if (selectedIdCard) {
        payload.id_card = selectedIdCard;
      } else if (GATEWAYS_WITH_CARD_FORM.includes(activeGateway) && paymentMethod === 'card' && cardData) {
        payload.card_number = cardData.card_number;
        payload.card_holder_name = cardData.card_holder_name;
        payload.card_exp_month = cardData.card_exp_month;
        payload.card_exp_year = cardData.card_exp_year;
        payload.card_cvv = cardData.card_cvv;
      }

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
      console.log('[Checkout] Entrance response:', response.status, data);
      if (!response.ok) {
        const detail = typeof data.details === 'string' ? data.details : (typeof data.error === 'string' ? data.error : JSON.stringify(data.error || data.details || 'Erro ao criar pagamento.'));
        throw new Error(detail);
      }

      if (data.gateway && (data.pix_copy_paste || data.pix_qrcode_url || data.pix_qrcode)) {
        paymentTxRef.current = data.transaction_id || null;
        paymentTypeRef.current = 'entrance';
        setGatewayResult(data);
        setGatewayWaiting(true);
        startPaymentPolling('entrance');
        setProcessing(false);
        return;
      }

      if (data.needs_polling && data.transaction_id) {
        paymentTxRef.current = data.transaction_id;
        paymentTypeRef.current = 'entrance';
        setGatewayResult(data);
        setGatewayWaiting(true);
        startIOPayCardPolling(data.transaction_id, 'entrance');
        setProcessing(false);
        return;
      }

      const payUrl = data.init_point || data.sandbox_init_point;
      if (payUrl) {
        window.open(payUrl, '_blank');
      } else {
        throw new Error('Link de pagamento não disponível.');
      }
    } catch (err) {
      console.error('[Checkout] Entrance error:', err);
      setError(err.message);
      setCardFormResetKey(k => k + 1);
    } finally {
      setProcessing(false);
    }
  };

  const handleCombinedPayment = async (cardData = null, selectedIdCard = null) => {
    setProcessing(true);
    setPaymentAttempted(true);
    setError('');
    setGatewayResult(null);
    setPollingTimedOut(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Você precisa estar logado.');

      const { group: grp, service: svc } = details;
      const cycleMonths = monthsForCycle(selectedCycle, grp);
      const cycleDays = daysForCycle(selectedCycle, grp);
      const gwPaymentMethod = GATEWAYS_WITH_PIX.includes(activeGateway) ? paymentMethod : undefined;

      const entranceAmount = hasEntranceFee ? Number(group.entrance_fee) : 0;
      const subscriptionAmount = Number(group.price_per_slot) * cycleMonths;
      const totalCombinedAmount = entranceAmount + subscriptionAmount;

      const payload = {
        group_id: grp.id,
        user_id: user.id,
        billing_cycle: selectedCycle,
        months: cycleMonths,
        custom_cycle_days: cycleDays || null,
        custom_cycle_months: selectedCycle === 'custom' ? (grp.custom_cycle_months || null) : null,
        custom_cycle_label: (selectedCycle === 'days' ? grp.custom_cycle_label : (selectedCycle === 'custom' ? grp.custom_cycle_label : null)) || null,
        payment_type: 'combined',
        reason: `Adesão + 1ª Mensalidade - ${svc?.name || svc?.full_name}`,
        referral_code: referralCode || null,
        force_new_plan: true,
        payment_method: gwPaymentMethod,
        gateway: activeGateway,
      };

      if (couponResult?.valid) {
        payload.coupon_id = couponResult.coupon_id;
        payload.discount_amount = couponResult.discount_amount;
        payload.final_amount = couponResult.final_amount;
      }

      if (selectedIdCard) {
        payload.id_card = selectedIdCard;
      } else if (GATEWAYS_WITH_CARD_FORM.includes(activeGateway) && paymentMethod === 'card' && cardData) {
        payload.card_number = cardData.card_number;
        payload.card_holder_name = cardData.card_holder_name;
        payload.card_exp_month = cardData.card_exp_month;
        payload.card_exp_year = cardData.card_exp_year;
        payload.card_cvv = cardData.card_cvv;
      }

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
      console.log('[Checkout] Combined response:', response.status, data);
      if (!response.ok) {
        const detail = typeof data.details === 'string' ? data.details : (typeof data.error === 'string' ? data.error : JSON.stringify(data.error || data.details || 'Erro ao criar pagamento.'));
        throw new Error(detail);
      }

      if (data.gateway && (data.pix_copy_paste || data.pix_qrcode_url || data.pix_qrcode)) {
        paymentTxRef.current = data.transaction_id || null;
        paymentTypeRef.current = 'combined';
        setGatewayResult(data);
        setGatewayWaiting(true);
        startPaymentPolling('combined');
        setProcessing(false);
        return;
      }

      if (data.needs_polling && data.transaction_id) {
        paymentTxRef.current = data.transaction_id;
        paymentTypeRef.current = 'combined';
        setGatewayResult(data);
        setGatewayWaiting(true);
        startIOPayCardPolling(data.transaction_id, 'combined');
        setProcessing(false);
        return;
      }

      const payUrl = data.init_point || data.sandbox_init_point;
      if (payUrl) {
        window.open(payUrl, '_blank');
      } else {
        throw new Error('Link de pagamento não disponível.');
      }
    } catch (err) {
      console.error('[Checkout] Combined error:', err);
      setError(err.message);
      setCardFormResetKey(k => k + 1);
    } finally {
      setProcessing(false);
    }
  };

  const handleSubscriptionPayment = async (cardData = null, selectedIdCard = null) => {
    setProcessing(true);
    setPaymentAttempted(true);
    setError('');
    setGatewayResult(null);
    setPollingTimedOut(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Você precisa estar logado.');

      const { group: grp, service: svc } = details;
      const cycleMonths = monthsForCycle(selectedCycle, grp);
      const cycleDays = daysForCycle(selectedCycle, grp);
      const gwPaymentMethod = GATEWAYS_WITH_PIX.includes(activeGateway) ? paymentMethod : undefined;

      const payload = {
        group_id: grp.id,
        user_id: user.id,
        billing_cycle: selectedCycle,
        months: cycleMonths,
        custom_cycle_days: cycleDays || null,
        custom_cycle_months: selectedCycle === 'custom' ? (grp.custom_cycle_months || null) : null,
        custom_cycle_label: (selectedCycle === 'days' ? grp.custom_cycle_label : (selectedCycle === 'custom' ? grp.custom_cycle_label : null)) || null,
        payment_type: 'subscription',
        reason: `DividePass - ${svc?.name || svc?.full_name}`,
        referral_code: referralCode || null,
        force_new_plan: true,
        payment_method: gwPaymentMethod,
        gateway: activeGateway,
      };

      if (couponResult?.valid) {
        payload.coupon_id = couponResult.coupon_id;
        payload.discount_amount = couponResult.discount_amount;
        payload.final_amount = couponResult.final_amount;
      }

      if (selectedIdCard) {
        payload.id_card = selectedIdCard;
      } else if (GATEWAYS_WITH_CARD_FORM.includes(activeGateway) && paymentMethod === 'card' && cardData) {
        payload.card_number = cardData.card_number;
        payload.card_holder_name = cardData.card_holder_name;
        payload.card_exp_month = cardData.card_exp_month;
        payload.card_exp_year = cardData.card_exp_year;
        payload.card_cvv = cardData.card_cvv;
      }

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
      console.log('[Checkout] Subscription response:', response.status, data);
      if (!response.ok) {
        const detail = typeof data.details === 'string' ? data.details : (typeof data.error === 'string' ? data.error : JSON.stringify(data.error || data.details || 'Erro ao criar pagamento.'));
        throw new Error(detail);
      }

      if (data.gateway && (data.pix_copy_paste || data.pix_qrcode_url || data.pix_qrcode)) {
        paymentTxRef.current = data.transaction_id || null;
        paymentTypeRef.current = 'subscription';
        setGatewayResult(data);
        setGatewayWaiting(true);
        startPaymentPolling('subscription');
        setProcessing(false);
        return;
      }

      if (data.needs_polling && data.transaction_id) {
        paymentTxRef.current = data.transaction_id;
        paymentTypeRef.current = 'subscription';
        setGatewayResult(data);
        setGatewayWaiting(true);
        startIOPayCardPolling(data.transaction_id, 'subscription');
        setProcessing(false);
        return;
      }

      const payUrl = data.init_point || data.sandbox_init_point;
      if (payUrl) {
        window.open(payUrl, '_blank');
      } else {
        throw new Error('Link de pagamento não disponível.');
      }
    } catch (err) {
      console.error('[Checkout] Subscription error:', err);
      setError(err.message);
      setCardFormResetKey(k => k + 1);
    } finally {
      setProcessing(false);
    }
  };

  const handlePaymentSuccess = async (paymentType, amount) => {
    setPaymentSuccess({ type: paymentType, amount });
    setGatewayWaiting(false);

    for (let attempt = 0; attempt < 5; attempt++) {
      try { await refresh(); } catch (e) { console.error('Refresh error:', e); }

      if (paymentType === 'entrance') {
        const { data: member } = await supabase
          .from('group_members')
          .select('payment_status, entrance_paid_at, subscription_deadline, status')
          .eq('group_id', details.group.id)
          .eq('user_id', user.id)
          .maybeSingle();
        if (member?.payment_status === 'entrance_paid' || member?.payment_status === 'active') {
          setMemberStatus(member);
          break;
        }
      } else {
        const { data: sub } = await supabase
          .from('user_subscriptions')
          .select('id')
          .eq('group_id', details.group.id)
          .eq('user_id', user.id)
          .eq('status', 'active')
          .maybeSingle();
        if (sub) break;
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    setTimeout(() => {
      if (paymentType === 'entrance') {
        setPaymentSuccess(null);
      } else {
        navigate('/dashboard/credentials');
      }
    }, 3000);
  };

  useEffect(() => {
    if (!paymentSuccess || googleAdsConversionSentRef.current) return;

    const transactionId = paymentTxRef.current || gatewayResult?.transaction_id || '';
    const amount = Number(paymentSuccess.amount || 1);
    const sent = reportGoogleAdsConversion({
      value: amount,
      currency: 'BRL',
      transactionId,
      key: transactionId || `${paymentSuccess.type}:${amount}`,
      attribution: profile,
    });

    if (sent) {
      googleAdsConversionSentRef.current = true;
    }
  }, [paymentSuccess, gatewayResult]);

  const startElapsedTimer = () => {
    setPollingElapsed(0);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      setPollingElapsed(prev => prev + 1);
    }, 1000);

    if (autoVerifyTimerRef.current) clearTimeout(autoVerifyTimerRef.current);
    autoVerifyTimerRef.current = setTimeout(() => {
      console.log('[Checkout] Auto-verify triggered after 10s');
      if (manualVerifyRef.current !== 'running' && paymentTxRef.current) {
        handleManualVerifyRef.current?.();
      }
    }, 10000);
  };

  const stopElapsedTimer = () => {
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
    if (autoVerifyTimerRef.current) { clearTimeout(autoVerifyTimerRef.current); autoVerifyTimerRef.current = null; }
  };

  const startPaymentPolling = (pollPaymentType = 'entrance') => {
    const startTime = Date.now();
    const MAX_WAIT = 10 * 60 * 1000;
    const POLL_INTERVAL = 10 * 1000;
    startElapsedTimer();

    const interval = setInterval(async () => {
      const elapsed = Date.now() - startTime;

      if (elapsed >= MAX_WAIT) {
        clearInterval(interval);
        stopElapsedTimer();
        setGatewayWaiting(false);
        setPollingTimedOut(true);
        return;
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        const txId = paymentTxRef.current;
        if (!accessToken || !txId) return;

        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-iopay-tx`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            transaction_id: txId,
            group_id: details.group.id,
            user_id: user.id,
            payment_type: pollPaymentType,
            billing_cycle: selectedCycle || null,
            custom_cycle_days: daysForCycle(selectedCycle, group) || null,
            custom_cycle_months: selectedCycle === 'custom' ? (group.custom_cycle_months || null) : null,
          }),
        });

        let txResult;
        try {
          txResult = await resp.json();
        } catch (parseErr) {
          console.error('[Checkout] Invalid JSON from poll edge function:', resp.status);
          return;
        }

        console.log('[Checkout] Poll result:', txResult);

        if (!resp.ok) {
          console.error('[Checkout] Poll edge function error:', resp.status, txResult);
          return; // Continue polling for PIX
        }

        if (txResult.pix_copy_paste) {
          setGatewayResult(prev => ({ ...prev, pix_copy_paste: txResult.pix_copy_paste }));
        }

        if (txResult.confirmed) {
          clearInterval(interval);
          stopElapsedTimer();
          const amount = pollPaymentType === 'entrance' ? Number(group.entrance_fee) : 
                         pollPaymentType === 'combined' ? Number(group.entrance_fee) + Number(group.price_per_slot) : Number(group.price_per_slot);
          handlePaymentSuccess(pollPaymentType, amount);
          return;
        }

        // Direct DB fallback: check if payment already confirmed
        if (pollPaymentType === 'entrance' || pollPaymentType === 'combined') {
          const { data: memberCheck } = await supabase
            .from('group_members')
            .select('payment_status')
            .eq('group_id', details.group.id)
            .eq('user_id', user.id)
            .maybeSingle();
          if (memberCheck?.payment_status === 'entrance_paid' || memberCheck?.payment_status === 'active') {
            clearInterval(interval);
            stopElapsedTimer();
            handlePaymentSuccess(pollPaymentType, Number(group.entrance_fee) + (pollPaymentType === 'combined' ? Number(group.price_per_slot) : 0));
            return;
          }
        } else {
          const { data: subCheck } = await supabase
            .from('user_subscriptions')
            .select('id, status')
            .eq('group_id', details.group.id)
            .eq('user_id', user.id)
            .eq('status', 'active')
            .maybeSingle();
          if (subCheck) {
            clearInterval(interval);
            stopElapsedTimer();
            handlePaymentSuccess(pollPaymentType, Number(group.price_per_slot));
            return;
          }
        }

        const pollFailed = txResult.status === 'failed' || txResult.status === 'cancelled'
          || txResult.status === 'refunded' || txResult.status === 'error';
        if (pollFailed) {
          clearInterval(interval);
          stopElapsedTimer();
          setGatewayWaiting(false);
          setError('Pagamento não aprovado. Verifique os dados do cartão e tente novamente.');
          return;
        }
      } catch (e) {
        console.error('[Checkout] Poll error:', e);
      }
    }, POLL_INTERVAL);

    pollingIntervalRef.current = interval;
  };

  const startIOPayCardPolling = (txId, paymentType = 'subscription') => {
    const startTime = Date.now();
    const MAX_WAIT = 5 * 60 * 1000;
    const POLL_INTERVAL = 3 * 1000;
    startElapsedTimer();

    const interval = setInterval(async () => {
      const elapsed = Date.now() - startTime;

      if (elapsed >= MAX_WAIT) {
        clearInterval(interval);
        stopElapsedTimer();
        setGatewayWaiting(false);
        setPollingTimedOut(true);
        return;
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) return;

        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-iopay-tx`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            transaction_id: txId,
            group_id: details.group.id,
            user_id: user.id,
            payment_type: paymentType,
            billing_cycle: selectedCycle || null,
            custom_cycle_days: daysForCycle(selectedCycle, group) || null,
            custom_cycle_months: selectedCycle === 'custom' ? (group.custom_cycle_months || null) : null,
          }),
        });

        let txResult;
        try {
          txResult = await resp.json();
        } catch (parseErr) {
          console.error('[Checkout] Invalid JSON from edge function:', resp.status);
          return; // Continue polling - could be transient
        }

        console.log('[Checkout] IOPay card poll:', txResult);

        if (!resp.ok) {
          console.error('[Checkout] Edge function error:', resp.status, txResult);
          // Show actual error to help debug
          if (txResult.error || txResult.confirm_error) {
            setGatewayWaiting(false);
            setError(`Erro ao verificar: ${txResult.error || txResult.confirm_error}`);
            return;
          }
          if (txResult.status === 'auth_error') {
            clearInterval(interval);
            stopElapsedTimer();
            setGatewayWaiting(false);
            setError('Erro de autenticação com IOPay. Verifique as credenciais no painel admin.');
            return;
          }
          // For other errors, continue polling
          return;
        }

        if (txResult.confirmed) {
          clearInterval(interval);
          stopElapsedTimer();
          const amount = paymentType === 'entrance' ? Number(group.entrance_fee) : 
                         paymentType === 'combined' ? Number(group.entrance_fee) + Number(group.price_per_slot) : Number(group.price_per_slot);
          handlePaymentSuccess(paymentType, amount);
          return;
        }

        if (txResult.confirm_error) {
          console.error('[Checkout] Confirm error from backend:', txResult.confirm_error);
          clearInterval(interval);
          stopElapsedTimer();
          setGatewayWaiting(false);
          setError(`Erro ao confirmar pagamento: ${txResult.confirm_error}. Clique em "Verificar Pagamento" para tentar novamente.`);
          return;
        }

        // Direct DB fallback: check if payment already confirmed
        if (paymentType === 'entrance' || paymentType === 'combined') {
          const { data: memberCheck } = await supabase
            .from('group_members')
            .select('payment_status')
            .eq('group_id', details.group.id)
            .eq('user_id', user.id)
            .maybeSingle();
          if (memberCheck?.payment_status === 'entrance_paid' || memberCheck?.payment_status === 'active') {
            clearInterval(interval);
            stopElapsedTimer();
            handlePaymentSuccess(paymentType, Number(group.entrance_fee) + (paymentType === 'combined' ? Number(group.price_per_slot) : 0));
            return;
          }
        } else {
          const { data: subCheck } = await supabase
            .from('user_subscriptions')
            .select('id, status')
            .eq('group_id', details.group.id)
            .eq('user_id', user.id)
            .eq('status', 'active')
            .maybeSingle();
          if (subCheck) {
            clearInterval(interval);
            stopElapsedTimer();
            handlePaymentSuccess(paymentType, Number(group.price_per_slot));
            return;
          }
        }

        const txFailed = txResult.status === 'failed' || txResult.status === 'cancelled'
          || txResult.status === 'refunded' || txResult.status === 'error';
        if (txFailed) {
          clearInterval(interval);
          stopElapsedTimer();
          setGatewayWaiting(false);
          setError('Pagamento não aprovado. Verifique os dados do cartão e tente novamente.');
          return;
        }
      } catch (e) {
        console.error('[Checkout] Card poll error:', e);
      }
    }, POLL_INTERVAL);

    pollingIntervalRef.current = interval;
  };

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
      if (code?.data) {
        console.log('[PIX] QR code decoded:', code.data.substring(0, 80));
        return code.data;
      }
      return null;
    } catch (e) {
      console.error('[PIX] QR decode error:', e);
      return null;
    }
  }, []);

  const copyPixCode = () => {
    const code = gatewayResult?.pix_copy_paste || pixCopyDecoded;
    if (code) {
      navigator.clipboard.writeText(code);
    }
  };

  useEffect(() => {
    if (gatewayResult?.pix_copy_paste || !gatewayResult) { setPixCopyDecoded(null); return; }
    if (pixCopyDecoded) return;
    const qrData = gatewayResult.pix_qrcode || gatewayResult.pix_qrcode_url;
    if (!qrData) return;
    let cancelled = false;
    (async () => {
      const decoded = await decodePixQrCode(qrData);
      if (!cancelled && decoded) setPixCopyDecoded(decoded);
    })();
    return () => { cancelled = true; };
  }, [gatewayResult, pixCopyDecoded, decodePixQrCode]);

  const handleManualVerify = async () => {
    if (manualVerifyRef.current === 'running') return;
    manualVerifyRef.current = 'running';
    setVerifying(true);
    setError('');
    stopElapsedTimer();
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const txId = paymentTxRef.current || gatewayResult?.transaction_id;
      if (!accessToken || !txId) throw new Error('Dados inválidos');

      const pt = paymentTypeRef.current || 'subscription';
      const billingCycle = selectedCycle || null;
      const customDays = daysForCycle(selectedCycle, group) || null;
      const customMonths = selectedCycle === 'custom' ? (group.custom_cycle_months || null) : null;

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-iopay-tx`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          transaction_id: txId,
          group_id: details.group.id,
          user_id: user.id,
          payment_type: pt,
          billing_cycle: billingCycle,
          custom_cycle_days: customDays,
          custom_cycle_months: customMonths,
        }),
      });

      let txResult;
      try {
        txResult = await resp.json();
      } catch (parseErr) {
        throw new Error('Resposta inválida do servidor');
      }
      console.log('[Checkout] Manual verify result:', txResult);

      if (txResult.confirmed) {
        setPollingTimedOut(false);
        const amount = pt === 'entrance' ? Number(group.entrance_fee) : 
                       pt === 'combined' ? Number(group.entrance_fee) + Number(group.price_per_slot) : Number(group.price_per_slot);
        handlePaymentSuccess(pt, amount);
        return;
      }

      if (txResult.confirm_error) {
        setError(`Erro ao confirmar pagamento: ${txResult.confirm_error}. Clique em "Verificar" novamente.`);
        return;
      }

      if (txResult.status === 'failed' || txResult.status === 'cancelled') {
        setError('Pagamento não foi aprovado pelo gateway.');
        return;
      }

      setError('Pagamento ainda não confirmado. Verifique se o pagamento foi realizado e tente novamente.');
    } catch (e) {
      console.error('[Checkout] Manual verify error:', e);
      setError('Erro ao verificar pagamento. Tente novamente.');
    } finally {
      manualVerifyRef.current = null;
      setVerifying(false);
    }
  };

  const handleManualVerifyRef = useRef(null);
  handleManualVerifyRef.current = handleManualVerify;

  // Loading state
  if (details === undefined) {
    return (
      <div className="fade-in checkout-page">
        <div className="loading-state">
          <Loader2 size={32} className="spin" />
          <p>Carregando grupo...</p>
        </div>
      </div>
    );
  }

  // Not found
  if (!details) {
    return (
      <div className="fade-in checkout-page">
        <div className="empty-checkout">
          <h2>Grupo não encontrado</h2>
          <Link to="/dashboard/catalog" className="btn btn-primary">Voltar ao Catálogo</Link>
        </div>
      </div>
    );
  }

  const { group, service, spots } = details;
  const hasEntranceFee = group.has_entrance_fee && Number(group.entrance_fee || 0) > 0;
  const entranceAmount = hasEntranceFee ? Number(group.entrance_fee) : 0;
  const availableCycles = group.available_cycles?.length
    ? group.available_cycles
    : [group.billing_cycle || 'monthly'];
  const defaultCycle = group.billing_cycle || availableCycles[0];
  const validSelectedCycle = availableCycles.includes(selectedCycle) ? selectedCycle : defaultCycle;
  const cycleMonths = monthsForCycle(validSelectedCycle, group);
  const subscriptionAmount = Number(group.price_per_slot) * cycleMonths;

  const finalEntranceAmount = couponResult?.valid && couponResult.original_amount === entranceAmount
    ? couponResult.final_amount
    : entranceAmount;
  const finalSubscriptionAmount = couponResult?.valid && couponResult.original_amount === subscriptionAmount
    ? couponResult.final_amount
    : subscriptionAmount;

  const renderCouponInput = (paymentType, amount) => (
    <div className="coupon-checkout-section">
      {testimonialRewardNotice && !couponResult && (
        <div className="testimonial-reward-notice">
          <span>🎉 Desconto de avaliação aplicado!</span>
          <span className="reward-amount">R$ {testimonialRewardNotice.discount_value.toFixed(2).replace('.', ',')}</span>
        </div>
      )}
      {!couponResult ? (
        <div className="coupon-input-row">
          <Tag size={14} />
          <input
            type="text"
            placeholder="Cupom de desconto"
            value={couponCode}
            onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponError(''); setCouponResult(null); setTestimonialRewardNotice(null); }}
            maxLength={30}
          />
          <button
            type="button"
            className="coupon-apply-btn"
            onClick={() => handleValidateCoupon(paymentType, amount)}
            disabled={validatingCoupon || couponCode.length < 3}
          >
            {validatingCoupon ? <Loader2 size={14} className="spinning" /> : 'Aplicar'}
          </button>
        </div>
      ) : (
        <div className="coupon-applied">
          <Tag size={14} />
          <span className="coupon-applied-code">{couponResult.code}</span>
          <span className="coupon-applied-discount">
            -{couponResult.discount_type === 'percentage' ? `${couponResult.discount_value}%` : `R$ ${couponResult.discount_amount.toFixed(2)}`}
          </span>
          <button type="button" className="coupon-remove-btn" onClick={() => { setCouponResult(null); setCouponCode(''); setCouponError(''); }}>
            <X size={14} />
          </button>
        </div>
      )}
      {couponResult?.min_charge_warning && <p className="coupon-min-warning">{couponResult.min_charge_warning}</p>}
      {couponError && <p className="coupon-checkout-error">{couponError}</p>}
    </div>
  );

  // Full group
  if (spots <= 0) {
    return (
      <div className="fade-in checkout-page">
        <div className="empty-checkout">
          <h2>Grupo Cheio</h2>
          <p>Este grupo já atingiu o limite de membros.</p>
          <Link to={`/dashboard/catalog/${service?.slug || service?.id}`} className="btn btn-primary">Ver Outros Grupos</Link>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <div className="fade-in checkout-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ChevronLeft size={18} /> Voltar
        </button>
        <div className="page-header">
          <h1>Finalizar Assinatura</h1>
          <p>Faça login ou crie uma conta para continuar.</p>
        </div>
        <div className="checkout-grid checkout-simple">
          <div className="checkout-summary">
            <h3>Resumo</h3>
            <div className="summary-item summary-service">
              <div className="summary-icon" style={{ backgroundColor: service?.color }}>{service?.icon}</div>
              <div>
                <h4>{service?.full_name}</h4>
                <p>{group.name}{group.plan_type ? ` • ${group.plan_type}` : group.plan_type_custom ? ` • ${group.plan_type_custom}` : ''}</p>
              </div>
            </div>
            {group.rules && (
              <div className="checkout-rules">
                <ScrollText size={18} />
                <div><strong>Regras do grupo</strong><p>{group.rules}</p></div>
              </div>
            )}
            <div className="summary-row"><span>Preço mensal</span><strong>{formatCurrency(group.price_per_slot)}</strong></div>
            {hasEntranceFee && <div className="summary-row entrance-row"><span>Taxa de Adesão (única)</span><strong>{formatCurrency(entranceAmount)}</strong></div>}
            <div className="summary-row summary-total">
              <span>Total primeiro pagamento</span>
              <strong>{formatCurrency(hasEntranceFee ? entranceAmount : subscriptionAmount)}</strong>
            </div>
          </div>
          <div className="checkout-payment checkout-payment-simple">
            <div className="payment-provider">
              <div className="provider-badge"><Shield size={28} /></div>
              <h3>Entre para continuar</h3>
              <p>Faça login ou crie uma conta para finalizar.</p>
            </div>
            <div className="auth-buttons-checkout">
              <Link to={`/login${referralCode ? `?ref=${referralCode}` : ''}`} className="btn btn-primary btn-full">Entrar</Link>
              <Link to={`/register${referralCode ? `?ref=${referralCode}` : ''}`} className="btn btn-outline btn-full">Criar Conta</Link>
            </div>
            <p className="secure-note"><Shield size={14} /> Ambiente criptografado e seguro.</p>
          </div>
        </div>
      </div>
    );
  }

  const entrancePaid = hasEntranceFee && (memberStatus?.payment_status === 'entrance_paid' || memberStatus?.payment_status === 'awaiting_subscription' || memberStatus?.payment_status === 'active');
  const entranceExpired = hasEntranceFee && (memberStatus?.payment_status === 'expired' || memberStatus?.payment_status === 'overdue' || memberStatus?.payment_status === 'cancelled');

  const handleResetPayment = async () => {
    try {
      setProcessing(true);
      setError('');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada. Faça login novamente.');
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ group_id: details.group.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMemberStatus({ payment_status: 'first_attempt', status: 'pending' });
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  // ============================================
  // EXPIRED: Prazo da taxa de entrada expirou
  // ============================================
  if (entranceExpired) {
    return (
      <div className="fade-in checkout-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ChevronLeft size={18} /> Voltar
        </button>
        <div className="page-header">
          <h1>Prazo Expirado</h1>
          <p>O prazo para pagamento da assinatura expirou.</p>
        </div>

        {error && (
          <div className="payment-error-banner" role="alert">
            <AlertTriangle size={18} />
            <div className="error-text">
              <strong>Pagamento não concluído</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        <div className="checkout-grid checkout-simple">
          <div className="checkout-summary">
            <h3>Resumo</h3>
            <div className="summary-item summary-service">
              <div className="summary-icon" style={{ backgroundColor: service?.color }}>{service?.icon}</div>
              <div><h4>{service?.full_name}</h4><p>{group.name}{group.plan_type ? ` • ${group.plan_type}` : group.plan_type_custom ? ` • ${group.plan_type_custom}` : ''}</p></div>
            </div>

            <div className="entrance-fee-highlight" style={{ borderColor: 'var(--error, #ef4444)' }}>
              <div className="entrance-fee-header">
                <span className="entrance-fee-icon" style={{ background: 'var(--error, #ef4444)' }}>!</span>
                <strong>Taxa de Adesão: {formatCurrency(entranceAmount)}</strong>
              </div>
              <p className="entrance-fee-desc">Você pagou a taxa de entrada, mas não completou a assinatura dentro de 12 horas.</p>
            </div>

            <div className="payment-flow-steps">
              <div className="payment-step completed">
                <div className="step-number"><CheckCircle size={16} /></div>
                <span>Taxa de Adesão</span>
              </div>
              <div className="payment-step-line" />
              <div className="payment-step expired">
                <div className="step-number">!</div>
                <span>Assinatura — Expirada</span>
              </div>
            </div>

            <div className="summary-row summary-total">
              <span>Para reiniciar</span>
              <strong>Clique no botão ao lado</strong>
            </div>
          </div>

          <div className="checkout-payment">
            <div className="payment-provider">
              <div className="provider-badge" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>
                <AlertTriangle size={28} style={{ color: 'var(--error, #ef4444)' }} />
              </div>
              <h3>Pagamento Expirado</h3>
              <p>Seu prazo de 12 horas para concluir a assinatura expirou. Clique abaixo para reiniciar o processo de pagamento do zero.</p>
            </div>

            <div className="payment-buttons">
              <button
                className="btn btn-primary btn-full btn-lg"
                onClick={handleResetPayment}
                disabled={processing}
              >
                {processing ? (
                  <><Loader2 size={18} className="spin" /> Reiniciando...</>
                ) : (
                  <><RotateCcw size={18} /> Reiniciar Pagamento</>
                )}
              </button>
            </div>
            <p className="secure-note"><Shield size={14} /> Você pagará novamente a taxa de entrada e terá novo prazo de 12h.</p>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // STEP 1: Mostrar pagamento da taxa de entrada
  // ============================================
  if (hasEntranceFee && !entrancePaid && !entranceExpired) {
    return (
      <div className="fade-in checkout-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ChevronLeft size={18} /> Voltar
        </button>
        <div className="page-header">
          <h1>Passo 1 de 2 — Taxa de Adesão</h1>
          <p>Pagamento único para garantir sua vaga no grupo.</p>
        </div>

        {error && (
          <div className="payment-error-banner" role="alert">
            <AlertTriangle size={18} />
            <div className="error-text">
              <strong>Pagamento não concluído</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        <div className="checkout-grid checkout-simple">
          <div className="checkout-summary">
            <h3>Resumo da Taxa de Adesão</h3>
            <div className="summary-item summary-service">
              <div className="summary-icon" style={{ backgroundColor: service?.color }}>{service?.icon}</div>
              <div><h4>{service?.full_name}</h4><p>{group.name}{group.plan_type ? ` • ${group.plan_type}` : group.plan_type_custom ? ` • ${group.plan_type_custom}` : ''}</p></div>
            </div>

            <div className="entrance-fee-highlight">
              <div className="entrance-fee-header">
                <span className="entrance-fee-icon">!</span>
                <strong>Taxa de Adesão: {formatCurrency(entranceAmount)}</strong>
              </div>
              <p className="entrance-fee-desc">Este valor é cobrado apenas UMA VEZ para garantir sua vaga no grupo.</p>
              <p className="entrance-fee-desc" style={{ marginTop: '0.5rem' }}>Após confirmação, você terá até 12 horas para concluir o pagamento da assinatura mensal.</p>
            </div>

            <div className="adesao-info-box">
              <h4>O que é a Taxa de Adesão?</h4>
              <p>A Taxa de Adesão é um pagamento único cobrado pela plataforma para ingressar neste grupo e concluir sua participação.</p>
              <p>Após a confirmação do pagamento, sua vaga ficará reservada por até 12 horas. Nesse período, você deverá realizar o pagamento da mensalidade da assinatura.</p>
              <ul className="adesao-info-list">
                <li>A Taxa de Adesão é cobrada apenas uma única vez.</li>
                <li>Ela não faz parte da mensalidade da assinatura.</li>
                <li>Caso a mensalidade não seja paga em até 12 horas, sua participação será cancelada e a Taxa de Adesão será reembolsada automaticamente.</li>
                <li>Após concluir a assinatura, essa taxa nunca mais será cobrada para este grupo.</li>
              </ul>
            </div>

            <div className="payment-flow-steps">
              <div className="payment-step active">
                <div className="step-number">1</div>
                <span>Taxa de Adesão</span>
              </div>
              <div className="payment-step-line" />
              <div className="payment-step">
                <div className="step-number">2</div>
                <span>Assinatura Mensal</span>
              </div>
            </div>

            {renderCouponInput('entrance', entranceAmount)}

            <div className="summary-row summary-total">
              <span>Total agora</span>
              <strong>
                {couponResult?.valid && couponResult.original_amount === entranceAmount ? (
                  <>
                    <span className="original-price">{formatCurrency(entranceAmount)}</span>
                    {' '}
                    <span className="discounted-price">{formatCurrency(finalEntranceAmount)}</span>
                  </>
                ) : formatCurrency(entranceAmount)}
              </strong>
            </div>
          </div>

          <div className="checkout-payment">
            {gatewayResult?.gateway && (gatewayResult?.pix_copy_paste || gatewayResult?.pix_qrcode_url || gatewayResult?.pix_qrcode) ? (
              <div className="iopay-pix-result">
                {gatewayResult.pix_qrcode && (
                  <img src={`data:image/png;base64,${gatewayResult.pix_qrcode}`} alt="QR Code PIX" className="pix-qrcode" />
                )}
                {!gatewayResult.pix_qrcode && gatewayResult.pix_qrcode_url && (
                  <img src={gatewayResult.pix_qrcode_url} alt="QR Code PIX" className="pix-qrcode" />
                )}
                {!gatewayResult.pix_qrcode && !gatewayResult.pix_qrcode_url && <QrCode size={48} style={{ margin: '0 auto 1rem', color: 'var(--primary)' }} />}
                <h3>Pague via PIX</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  Escaneie o QR Code acima ou copie o código abaixo
                </p>
                {gatewayResult.pix_copy_paste || pixCopyDecoded ? (
                  <>
                    <div className="pix-copy-paste">
                      {gatewayResult.pix_copy_paste || pixCopyDecoded}
                    </div>
                    <button className="btn btn-outline btn-full" onClick={copyPixCode} style={{ marginBottom: '1rem' }}>
                      <Copy size={14} /> Copiar Código PIX
                    </button>
                  </>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                    Código PIX será exibido em breve...
                  </p>
                )}
                {gatewayWaiting && (
                  <div className="pix-waiting">
                    <Loader2 size={16} className="spin" /> Aguardando confirmação do pagamento...
                    <p style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                    Verificando a cada 10 segundos{pollingElapsed >= 60 ? ` • ${(pollingElapsed / 60).toFixed(0)} min` : ` • ${pollingElapsed}s`}
                    </p>
                    {pollingElapsed >= 30 && (
                      <button className="btn btn-primary btn-full" style={{ marginTop: '0.75rem' }} onClick={handleManualVerify} disabled={verifying}>
                        {verifying ? (<><Loader2 size={16} className="spin" /> Verificando...</>) : (<>Já paguei — Verificar Agora</>)}
                      </button>
                    )}
                  </div>
                )}
                {pollingTimedOut && (
                  <div className="pix-waiting">
                    <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>
                      A verificação automática não detectou o pagamento. Verifique manualmente ou gere um novo QR Code.
                    </p>
                    <button className="btn btn-primary btn-full" onClick={handleManualVerify} disabled={verifying}>
                      {verifying ? (<><Loader2 size={16} className="spin" /> Verificando...</>) : (<>Verificar Pagamento Novamente</>)}
                    </button>
                    <button className="btn btn-outline btn-full" style={{ marginTop: '0.5rem' }} onClick={() => window.location.reload()}>
                      Gerar Novo QR Code
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="payment-provider">
                  <div className="provider-badge"><CreditCard size={28} /></div>
                  <h3>Pagar Taxa de Adesão</h3>
                  <p>Pagamento único via {GATEWAY_NAMES[activeGateway] || activeGateway}. Após confirmação, avance para a assinatura.</p>
                </div>

                {gatewayResult?.needs_polling && gatewayWaiting ? (
                  <div className="iopay-processing">
                    <div className="processing-animation">
                      <Loader2 size={48} className="spin" />
                    </div>
                    <h3>Processando Pagamento</h3>
                    <p>Seu pagamento está sendo processado. Aguarde a confirmação...</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                      Verificando a cada 3 segundos{pollingElapsed >= 60 ? ` • ${(pollingElapsed / 60).toFixed(0)} min` : ` • ${pollingElapsed}s`}
                    </p>
                    {pollingElapsed >= 30 && (
                      <div style={{ marginTop: '1rem' }}>
                        <button className="btn btn-primary btn-full" onClick={handleManualVerify} disabled={verifying}>
                          {verifying ? (<><Loader2 size={16} className="spin" /> Verificando...</>) : (<>Já paguei — Verificar Agora</>)}
                        </button>
                      </div>
                    )}
                  </div>
                ) : GATEWAYS_REDIRECT.includes(activeGateway) ? (
                  <div className="payment-buttons">
                    <button className="btn btn-primary btn-full btn-lg" onClick={() => handleEntrancePayment()} disabled={processing}>
                      {processing ? (<><Loader2 size={18} className="spin" /> Redirecionando...</>) : (<>Pagar com {GATEWAY_NAMES[activeGateway]} — {formatCurrency(finalEntranceAmount)}</>)}
                    </button>
                    {paymentAttempted && (
                      <button className="btn btn-verify btn-full" onClick={handleCheckPayment} disabled={checking}>
                        {checking ? (<><Loader2 size={16} className="spin" /> Verificando...</>) : 'Já paguei — Verificar Pagamento'}
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {GATEWAYS_WITH_PIX.includes(activeGateway) && (
                      <div className="iopay-method-selector">
                        <button
                          type="button"
                          className={`iopay-method-btn ${paymentMethod === 'card' ? 'active' : ''}`}
                          onClick={() => setPaymentMethod('card')}
                        >
                          <CreditCard size={16} /> Cartão
                        </button>
                        <button
                          type="button"
                          className={`iopay-method-btn ${paymentMethod === 'pix' ? 'active' : ''}`}
                          onClick={() => { setPaymentMethod('pix'); setGatewayResult(null); setError(''); }}
                        >
                          <QrCode size={16} /> PIX
                        </button>
                      </div>
                    )}

                    {GATEWAYS_WITH_CARD_FORM.includes(activeGateway) && paymentMethod === 'card' ? (
                      savedCards.length > 0 && !showAddCard ? (
                        <div className="saved-cards-section">
                          <p className="saved-cards-title">Cartões salvos</p>
                          {savedCards.map((card) => (
                            <div key={card.id_card || card.id} className="saved-card-row">
                              <span className="saved-card-info">
                                <CreditCard size={16} />
                                <span className="saved-card-number">•••• {revealedCards[card.id_card] ? getCardLast4(card) : '????'}</span>
                                <span className="saved-card-brand">{getCardBrand(card)}</span>
                                <button className="card-reveal-btn" onClick={() => setRevealedCards(prev => ({ ...prev, [card.id_card]: !prev[card.id_card] }))} title={revealedCards[card.id_card] ? 'Ocultar dígitos' : 'Mostrar últimos 4 dígitos'}>
                                  {revealedCards[card.id_card] ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              </span>
                              <button className="btn btn-primary btn-sm" onClick={() => handleEntrancePayment(null, card.id_card || card.id)} disabled={processing}>
                                Pagar com este!
                              </button>
                            </div>
                          ))}
                          <button className="btn btn-ghost btn-sm add-card-toggle" onClick={() => setShowAddCard(true)}>
                            <Plus size={14} /> Novo cartão
                          </button>
                        </div>
                      ) : (
                        <>
                          {savedCards.length > 0 && (
                            <button className="btn btn-ghost btn-sm add-card-toggle" onClick={() => setShowAddCard(false)} style={{ marginBottom: '0.75rem' }}>
                              <ChevronLeft size={14} /> Usar cartão salvo
                            </button>
                          )}
                          <IOPayCardForm
                            amount={entranceAmount}
                            onCardDataReady={(data) => handleEntrancePayment(data)}
                            onError={setError}
                            disabled={processing}
                            resetKey={cardFormResetKey}
                          />
                        </>
                      )
                    ) : (
                      <div className="payment-buttons">
                        <button className="btn btn-primary btn-full btn-lg" onClick={() => handleEntrancePayment()} disabled={processing}>
                          {processing ? (<><Loader2 size={18} className="spin" /> Processando...</>) : (<><CreditCard size={18} /> Pagar {formatCurrency(finalEntranceAmount)}</>)}
                        </button>
                        {paymentAttempted && (
                          <button className="btn btn-verify btn-full" onClick={handleCheckPayment} disabled={checking}>
                            {checking ? (<><Loader2 size={16} className="spin" /> Verificando...</>) : 'Já paguei — Verificar Pagamento'}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            <p className="secure-note"><Shield size={14} /> Pagamento seguro</p>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // STEP 1.5: Entrada paga, aguardando assinatura
  // ============================================
  if (hasEntranceFee && memberStatus?.payment_status === 'entrance_paid') {
    const deadline = new Date(memberStatus.subscription_deadline);
    const now = new Date();
    const hoursLeft = Math.max(0, (deadline - now) / (1000 * 60 * 60));

    return (
      <div className="fade-in checkout-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ChevronLeft size={18} /> Voltar
        </button>
        <div className="page-header">
          <h1>Passo 2 de 2 — Assinatura Mensal</h1>
          <p>Taxa de Adesão confirmada! Agora pague a assinatura para liberar o acesso.</p>
        </div>

        {error && (
          <div className="payment-error-banner" role="alert">
            <AlertTriangle size={18} />
            <div className="error-text">
              <strong>Pagamento não concluído</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        <div className="checkout-grid checkout-simple">
          <div className="checkout-summary">
            <h3>Resumo da Assinatura</h3>

            <div className="entrance-paid-badge">
              <CheckCircle size={18} />
              <span>Taxa de Adesão paga: {formatCurrency(entranceAmount)}</span>
            </div>

            <div className="deadline-warning">
              <Clock size={18} />
              <div>
                <strong>Prazo: {Math.floor(hoursLeft)}h {Math.floor((hoursLeft % 1) * 60)}min restantes</strong>
                <p>Complete o pagamento da assinatura antes do prazo para garantir sua vaga.</p>
              </div>
            </div>

            <div className="payment-flow-steps">
              <div className="payment-step completed">
                <div className="step-number"><CheckCircle size={16} /></div>
                <span>Taxa de Adesão</span>
              </div>
              <div className="payment-step-line completed" />
              <div className="payment-step active">
                <div className="step-number">2</div>
                <span>Assinatura Mensal</span>
              </div>
            </div>

            <div className="summary-row"><span>Preço mensal</span><strong>{formatCurrency(group.price_per_slot)}</strong></div>
            {validSelectedCycle !== 'monthly' && (
              <div className="summary-row"><span>Ciclo</span><strong>{getCycleLabel(validSelectedCycle, group)}</strong></div>
            )}

            {renderCouponInput('subscription', subscriptionAmount)}

            <div className="summary-row summary-total">
              <span>Total agora</span>
              <strong>
                {couponResult?.valid && couponResult.original_amount === subscriptionAmount ? (
                  <>
                    <span className="original-price">{formatCurrency(subscriptionAmount)}</span>
                    {' '}
                    <span className="discounted-price">{formatCurrency(finalSubscriptionAmount)}</span>
                  </>
                ) : formatCurrency(subscriptionAmount)}
              </strong>
            </div>
          </div>

          <div className="checkout-payment">
            {gatewayResult?.gateway && (gatewayResult?.pix_copy_paste || gatewayResult?.pix_qrcode_url || gatewayResult?.pix_qrcode) ? (
              <div className="iopay-pix-result">
                {gatewayResult.pix_qrcode && (
                  <img src={`data:image/png;base64,${gatewayResult.pix_qrcode}`} alt="QR Code PIX" className="pix-qrcode" />
                )}
                {!gatewayResult.pix_qrcode && gatewayResult.pix_qrcode_url && (
                  <img src={gatewayResult.pix_qrcode_url} alt="QR Code PIX" className="pix-qrcode" />
                )}
                {!gatewayResult.pix_qrcode && !gatewayResult.pix_qrcode_url && <QrCode size={48} style={{ margin: '0 auto 1rem', color: 'var(--primary)' }} />}
                <h3>Pague via PIX</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  Escaneie o QR Code acima ou copie o código abaixo
                </p>
                {gatewayResult.pix_copy_paste || pixCopyDecoded ? (
                  <>
                    <div className="pix-copy-paste">
                      {gatewayResult.pix_copy_paste || pixCopyDecoded}
                    </div>
                    <button className="btn btn-outline btn-full" onClick={copyPixCode} style={{ marginBottom: '1rem' }}>
                      <Copy size={14} /> Copiar Código PIX
                    </button>
                  </>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                    Código PIX será exibido em breve...
                  </p>
                )}
                {gatewayWaiting && (
                  <div className="pix-waiting">
                    <Loader2 size={16} className="spin" /> Aguardando confirmação do pagamento...
                    <p style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                      Verificando a cada 30 segundos{pollingElapsed >= 60 ? ` • ${(pollingElapsed / 60).toFixed(0)} min` : ` • ${pollingElapsed}s`}
                    </p>
                    {pollingElapsed >= 30 && (
                      <button className="btn btn-primary btn-full" style={{ marginTop: '0.75rem' }} onClick={handleManualVerify} disabled={verifying}>
                        {verifying ? (<><Loader2 size={16} className="spin" /> Verificando...</>) : (<>Já paguei — Verificar Agora</>)}
                      </button>
                    )}
                  </div>
                )}
                {pollingTimedOut && (
                  <div className="pix-waiting">
                    <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>
                      A verificação automática não detectou o pagamento. Verifique manualmente ou gere um novo QR Code.
                    </p>
                    <button className="btn btn-primary btn-full" onClick={handleManualVerify} disabled={verifying}>
                      {verifying ? (<><Loader2 size={16} className="spin" /> Verificando...</>) : (<>Verificar Pagamento Novamente</>)}
                    </button>
                    <button className="btn btn-outline btn-full" style={{ marginTop: '0.5rem' }} onClick={() => window.location.reload()}>
                      Gerar Novo QR Code
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="payment-provider">
                  <div className="provider-badge"><CreditCard size={28} /></div>
                  <h3>Pagar Assinatura</h3>
                  <p>Pagamento recorrente mensal via {GATEWAY_NAMES[activeGateway] || activeGateway}.</p>
                </div>

                {gatewayResult?.needs_polling && gatewayWaiting ? (
                  <div className="iopay-processing">
                    <div className="processing-animation">
                      <Loader2 size={48} className="spin" />
                    </div>
                    <h3>Processando Pagamento</h3>
                    <p>Seu pagamento está sendo processado. Aguarde a confirmação...</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                      Verificando a cada 3 segundos{pollingElapsed >= 60 ? ` • ${(pollingElapsed / 60).toFixed(0)} min` : ` • ${pollingElapsed}s`}
                    </p>
                    {pollingElapsed >= 30 && (
                      <div style={{ marginTop: '1rem' }}>
                        <button className="btn btn-primary btn-full" onClick={handleManualVerify} disabled={verifying}>
                          {verifying ? (<><Loader2 size={16} className="spin" /> Verificando...</>) : (<>Já paguei — Verificar Agora</>)}
                        </button>
                      </div>
                    )}
                  </div>
                ) : GATEWAYS_REDIRECT.includes(activeGateway) ? (
                  <div className="payment-buttons">
                    <button className="btn btn-primary btn-full btn-lg" onClick={() => handleSubscriptionPayment()} disabled={processing}>
                      {processing ? (<><Loader2 size={18} className="spin" /> Redirecionando...</>) : (<>Pagar com {GATEWAY_NAMES[activeGateway]} — {formatCurrency(finalSubscriptionAmount)}</>)}
                    </button>
                    {couponResult?.valid && couponResult.original_amount === subscriptionAmount && (
                      <div className="checkout-payment-info">
                        {couponResult.recurring ? (
                          <p className="checkout-info-text">Valor com desconto aplicado. Sua assinatura será <strong>{formatCurrency(finalSubscriptionAmount)}</strong> por ciclo até o vencimento do cupom.</p>
                        ) : (
                          <p className="checkout-info-text">Desconto aplicado apenas neste pagamento. Nos próximos ciclos, a cobrança será de <strong>{formatCurrency(subscriptionAmount)}</strong>.</p>
                        )}
                        <p className="checkout-info-text">Próxima cobrança: <strong>{getNextBillingDate(validSelectedCycle, group)}</strong></p>
                      </div>
                    )}
                    {!couponResult?.valid && (
                      <div className="checkout-payment-info">
                        <p className="checkout-info-text">Próxima cobrança: <strong>{getNextBillingDate(validSelectedCycle, group)}</strong></p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {activeGateway === 'iopay' && (
                      <div className="iopay-method-selector">
                        <button
                          type="button"
                          className={`iopay-method-btn ${paymentMethod === 'card' ? 'active' : ''}`}
                          onClick={() => setPaymentMethod('card')}
                        >
                          <CreditCard size={16} /> Cartão
                        </button>
                        {GATEWAYS_WITH_PIX.includes(activeGateway) && (
                          <button
                            type="button"
                            className={`iopay-method-btn ${paymentMethod === 'pix' ? 'active' : ''}`}
                            onClick={() => { setPaymentMethod('pix'); setGatewayResult(null); setError(''); }}
                          >
                            <QrCode size={16} /> PIX
                          </button>
                        )}
                      </div>
                    )}
                    {activeGateway === 'iopay' && paymentMethod === 'pix' && (
                      <p className="iopay-method-note" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                        PIX gera fatura para pagamento manual. Sem cobrança automática.
                      </p>
                    )}

                    {GATEWAYS_WITH_CARD_FORM.includes(activeGateway) && paymentMethod === 'card' ? (
                      savedCards.length > 0 && !showAddCard ? (
                        <div className="saved-cards-section">
                          <p className="saved-cards-title">Cartões salvos</p>
                          {savedCards.map((card) => (
                            <div key={card.id_card || card.id} className="saved-card-row">
                              <span className="saved-card-info">
                                <CreditCard size={16} />
                                <span className="saved-card-number">•••• {revealedCards[card.id_card] ? getCardLast4(card) : '????'}</span>
                                <span className="saved-card-brand">{getCardBrand(card)}</span>
                                <button className="card-reveal-btn" onClick={() => setRevealedCards(prev => ({ ...prev, [card.id_card]: !prev[card.id_card] }))} title={revealedCards[card.id_card] ? 'Ocultar dígitos' : 'Mostrar últimos 4 dígitos'}>
                                  {revealedCards[card.id_card] ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              </span>
                              <button className="btn btn-primary btn-sm" onClick={() => handleSubscriptionPayment(null, card.id_card || card.id)} disabled={processing}>
                                Pagar com este!
                              </button>
                            </div>
                          ))}
                          <button className="btn btn-ghost btn-sm add-card-toggle" onClick={() => setShowAddCard(true)}>
                            <Plus size={14} /> Novo cartão
                          </button>
                        </div>
                      ) : (
                        <>
                          {savedCards.length > 0 && (
                            <button className="btn btn-ghost btn-sm add-card-toggle" onClick={() => setShowAddCard(false)} style={{ marginBottom: '0.75rem' }}>
                              <ChevronLeft size={14} /> Usar cartão salvo
                            </button>
                          )}
                          <IOPayCardForm
                            amount={subscriptionAmount}
                            onCardDataReady={(token) => handleSubscriptionPayment(token)}
                            onError={setError}
                            disabled={processing}
                            resetKey={cardFormResetKey}
                          />
                        </>
                      )
                    ) : (
                      <div className="payment-buttons">
                        <button className="btn btn-primary btn-full btn-lg" onClick={() => handleSubscriptionPayment()} disabled={processing}>
                          {processing ? (<><Loader2 size={18} className="spin" /> Processando...</>) : (
                            paymentMethod === 'pix'
                              ? (<><QrCode size={18} /> Gerar PIX — {formatCurrency(finalSubscriptionAmount)}</>)
                              : (<><CreditCard size={18} /> Pagar {formatCurrency(finalSubscriptionAmount)}</>)
                          )}
                        </button>
                        {couponResult?.valid && couponResult.original_amount === subscriptionAmount && (
                          <div className="checkout-payment-info">
                            {couponResult.recurring ? (
                              <p className="checkout-info-text">Valor com desconto aplicado. Sua assinatura será <strong>{formatCurrency(finalSubscriptionAmount)}</strong> por ciclo até o vencimento do cupom.</p>
                            ) : (
                              <p className="checkout-info-text">Desconto aplicado apenas neste pagamento. Nos próximos ciclos, a cobrança será de <strong>{formatCurrency(subscriptionAmount)}</strong>.</p>
                            )}
                            <p className="checkout-info-text">Próxima cobrança: <strong>{getNextBillingDate(validSelectedCycle, group)}</strong></p>
                          </div>
                        )}
                        {!couponResult?.valid && (
                          <div className="checkout-payment-info">
                            <p className="checkout-info-text">Próxima cobrança: <strong>{getNextBillingDate(validSelectedCycle, group)}</strong></p>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            <p className="secure-note"><Shield size={14} /> Pagamento seguro</p>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // FLUXO SEM TAXA DE ENTRADA (direto à assinatura)
  // ============================================
  return (
    <div className="fade-in checkout-page">
      <button onClick={() => navigate(-1)} className="back-btn">
        <ChevronLeft size={18} /> Voltar
      </button>
      <div className="page-header">
        <h1>Finalizar Assinatura</h1>
        <p>Revise os dados e siga para o pagamento seguro.</p>
      </div>

      {error && (
        <div className="payment-error-banner" role="alert">
          <AlertTriangle size={18} />
          <div className="error-text">
            <strong>Pagamento não concluído</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <div className="checkout-grid checkout-simple">
        <div className="checkout-summary">
          <h3>Resumo da Assinatura</h3>
          <div className="summary-item summary-service">
            <div className="summary-icon" style={{ backgroundColor: service?.color }}>{service?.icon}</div>
            <div><h4>{service?.full_name}</h4><p>{group.name}{group.plan_type ? ` • ${group.plan_type}` : group.plan_type_custom ? ` • ${group.plan_type_custom}` : ''}</p></div>
          </div>

          {group.rules && (
            <div className="checkout-rules">
              <ScrollText size={18} />
              <div><strong>Regras do grupo</strong><p>{group.rules}</p></div>
            </div>
          )}

          <div className="summary-row"><span>Preço mensal</span><strong>{formatCurrency(group.price_per_slot)}</strong></div>
          <div className="summary-row"><span>Ciclo</span><strong>{getCycleLabel(validSelectedCycle, group)}</strong></div>
          <div className="summary-row"><span>Total do ciclo</span><strong>{formatCurrency(subscriptionAmount)}</strong></div>
          <div className="summary-row"><span>Vagas restantes</span><strong>{spots === Infinity ? 'Ilimitadas' : `${spots} ${spots === 1 ? 'vaga' : 'vagas'}`}</strong></div>

          {renderCouponInput('subscription', subscriptionAmount)}

          <div className="summary-row summary-total">
            <span>Total a pagar</span>
            <strong>
              {couponResult?.valid && couponResult.original_amount === subscriptionAmount ? (
                <>
                  <span className="original-price">{formatCurrency(subscriptionAmount)}</span>
                  {' '}
                  <span className="discounted-price">{formatCurrency(finalSubscriptionAmount)}</span>
                </>
              ) : formatCurrency(subscriptionAmount)}
            </strong>
          </div>
        </div>

          <div className="checkout-payment">
            {gatewayResult?.gateway && (gatewayResult?.pix_copy_paste || gatewayResult?.pix_qrcode_url || gatewayResult?.pix_qrcode) ? (
              <div className="iopay-pix-result">
                {gatewayResult.pix_qrcode && (
                  <img src={`data:image/png;base64,${gatewayResult.pix_qrcode}`} alt="QR Code PIX" className="pix-qrcode" />
                )}
                {!gatewayResult.pix_qrcode && gatewayResult.pix_qrcode_url && (
                  <img src={gatewayResult.pix_qrcode_url} alt="QR Code PIX" className="pix-qrcode" />
                )}
                {!gatewayResult.pix_qrcode && !gatewayResult.pix_qrcode_url && <QrCode size={48} style={{ margin: '0 auto 1rem', color: 'var(--primary)' }} />}
                <h3>Pague via PIX</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  Escaneie o QR Code acima ou copie o código abaixo
                </p>
                {gatewayResult.pix_copy_paste || pixCopyDecoded ? (
                  <>
                    <div className="pix-copy-paste">
                      {gatewayResult.pix_copy_paste || pixCopyDecoded}
                    </div>
                    <button className="btn btn-outline btn-full" onClick={copyPixCode} style={{ marginBottom: '1rem' }}>
                      <Copy size={14} /> Copiar Código PIX
                    </button>
                  </>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                    Código PIX será exibido em breve...
                  </p>
                )}
                {gatewayWaiting && (
                  <div className="pix-waiting">
                    <Loader2 size={16} className="spin" /> Aguardando confirmação do pagamento...
                    <p style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                      Verificando a cada 30 segundos{pollingElapsed >= 60 ? ` • ${(pollingElapsed / 60).toFixed(0)} min` : ` • ${pollingElapsed}s`}
                    </p>
                    {pollingElapsed >= 30 && (
                      <button className="btn btn-primary btn-full" style={{ marginTop: '0.75rem' }} onClick={handleManualVerify} disabled={verifying}>
                        {verifying ? (<><Loader2 size={16} className="spin" /> Verificando...</>) : (<>Já paguei — Verificar Agora</>)}
                      </button>
                    )}
                  </div>
                )}
                {pollingTimedOut && (
                  <div className="pix-waiting">
                    <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>
                      A verificação automática não detectou o pagamento. Verifique manualmente ou gere um novo QR Code.
                    </p>
                    <button className="btn btn-primary btn-full" onClick={handleManualVerify} disabled={verifying}>
                      {verifying ? (<><Loader2 size={16} className="spin" /> Verificando...</>) : (<>Verificar Pagamento Novamente</>)}
                    </button>
                    <button className="btn btn-outline btn-full" style={{ marginTop: '0.5rem' }} onClick={() => window.location.reload()}>
                      Gerar Novo QR Code
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="payment-provider">
                  <div className="provider-badge"><CreditCard size={28} /></div>
                  <h3>Pagar Assinatura</h3>
                  <p>Pagamento recorrente mensal via {GATEWAY_NAMES[activeGateway] || activeGateway}.</p>
                </div>

                {availableCycles.length > 1 && (
                  <div className="cycle-selector">
                    <label>Ciclo de cobrança</label>
                    <div className="cycle-options">
                      {availableCycles.map(key => {
                        const label = getCycleLabel(key, group);
                        return (
                            <button key={key} type="button" className={`cycle-option ${validSelectedCycle === key ? 'selected' : ''}`} onClick={() => setSelectedCycleState(key)}>
                              <span className="cycle-label">{label}</span>
                            </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {GATEWAYS_REDIRECT.includes(activeGateway) ? (
                  <div className="payment-buttons">
                    <button className="btn btn-primary btn-full btn-lg" onClick={() => handleSubscriptionPayment()} disabled={processing}>
                      {processing ? (<><Loader2 size={18} className="spin" /> Redirecionando...</>) : (<>Pagar com {GATEWAY_NAMES[activeGateway]} — {formatCurrency(finalSubscriptionAmount)}</>)}
                    </button>
                    {couponResult?.valid && couponResult.original_amount === subscriptionAmount && (
                      <div className="checkout-payment-info">
                        {couponResult.recurring ? (
                          <p className="checkout-info-text">Valor com desconto aplicado. Sua assinatura será <strong>{formatCurrency(finalSubscriptionAmount)}</strong> por ciclo até o vencimento do cupom.</p>
                        ) : (
                          <p className="checkout-info-text">Desconto aplicado apenas neste pagamento. Nos próximos ciclos, a cobrança será de <strong>{formatCurrency(subscriptionAmount)}</strong>.</p>
                        )}
                        <p className="checkout-info-text">Próxima cobrança: <strong>{getNextBillingDate(validSelectedCycle, group)}</strong></p>
                      </div>
                    )}
                    {!couponResult?.valid && (
                      <div className="checkout-payment-info">
                        <p className="checkout-info-text">Próxima cobrança: <strong>{getNextBillingDate(validSelectedCycle, group)}</strong></p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {activeGateway === 'iopay' && (
                      <div className="iopay-method-selector">
                        <button
                          type="button"
                          className={`iopay-method-btn ${paymentMethod === 'card' ? 'active' : ''}`}
                          onClick={() => setPaymentMethod('card')}
                        >
                          <CreditCard size={16} /> Cartão
                        </button>
                        {GATEWAYS_WITH_PIX.includes(activeGateway) && (
                          <button
                            type="button"
                            className={`iopay-method-btn ${paymentMethod === 'pix' ? 'active' : ''}`}
                            onClick={() => { setPaymentMethod('pix'); setGatewayResult(null); setError(''); }}
                          >
                            <QrCode size={16} /> PIX
                          </button>
                        )}
                      </div>
                    )}
                    {activeGateway === 'iopay' && paymentMethod === 'pix' && (
                      <p className="iopay-method-note" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                        PIX gera fatura para pagamento manual. Sem cobrança automática.
                      </p>
                    )}

                    {GATEWAYS_WITH_CARD_FORM.includes(activeGateway) && paymentMethod === 'card' ? (
                      savedCards.length > 0 && !showAddCard ? (
                        <div className="saved-cards-section">
                          <p className="saved-cards-title">Cartões salvos</p>
                          {savedCards.map((card) => (
                            <div key={card.id_card || card.id} className="saved-card-row">
                              <span className="saved-card-info">
                                <CreditCard size={16} />
                                <span className="saved-card-number">•••• {revealedCards[card.id_card] ? getCardLast4(card) : '????'}</span>
                                <span className="saved-card-brand">{getCardBrand(card)}</span>
                                <button className="card-reveal-btn" onClick={() => setRevealedCards(prev => ({ ...prev, [card.id_card]: !prev[card.id_card] }))} title={revealedCards[card.id_card] ? 'Ocultar dígitos' : 'Mostrar últimos 4 dígitos'}>
                                  {revealedCards[card.id_card] ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              </span>
                              <button className="btn btn-primary btn-sm" onClick={() => handleSubscriptionPayment(null, card.id_card || card.id)} disabled={processing}>
                                Pagar com este!
                              </button>
                            </div>
                          ))}
                          <button className="btn btn-ghost btn-sm add-card-toggle" onClick={() => setShowAddCard(true)}>
                            <Plus size={14} /> Novo cartão
                          </button>
                        </div>
                      ) : (
                        <>
                          {savedCards.length > 0 && (
                            <button className="btn btn-ghost btn-sm add-card-toggle" onClick={() => setShowAddCard(false)} style={{ marginBottom: '0.75rem' }}>
                              <ChevronLeft size={14} /> Usar cartão salvo
                            </button>
                          )}
                          <IOPayCardForm
                            amount={subscriptionAmount}
                            onCardDataReady={(data) => handleSubscriptionPayment(data)}
                            onError={setError}
                            disabled={processing}
                            resetKey={cardFormResetKey}
                          />
                        </>
                      )
                    ) : (
                      <div className="payment-buttons">
                        <button className="btn btn-primary btn-full btn-lg" onClick={() => handleSubscriptionPayment()} disabled={processing}>
                          {processing ? (<><Loader2 size={18} className="spin" /> Processando...</>) : (
                            paymentMethod === 'pix'
                              ? (<><QrCode size={18} /> Gerar PIX — {formatCurrency(finalSubscriptionAmount)}</>)
                              : (<><CreditCard size={18} /> Pagar {formatCurrency(finalSubscriptionAmount)}</>)
                          )}
                        </button>
                        {couponResult?.valid && couponResult.original_amount === subscriptionAmount && (
                          <div className="checkout-payment-info">
                            {couponResult.recurring ? (
                              <p className="checkout-info-text">Valor com desconto aplicado. Sua assinatura será <strong>{formatCurrency(finalSubscriptionAmount)}</strong> por ciclo até o vencimento do cupom.</p>
                            ) : (
                              <p className="checkout-info-text">Desconto aplicado apenas neste pagamento. Nos próximos ciclos, a cobrança será de <strong>{formatCurrency(subscriptionAmount)}</strong>.</p>
                            )}
                            <p className="checkout-info-text">Próxima cobrança: <strong>{getNextBillingDate(validSelectedCycle, group)}</strong></p>
                          </div>
                        )}
                        {!couponResult?.valid && (
                          <div className="checkout-payment-info">
                            <p className="checkout-info-text">Próxima cobrança: <strong>{getNextBillingDate(validSelectedCycle, group)}</strong></p>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            <p className="secure-note"><Shield size={14} /> Pagamento seguro</p>
        </div>
      </div>

      {paymentSuccess && (
        <div className="payment-success-overlay">
          <div className="payment-success-card">
            <div className="payment-success-icon">
              <CheckCircle size={48} />
            </div>
            <h2>Pagamento Confirmado!</h2>
            <p>Seu pagamento foi processado com sucesso.</p>
            <div className="payment-success-amount">
              {formatCurrency(paymentSuccess.amount)}
            </div>
            <p style={{ fontSize: '0.85rem' }}>
              {paymentSuccess.type === 'entrance' 
                ? 'Taxa de adesão paga. Agora realize a assinatura para ativar o acesso.'
                : 'Assinatura ativada! Redirecionando para suas credenciais...'}
            </p>
            <div className="payment-success-redirect">
              <div className="spinner-small" />
              Redirecionando em 8 segundos...
            </div>
          </div>
        </div>
      )}

      {processing && !gatewayWaiting && (
        <div className="processing-overlay">
          <div className="processing-card">
            <div className="spinner-large" />
            <h3>Processando Pagamento</h3>
            <p>Aguarde enquanto processamos seu pagamento...</p>
            {pollingElapsed >= 60 && (
              <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={handleManualVerify} disabled={verifying}>
                {verifying ? (<><Loader2 size={16} className="spin" /> Verificando...</>) : (<>Já paguei — Verificar Agora</>)}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Checkout;
