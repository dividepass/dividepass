import { useState } from 'react';
import { CreditCard, Loader2, AlertCircle } from 'lucide-react';

function IOPayCardFormInner({ amount, onCardDataReady, onError, disabled }) {
  const [loading, setLoading] = useState(false);
  const [paymentState, setPaymentState] = useState('idle');
  const [cardData, setCardData] = useState({
    card_number: '',
    card_holder_name: '',
    card_expiry: '',
    card_cvv: '',
  });
  const [fieldErrors, setFieldErrors] = useState({});

  const formatCardNumber = (value) => {
    const v = value.replace(/\D/g, '').substring(0, 16);
    return v.replace(/(\d{4})(?=\d)/g, '$1 ');
  };

  const formatExpiry = (value) => {
    const v = value.replace(/\D/g, '').substring(0, 4);
    if (v.length >= 3) {
      return v.substring(0, 2) + '/' + v.substring(2);
    }
    return v;
  };

  const handleChange = (field, value) => {
    setFieldErrors(prev => ({ ...prev, [field]: '' }));
    if (field === 'card_number') {
      setCardData(prev => ({ ...prev, [field]: formatCardNumber(value) }));
    } else if (field === 'card_expiry') {
      setCardData(prev => ({ ...prev, [field]: formatExpiry(value) }));
    } else if (field === 'card_cvv') {
      setCardData(prev => ({ ...prev, [field]: value.replace(/\D/g, '').substring(0, 3) }));
    } else {
      setCardData(prev => ({ ...prev, [field]: value }));
    }
  };

  const validate = () => {
    const errors = {};
    const num = cardData.card_number.replace(/\s/g, '');
    if (num.length < 13 || num.length > 16) errors.card_number = 'Número inválido';
    if (!cardData.card_holder_name.trim()) errors.card_holder_name = 'Nome obrigatório';

    const expParts = cardData.card_expiry.split('/');
    if (expParts.length !== 2 || expParts[0].length !== 2 || expParts[1].length !== 2) {
      errors.card_expiry = 'MM/AA';
    } else {
      const month = parseInt(expParts[0], 10);
      const year = parseInt('20' + expParts[1], 10);
      if (month < 1 || month > 12) errors.card_expiry = 'Mês inválido';
      const now = new Date();
      if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
        errors.card_expiry = 'Cartão expirado';
      }
    }

    if (cardData.card_cvv.length < 3) errors.card_cvv = 'CVV inválido';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setPaymentState('processing');
    onError('');

    try {
      const expParts = cardData.card_expiry.split('/');
      onCardDataReady({
        card_number: cardData.card_number.replace(/\s/g, ''),
        card_holder_name: cardData.card_holder_name,
        card_exp_month: expParts[0],
        card_exp_year: expParts[1],
        card_cvv: cardData.card_cvv,
      });
    } catch (err) {
      console.error('[IOPay] Error:', err);
      setPaymentState('error');
      onError(err.message || 'Erro ao processar cartão');
      setTimeout(() => setPaymentState('idle'), 3000);
      setLoading(false);
    }
  };

  const getButtonContent = () => {
    if (paymentState === 'processing') {
      return <><Loader2 size={16} className="spin" /> Processando pagamento...</>;
    }
    if (paymentState === 'error') {
      return <><AlertCircle size={16} /> Erro ao processar</>;
    }
    return <><CreditCard size={16} /> Pagar R$ {Number(amount).toFixed(2).replace('.', ',')}</>;
  };

  const getButtonClass = () => {
    let cls = 'btn btn-primary btn-full iopay-submit-btn';
    if (paymentState === 'processing') cls += ' processing';
    if (paymentState === 'success') cls += ' success';
    if (paymentState === 'error') cls += ' error';
    return cls;
  };

  return (
    <form onSubmit={handleSubmit} className="iopay-card-form" autoComplete="on">
      <div className="card-form-row">
        <label>Número do Cartão</label>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="0000 0000 0000 0000"
          value={cardData.card_number}
          onChange={(e) => handleChange('card_number', e.target.value)}
          disabled={disabled || loading}
          maxLength={19}
          className={fieldErrors.card_number ? 'field-error' : ''}
          required
        />
        {fieldErrors.card_number && <span className="field-error-msg">{fieldErrors.card_number}</span>}
      </div>

      <div className="card-form-row">
        <label>Nome no Cartão</label>
        <input
          type="text"
          autoComplete="cc-name"
          placeholder="Como está no cartão"
          value={cardData.card_holder_name}
          onChange={(e) => handleChange('card_holder_name', e.target.value.toUpperCase())}
          disabled={disabled || loading}
          className={fieldErrors.card_holder_name ? 'field-error' : ''}
          required
        />
        {fieldErrors.card_holder_name && <span className="field-error-msg">{fieldErrors.card_holder_name}</span>}
      </div>

      <div className="card-form-grid">
        <div className="card-form-row">
          <label>Validade</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/AA"
            value={cardData.card_expiry}
            onChange={(e) => handleChange('card_expiry', e.target.value)}
            disabled={disabled || loading}
            maxLength={5}
            className={fieldErrors.card_expiry ? 'field-error' : ''}
            required
          />
          {fieldErrors.card_expiry && <span className="field-error-msg">{fieldErrors.card_expiry}</span>}
        </div>

        <div className="card-form-row">
          <label>CVV</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="000"
            value={cardData.card_cvv}
            onChange={(e) => handleChange('card_cvv', e.target.value)}
            disabled={disabled || loading}
            maxLength={3}
            className={fieldErrors.card_cvv ? 'field-error' : ''}
            required
          />
          {fieldErrors.card_cvv && <span className="field-error-msg">{fieldErrors.card_cvv}</span>}
        </div>
      </div>

      <button
        type="submit"
        className={getButtonClass()}
        disabled={disabled || loading || paymentState === 'success'}
        style={{ marginTop: '0.75rem' }}
      >
        {getButtonContent()}
      </button>
    </form>
  );
}

export default function IOPayCardForm({ resetKey, ...props }) {
  return <IOPayCardFormInner key={resetKey} {...props} />;
}
