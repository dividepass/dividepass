import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, Loader2, ArrowRight, Shield } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAppDataContext } from '../contexts/AppDataContext';
import { useAuth } from '../hooks/useAuth';
import { reportGoogleAdsConversion } from '../lib/googleAds';
import logoImg from '../assets/logo.png';
import './PaymentReturn.css';

function PaymentReturn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { streamingServices } = useAppDataContext();
  const { profile } = useAuth();
  const [status, setStatus] = useState('loading');
  const [serviceId, setServiceId] = useState(null);
  const [groupName, setGroupName] = useState('');
  const [amount, setAmount] = useState(1);
  const [error, setError] = useState('');
  const conversionSentRef = useRef(false);

  const paymentId = searchParams.get('payment_id') || searchParams.get('collection_id');
  const externalReference = searchParams.get('external_reference');
  const mpStatus = searchParams.get('status') || searchParams.get('collection_status');

  useEffect(() => {
    const verifyPayment = async () => {
      try {
        const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mercado-pago-verify-payment`;
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;

        const response = await fetch(functionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            payment_id: paymentId,
            external_reference: externalReference,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Erro ao verificar pagamento.');
        }

        setServiceId(data.service_id);
        setGroupName(data.group_name || '');
        setAmount(Number(data.amount || data.value || 1));

        if (data.status === 'approved' || mpStatus === 'approved') {
          setStatus('success');
        } else if (data.status === 'pending' || data.status === 'in_process' || mpStatus === 'pending') {
          setStatus('pending');
        } else {
          setStatus('failure');
        }
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    };

    verifyPayment();
  }, [paymentId, externalReference, mpStatus]);

  useEffect(() => {
    if (status !== 'success' || conversionSentRef.current) return;
    const transactionId = paymentId || externalReference || '';
    const sent = reportGoogleAdsConversion({
      value: amount,
      currency: 'BRL',
      transactionId,
      key: transactionId || `payment-return:${externalReference || 'unknown'}`,
      attribution: profile,
    });
    conversionSentRef.current = sent || conversionSentRef.current;
  }, [status, paymentId, externalReference]);

  const renderContent = () => {
    const svc = serviceId ? streamingServices.find(s => s.id === serviceId) : null;
    const svcSlug = svc?.slug || serviceId;
    switch (status) {
      case 'loading':
        return (
          <div className="payment-return-card">
            <Loader2 size={48} className="spin return-icon" />
            <h2>Verificando pagamento...</h2>
            <p>Aguarde enquanto confirmamos o status do seu pagamento.</p>
          </div>
        );

      case 'success':
        return (
          <div className="payment-return-card success">
            <CheckCircle size={56} className="return-icon" />
            <h2>Pagamento Confirmado!</h2>
            <p>
              Sua assinatura no grupo <strong>{groupName}</strong> foi ativada com sucesso.
              Você já pode acessar as credenciais do serviço.
            </p>
            <div className="return-actions">
              {serviceId && (
                <Link to={`/dashboard/credentials/${svcSlug}`} className="btn btn-primary">
                  Ver Credenciais
                  <ArrowRight size={18} />
                </Link>
              )}
              <Link to="/dashboard" className="btn btn-outline">
                Ir para Dashboard
              </Link>
            </div>
          </div>
        );

      case 'pending':
        return (
          <div className="payment-return-card pending">
            <Clock size={56} className="return-icon" />
            <h2>Pagamento em Análise</h2>
            <p>
              Seu pagamento está sendo processado. Assim que for confirmado,
              sua assinatura será ativada automaticamente.
            </p>
            <div className="return-actions">
              <Link to="/dashboard" className="btn btn-primary">
                Ir para Dashboard
              </Link>
              {serviceId && (
                <Link to={`/dashboard/credentials/${svcSlug}`} className="btn btn-outline">
                  Ver Credenciais
                </Link>
              )}
            </div>
          </div>
        );

      case 'failure':
      case 'error':
        return (
          <div className="payment-return-card failure">
            <XCircle size={56} className="return-icon" />
            <h2>{status === 'failure' ? 'Pagamento Não Aprovado' : 'Erro na Verificação'}</h2>
            <p>
              {status === 'failure'
                ? 'Não foi possível aprovar seu pagamento. Você pode tentar novamente.'
                : error || 'Ocorreu um erro ao verificar seu pagamento. Tente novamente mais tarde.'}
            </p>
            <div className="return-actions">
              <button onClick={() => navigate(-1)} className="btn btn-primary">
                Tentar Novamente
              </button>
              <Link to="/dashboard" className="btn btn-outline">
                Ir para Dashboard
              </Link>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="payment-return-page">
      <div className="payment-return-container">
        <div className="payment-return-logo">
          <img src={logoImg} alt="DividePass" className="payment-return-logo-img" />
          <span>DividePass</span>
        </div>
        {renderContent()}
        <p className="payment-return-security">
          <Shield size={14} />
          Pagamento processado de forma segura pelo Mercado Pago.
        </p>
      </div>
    </div>
  );
}

export default PaymentReturn;
