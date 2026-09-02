import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Check, BadgeCheck, Search, X, Bell, Pin, Star, Share2 } from 'lucide-react';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import './Catalog.css';

const CYCLE_LABELS = {
  monthly: 'mês',
  quarterly: 'trimestre',
  semiannual: 'semestre',
  annual: 'ano',
  days: 'dias',
};

const CATEGORIES = [
  { key: 'all', label: 'Todos', icon: '🔍' },
  { key: 'streaming', label: 'Streaming', icon: '📺' },
  { key: 'musica', label: 'Música', icon: '🎵' },
  { key: 'ia', label: 'IA', icon: '🤖' },
  { key: 'cursos', label: 'Cursos', icon: '🎓' },
  { key: 'produtividade', label: 'Produtividade', icon: '💼' },
  { key: 'ferramentas', label: 'Ferramentas', icon: '🛠' },
  { key: 'leitura', label: 'Leitura', icon: '📚' },
  { key: 'games', label: 'Games', icon: '🎮' },
  { key: 'saude', label: 'Saúde', icon: '🏋️' },
  { key: 'seguranca', label: 'Segurança', icon: '🔒' },
];

const CATEGORY_KEYWORDS = {
  streaming: ['filmes', 'series', 'video', 'streaming', 'tv', 'netflix', 'disney', 'max', 'prime', 'globoplay', 'paramount', 'apple tv', 'crunchyroll', 'mubi'],
  musica: ['musica', 'music', 'podcast', 'audio', 'spotify', 'deezer', 'tidal', 'audible'],
  ia: ['ia', 'ai', 'inteligencia', 'artificial', 'chatgpt', 'claude', 'gemini', 'midjourney', 'perplexity', 'cursor', 'elevenlabs', 'runway', 'gpt'],
  cursos: ['curso', 'cursos', 'educacao', 'aprender', 'estudar', 'alura', 'udemy', 'coursera', 'domestika', 'duolingo', 'rocketseat', 'aula'],
  produtividade: ['produtividade', 'trabalho', 'colaboracao', 'microsoft', 'google', 'notion', 'trello', 'clickup', 'slack', 'office'],
  ferramentas: ['design', 'edicao', 'marketing', 'canva', 'adobe', 'figma', 'semrush', 'envato', 'grammarly', 'criativo'],
  leitura: ['livro', 'leitura', 'kindle', 'scribd', 'readly', 'ebook', 'revista'],
  games: ['jogo', 'jogos', 'game', 'games', 'xbox', 'playstation', 'nintendo', 'geforce', 'gamer'],
  saude: ['saude', 'fitness', 'exercicio', 'bem estar', 'wellhub', 'strava', 'headspace', 'calm', 'academia'],
  seguranca: ['seguranca', 'vpn', 'senha', 'senhas', 'nordvpn', 'surfshark', 'bitwarden', '1password', 'protecao'],
};

const SORT_OPTIONS = [
  { key: 'popular', label: 'Mais populares' },
  { key: 'price_asc', label: 'Menor preço' },
  { key: 'price_desc', label: 'Maior preço' },
  { key: 'newest', label: 'Mais recentes' },
];

function Catalog() {
  const { serviceId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { streamingServices, getAvailableServices, isSubscribedToService } = useAppDataContext();

  const [search, setSearch] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('categoria') || 'all');
  const [sortBy, setSortBy] = useState('popular');
  const [interestModal, setInterestModal] = useState(false);
  const [interestMsg, setInterestMsg] = useState('');
  const [interestSent, setInterestSent] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [extraGroups, setExtraGroups] = useState([]);
  const [adminUser, setAdminUser] = useState(null);

  const siteUrl = (import.meta.env.VITE_SITE_URL || 'https://dividepass.com').replace(/\/$/, '');

  const availableServices = getAvailableServices();
  const selectedService = serviceId
    ? streamingServices.find(s => s.id === serviceId || s.slug === serviceId)
    : null;

  const handleCategoryChange = (key) => {
    setSelectedCategory(key);
    if (key === 'all') {
      searchParams.delete('categoria');
    } else {
      searchParams.set('categoria', key);
    }
    setSearchParams(searchParams, { replace: true });
  };

  useEffect(() => {
    if (!selectedService || !serviceId) return;
    const serviceData = availableServices.find(s => s.id === serviceId || s.slug === serviceId);
    if (serviceData && serviceData.groups && serviceData.groups.length > 0) return;

    let cancelled = false;
    const fetchGroups = async () => {
      const { data } = await supabase
        .from('groups')
        .select(`
          *,
          service:service_id (*),
          members:group_members (*),
          credential:group_credentials (*),
          owner:owner_id (id, name, email, avatar_url, role)
        `)
        .eq('service_id', selectedService.id)
        .in('status', ['open', 'forming']);
      if (!cancelled && data) setExtraGroups(data);
    };
    fetchGroups();
    return () => { cancelled = true; };
  }, [selectedService, serviceId, availableServices]);

  useEffect(() => {
    const allGroups = [...(selectedService?.groups || []), ...extraGroups];
    const hasNoOwner = allGroups.some(g => !g.owner);
    if (!hasNoOwner || adminUser) return;
    const fetchAdmin = async () => {
      const { data } = await supabase
        .from('users')
        .select('id, name, avatar_url, role')
        .limit(1)
        .maybeSingle();
      if (data) setAdminUser(data);
    };
    fetchAdmin();
  }, [extraGroups, selectedService, adminUser]);

  const getActiveMembers = (group) =>
    group.members?.filter(m => m.status === 'active' || m.status === 'pending').length || 0;

  const getSpots = useCallback((group, service) => {
    if (group.has_slot_limit === false) return Infinity;
    const maxSize = group.max_size || service?.max_group_size;
    return Math.max(0, maxSize - getActiveMembers(group));
  }, []);

  const isFull = (group, service) => {
    if (group.has_slot_limit === false) return false;
    return getSpots(group, service) === 0;
  };

  const formatCycleLabel = (group) => {
    const availableCycles = group.available_cycles || [group.billing_cycle || 'monthly'];
    const getLabel = (c, grp) => {
      if (c === 'days') return grp.custom_cycle_label || `${grp.custom_cycle_days || '?'} dias`;
      if (c === 'custom') return grp.custom_cycle_label || `${grp.custom_cycle_months || '?'} meses`;
      return CYCLE_LABELS[c] || c;
    };
    if (availableCycles.length === 1) {
      return { label: `/${getLabel(availableCycles[0], group)}`, multi: false };
    }
    return { label: availableCycles.map(c => getLabel(c, group)).join(' / '), multi: true };
  };

  const handleInterest = async () => {
    if (!selectedService || !user) return;
    try {
      const { error } = await supabase
        .from('group_interest')
        .upsert({
          service_id: selectedService.id,
          user_id: user.id,
          group_id: null,
          message: interestMsg || null,
        }, { onConflict: 'service_id, user_id', ignoreDuplicates: false });
      if (error && error.code !== '23505') {
        console.error(error);
      }
      setInterestSent(true);
      setTimeout(() => { setInterestModal(false); setInterestSent(false); setInterestMsg(''); }, 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSharePlatform = async () => {
    const link = `${siteUrl}/dashboard/catalog/${selectedService?.slug || selectedService?.id}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'DividePass',
          text: `Veja os grupos da ${selectedService?.name || 'plataforma'} na DividePass`,
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
        console.error('Erro ao compartilhar catálogo:', err);
      }
    }
  };

  const serviceData = selectedService
    ? availableServices.find(s => s.id === serviceId || s.slug === serviceId)
    : null;
  const allServiceGroups = useMemo(() => {
    const fromContext = serviceData?.groups || [];
    if (fromContext.length > 0) return fromContext;
    return extraGroups;
  }, [serviceData?.groups, extraGroups]);
  const alreadySubscribed = selectedService ? isSubscribedToService(serviceId) : false;

  const filteredGroups = useMemo(() => {
    let result = allServiceGroups;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(g =>
        g.name?.toLowerCase().includes(q) ||
        g.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    if (verifiedOnly) {
      result = result.filter(g => g.verified);
    }
    // Sort: official groups first, then by created_at desc
    result = [...result].sort((a, b) => {
      if (a.is_official && !b.is_official) return -1;
      if (!a.is_official && b.is_official) return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    if (sortBy === 'price_asc') {
      result = [...result].sort((a, b) => a.price_per_slot - b.price_per_slot);
    } else if (sortBy === 'price_desc') {
      result = [...result].sort((a, b) => b.price_per_slot - a.price_per_slot);
    } else if (sortBy === 'spots') {
      result = [...result].sort((a, b) => getSpots(b, selectedService) - getSpots(a, selectedService));
    }
    return result;
  }, [allServiceGroups, search, verifiedOnly, sortBy, selectedService, getSpots]);

  const filteredServices = useMemo(() => {
    let result = availableServices;

    if (selectedCategory !== 'all') {
      result = result.filter(s => s.category === selectedCategory);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s => {
        if (s.name?.toLowerCase().includes(q)) return true;
        if (s.fullName?.toLowerCase().includes(q)) return true;
        if (s.category && CATEGORY_KEYWORDS[s.category]?.some(kw => kw.includes(q) || q.includes(kw))) return true;
        return false;
      });
    }

    result.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return 0;
    });

    return result;
  }, [availableServices, selectedCategory, search]);

  if (selectedService) {
    return (
      <div className="fade-in catalog-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ChevronLeft size={18} />
          Voltar
        </button>

        <div className="catalog-detail-header">
          <div className="page-header">
            <h1>{selectedService.fullName || selectedService.name}</h1>
            <p>Escolha um grupo para fazer parte do rateio.</p>
          </div>
          <div className="catalog-detail-actions">
            <button className="btn-interest-header btn-share-header" onClick={handleSharePlatform}>
              {shareCopied ? <Check size={16} /> : <Share2 size={16} />}
              {shareCopied ? 'Link copiado' : 'Compartilhar plataforma'}
            </button>
            <button className="btn-interest-header" onClick={() => setInterestModal(true)}>
              <Bell size={16} />
              Lista de Espera
            </button>
          </div>
        </div>

        {alreadySubscribed && (
          <div className="info-banner">
            <Check size={18} />
            Você já possui uma assinatura ativa do {selectedService.name}.
            <Link to={`/dashboard/credentials/${selectedService?.slug || serviceId}`}>Ver credenciais</Link>
          </div>
        )}

        <div className="catalog-filters">
          <div className="search-input-wrap">
            <Search size={16} />
            <input
              type="text"
              placeholder="Buscar grupo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            )}
          </div>
          <div className="catalog-filters-row">
            <button
              className={`filter-btn ${verifiedOnly ? 'active' : ''}`}
              onClick={() => setVerifiedOnly(!verifiedOnly)}
            >
              <BadgeCheck size={14} />
              Verificados
            </button>
            <select
              className="sort-select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
            >
              {SORT_OPTIONS.map(opt => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {filteredGroups.length === 0 && (
          <div className="empty-groups">
            <p>Nenhum grupo encontrado{search ? ' para sua busca' : ''}.</p>
            <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => setInterestModal(true)}>
              <Bell size={16} /> Solicitar Novo Grupo
            </button>
          </div>
        )}

        <div className="groups-grid">
          {filteredGroups.map(group => {
            const activeMembers = getActiveMembers(group);
            const spots = getSpots(group, selectedService);
            const full = isFull(group, selectedService);
            const hasSlotLimit = group.has_slot_limit !== false;
            const maxSize = hasSlotLimit ? (group.max_size || selectedService.max_group_size) : null;
            const cycleInfo = formatCycleLabel(group);
            const memberAvatars = (group.members || []).filter(m => m.status === 'active').slice(0, 4);

            return (
              <div
                key={group.id}
                className={`group-card ${full ? 'group-card-full' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/dashboard/groups/${group.slug || group.id}`)}
              >
                {/* Top Section: Photo + Name + Stats */}
                <div className="gc-top">
                  {group.photo_url ? (
                    <div className="gc-photo">
                      <img src={group.photo_url} alt={group.name} />
                    </div>
                  ) : (
                    <div className="gc-photo gc-photo-placeholder" style={{ backgroundColor: group.service?.color || selectedService?.color || '#4F46E5' }}>
                      {group.service?.icon_url || selectedService?.icon_url ? (
                        <img src={group.service?.icon_url || selectedService?.icon_url} alt="" />
                      ) : (
                        <span>{group.service?.icon || selectedService?.icon || group.name?.[0]?.toUpperCase()}</span>
                      )}
                    </div>
                  )}
                  <div className="gc-info">
                    <div className="gc-name-row">
                      <h3>{group.name}</h3>
                      {group.verified && (
                        <span className="gc-verified" title="Verificado">
                          <BadgeCheck size={18} />
                        </span>
                      )}
                    </div>
                    <div className="gc-stats-row">
                      <span className="gc-members">
                        {activeMembers} de {maxSize} membros
                      </span>
                      <span className="gc-ref">#{group.slug || group.id.slice(0, 6).toUpperCase()}</span>
                    </div>
                  </div>
                </div>

                <div className="gc-divider" />

                {/* Price Section */}
                <div className="gc-price">
                  <span className="gc-price-label">A partir de</span>
                  <span className="gc-price-value">
                    R$ {Number(group.price_per_slot).toFixed(2).replace('.', ',')}
                    <small>/mês por perfil</small>
                  </span>
                </div>

                <div className="gc-divider" />

                {/* Bottom Section: Members + Creator */}
                <div className="gc-bottom">
                  <div className="gc-member-avatars">
                    {memberAvatars.map((m, i) => (
                      <div
                        key={m.user_id || i}
                        className="gc-member-avatar"
                        style={{ zIndex: memberAvatars.length - i }}
                        title={m.user?.name || 'Membro'}
                      >
                        {m.user?.avatar_url ? (
                          <img src={m.user.avatar_url} alt="" />
                        ) : (
                          <span>{(m.user?.name || '?')[0].toUpperCase()}</span>
                        )}
                      </div>
                    ))}
                    {memberAvatars.length === 0 && (
                      <div className="gc-member-avatar gc-empty">
                        <span>?</span>
                      </div>
                    )}
                  </div>

                  <div className="gc-creator">
                    {group.is_official || !group.owner_id ? (
                      <>
                        {adminUser?.avatar_url ? (
                          <img src={adminUser.avatar_url} alt="" className="gc-creator-avatar" />
                        ) : (
                          <div className="gc-creator-avatar gc-avatar-dp">DP</div>
                        )}
                        <span>Criado por: <strong>DividePass</strong></span>
                        <span className="gc-official-badge">
                          <BadgeCheck size={12} /> Oficial
                        </span>
                      </>
                    ) : (
                      <>
                        {group.owner?.avatar_url ? (
                          <img src={group.owner.avatar_url} alt="" className="gc-creator-avatar" />
                        ) : (
                          <div className="gc-creator-avatar">
                            {(group.owner?.name || 'U')[0].toUpperCase()}
                          </div>
                        )}
                        <span>Criado por: <strong>{group.owner?.name || 'Admin'}</strong></span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {interestModal && (
          <div className="modal-overlay" onClick={() => setInterestModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3>Lista de Espera</h3>
              <p>Receba uma notificação quando um novo grupo de <strong>{selectedService.name}</strong> for aberto.</p>
              {interestSent ? (
                <div className="interest-success">
                  <Check size={24} />
                  <p>Inscrição na lista de espera realizada!</p>
                </div>
              ) : (
                <>
                  <textarea
                    placeholder="Mensagem opcional (ex: prefiro grupo de 6 pessoas)"
                    value={interestMsg}
                    onChange={e => setInterestMsg(e.target.value)}
                    rows={3}
                  />
                  <div className="modal-actions">
                    <button className="btn btn-outline" onClick={() => setInterestModal(false)}>Cancelar</button>
                    <button className="btn btn-primary" onClick={handleInterest}>
                      <Bell size={16} /> Quero Entrar na Lista
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fade-in catalog-page">
      <div className="page-header">
        <h1>Catálogo de Serviços</h1>
        <p>Assine novos serviços dividindo o valor com outras pessoas.</p>
      </div>

      <div className="catalog-toolbar">
        <div className="catalog-search-wrap">
          <Search size={16} />
          <input
            type="text"
            placeholder="Buscar serviço ou categoria..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="category-filter-bar">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            className={`category-pill ${selectedCategory === cat.key ? 'active' : ''}`}
            onClick={() => handleCategoryChange(cat.key)}
          >
            <span className="category-pill-icon">{cat.icon}</span>
            <span className="category-pill-label">{cat.label}</span>
          </button>
        ))}
      </div>

      {filteredServices.length === 0 ? (
        <div className="empty-groups">
          <p>Nenhum serviço encontrado para "{search || CATEGORIES.find(c => c.key === selectedCategory)?.label}".</p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => { setSelectedCategory('all'); setSearch(''); }}>
            Ver Todos os Serviços
          </button>
        </div>
      ) : (
        <div className="catalog-grid">
          {filteredServices.map((service, index) => {
            const subscribed = isSubscribedToService(service.id);

            return (
              <div
                className={`catalog-card ${subscribed ? 'subscribed' : ''} ${service.pinned ? 'catalog-card-pinned' : ''} ${service.featured ? 'catalog-card-featured' : ''}`}
                key={service.id}
                style={{ animationDelay: `${index * 0.06}s` }}
                onClick={() => navigate(`/dashboard/catalog/${service.slug || service.id}`)}
              >
                <div className="catalog-header" style={{ backgroundColor: service.color }}>
                  {service.icon_url ? (
                    <img src={service.icon_url} alt={service.name} className="catalog-logo" />
                  ) : (
                    <div className="catalog-icon-text">{service.icon || service.name[0]}</div>
                  )}
                  {service.pinned && (
                    <div className="catalog-badge-pin" title="Fixado no topo">
                      <Pin size={12} />
                    </div>
                  )}
                  {service.featured && (
                    <div className="catalog-badge-star" title="Destaque">
                      <Star size={12} />
                    </div>
                  )}
                </div>
                <span className="catalog-service-name">{service.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Catalog;
