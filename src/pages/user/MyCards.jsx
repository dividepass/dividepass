import { useState, useEffect } from 'react';
import {
  CreditCard, Trash2, Star, Loader2, Plus, X, CheckCircle, Shield, Eye, EyeOff, CreditCardIcon
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import AddCardModal from '../../components/AddCardModal';
import './Wallet.css';
import './MyCards.css';

function RemoveCardModal({ cardBrand, last4, onConfirm, onCancel, loading }) {
  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={e => e.stopPropagation()}>
        <button className="confirm-modal-close" onClick={onCancel}><X size={20} /></button>
        <div className="confirm-modal-icon danger">
          <CreditCardIcon size={28} />
        </div>
        <h3>Remover cartão?</h3>
        <p>
          Deseja remover o cartão <strong>{cardBrand}</strong> terminada em <strong>•••• {last4}</strong>?
        </p>
        <div className="confirm-modal-actions">
          <button className="btn btn-outline" onClick={onCancel} disabled={loading}>Cancelar</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
            Remover
          </button>
        </div>
      </div>
    </div>
  );
}

function MyCards() {
  const { user } = useAuth();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddCard, setShowAddCard] = useState(false);
  const [removingCard, setRemovingCard] = useState(null);
  const [settingDefault, setSettingDefault] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState('');
  const [revealedCards, setRevealedCards] = useState({});
  const [removeTarget, setRemoveTarget] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchCards = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await supabase.functions.invoke('iopay-cards', {
        method: 'GET',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.error) throw new Error(res.error.message);
      setCards(res.data?.cards || []);
    } catch (err) {
      console.error('Erro ao carregar cartões:', err);
      setError('Não foi possível carregar seus cartões. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCards();
  }, [user]);

  const handleRemoveCard = async (id_card) => {
    try {
      setRemovingCard(id_card);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('iopay-cards', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { id_card },
      });
      if (res.error) throw new Error(res.error.message);
      setCards(prev => prev.filter(c => (c.id_card || c.id) !== id_card));
      setToast('Cartão removido com sucesso!');
    } catch (err) {
      setError('Não foi possível remover o cartão. Tente novamente.');
    } finally {
      setRemovingCard(null);
      setRemoveTarget(null);
    }
  };

  const handleSetDefault = async (id_card) => {
    try {
      setSettingDefault(id_card);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('iopay-cards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { action: 'set_default', id_card },
      });
      if (res.error) throw new Error(res.error.message);
      setCards(prev => prev.map(c => ({
        ...c,
        is_default: (c.id_card || c.id) === id_card,
      })));
      setToast('Cartão definido como padrão!');
    } catch (err) {
      console.error('Erro ao definir padrão:', err);
      setError('Não foi possível definir o cartão como padrão. Tente novamente.');
    } finally {
      setSettingDefault(null);
    }
  };

  const maskCard = (card) => {
    const number = card?.last4_digits || card?.first4_digits || card?.number || card?.card_number || '';
    if (!number || number.length < 4) return '•••• •••• •••• ••••';
    const last4 = number.slice(-4);
    return `•••• •••• •••• ${last4}`;
  };

  const getBrandIcon = (brand) => {
    const b = (brand || '').toLowerCase();
    if (b.includes('visa')) return '💳';
    if (b.includes('master')) return '💳';
    if (b.includes('elo')) return '💳';
    if (b.includes('amex')) return '💳';
    return '💳';
  };

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando cartões...</p>
      </div>
    );
  }

  return (
    <div className="fade-in my-cards-page">
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
            <h1>Meus Cartões</h1>
            <p>Gerencie seus cartões cadastrados na IOPay.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddCard(true)}>
            <Plus size={18} /> Adicionar Cartão
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="my-cards-info-box">
        <Shield size={18} />
        <span>Seus dados de cartão são criptografados e armazenados de forma segura pela IOPay.</span>
      </div>

      {cards.length === 0 ? (
        <div className="my-cards-empty">
          <CreditCard size={48} />
          <h3>Nenhum cartão cadastrado</h3>
          <p>Adicione um cartão para realizar pagamentos automáticos.</p>
          <button className="btn btn-primary" onClick={() => setShowAddCard(true)}>
            <Plus size={18} /> Adicionar Primeiro Cartão
          </button>
        </div>
      ) : (
        <div className="my-cards-grid">
          {cards.map((card) => {
            const cardId = card.id_card || card.id;
            const isDefault = card.is_default || card.default;
            return (
              <div key={cardId} className={`my-card-item ${isDefault ? 'is-default' : ''}`}>
                <div className="my-card-item-header">
                  <div className="my-card-brand">
                    <span className="my-card-brand-icon">{getBrandIcon(card.brand)}</span>
                    <span className="my-card-brand-name">{card.brand || 'Cartão'}</span>
                  </div>
                  {isDefault && (
                    <span className="my-card-default-badge">
                      <Star size={12} /> Padrão
                    </span>
                  )}
                </div>

                <div className="my-card-number">
                  {revealedCards[cardId]
                    ? maskCard(card)
                    : '•••• •••• •••• ••••'
                  }
                  <button className="card-reveal-btn" onClick={() => setRevealedCards(prev => ({ ...prev, [cardId]: !prev[cardId] }))} title={revealedCards[cardId] ? 'Ocultar dígitos' : 'Mostrar últimos 4 dígitos'}>
                    {revealedCards[cardId] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                <div className="my-card-details">
                  {card.holder_name && (
                    <span className="my-card-holder">{card.holder_name}</span>
                  )}
                  {(card.exp_month || card.expiration_month) && (
                    <span className="my-card-expiry">
                      {String(card.exp_month || card.expiration_month).padStart(2, '0')}/{card.exp_year || card.expiration_year}
                    </span>
                  )}
                </div>

                <div className="my-card-actions">
                  {!isDefault && (
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => handleSetDefault(cardId)}
                      disabled={settingDefault === cardId}
                    >
                      {settingDefault === cardId ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <Star size={14} />
                      )}
                      Definir como padrão
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-danger-outline"
                    onClick={() => setRemoveTarget({ id_card: cardId, brand: card.brand, last4: card.last4_digits || card.first4_digits || '****' })}
                    disabled={removingCard === cardId}
                  >
                    {removingCard === cardId ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    Remover
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddCard && (
        <AddCardModal
          onClose={() => setShowAddCard(false)}
          onSuccess={() => {
            setShowAddCard(false);
            setToast('Cartão adicionado com sucesso!');
            fetchCards();
          }}
        />
      )}

      {removeTarget && (
        <RemoveCardModal
          cardBrand={removeTarget.brand || 'Cartão'}
          last4={removeTarget.last4}
          onConfirm={() => handleRemoveCard(removeTarget.id_card)}
          onCancel={() => setRemoveTarget(null)}
          loading={removingCard === removeTarget.id_card}
        />
      )}
    </div>
  );
}

export default MyCards;
