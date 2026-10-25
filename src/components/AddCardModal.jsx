import { useState } from 'react';
import { CreditCard, Loader2, X, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
// O modal reaproveita exatamente o visual de /dashboard/my-cards, por isso
// puxa os mesmos estilos das paginas que hoje o renderizam.
import '../pages/user/Wallet.css';
import '../pages/user/MyCards.css';

/**
 * Modal de cadastro de cartao de credito (IOPay).
 *
 * Compartilhado entre a tela "Meus Cartoes" e o modal de renovacao de
 * assinatura, onde o usuario pode nao ter nenhum cartao salvo e precisa
 * cadastrar um antes de conseguir pagar.
 */
export default function AddCardModal({ onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cardData, setCardData] = useState({
    card_number: '',
    holder_name: '',
    expiry: '',
    cvv: '',
  });
  const [fieldErrors, setFieldErrors] = useState({});

  const formatCardNumber = (value) => {
    const v = value.replace(/\D/g, '').substring(0, 16);
    return v.replace(/(\d{4})(?=\d)/g, '$1 ');
  };

  const formatExpiry = (value) => {
    const v = value.replace(/\D/g, '').substring(0, 4);
    if (v.length >= 3) return v.substring(0, 2) + '/' + v.substring(2);
    return v;
  };

  const handleChange = (field, value) => {
    setFieldErrors(prev => ({ ...prev, [field]: '' }));
    setError('');
    if (field === 'card_number') {
      setCardData(prev => ({ ...prev, card_number: formatCardNumber(value) }));
    } else if (field === 'expiry') {
      setCardData(prev => ({ ...prev, expiry: formatExpiry(value) }));
    } else if (field === 'cvv') {
      setCardData(prev => ({ ...prev, cvv: value.replace(/\D/g, '').substring(0, 4) }));
    } else {
      setCardData(prev => ({ ...prev, [field]: value }));
    }
  };

  const validate = () => {
    const errors = {};
    const num = cardData.card_number.replace(/\s/g, '');
    if (num.length < 13 || num.length > 16) errors.card_number = 'Número inválido';
    if (!cardData.holder_name.trim()) errors.holder_name = 'Nome obrigatório';

    const expParts = cardData.expiry.split('/');
    if (expParts.length !== 2 || expParts[0].length !== 2 || expParts[1].length !== 2) {
      errors.expiry = 'MM/AA';
    } else {
      const month = parseInt(expParts[0], 10);
      const year = parseInt('20' + expParts[1], 10);
      if (month < 1 || month > 12) errors.expiry = 'Mês inválido';
      const now = new Date();
      if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
        errors.expiry = 'Cartão expirado';
      }
    }

    if (cardData.cvv.length < 3) errors.cvv = 'CVV inválido';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setError('');

    try {
      const expParts = cardData.expiry.split('/');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada');

      const res = await supabase.functions.invoke('iopay-cards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          action: 'add',
          card_number: cardData.card_number.replace(/\s/g, ''),
          holder_name: cardData.holder_name,
          exp_month: expParts[0],
          exp_year: expParts[1],
          cvv: cardData.cvv,
        },
      });

      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) throw new Error(res.data.error);

      // `res.data.id_card` permite ao chamador ja selecionar o cartao novo.
      // O last4 vai junto para o chamador conseguir exibir o cartao mesmo
      // que a listagem da IOPay ainda nao o reflita.
      const last4 = cardData.card_number.replace(/\s/g, '').slice(-4);
      onSuccess({ ...(res.data || {}), last4 });
    } catch (err) {
      setError(err.message || 'Erro ao adicionar cartão');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wallet-modal-overlay" onClick={onClose}>
      <div className="wallet-modal my-cards-add-modal" onClick={e => e.stopPropagation()}>
        <button className="wallet-modal-close" onClick={onClose}>
          <X size={20} />
        </button>
        <div className="wallet-modal-header">
          <CreditCard size={28} />
          <div>
            <h3>Adicionar Cartão</h3>
            <p>Preencha os dados do cartão de crédito.</p>
          </div>
        </div>

        {error && (
          <div className="add-card-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="add-card-form">
          <div className="card-form-row">
            <label>Número do Cartão</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="0000 0000 0000 0000"
              value={cardData.card_number}
              onChange={(e) => handleChange('card_number', e.target.value)}
              disabled={loading}
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
              value={cardData.holder_name}
              onChange={(e) => handleChange('holder_name', e.target.value.toUpperCase())}
              disabled={loading}
              className={fieldErrors.holder_name ? 'field-error' : ''}
              required
            />
            {fieldErrors.holder_name && <span className="field-error-msg">{fieldErrors.holder_name}</span>}
          </div>

          <div className="card-form-grid">
            <div className="card-form-row">
              <label>Validade</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="cc-exp"
                placeholder="MM/AA"
                value={cardData.expiry}
                onChange={(e) => handleChange('expiry', e.target.value)}
                disabled={loading}
                maxLength={5}
                className={fieldErrors.expiry ? 'field-error' : ''}
                required
              />
              {fieldErrors.expiry && <span className="field-error-msg">{fieldErrors.expiry}</span>}
            </div>

            <div className="card-form-row">
              <label>CVV</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="000"
                value={cardData.cvv}
                onChange={(e) => handleChange('cvv', e.target.value)}
                disabled={loading}
                maxLength={4}
                className={fieldErrors.cvv ? 'field-error' : ''}
                required
              />
              {fieldErrors.cvv && <span className="field-error-msg">{fieldErrors.cvv}</span>}
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={loading}
            style={{ marginTop: '0.75rem' }}
          >
            {loading ? (
              <><Loader2 size={16} className="spin" /> Adicionando...</>
            ) : (
              <><CreditCard size={16} /> Adicionar Cartão</>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
