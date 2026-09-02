import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Shield, Users, ChevronDown, ChevronUp, Star, AlertCircle, CheckCircle2, CreditCard, Share2, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { logPlatformEvent } from '../../lib/platformEventLogger';
import './GroupDetail.css';

const CYCLE_LABELS = {
  monthly: 'mês',
  quarterly: 'trimestre',
  semiannual: 'semestre',
  annual: 'ano',
  days: 'dias',
};

const FAQ_ITEMS = [
  { q: 'Quando terei acesso ao serviço?', a: 'Após a confirmação do pagamento, você receberá as credenciais de acesso por e-mail ou diretamente no painel de credenciais da plataforma.' },
  { q: 'Quais as formas de pagamento aceitas?', a: 'Aceitamos PIX, cartão de crédito e boleto bancário via Mercado Pago.' },
  { q: 'O que é caução?', a: 'Caução é uma garantia financeira cobrada em alguns grupos para assegurar o comprometimento dos membros. O valor é devolvido ao final do período.' },
  { q: 'Com quem posso dividir uma assinatura?', a: 'Você pode dividir com familiares, amigos ou conhecidos. O importante é que todos os membros respeitem as regras do grupo.' },
];

function GroupDetail() {
  const { groupSlug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [service, setService] = useState(null);
  const [members, setMembers] = useState([]);
  const [owner, setOwner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareCopied, setShareCopied] = useState(false);
  const [openSections, setOpenSections] = useState({
    about: true,
    loyalty: false,
    members: true,
    faq: false,
  });

  useEffect(() => {
    const load = async () => {
      const QUERY = `
        *,
        service:service_id (*),
        members:group_members (*, user:user_id (id, name, avatar_url, created_at)),
        owner:owner_id (id, name, avatar_url, created_at, email, role)
      `;

      let data;

      const { data: bySlug } = await supabase
        .from('groups')
        .select(QUERY)
        .eq('slug', groupSlug)
        .maybeSingle();

      if (bySlug) {
        data = bySlug;
      } else {
        const { data: byId } = await supabase
          .from('groups')
          .select(QUERY)
          .eq('id', groupSlug)
          .maybeSingle();
        data = byId;
      }

      if (!data) {
        setError('Grupo não encontrado.');
        setLoading(false);
        return;
      }

      setGroup(data);
      setService(data.service);
      setMembers(data.members?.filter(m => m.status === 'active') || []);
      setOwner(data.owner);
      setLoading(false);
    };

    load();
  }, [groupSlug]);

  useEffect(() => {
    if (owner || !group) return;
    const fetchAdmin = async () => {
      const { data } = await supabase
        .from('users')
        .select('id, name, avatar_url, role')
        .limit(1)
        .maybeSingle();
      if (data) setOwner(data);
    };
    fetchAdmin();
  }, [group, owner]);

  const toggleSection = (key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const activeMembers = members.length;
  const allOccupants = (group?.members || []).filter(m => m.status === 'active' || m.status === 'pending').length;
  const maxMembers = group?.has_slot_limit === false ? Infinity : (group?.max_size || service?.max_group_size || 4);
  const spots = maxMembers === Infinity ? Infinity : Math.max(0, maxMembers - allOccupants);
  const isFull = spots === 0;
  const isMember = user && members.some(m => m.user?.id === user.id);
  const hasActiveSubscription = user && members.some(m => m.user?.id === user.id && (m.payment_status === 'active' || m.payment_status === 'awaiting_subscription'));

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando detalhes do grupo...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fade-in group-detail-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ArrowLeft size={18} /> Voltar
        </button>
        <div className="empty-state">
          <AlertCircle size={48} style={{ color: 'var(--text-soft)', margin: '0 auto 1rem' }} />
          <p>{error}</p>
          <Link to="/dashboard/catalog" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Ver Catálogo
          </Link>
        </div>
      </div>
    );
  }

  const price = Number(group?.price_per_slot) || 0;
  const cycle = group?.billing_cycle || 'monthly';
  const siteUrl = (import.meta.env.VITE_SITE_URL || 'https://dividepass.com').replace(/\/$/, '');

  const handleCheckoutClick = () => {
    if (user?.id && group?.id) {
      void logPlatformEvent({
        event_type: 'checkout_opened',
        title: 'Checkout aberto',
        message: `${user.user_metadata?.name || user.email || 'Usuário'} abriu o checkout do grupo ${group.name}.`,
        metadata: { user_id: user.id, group_id: group.id, service_id: service?.id, billing_cycle: group?.billing_cycle || null },
        created_by: user.id,
      });
    }
    navigate(`/dashboard/checkout/${group?.slug || group?.id}`);
  };

  const handleShareGroup = async () => {
    const link = `${siteUrl}/dashboard/groups/${group?.slug || group?.id}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: group?.name || service?.name || 'DividePass',
          text: `Veja este grupo da DividePass: ${group?.name || service?.name || 'Grupo'}`,
          url: link,
        });
      } else {
        await navigator.clipboard.writeText(link);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(link);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      } catch (err) {
        console.error('Erro ao compartilhar grupo:', err);
      }
    }
  };

  return (
    <div className="fade-in group-detail-page">
      <button onClick={() => navigate(-1)} className="back-btn">
        <ArrowLeft size={18} /> Voltar
      </button>

      {/* Header */}
      <div className="gd-header">
        <div className="gd-header-service" style={{ backgroundColor: service?.color }}>
          {service?.icon_url ? (
            <img src={service.icon_url} alt={service.name} className="gd-service-logo" />
          ) : (
            <span className="gd-service-icon-text">{service?.icon || service?.name?.[0]}</span>
          )}
        </div>
        <div className="gd-header-info">
          <h1>{group?.name || service?.name}</h1>
          <p className="gd-header-sub">{service?.full_name || service?.name}</p>
          <div className="gd-header-tags">
            {group?.verified && (
              <span className="gd-badge verified">
                <Shield size={12} /> Verificado
              </span>
            )}
            <span className={`gd-badge status ${group?.status}`}>
              {group?.status === 'open' ? 'Aberto' : group?.status === 'forming' ? 'Formando' : 'Fechado'}
            </span>
            <span className="gd-badge spots">
              <Users size={12} /> {spots > 0 ? `${spots} vaga${spots > 1 ? 's' : ''}` : 'Lotado'}
            </span>
          </div>
        </div>
        <div className="gd-header-price">
          <span className="gd-price-value">R$ {price.toFixed(2).replace('.', ',')}</span>
          <span className="gd-price-cycle">/mês por perfil</span>
        </div>
      </div>

      {/* CTA Button */}
      <div className="gd-cta">
        {hasActiveSubscription ? (
          <Link to={`/dashboard/credentials/${service?.slug || service?.id}`} className="btn btn-primary gd-cta-btn">
            <CheckCircle2 size={18} /> Acessar Credenciais
          </Link>
        ) : isMember ? (
          <button type="button" onClick={handleCheckoutClick} className="btn btn-primary gd-cta-btn">
            <CreditCard size={18} /> Continuar Assinatura
          </button>
        ) : isFull ? (
          <button className="btn btn-outline gd-cta-btn" disabled>
            Grupo Lotado
          </button>
        ) : (
          <button type="button" onClick={handleCheckoutClick} className="btn btn-primary gd-cta-btn">
            Entrar no Grupo
          </button>
        )}

        <button className="btn btn-outline gd-share-btn" onClick={handleShareGroup}>
          {shareCopied ? <Check size={18} /> : <Share2 size={18} />}
          {shareCopied ? 'Link copiado' : 'Compartilhar grupo'}
        </button>
      </div>

      {/* About the Group */}
      <div className="gd-section">
        <button className="gd-section-header" onClick={() => toggleSection('about')}>
          <h2>Sobre o grupo</h2>
          {openSections.about ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
        {openSections.about && (
          <div className="gd-section-body">
            {group?.verified && (
              <div className="gd-badge-row">
                <div className="gd-seal">
                  <Star size={16} />
                </div>
                <span>Grupo verificado pelo DividePass</span>
              </div>
            )}

            {group?.description || service?.description ? (
              <>
                <h3>Descrição</h3>
                <p>{group?.description || service?.description}</p>
              </>
            ) : null}

            {group?.rules && (
              <>
                <h3>Regrinhas</h3>
                <div className="gd-rules">
                  {group.rules.split('\n').map((rule, i) => (
                    <p key={i}>{rule}</p>
                  ))}
                </div>
              </>
            )}

            <h3>Outras informações</h3>
            <p className="gd-meta">
              {service?.full_name || service?.name}
              {group?.has_slot_limit === false && <span className="gd-unlimited">Vagas ilimitadas</span>}
            </p>

            <h3>Situação</h3>
            <p>
              {group?.status === 'open' && 'O grupo está ativo e existem vagas disponíveis.'}
              {group?.status === 'forming' && 'O grupo está em formação. Aguarde a confirmação dos membros.'}
              {group?.status === 'closed' && 'O grupo está fechado para novos membros.'}
            </p>
          </div>
        )}
      </div>

      {/* Members Section */}
      <div className="gd-section">
        <button className="gd-section-header" onClick={() => toggleSection('members')}>
          <h2>Quem faz parte</h2>
          {openSections.members ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
        {openSections.members && (
          <div className="gd-section-body">
            <div className="gd-members-grid">
              {members.map(member => (
                <Link
                  key={member.id}
                  to={`/dashboard/user/${member.user?.id}`}
                  className="gd-member"
                >
                  {member.user?.avatar_url ? (
                    <img src={member.user.avatar_url} alt={member.user.name} className="gd-member-avatar" />
                  ) : (
                    <div className="gd-member-avatar-placeholder">
                      {(member.user?.name || member.profile_name || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <span className="gd-member-name">
                    {member.profile_name || member.user?.name || 'Membro'}
                  </span>
                </Link>
              ))}
              {members.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Nenhum membro ainda.</p>
              )}
            </div>

            {/* Criado por */}
            {owner && (
              <Link to={`/dashboard/user/${owner.id}`} className={`gd-created-by ${owner.role === 'admin' ? 'official' : ''}`}>
                <span className="gd-created-by-label">Criado por:</span>
                <div className="gd-created-by-profile">
                  {owner.avatar_url ? (
                    <img src={owner.avatar_url} alt={owner.name} className="gd-created-by-avatar" />
                  ) : (
                    <div className="gd-created-by-avatar-placeholder">
                      {owner.role === 'admin' ? 'DP' : (owner.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span className="gd-created-by-name">{owner.role === 'admin' ? 'DividePass' : (owner.name || 'Administrador')}</span>
                  {owner.role === 'admin' && <span className="gd-official-seal">✓ Oficial</span>}
                </div>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* FAQ Section */}
      <div className="gd-section">
        <button className="gd-section-header" onClick={() => toggleSection('faq')}>
          <h2>Dúvidas frequentes</h2>
          {openSections.faq ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
        {openSections.faq && (
          <div className="gd-section-body">
            <div className="gd-faq-list">
              {FAQ_ITEMS.map((item, i) => (
                <FaqItem key={i} question={item.q} answer={item.a} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      <div className="gd-bottom-cta">
        {hasActiveSubscription ? (
          <Link to={`/dashboard/credentials/${service?.slug || service?.id}`} className="btn btn-primary gd-cta-btn">
            Acessar Credenciais
          </Link>
        ) : isMember ? (
          <Link to={`/dashboard/checkout/${group?.slug || group?.id}`} className="btn btn-primary gd-cta-btn">
            Continuar Assinatura
          </Link>
        ) : isFull ? (
          <button className="btn btn-outline gd-cta-btn" disabled>Grupo Lotado</button>
        ) : (
          <Link to={`/dashboard/checkout/${group?.slug || group?.id}`} className="btn btn-primary gd-cta-btn">
            Entrar no Grupo — R$ {price.toFixed(2).replace('.', ',')} / {CYCLE_LABELS[cycle] || cycle}
          </Link>
        )}
      </div>
    </div>
  );
}

function FaqItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`gd-faq-item ${open ? 'open' : ''}`}>
      <button className="gd-faq-question" onClick={() => setOpen(!open)}>
        <span>{question}</span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && <div className="gd-faq-answer"><p>{answer}</p></div>}
    </div>
  );
}

export default GroupDetail;
