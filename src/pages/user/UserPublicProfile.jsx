import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Shield, Users, Calendar, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './UserPublicProfile.css';

function UserPublicProfile() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const { data: userData, error: userErr } = await supabase
        .from('users')
        .select('id, name, avatar_url, nickname, created_at, role')
        .eq('id', userId)
        .single();

      if (userErr || !userData) {
        setError('Usuário não encontrado.');
        setLoading(false);
        return;
      }

      setProfile(userData);

      const { data: memberData } = await supabase
        .from('group_members')
        .select(`
          group_id,
          joined_at,
          group:group_id (
            id, name, slug, status, price_per_slot, billing_cycle, max_size, verified,
            service:service_id (id, name, slug, icon, icon_url, color, full_name)
          )
        `)
        .eq('user_id', userId)
        .eq('status', 'active');

      const memberGroups = (memberData || [])
        .map(m => m.group)
        .filter(Boolean);

      const { data: ownedData } = await supabase
        .from('groups')
        .select(`
          id, name, slug, status, price_per_slot, billing_cycle, max_size, verified, owner_id,
          service:service_id (id, name, slug, icon, icon_url, color, full_name),
          members:group_members (id, user_id, status)
        `)
        .eq('owner_id', userId);

      const allGroups = [...memberGroups];
      if (ownedData) {
        for (const owned of ownedData) {
          if (!allGroups.find(g => g.id === owned.id)) {
            allGroups.push(owned);
          }
        }
      }

      setGroups(allGroups.filter(g => g.status !== 'closed'));
      setLoading(false);
    };

    load();
  }, [userId]);

  const getMemberSince = (date) => {
    if (!date) return '';
    const created = new Date(date);
    const now = new Date();
    const months = (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth());
    if (months < 1) return 'Membro desde este mês';
    if (months === 1) return 'Membro há 1 mês';
    return `Membro há ${months} meses`;
  };

  const getGroupActiveCount = (group) => {
    if (!group?.members) return 0;
    return group.members.filter(m => m.status === 'active').length;
  };

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando perfil...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fade-in user-public-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ArrowLeft size={18} /> Voltar
        </button>
        <div className="empty-state">
          <p>{error}</p>
          <Link to="/dashboard/catalog" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Ver Catálogo
          </Link>
        </div>
      </div>
    );
  }

  const initials = (profile.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="fade-in user-public-page">
      <button onClick={() => navigate(-1)} className="back-btn">
        <ArrowLeft size={18} /> Voltar
      </button>

      {/* Profile Card */}
      <div className="up-card up-profile-card">
        <div className="up-avatar-section">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt={profile.name} className="up-avatar" />
          ) : (
            <div className="up-avatar-placeholder">{initials}</div>
          )}
          <h1>
            {profile.nickname || profile.name}
            {profile.role === 'admin' && <span className="up-official-badge">✓ Oficial</span>}
          </h1>
          {profile.nickname && <p className="up-full-name">{profile.name}</p>}
          <div className="up-meta">
            <span className="up-meta-item">
              <Calendar size={14} /> {getMemberSince(profile.created_at)}
            </span>
          </div>
        </div>
      </div>

      {/* Groups */}
      <div className="up-card">
        <div className="up-section-header">
          <Users size={18} />
          <h2>Grupos ({groups.length})</h2>
        </div>

        {groups.length === 0 ? (
          <p className="up-empty">Este usuário ainda não participa de nenhum grupo.</p>
        ) : (
          <div className="up-groups-list">
            {groups.map(group => {
              const activeCount = getGroupActiveCount(group);
              const maxMembers = group.max_size || 4;
              return (
                <Link
                  key={group.id}
                  to={`/dashboard/groups/${group.slug || group.id}`}
                  className="up-group-card"
                >
                  <div
                    className="up-group-icon"
                    style={{ backgroundColor: group.service?.color }}
                  >
                    {group.service?.icon_url ? (
                      <img src={group.service.icon_url} alt="" className="up-group-icon-img" />
                    ) : (
                      <span>{group.service?.icon || group.service?.name?.[0]}</span>
                    )}
                  </div>
                  <div className="up-group-info">
                    <h3>{group.name}</h3>
                    <p>{group.service?.full_name || group.service?.name}</p>
                    <div className="up-group-meta">
                      <span className={`up-group-status ${group.status}`}>
                        {group.status === 'open' ? 'Aberto' : group.status === 'forming' ? 'Formando' : 'Fechado'}
                      </span>
                      <span className="up-group-members">
                        {activeCount}/{maxMembers} membros
                      </span>
                      {group.owner_id === userId && (
                        <span className="up-group-owner-badge">
                          <Shield size={10} /> Administrador
                        </span>
                      )}
                    </div>
                  </div>
                  <ExternalLink size={16} className="up-group-link-icon" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default UserPublicProfile;
