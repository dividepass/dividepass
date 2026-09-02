import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { Share2, Copy, Check, Users, Trophy, Gift, ExternalLink } from 'lucide-react';
import './Share.css';

function Share() {
  const { user } = useAuth();
  const { getActiveServices } = useAppDataContext();

  const [referralCode, setReferralCode] = useState('');
  const [referrals, setReferrals] = useState([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedGroup, setCopiedGroup] = useState(null);

  const activeServices = getActiveServices();

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      try {
        setLoading(true);

        const [codeRes, referralsRes] = await Promise.all([
          supabase
            .from('user_referral_codes')
            .select('referral_code')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('referrals')
            .select('*')
            .eq('referrer_id', user.id)
            .order('created_at', { ascending: false })
        ]);

        if (codeRes.error) console.error('Error fetching code:', codeRes.error);
        if (referralsRes.error) console.error('Error fetching referrals:', referralsRes.error);

        let userReferralCode = codeRes.data?.referral_code || '';

        if (!userReferralCode) {
          const { data: fallbackCode, error: fallbackError } = await supabase.rpc('ensure_my_referral_code');
          if (fallbackError) {
            console.error('Error ensuring referral code:', fallbackError);
          } else if (typeof fallbackCode === 'string') {
            userReferralCode = fallbackCode;
          }
        }

        setReferralCode(userReferralCode);

        const referralList = referralsRes.data || [];

        const inviteeIds = [...new Set(referralList.map(r => r.invitee_id).filter(Boolean))];
        let userNames = {};
        if (inviteeIds.length > 0) {
          const { data: usersData } = await supabase
            .from('users')
            .select('id, name, email')
            .in('id', inviteeIds);
          if (usersData) {
            usersData.forEach(u => { userNames[u.id] = u.name || u.email; });
          }
        }

        const enrichedReferrals = referralList.map(r => ({
          ...r,
          inviteeName: userNames[r.invitee_id] || 'Usuário'
        }));

        setReferrals(enrichedReferrals);

        const points = enrichedReferrals.reduce((sum, r) => sum + (r.points || 0), 0);
        setTotalPoints(points);
      } catch (err) {
        console.error('Erro ao buscar dados de referral:', err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user]);

  const copyToClipboard = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else if (type === 'link') {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else if (type.startsWith('group-')) {
        const groupId = type.replace('group-', '');
        setCopiedGroup(groupId);
        setTimeout(() => setCopiedGroup(null), 2000);
      }
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      if (type === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else if (type === 'link') {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else if (type.startsWith('group-')) {
        const groupId = type.replace('group-', '');
        setCopiedGroup(groupId);
        setTimeout(() => setCopiedGroup(null), 2000);
      }
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('pt-BR');
  };

  const siteUrl = import.meta.env.VITE_SITE_URL || 'https://dividepass.com';
  const generalLink = `${siteUrl.replace(/\/$/, '')}/register?ref=${referralCode}`;

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  if (loading) {
    return (
      <div className="share-page">
        <div className="loading-cell">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="share-page fade-in">
      <div className="page-header">
        <h1>Convide Amigos</h1>
        <p>Compartilhe e ganhe pontuações</p>
      </div>

      {/* Referral Code Card */}
      <section className="referral-code-card">
        <div className="referral-code-header">
          <Gift size={24} />
          <h2>Meu Código de Indicação</h2>
        </div>

        <div className="code-display">
          <span className="code-text">{referralCode}</span>
          <button
            className="copy-btn"
            onClick={() => copyToClipboard(referralCode, 'code')}
            title="Copiar código"
          >
            {copiedCode ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>

        <div className="share-link-box">
          <ExternalLink size={16} className="share-link-icon" />
          <span className="share-link-label">Link de Convite Geral</span>
          <span className="share-link-text">{generalLink}</span>
          <button
            className="copy-btn copy-btn-sm"
            onClick={() => copyToClipboard(generalLink, 'link')}
            title="Copiar link"
          >
            {copiedLink ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>

        <button
          className="btn btn-primary share-main-btn"
          onClick={() => copyToClipboard(generalLink, 'link')}
        >
          <Share2 size={18} />
          {copiedLink ? 'Link Copiado!' : 'Compartilhar Link'}
        </button>

        {/* Como Funcionam os Pontos - dentro do card */}
        <div className="points-info-inline">
          <div className="points-info-header">
            <Gift size={20} />
            <h3>Como Funcionam os Pontos</h3>
          </div>
          <ul className="points-rules">
            <li>
              <span className="points-rule-value">+5 pts</span>
              <span>quando um amigo se cadastra pelo seu link</span>
            </li>
            <li>
              <span className="points-rule-value">+10 pts</span>
              <span>quando seu amigo assina um grupo (status fica Ativo)</span>
            </li>
            <li>
              <span className="points-rule-value">+5 pts</span>
              <span>o amigo novo também ganha 5 pontos por ser indicado</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Share by Group */}
      {activeServices.length > 0 && (
        <section className="share-groups-section">
          <div className="section-title-row">
            <h2>Compartilhar por Grupo</h2>
          </div>
          <div className="group-share-list">
            {activeServices.map(({ service, group }) => {
              const groupSlug = group.slug || group.id;
              const groupLink = `${siteUrl.replace(/\/$/, '')}/dashboard/checkout/${groupSlug}?ref=${referralCode}`;
              return (
                <div key={group.id} className="group-share-card">
                  <div
                    className="group-share-icon"
                    style={{ backgroundColor: service.color }}
                  >
                    {service.icon_url ? (
                      <img src={service.icon_url} alt={service.name} className="group-share-icon-img" />
                    ) : (
                      service.icon || service.name[0]
                    )}
                  </div>
                  <div className="group-share-info">
                    <h4>{group.name}</h4>
                    <p>{service.name} &middot; {formatCurrency(group.price_per_slot)}/mês</p>
                  </div>
                  <button
                    className="copy-btn copy-btn-group"
                    onClick={() => copyToClipboard(groupLink, `group-${group.id}`)}
                    title="Copiar link do grupo"
                  >
                    {copiedGroup === group.id ? (
                      <Check size={16} />
                    ) : (
                      <Share2 size={16} />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* My Referrals */}
      <section className="referrals-section">
        <div className="section-title-row">
          <h2>Minhas Indicações</h2>
          <div className="points-total">
            <Trophy size={18} />
            <span>{totalPoints} pontos</span>
          </div>
        </div>

        {referrals.length === 0 ? (
          <div className="empty-state">
            <Users size={40} className="empty-icon" />
            <p>Você ainda não convidou ninguém</p>
          </div>
        ) : (
          <div className="referrals-list">
            {referrals.map((referral) => {
              const inviteeName = referral.inviteeName || 'Usuário';
              const isActive = referral.status === 'completed';
              return (
                <div key={referral.id} className="referral-item">
                  <div className="referral-avatar">
                    {inviteeName[0]?.toUpperCase() || 'U'}
                  </div>
                  <div className="referral-info">
                    <h4>{inviteeName}</h4>
                    <span className="referral-date">{formatDate(referral.created_at)}</span>
                  </div>
                  <span className={`status-badge ${isActive ? 'active' : 'pending'}`}>
                    {isActive ? 'Ativo' : 'Pendente'}
                  </span>
                  <span className="referral-points">
                    +{referral.points || 0} pts
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default Share;
