import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, Loader2, ChevronLeft, Pencil, Trash2, Heart, Search, X,
  AlertCircle, CheckCircle, Clock, Ban, MessageSquare, Shield,
  DollarSign, Users, TrendingUp, CreditCard, Activity, BarChart3
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import InterestList from './InterestList';
import './Platforms.css';

const TABS = [
  { id: 'platforms', label: 'Plataformas', icon: <BarChart3 size={16} /> },
  { id: 'groups', label: 'Grupos', icon: <Users size={16} /> },
  { id: 'financial', label: 'Financeiro', icon: <DollarSign size={16} /> },
];

function Platforms() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('platforms');

  return (
    <div className="fade-in platforms-page">
      <div className="admin-header">
        <div>
          <h1>Plataformas & Grupos</h1>
        </div>
      </div>

      <div className="pf-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`pf-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'platforms' && <PlatformsTab />}
      {activeTab === 'groups' && <GroupsTab />}
      {activeTab === 'financial' && <FinancialTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════
   TAB: PLATAFORMAS
   ═══════════════════════════════════════════ */
function PlatformsTab() {
  const navigate = useNavigate();
  const [platforms, setPlatforms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const { data, error: supabaseError } = await supabase
          .from('streaming_services')
          .select('*')
          .order('name');
        if (supabaseError) throw supabaseError;
        setPlatforms(data || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = platforms.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase()) ||
    p.full_name?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando plataformas...</p>
      </div>
    );
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="platforms-search">
          <input
            type="text"
            placeholder="Buscar plataforma..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Link to="/admin/platforms/new" className="btn btn-primary">
          <Plus size={18} /> Nova Plataforma
        </Link>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>Nenhuma plataforma encontrada.</p>
        </div>
      ) : (
        <div className="platforms-grid">
          {filtered.map(platform => (
            <button
              key={platform.id}
              className={`platform-card ${platform.status !== 'active' ? 'platform-inactive' : ''}`}
              onClick={() => navigate(`/admin/platforms/${platform.id}/edit`)}
              style={{ '--platform-color': platform.color }}
            >
              <div className="platform-icon" style={{ backgroundColor: platform.color }}>
                {platform.icon_url ? (
                  <img src={platform.icon_url} alt={platform.name} />
                ) : (
                  platform.icon || platform.name?.[0] || '?'
                )}
              </div>
              <div className="platform-info">
                <h4>{platform.full_name || platform.name}</h4>
              </div>
              <span className={`platform-status ${platform.status === 'active' ? 'active' : 'inactive'}`}>
                {platform.status === 'active' ? 'ATIVO' : 'INATIVO'}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════
   TAB: GRUPOS (merged from Groups.jsx)
   ═══════════════════════════════════════════ */
function GroupsTab() {
  const navigate = useNavigate();
  const [services, setServices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const initialLoadDone = useRef(false);

  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedService, setSelectedService] = useState(null);
  const [groupSearch, setGroupSearch] = useState('');

  const [groupTab, setGroupTab] = useState('all');
  const [pendingGroups, setPendingGroups] = useState([]);
  const [rejectedGroups, setRejectedGroups] = useState([]);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processingId, setProcessingId] = useState(null);

  useEffect(() => {
    if (initialLoadDone.current) return;
    let cancelled = false;

    const loadData = async () => {
      try {
        if (!cancelled) setLoading(true);
        const [servicesRes, groupsRes] = await Promise.all([
          supabase.from('streaming_services').select('*').order('name'),
          supabase.from('groups').select(`
            *,
            service:service_id (*),
            owner:owner_id (id, name),
            members:group_members (*, user:user_id (id, name, email))
          `).order('name')
        ]);

        if (servicesRes.error) throw servicesRes.error;
        if (groupsRes.error) throw groupsRes.error;

        if (!cancelled) {
          setServices(servicesRes.data || []);
          setGroups(groupsRes.data || []);
          setPendingGroups((groupsRes.data || []).filter(g => g.approval_status === 'pending'));
          setRejectedGroups((groupsRes.data || []).filter(g => g.approval_status === 'rejected'));
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          initialLoadDone.current = true;
        }
      }
    };

    loadData();
    return () => { cancelled = true; };
  }, []);

  const handleDelete = async (id) => {
    if (!confirm('Tem certeza que deseja excluir este grupo?')) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-group`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ group_id: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao excluir grupo');
      setGroups(prev => prev.filter(g => g.id !== id));
      setPendingGroups(prev => prev.filter(g => g.id !== id));
      setRejectedGroups(prev => prev.filter(g => g.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleApproveGroup = async (groupId) => {
    setProcessingId(groupId);
    try {
      const group = pendingGroups.find(g => g.id === groupId);
      const { error } = await supabase.from('groups').update({
        approval_status: 'approved',
        approved_at: new Date().toISOString(),
      }).eq('id', groupId);
      if (error) throw error;

      await supabase.from('platform_events').insert({
        event_type: 'group_approved',
        title: 'Grupo aprovado',
        message: `O grupo "${group?.name || groupId}" foi aprovado e agora está visível no catálogo.`,
        metadata: JSON.stringify({ group_id: groupId, group_name: group?.name }),
        created_by: (await supabase.auth.getUser()).data.user?.id,
      });

      if (group?.owner_id) {
        await supabase.from('notifications').insert({
          user_id: group.owner_id,
          title: 'Grupo aprovado!',
          message: `Seu grupo "${group?.name}" foi aprovado e já está visível no catálogo.`,
          event_type: 'group_approved',
          metadata: JSON.stringify({ group_id: groupId }),
        });
      }

      setPendingGroups(prev => prev.filter(g => g.id !== groupId));
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, approval_status: 'approved', approved_at: new Date().toISOString() } : g));
    } catch (err) {
      setError(err.message);
    }
    setProcessingId(null);
  };

  const handleRejectGroup = async () => {
    if (!rejectModal || !rejectReason.trim()) return;
    setProcessingId(rejectModal.id);
    try {
      const { error } = await supabase.from('groups').update({
        approval_status: 'rejected',
        rejection_reason: rejectReason.trim(),
      }).eq('id', rejectModal.id);
      if (error) throw error;

      await supabase.from('platform_events').insert({
        event_type: 'group_rejected',
        title: 'Grupo recusado',
        message: `O grupo "${rejectModal.name}" foi recusado. Motivo: ${rejectReason.trim()}`,
        metadata: JSON.stringify({ group_id: rejectModal.id, group_name: rejectModal.name, reason: rejectReason.trim() }),
        created_by: (await supabase.auth.getUser()).data.user?.id,
      });

      if (rejectModal.owner_id) {
        await supabase.from('notifications').insert({
          user_id: rejectModal.owner_id,
          title: 'Grupo recusado',
          message: `Seu grupo "${rejectModal.name}" foi recusado. Motivo: ${rejectReason.trim()}`,
          event_type: 'group_rejected',
          metadata: JSON.stringify({ group_id: rejectModal.id, reason: rejectReason.trim() }),
        });
      }

      setPendingGroups(prev => prev.filter(g => g.id !== rejectModal.id));
      setGroups(prev => prev.map(g => g.id === rejectModal.id ? { ...g, approval_status: 'rejected', rejection_reason: rejectReason.trim() } : g));
      setRejectModal(null);
      setRejectReason('');
    } catch (err) {
      setError(err.message);
    }
    setProcessingId(null);
  };

  const openRejectModal = (group) => {
    setRejectModal(group);
    setRejectReason('');
  };

  const getActiveMembers = (group) =>
    group.members?.filter(m => m.status === 'active' || m.status === 'pending').length || 0;

  // Esta aba só lista plataformas que têm ao menos um grupo. A aba Plataformas
// continua mostrando todas, senão o admin não consegue editar uma plataforma
// que ainda não tem grupo.
  const servicesWithGroups = useMemo(() => {
    const ids = new Set(groups.map(g => g.service_id).filter(Boolean));
    return services.filter(s => ids.has(s.id));
  }, [services, groups]);

  const filteredServices = servicesWithGroups.filter(s =>
    s.name?.toLowerCase().includes(serviceSearch.toLowerCase()) ||
    s.full_name?.toLowerCase().includes(serviceSearch.toLowerCase())
  );

  const selectedServiceData = services.find(s => s.id === selectedService);

  const serviceGroups = selectedService
    ? groups.filter(g => g.service_id === selectedService)
    : [];

  const filteredGroups = serviceGroups.filter(g =>
    g.name?.toLowerCase().includes(groupSearch.toLowerCase()) ||
    g.reference_code?.toLowerCase().includes(groupSearch.toLowerCase()) ||
    g.owner?.name?.toLowerCase().includes(groupSearch.toLowerCase())
  );

  const sortedGroups = [...filteredGroups].sort((a, b) => {
    const aOfficial = a.is_official ? 2 : 0;
    const bOfficial = b.is_official ? 2 : 0;
    if (aOfficial !== bOfficial) return bOfficial - aOfficial;

    const aPinned = (a.pinned || a.verified) ? 1 : 0;
    const bPinned = (b.pinned || b.verified) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;

    const aMembers = getActiveMembers(a);
    const bMembers = getActiveMembers(b);
    if (aMembers !== bMembers) return bMembers - aMembers;

    return (a.name || '').localeCompare(b.name || '');
  });

  const getSpots = (group, service) => {
    if (group.has_slot_limit === false) return Infinity;
    const maxSize = group.max_size || service?.max_group_size;
    if (!maxSize) return Infinity;
    return Math.max(0, maxSize - getActiveMembers(group));
  };

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando grupos...</p>
      </div>
    );
  }

  if (selectedService) {
    return (
      <>
        <div className="admin-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button className="back-btn-platform" onClick={() => { setSelectedService(null); setGroupSearch(''); }}>
              <ChevronLeft size={18} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div className="service-icon-sm" style={{ backgroundColor: selectedServiceData?.color }}>
                {selectedServiceData?.icon_url ? (
                  <img src={selectedServiceData.icon_url} alt="" />
                ) : (
                  selectedServiceData?.icon || selectedServiceData?.name?.[0]
                )}
              </div>
              <div>
                <h1>{selectedServiceData?.full_name || selectedServiceData?.name}</h1>
                <p className="page-subtitle">{serviceGroups.length} {serviceGroups.length === 1 ? 'grupo' : 'grupos'}</p>
              </div>
            </div>
          </div>
          <div className="groups-header-actions">
            <Link to="/admin/interest" className="btn btn-outline btn-sm">
              <Heart size={16} /> Lista de Espera
            </Link>
            <Link to={`/admin/groups/new?service=${selectedService}`} className="btn btn-primary">
              <Plus size={18} /> Novo Grupo
            </Link>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="groups-search-bar">
          <Search size={16} />
          <input
            type="text"
            placeholder="Buscar por nome, código ou criador..."
            value={groupSearch}
            onChange={e => setGroupSearch(e.target.value)}
          />
          {groupSearch && (
            <button className="search-clear" onClick={() => setGroupSearch('')}>
              <X size={14} />
            </button>
          )}
        </div>

        {sortedGroups.length === 0 ? (
          <div className="empty-groups">
            {serviceGroups.length === 0 ? (
              <>
                <p>Nenhum grupo cadastrado para {selectedServiceData?.name}.</p>
                <button className="btn btn-outline btn-sm" onClick={() => navigate(`/admin/groups/new?service=${selectedService}`)}>
                  Criar primeiro grupo
                </button>
              </>
            ) : (
              <p>Nenhum grupo encontrado para "{groupSearch}".</p>
            )}
          </div>
        ) : (
          <div className="groups-grid">
            {sortedGroups.map(group => {
              const activeMembers = getActiveMembers(group);
              const spots = getSpots(group, selectedServiceData);
              const full = spots === 0;
              const maxSize = group.max_size || selectedServiceData?.max_group_size;

              return (
                <div key={group.id} className={`group-card ${full ? 'group-full' : ''}`}>
                  <div className="gc-top">
                    {group.photo_url ? (
                      <div className="gc-photo">
                        <img src={group.photo_url} alt={group.name} />
                      </div>
                    ) : (
                      <div className="gc-photo gc-photo-placeholder" style={{ backgroundColor: selectedServiceData?.color || '#4F46E5' }}>
                        {selectedServiceData?.icon_url ? (
                          <img src={selectedServiceData.icon_url} alt="" />
                        ) : (
                          <span>{selectedServiceData?.icon || group.name?.[0]?.toUpperCase()}</span>
                        )}
                      </div>
                    )}
                    <div className="gc-info">
                      <div className="gc-name-row">
                        <h4>{group.name}</h4>
                      </div>
                      <div className="gc-stats-row">
                        <span className="gc-members">{activeMembers} de {maxSize} membros</span>
                        <span className={`gc-vagas ${full ? 'full' : ''}`}>{full ? 'CHEIO' : `${spots} VAGAS`}</span>
                        <span className="gc-ref">#{group.slug || group.id.slice(0, 6).toUpperCase()}</span>
                      </div>
                      <div className="group-meta-row" style={{ marginTop: '0.25rem' }}>
                        <span className="group-creator" style={{ fontSize: '0.7rem' }}>
                          {group.owner_id
                            ? `Criado por: ${group.owner?.name || 'Usuário'}`
                            : <strong className="creator-admin">DividePass</strong>
                          }
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="gc-divider" />

                  <div className="group-price" style={{ border: 'none', paddingTop: 0 }}>
                    <span className="price-label">Preço por vaga</span>
                    <span className="price-value" style={{ fontSize: '1.2rem' }}>
                      R$ {Number(group.price_per_slot).toFixed(2).replace('.', ',')}
                      <small>/mês</small>
                    </span>
                  </div>

                  {full && (
                    <div className="group-warning" style={{ marginTop: '0.5rem' }}>
                      <AlertCircle size={14} />
                      Grupo fechado. Não é possível adicionar novos membros.
                    </div>
                  )}

                  <div className="gc-divider" />

                  <div className="group-card-actions">
                    <Link to={`/admin/groups/${group.id}/edit`} className="group-btn edit">
                      <Pencil size={14} /> Editar
                    </Link>
                    <button className="group-btn delete" onClick={() => handleDelete(group.id)}>
                      <Trash2 size={14} /> Excluir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <p className="page-subtitle" style={{ margin: 0 }}>{groups.length} grupos em {servicesWithGroups.length} plataformas</p>
        <div className="groups-header-actions">
          <Link to="/admin/interest" className="btn btn-outline btn-sm">
            <Heart size={16} /> Lista de Espera
          </Link>
          <Link to="/admin/groups/new" className="btn btn-primary">
            <Plus size={18} /> Novo Grupo
          </Link>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="groups-tabs">
        <button className={`groups-tab ${groupTab === 'all' ? 'active' : ''}`} onClick={() => setGroupTab('all')}>
          Todos ({groups.length})
        </button>
        <button className={`groups-tab pending ${groupTab === 'pending' ? 'active' : ''}`} onClick={() => setGroupTab('pending')}>
          <Clock size={14} /> Pendentes ({pendingGroups.length})
        </button>
        <button className={`groups-tab rejected ${groupTab === 'rejected' ? 'active' : ''}`} onClick={() => setGroupTab('rejected')}>
          <Ban size={14} /> Recusados ({rejectedGroups.length})
        </button>
        <button className={`groups-tab ${groupTab === 'interest' ? 'active' : ''}`} onClick={() => setGroupTab('interest')}>
          <Heart size={14} /> Lista de Espera
        </button>
      </div>

      {groupTab === 'interest' ? (
        <InterestList embedded />
      ) : (<>
        {groupTab === 'pending' && (
          <div className="pending-groups-section">
            {pendingGroups.length === 0 ? (
              <div className="empty-groups">
                <CheckCircle size={40} style={{ color: 'var(--success, #10B981)' }} />
                <p>Nenhum grupo pendente de aprovação.</p>
              </div>
            ) : (
              <div className="pending-groups-list">
                {pendingGroups.map(group => (
                  <div key={group.id} className="pending-group-card">
                    <div className="pending-group-header">
                      <div className="pending-group-info">
                        <h3>{group.name}</h3>
                        <span className="pending-group-service">{group.service?.full_name || group.service?.name}</span>
                        <span className="pending-group-owner">Criado por: {group.owner?.name || 'Usuário'}</span>
                      </div>
                      <span className="pending-badge"><Clock size={12} /> Pendente</span>
                    </div>
                    <div className="pending-group-details">
                      <span>R$ {Number(group.price_per_slot).toFixed(2)}/mês</span>
                      <span>{group.available_cycles?.join(', ') || 'monthly'}</span>
                      <span>{group.has_entrance_fee ? `Entrada: R$ ${(group.entrance_fee || 0).toFixed(2)}` : 'Sem entrada'}</span>
                      {group.has_slot_limit && <span>{group.max_size} vagas</span>}
                    </div>
                    {group.rules && (
                      <div className="pending-group-rules"><strong>Regras:</strong> {group.rules}</div>
                    )}
                    <div className="pending-group-actions">
                      <button className="approve-btn" onClick={() => handleApproveGroup(group.id)} disabled={processingId === group.id}>
                        {processingId === group.id ? <Loader2 size={14} className="spin" /> : <CheckCircle size={14} />}
                        Aprovar
                      </button>
                      <button className="reject-btn" onClick={() => openRejectModal(group)} disabled={processingId === group.id}>
                        <Ban size={14} /> Recusar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {groupTab === 'rejected' && (
          <div className="pending-groups-section">
            {rejectedGroups.length === 0 ? (
              <div className="empty-groups"><p>Nenhum grupo recusado.</p></div>
            ) : (
              <div className="pending-groups-list">
                {rejectedGroups.map(group => (
                  <div key={group.id} className="pending-group-card rejected-card">
                    <div className="pending-group-header">
                      <div className="pending-group-info">
                        <h3>{group.name}</h3>
                        <span className="pending-group-service">{group.service?.full_name || group.service?.name}</span>
                        <span className="pending-group-owner">Criado por: {group.owner?.name || 'Usuário'}</span>
                      </div>
                      <span className="rejected-badge"><Ban size={12} /> Recusado</span>
                    </div>
                    {group.rejection_reason && (
                      <div className="rejected-reason">
                        <MessageSquare size={14} />
                        <span><strong>Motivo:</strong> {group.rejection_reason}</span>
                      </div>
                    )}
                    <div className="pending-group-actions">
                      <button className="approve-btn" onClick={() => handleApproveGroup(group.id)} disabled={processingId === group.id}>
                        {processingId === group.id ? <Loader2 size={14} className="spin" /> : <CheckCircle size={14} />}
                        Aprovar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="service-search-bar">
          <Search size={16} />
          <input
            type="text"
            placeholder="Buscar plataforma..."
            value={serviceSearch}
            onChange={e => setServiceSearch(e.target.value)}
          />
          {serviceSearch && (
            <button className="search-clear" onClick={() => setServiceSearch('')}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="platform-grid">
          {filteredServices.map(service => {
            const serviceGroupCount = groups.filter(g => g.service_id === service.id).length;
            const totalSpots = groups
              .filter(g => g.service_id === service.id)
              .reduce((sum, g) => sum + getSpots(g, service), 0);

            return (
              <button key={service.id} className="platform-card" onClick={() => setSelectedService(service.id)}>
                <div className="platform-card-icon" style={{ backgroundColor: service.color }}>
                  {service.icon_url ? (
                    <img src={service.icon_url} alt="" />
                  ) : (
                    service.icon || service.name?.[0]
                  )}
                </div>
                <div className="platform-card-info">
                  <h3>{service.full_name || service.name}</h3>
                  <span>{serviceGroupCount} {serviceGroupCount === 1 ? 'grupo' : 'grupos'} • {totalSpots} vagas</span>
                </div>
              </button>
            );
          })}
        </div>

        {filteredServices.length === 0 && (
          <div className="empty-groups">
            <p>Nenhuma plataforma encontrada para "{serviceSearch}".</p>
          </div>
        )}

        {rejectModal && (
          <div className="scheduler-overlay" onClick={() => setRejectModal(null)}>
            <div className="reject-modal" onClick={e => e.stopPropagation()}>
              <div className="reject-modal-header">
                <Ban size={20} />
                <h3>Recusar Grupo</h3>
                <button onClick={() => setRejectModal(null)} className="close-btn">&times;</button>
              </div>
              <div className="reject-modal-body">
                <p>Grupo: <strong>{rejectModal.name}</strong></p>
                <p>Plataforma: <strong>{rejectModal.service?.full_name || rejectModal.service?.name}</strong></p>
                <p>Criado por: <strong>{rejectModal.owner?.name || 'Usuário'}</strong></p>
                <div className="reject-form-group">
                  <label>Motivo da recusa *</label>
                  <textarea
                    rows={4}
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="Descreva o motivo da recusa do grupo..."
                    autoFocus
                  />
                </div>
              </div>
              <div className="reject-modal-actions">
                <button className="cancel-btn" onClick={() => setRejectModal(null)}>Cancelar</button>
                <button
                  className="confirm-reject-btn"
                  onClick={handleRejectGroup}
                  disabled={!rejectReason.trim() || processingId === rejectModal.id}
                >
                  {processingId === rejectModal.id ? <Loader2 size={14} className="spin" /> : <Ban size={14} />}
                  Confirmar Recusa
                </button>
              </div>
            </div>
          </div>
        )}
      </>)}
    </>
  );
}

/* ═══════════════════════════════════════════
   TAB: FINANCEIRO (Official groups dashboard)
   ═══════════════════════════════════════════ */
function FinancialTab() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalRevenue: 0,
    monthRevenue: 0,
    totalPayments: 0,
    activeSubscriptions: 0,
    totalMembers: 0,
    avgRevenuePerGroup: 0,
  });
  const [revenueByPlatform, setRevenueByPlatform] = useState([]);
  const [recentPayments, setRecentPayments] = useState([]);
  const [revenueByGroup, setRevenueByGroup] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadFinancial = async () => {
      try {
        setLoading(true);

        const [paymentsRes, subsRes, groupsRes, servicesRes] = await Promise.all([
          supabase.from('payment_attempts').select('*').eq('status', 'approved').order('created_at', { ascending: false }),
          supabase.from('user_subscriptions').select('*, group:groups!inner(id, name, service_id, is_official, owner_id)').eq('status', 'active'),
          supabase.from('groups').select('id, name, service_id, is_official, owner_id, price_per_slot, approval_status'),
          supabase.from('streaming_services').select('id, name, full_name, color, icon_url'),
        ]);

        if (cancelled) return;

        const payments = paymentsRes.data || [];
        const subs = subsRes.data || [];
        const allGroups = groupsRes.data || [];
        const services = servicesRes.data || [];

        const serviceMap = {};
        services.forEach(s => { serviceMap[s.id] = s; });

        const groupMap = {};
        allGroups.forEach(g => { groupMap[g.id] = g; });

        const totalRevenue = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthPayments = payments.filter(p => new Date(p.created_at) >= monthStart);
        const monthRevenue = monthPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

        const activeSubscriptions = subs.length;

        const totalMembers = allGroups.reduce((sum, g) => {
          return sum + (subs.filter(s => s.group?.id === g.id).length);
        }, 0);

        const officialGroups = allGroups.filter(g => g.is_official);
        const officialGroupIds = new Set(officialGroups.map(g => g.id));

        const officialPayments = payments.filter(p => {
          const g = groupMap[p.group_id];
          return g?.is_official || officialGroupIds.has(p.group_id);
        });
        const officialRevenue = officialPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

        setStats({
          totalRevenue,
          monthRevenue,
          totalPayments: payments.length,
          activeSubscriptions,
          totalMembers,
          avgRevenuePerGroup: officialGroups.length > 0 ? officialRevenue / officialGroups.length : 0,
        });

        const platformRevenue = {};
        payments.forEach(p => {
          const g = groupMap[p.group_id];
          if (!g) return;
          const svc = serviceMap[g.service_id];
          const key = g.service_id || 'unknown';
          if (!platformRevenue[key]) {
            platformRevenue[key] = { name: svc?.full_name || svc?.name || 'Desconhecida', color: svc?.color || '#6b7280', revenue: 0, count: 0 };
          }
          platformRevenue[key].revenue += Number(p.amount) || 0;
          platformRevenue[key].count += 1;
        });

        setRevenueByPlatform(
          Object.values(platformRevenue)
            .sort((a, b) => b.revenue - a.revenue)
        );

        const groupRevenue = {};
        payments.forEach(p => {
          const g = groupMap[p.group_id];
          if (!g) return;
          const key = p.group_id;
          if (!groupRevenue[key]) {
            const svc = serviceMap[g.service_id];
            groupRevenue[key] = {
              name: g.name,
              serviceName: svc?.name || '?',
              color: svc?.color || '#6b7280',
              revenue: 0,
              count: 0,
              isOfficial: g.is_official,
            };
          }
          groupRevenue[key].revenue += Number(p.amount) || 0;
          groupRevenue[key].count += 1;
        });

        setRevenueByGroup(
          Object.values(groupRevenue)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 20)
        );

        setRecentPayments(
          payments.slice(0, 30).map(p => ({
            ...p,
            group: groupMap[p.group_id],
          }))
        );

      } catch (err) {
        console.error('Financial load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadFinancial();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando dados financeiros...</p>
      </div>
    );
  }

  return (
    <>
      {/* Stats Cards */}
      <div className="fin-stats-grid">
        <div className="fin-stat-card">
          <div className="fin-stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10B981' }}>
            <DollarSign size={22} />
          </div>
          <div className="fin-stat-info">
            <span>Receita Total</span>
            <strong>R$ {stats.totalRevenue.toFixed(2)}</strong>
          </div>
        </div>
        <div className="fin-stat-card">
          <div className="fin-stat-icon" style={{ background: 'rgba(79, 70, 229, 0.1)', color: '#4F46E5' }}>
            <TrendingUp size={22} />
          </div>
          <div className="fin-stat-info">
            <span>Este Mês</span>
            <strong>R$ {stats.monthRevenue.toFixed(2)}</strong>
          </div>
        </div>
        <div className="fin-stat-card">
          <div className="fin-stat-icon" style={{ background: 'rgba(234, 88, 12, 0.1)', color: '#EA580C' }}>
            <CreditCard size={22} />
          </div>
          <div className="fin-stat-info">
            <span>Transações</span>
            <strong>{stats.totalPayments}</strong>
          </div>
        </div>
        <div className="fin-stat-card">
          <div className="fin-stat-icon" style={{ background: 'rgba(14, 165, 233, 0.1)', color: '#0EA5E9' }}>
            <Users size={22} />
          </div>
          <div className="fin-stat-info">
            <span>Assinaturas Ativas</span>
            <strong>{stats.activeSubscriptions}</strong>
          </div>
        </div>
      </div>

      {/* Revenue by Platform */}
      <div className="fin-section">
        <h3><BarChart3 size={18} /> Receita por Plataforma</h3>
        {revenueByPlatform.length === 0 ? (
          <div className="fin-empty">Nenhum pagamento registrado.</div>
        ) : (
          <div className="fin-bars">
            {revenueByPlatform.map((p, i) => {
              const maxRev = revenueByPlatform[0]?.revenue || 1;
              const pct = Math.max(5, (p.revenue / maxRev) * 100);
              return (
                <div key={i} className="fin-bar-row">
                  <div className="fin-bar-label">
                    <span className="fin-bar-dot" style={{ background: p.color }} />
                    <span>{p.name}</span>
                    <span className="fin-bar-count">{p.count} pagos</span>
                  </div>
                  <div className="fin-bar-track">
                    <div className="fin-bar-fill" style={{ width: `${pct}%`, background: p.color }} />
                  </div>
                  <span className="fin-bar-value">R$ {p.revenue.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Revenue by Group */}
      <div className="fin-section">
        <h3><Activity size={18} /> Receita por Grupo</h3>
        {revenueByGroup.length === 0 ? (
          <div className="fin-empty">Nenhum pagamento registrado.</div>
        ) : (
          <div className="admin-card table-responsive">
            <table className="groups-list-table">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Plataforma</th>
                  <th>Receita</th>
                  <th>Pagamentos</th>
                  <th>Tipo</th>
                </tr>
              </thead>
              <tbody>
                {revenueByGroup.map((g, i) => (
                  <tr key={i}>
                    <td>
                      <div className="group-name-cell">
                        <div className="group-thumb-placeholder" style={{ background: g.color }}>
                          {g.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <span style={{ fontWeight: 600 }}>{g.name}</span>
                      </div>
                    </td>
                    <td><span className="plan-badge" style={{ borderLeft: `3px solid ${g.color}` }}>{g.serviceName}</span></td>
                    <td><strong style={{ color: '#10B981' }}>R$ {g.revenue.toFixed(2)}</strong></td>
                    <td>{g.count}</td>
                    <td>
                      <span className={`status-badge ${g.isOfficial ? 'active' : ''}`}>
                        {g.isOfficial ? 'Oficial' : 'Usuário'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Payments */}
      <div className="fin-section">
        <h3><CreditCard size={18} /> Pagamentos Recentes</h3>
        {recentPayments.length === 0 ? (
          <div className="fin-empty">Nenhum pagamento registrado.</div>
        ) : (
          <div className="admin-card table-responsive">
            <table className="groups-list-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Grupo</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Gateway</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map((p, i) => (
                  <tr key={p.id || i}>
                    <td>
                      <span className="date-cell">
                        {p.created_at ? new Date(p.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.group?.name || '—'}</span>
                    </td>
                    <td>
                      <span className="plan-badge">
                        {p.payment_type === 'entrance' ? 'Adesão' : p.payment_type === 'subscription' ? 'Assinatura' : p.payment_type || '—'}
                      </span>
                    </td>
                    <td><strong>R$ {Number(p.amount || 0).toFixed(2)}</strong></td>
                    <td><span className="plan-badge">{p.gateway || '—'}</span></td>
                    <td>
                      <span className={`status-badge ${p.status === 'approved' ? 'active' : p.status === 'failed' ? 'rejected' : 'pending'}`}>
                        {p.status === 'approved' ? 'Aprovado' : p.status === 'failed' ? 'Falhou' : p.status || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default Platforms;
