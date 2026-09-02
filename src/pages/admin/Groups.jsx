import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Loader2,
  ChevronLeft,
  Pencil,
  Trash2,
  Heart,
  Search,
  X,
  AlertCircle,
  CheckCircle,
  Clock,
  Ban,
  MessageSquare,
  Shield
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import InterestList from './InterestList';
import './Groups.css';

function Groups() {
  const navigate = useNavigate();
  const [services, setServices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const initialLoadDone = useRef(false);

  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedService, setSelectedService] = useState(null);
  const [groupSearch, setGroupSearch] = useState('');

  // Approval tab
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'pending' | 'rejected'
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
          setError('');
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

  const filteredServices = services.filter(s =>
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

  const getSpots = (group, service) => {
    if (group.has_slot_limit === false) return Infinity;
    const maxSize = group.max_size || service?.max_group_size;
    if (!maxSize) return Infinity;
    return Math.max(0, maxSize - getActiveMembers(group));
  };

  if (loading) {
    return (
      <div className="fade-in groups-page">
        <div className="loading-state">
          <Loader2 size={32} className="spin" />
          <p>Carregando grupos...</p>
        </div>
      </div>
    );
  }

  if (selectedService) {
    return (
      <div className="fade-in groups-page">
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
              <Heart size={16} />
              Lista de Espera
            </Link>
            <Link to={`/admin/groups/new?service=${selectedService}`} className="btn btn-primary">
              <Plus size={18} />
              Novo Grupo
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

        {filteredGroups.length === 0 ? (
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
            {filteredGroups.map(group => {
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
                        <h4>
                          {group.name}
                          {group.verified && (
                            <span className="verified-badge-admin" title="Verificado">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="#3B82F6">
                                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                              </svg>
                            </span>
                          )}
                        </h4>
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
                      <Pencil size={14} />
                      Editar
                    </Link>
                    <button className="group-btn delete" onClick={() => handleDelete(group.id)}>
                      <Trash2 size={14} />
                      Excluir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fade-in groups-page">
      <div className="admin-header">
        <div>
          <h1>Grupos e Rateios</h1>
          <p className="page-subtitle">{groups.length} grupos cadastrados em {services.length} plataformas</p>
        </div>
        <div className="groups-header-actions">
          <Link to="/admin/interest" className="btn btn-outline btn-sm">
            <Heart size={16} />
            Lista de Espera
          </Link>
          <Link to="/admin/groups/new" className="btn btn-primary">
            <Plus size={18} />
            Novo Grupo
          </Link>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Tabs */}
      <div className="groups-tabs">
        <button className={`groups-tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
          Todos ({groups.length})
        </button>
        <button className={`groups-tab pending ${activeTab === 'pending' ? 'active' : ''}`} onClick={() => setActiveTab('pending')}>
          <Clock size={14} /> Pendentes ({pendingGroups.length})
        </button>
        <button className={`groups-tab rejected ${activeTab === 'rejected' ? 'active' : ''}`} onClick={() => setActiveTab('rejected')}>
          <Ban size={14} /> Recusados ({rejectedGroups.length})
        </button>
        <button className={`groups-tab ${activeTab === 'interest' ? 'active' : ''}`} onClick={() => setActiveTab('interest')}>
          <Heart size={14} /> Lista de Espera
        </button>
      </div>

      {/* Interest List Tab */}
      {activeTab === 'interest' ? (
        <InterestList embedded />
      ) : (<>
      {activeTab === 'pending' && (
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
                      <span className="pending-group-owner">
                        Criado por: {group.owner?.name || 'Usuário'}
                      </span>
                    </div>
                    <span className="pending-badge">
                      <Clock size={12} /> Pendente
                    </span>
                  </div>
                  <div className="pending-group-details">
                    <span>R$ {Number(group.price_per_slot).toFixed(2)}/mês</span>
                    <span>{group.available_cycles?.join(', ') || 'monthly'}</span>
                    <span>{group.has_entrance_fee ? `Entrada: R$ ${(group.entrance_fee || 0).toFixed(2)}` : 'Sem entrada'}</span>
                    {group.has_slot_limit && <span>{group.max_size} vagas</span>}
                  </div>
                  {group.rules && (
                    <div className="pending-group-rules">
                      <strong>Regras:</strong> {group.rules}
                    </div>
                  )}
                  <div className="pending-group-actions">
                    <button
                      className="approve-btn"
                      onClick={() => handleApproveGroup(group.id)}
                      disabled={processingId === group.id}
                    >
                      {processingId === group.id ? <Loader2 size={14} className="spin" /> : <CheckCircle size={14} />}
                      Aprovar
                    </button>
                    <button
                      className="reject-btn"
                      onClick={() => openRejectModal(group)}
                      disabled={processingId === group.id}
                    >
                      <Ban size={14} />
                      Recusar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rejected Groups View */}
      {activeTab === 'rejected' && (
        <div className="pending-groups-section">
          {rejectedGroups.length === 0 ? (
            <div className="empty-groups">
              <p>Nenhum grupo recusado.</p>
            </div>
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
                    <span className="rejected-badge">
                      <Ban size={12} /> Recusado
                    </span>
                  </div>
                  {group.rejection_reason && (
                    <div className="rejected-reason">
                      <MessageSquare size={14} />
                      <span><strong>Motivo:</strong> {group.rejection_reason}</span>
                    </div>
                  )}
                  <div className="pending-group-actions">
                    <button
                      className="approve-btn"
                      onClick={() => handleApproveGroup(group.id)}
                      disabled={processingId === group.id}
                    >
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
            <button
              key={service.id}
              className="platform-card"
              onClick={() => setSelectedService(service.id)}
            >
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

      {/* Reject Modal */}
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
    </div>
  );
}

export default Groups;
