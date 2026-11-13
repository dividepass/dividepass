import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Settings, Trash2, Globe, X, AlertTriangle, Loader2, ArrowRight } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import GroupTags from '../../components/GroupTags';
import { grupoDesativado, grupoEsgotado, grupoIndisponivel, statusGrupoLabel } from '../../lib/groupEstado';
import './MyGroups.css';

function DeleteGroupModal({ groupName, onConfirm, onCancel, loading, error }) {
  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={e => e.stopPropagation()}>
        <button className="confirm-modal-close" onClick={onCancel}><X size={20} /></button>
        <div className="confirm-modal-icon danger">
          <AlertTriangle size={28} />
        </div>
        <h3>Excluir grupo?</h3>
        <p>
          Tem certeza de que deseja excluir o grupo <strong>{groupName}</strong>?<br />
          Esta ação não pode ser desfeita.
        </p>
        {error && (
          <div className="confirm-modal-error">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}
        <div className="confirm-modal-actions">
          <button className="btn btn-outline" onClick={onCancel} disabled={loading}>Cancelar</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 size={15} className="spinning" /> : <Trash2 size={15} />}
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

function MyGroups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('groups')
        .select(`
          *,
          service:service_id (id, name, full_name, icon, icon_url, color, slug),
          members:group_members (id, status)
        `)
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });
      setGroups(data || []);
      setLoading(false);
    })();
  }, [user]);

  const handleDeleteClick = (group) => {
    setDeleteError('');
    setDeleteTarget(group);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    // apaga as credenciais junto (rascunhos podem ter uma linha gravada)
    await supabase.from('group_credentials').delete().eq('group_id', deleteTarget.id);
    const { error } = await supabase.from('groups').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (!error) {
      setGroups(prev => prev.filter(g => g.id !== deleteTarget.id));
      setDeleteTarget(null);
      return;
    }
    // O RLS barra a exclusão quando o grupo tem pagamento confirmado (a
    // regra vale para o usuário comum; para o admin, não). O erro cru do
    // PostgREST ("row-level security policy") não diz nada disso.
    const msg = String(error.message || '');
    const bloqueadoPorPolitica =
      /row-level security|permission denied/i.test(msg);
    setDeleteError(
      bloqueadoPorPolitica
        ? 'Este grupo tem pagamento confirmado, então a exclusão é feita pela equipe DividePass para que os valores de quem pagou sejam acertados. Abra um chamado na Suporte.'
        : `Não foi possível excluir o grupo: ${msg || 'erro desconhecido'}`
    );
  };

  if (loading) {
    return <div className="fade-in my-groups-page"><p>Carregando seus grupos...</p></div>;
  }

  return (
    <div className="fade-in my-groups-page">
      <div className="page-header-row">
        <div>
          <h1>Meus Grupos</h1>
          <p>Grupos que você criou e gerencia.</p>
        </div>
        <Link to="/dashboard/my-groups/create" className="btn btn-primary">
          <Plus size={18} />
          Criar Grupo
        </Link>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">
          <Globe size={48} />
          <h2>Nenhum grupo criado</h2>
          <p>Crie seu primeiro grupo e comece a compartilhar assinaturas.</p>
          <Link to="/dashboard/my-groups/create" className="btn btn-primary">
            <Plus size={18} />
            Criar Primeiro Grupo
          </Link>
        </div>
      ) : (
        <div className="my-groups-grid">
          {groups.map(group => {
            const activeMembers = group.members?.filter(m => m.status === 'active').length || 0;
            const spots = group.max_size ? Math.max(0, group.max_size - activeMembers) : null;
            const full = spots === 0;
            const isDraft = group.status === 'draft';
            // Grupo fechado, sem estoque ou lotado: o card fica mais
            // transparente (o cliente vê na hora o que dá para comprar).
            const inativo = grupoDesativado(group) || grupoEsgotado(group) || full;
            return (
              <div key={group.id} className={`my-group-card ${isDraft ? 'is-draft' : ''} ${inativo ? 'my-group-card-inativo' : ''}`}>
                <div className="mg-top">
                  {group.photo_url ? (
                    <div className="mg-photo">
                      <img src={group.photo_url} alt={group.name} />
                    </div>
                  ) : (
                    <div className="mg-photo mg-photo-placeholder" style={{ backgroundColor: group.service?.color || '#4F46E5' }}>
                      {group.service?.icon_url ? (
                        <img src={group.service.icon_url} alt="" />
                      ) : (
                        <span>{group.service?.icon || group.name?.[0]?.toUpperCase()}</span>
                      )}
                    </div>
                  )}
                  <div className="mg-info">
                    <div className="mg-name-row">
                      <h3>{group.name}</h3>
                      {isDraft && <span className="mg-draft-badge">Rascunho</span>}
                      {!isDraft && (
                        <span className={`mg-status-badge ${grupoIndisponivel(group) ? 'is-esgotado' : ''}`}>
                          {statusGrupoLabel(group)}
                        </span>
                      )}
                    </div>
                    <GroupTags group={group} size="sm" className="mg-tags" />
                    <div className="mg-stats-row">
                      {isDraft ? (
                        <span className="gc-members">Criação não concluída — continue de onde parou</span>
                      ) : (
                        <>
                          {group.max_size ? (
                            <span className="gc-members">{activeMembers} de {group.max_size} membros</span>
                          ) : (
                            <span className="gc-members">{activeMembers} {activeMembers === 1 ? 'membro' : 'membros'}</span>
                          )}
                          {spots !== null && (
                            <span className={`gc-vagas ${full ? 'full' : ''}`}>
                              {group.has_slot_limit === false
                                ? 'VAGAS LIVRES'
                                : full
                                  ? 'CHEIO'
                                  : `${spots} VAGAS`}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {!isDraft && (
                      <div className="mg-mobile-price">
                        <span className="gc-price-value">
                          R$ {parseFloat(group.price_per_slot || 0).toFixed(2).replace('.', ',')}
                          <small>/mês</small>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {!isDraft && <div className="gc-divider desktop-only" />}

                {!isDraft && (
                  <div className="mg-price desktop-only">
                    <span className="gc-price-value">
                      R$ {parseFloat(group.price_per_slot || 0).toFixed(2).replace('.', ',')}
                      <small>/mês</small>
                    </span>
                  </div>
                )}

                <div className="gc-divider" />

                <div className="mg-actions">
                  {isDraft ? (
                    <Link to={`/dashboard/my-groups/create?draft=${group.id}`} className="btn btn-primary btn-sm">
                      <ArrowRight size={15} />
                      Continuar
                    </Link>
                  ) : (
                    <Link to={`/dashboard/my-groups/${group.id}/manage`} className="btn btn-primary btn-sm">
                      <Settings size={15} />
                      Gerenciar
                    </Link>
                  )}
                  <button className="btn btn-sm btn-danger-outline" onClick={() => handleDeleteClick(group)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deleteTarget && (
        <DeleteGroupModal
          groupName={deleteTarget.name}
          onConfirm={handleDeleteConfirm}
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
          loading={deleting}
          error={deleteError}
        />
      )}
    </div>
  );
}

export default MyGroups;
