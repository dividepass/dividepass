import { useState, useEffect } from 'react';
import { Gift, Ticket, Copy, Check, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import './MyCupons.css';

const STATUS_LABEL = {
  available: 'Disponível',
  used: 'Usado',
  expired: 'Expirado',
};

/**
 * Cupons vinculados ao usuário, em duas fontes:
 * 1. campaign_rewards (elegibilidade individual) -> junta com coupons.code
 * 2. coupon_uses (histórico de uso) -> junta com coupons.id
 */
export default function MyCupons() {
  const { profile } = useAuth();
  const [rewards, setRewards] = useState([]);
  const [usedCoupons, setUsedCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [rewardsRes, usesRes] = await Promise.all([
          supabase
            .from('campaign_rewards')
            .select('campaign, status, earned_at, expires_at')
            .eq('user_id', profile.id)
            .order('earned_at', { ascending: false }),
          supabase
            .from('coupon_uses')
            .select('coupon_id, discount_amount, final_amount, created_at')
            .eq('user_id', profile.id)
            .order('created_at', { ascending: false }),
        ]);

        if (cancelled) return;

        // Junta os códigos das duas fontes.
        const rewardCampaigns = (rewardsRes.data || []).map((r) => r.campaign);
        const usedIds = (usesRes.data || []).map((u) => u.coupon_id).filter(Boolean);

        let couponsByCode = {};
        let couponsById = {};

        // Duas queries separadas: `.or()` com `.in()` aninhado é frágil.
        if (rewardCampaigns.length) {
          const { data: byCode } = await supabase
            .from('coupons')
            .select('id, code, description, discount_type, discount_value, expires_at')
            .in('code', rewardCampaigns);
          for (const c of byCode || []) couponsByCode[c.code] = c;
        }
        if (usedIds.length) {
          const { data: byId } = await supabase
            .from('coupons')
            .select('id, code, description, discount_type, discount_value, expires_at')
            .in('id', usedIds);
          for (const c of byId || []) couponsById[c.id] = c;
        }

        const mergedRewards = (rewardsRes.data || []).map((r) => ({
          ...r,
          coupon: couponsByCode[r.campaign] || null,
        }));

        const mergedUses = (usesRes.data || []).map((u) => ({
          ...u,
          coupon: couponsById[u.coupon_id] || null,
        }));

        if (!cancelled) {
          setRewards(mergedRewards);
          setUsedCoupons(mergedUses);
          setError('');
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [profile?.id]);

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => {});
  };

  const formatDiscount = (coupon) => {
    if (!coupon) return '—';
    if (coupon.discount_type === 'percentage') return `${coupon.discount_value}% OFF`;
    return `R$ ${Number(coupon.discount_value).toFixed(2)} OFF`;
  };

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando seus cupons...</p>
      </div>
    );
  }

  return (
    <div className="fade-in my-cupons">
      <div className="page-header">
        <h1>Meus Cupons</h1>
        <p className="page-subtitle">Seus descontos e a elegibilidade que você já conquistou.</p>
      </div>

      {error && (
        <div className="error-banner"><AlertCircle size={16} /> {error}</div>
      )}

      {rewards.length === 0 && usedCoupons.length === 0 ? (
        <div className="my-cupons-empty">
          <Gift size={40} />
          <h3>Nenhum cupom ainda</h3>
          <p>Envie um depoimento para ganhar R$ 5 de desconto na sua próxima assinatura.</p>
        </div>
      ) : (
        <>
          {rewards.length > 0 && (
            <section className="my-cupons-section">
              <h2>Seus cupons</h2>
              <div className="my-cupons-grid">
                {rewards.map((r) => (
                  <div key={r.campaign} className={`coupon-card ${r.status}`}>
                    <div className="coupon-card-top">
                      <span className={`coupon-status ${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
                      {r.expires_at && r.status === 'available' && (
                        <span className="coupon-expiry">
                          até {new Date(r.expires_at).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </div>

                    <div className="coupon-value">{formatDiscount(r.coupon)}</div>

                    <div className="coupon-code-row">
                      <span className="coupon-code">{r.campaign}</span>
                      <button
                        className="coupon-copy"
                        onClick={() => copyCode(r.campaign)}
                        title="Copiar código"
                      >
                        {copied === r.campaign ? <Check size={15} /> : <Copy size={15} />}
                      </button>
                    </div>

                    {r.coupon?.description && (
                      <p className="coupon-desc">{r.coupon.description.replace(/^campaign:/i, '')}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {usedCoupons.length > 0 && (
            <section className="my-cupons-section">
              <h2>Já utilizados</h2>
              <div className="my-cupons-list">
                {usedCoupons.map((u) => (
                  <div key={u.id ?? u.coupon_id} className="coupon-used-row">
                    <Ticket size={18} className="coupon-used-icon" />
                    <div className="coupon-used-info">
                      <strong>{u.coupon?.code || 'Cupom'}</strong>
                      <span>
                        {u.coupon
                          ? `${formatDiscount(u.coupon)} · economia de R$ ${Number(u.discount_amount || 0).toFixed(2)}`
                          : `economia de R$ ${Number(u.discount_amount || 0).toFixed(2)}`}
                      </span>
                    </div>
                    <span className="coupon-used-date">
                      {new Date(u.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}