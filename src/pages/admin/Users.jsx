import { useState, useEffect, useMemo } from 'react';
import { Search, Phone, Shield, User, Eye, Loader2, Trash2, RefreshCw, MessageCircle, ArrowUpDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import './Users.css';

const SORT_OPTIONS = [
  { key: 'name_asc', label: 'Nome (A-Z)' },
  { key: 'name_desc', label: 'Nome (Z-A)' },
  { key: 'created_desc', label: 'Mais recentes' },
  { key: 'created_asc', label: 'Mais antigos' },
  { key: 'status', label: 'Status' },
];

const STATUS_OPTIONS = [
  { key: 'all', label: 'Todos os status' },
  { key: 'active', label: 'Ativos' },
  { key: 'inactive', label: 'Inativos' },
  { key: 'pending', label: 'Pendentes' },
  { key: 'suspended', label: 'Suspensos' },
];

const STATUS_LABELS = {
  active: 'Ativo',
  inactive: 'Inativo',
  pending: 'Pendente',
  suspended: 'Suspenso',
};

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [deletingUser, setDeletingUser] = useState(null);
  const [syncingMembers, setSyncingMembers] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [sortBy, setSortBy] = useState('created_desc');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [pushFilter, setPushFilter] = useState('all');

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();

    const list = users.filter((user) => {
      if (query) {
        const matches =
          user.name?.toLowerCase().includes(query) ||
          user.email?.toLowerCase().includes(query) ||
          (user.phone && user.phone.includes(query));
        if (!matches) return false;
      }

      if (statusFilter !== 'all' && user.status !== statusFilter) return false;
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;

      if (pushFilter === 'with' && !user.push_notifications_enabled_at) return false;
      if (pushFilter === 'without' && user.push_notifications_enabled_at) return false;

      return true;
    });

    const byName = (a, b) => (a?.name || '').localeCompare(b?.name || '', 'pt-BR');

    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'name_asc':
          return byName(a, b);
        case 'name_desc':
          return byName(b, a);
        case 'created_asc':
          return new Date(a.created_at) - new Date(b.created_at);
        case 'status':
          return (a.status || '').localeCompare(b.status || '') || byName(a, b);
        case 'created_desc':
        default:
          return new Date(b.created_at) - new Date(a.created_at);
      }
    });
  }, [users, search, statusFilter, roleFilter, pushFilter, sortBy]);

  const hasActiveFilters =
    statusFilter !== 'all' || roleFilter !== 'all' || pushFilter !== 'all' || search.trim() !== '';

  useEffect(() => {
    let cancelled = false;

    const loadUsers = async () => {
      try {
        if (!cancelled) setLoading(true);
        const { data, error: supabaseError } = await supabase
          .from('users')
          .select('id, name, email, phone, role, status, created_at, push_notifications_enabled_at')
          .order('created_at', { ascending: false });

        if (supabaseError) throw supabaseError;
        if (!cancelled) {
          setUsers(data || []);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadUsers();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSyncAllMembers = async () => {
    if (!window.confirm('Sincronizar todos os membros? Isso vai verificar todas as assinaturas ativas e garantir que os usuários estão nos grupos corretos.')) return;
    setSyncingMembers(true);
    setSyncResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setSyncResult(data);
    } catch (e) {
      setSyncResult({ error: e.message });
    }
    setSyncingMembers(false);
  };

  const handleWhatsApp = (user) => {
    const phone = normalizePhone(user.phone);
    if (!phone) {
      alert('Este usuário não tem WhatsApp cadastrado.');
      return;
    }

    const nome = (user.name || '').split(' ')[0] || 'tudo bem';
    const texto =
      `Olá, ${nome}! Aqui é do suporte do DividePass. ` +
      `Podemos falar sobre a sua conta?`;

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener,noreferrer');
  };

  const handleDeleteUser = async (userId, userName) => {
    if (!window.confirm(`Tem certeza que deseja excluir o usuário "${userName}"?\n\nEsta ação irá:\n- Remover todos os dados do usuário\n- Remover de todos os grupos\n- Excluir a conta permanentemente\n\nEsta ação NÃO pode ser desfeita.`)) {
      return;
    }

    setDeletingUser(userId);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('admin-delete-user', {
        body: { target_user_id: userId },
      });

      if (fnError) throw new Error(fnError.message || 'Erro ao excluir usuário');
      if (data?.error) throw new Error(data.error);

      setUsers(prev => prev.filter(u => u.id !== userId));
      alert('Usuário excluído com sucesso');
    } catch (err) {
      alert('Erro: ' + err.message);
    } finally {
      setDeletingUser(null);
    }
  };

  return (
    <div className="fade-in users-page">
      <div className="admin-header">
        <div>
          <h1>Gestão de Usuários</h1>
          <p className="page-subtitle">
            {hasActiveFilters
              ? `${filteredUsers.length} de ${users.length} usuários`
              : `${users.length} usuários cadastrados`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn btn-outline" onClick={handleSyncAllMembers} disabled={syncingMembers}>
            {syncingMembers ? <><Loader2 size={14} className="spin" /> Sincronizando...</> : <><RefreshCw size={14} /> Sincronizar Membros</>}
          </button>
          <button className="btn btn-primary">+ Novo Usuário</button>
        </div>
      </div>
      {syncResult && !syncResult.error && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
          <strong>Sincronização concluída:</strong> {syncResult.synced || 0} membro(s) adicionado(s), {syncResult.already_ok || 0} já estavam OK, {syncResult.orphan_members || 0} órfãos(s), {syncResult.errors || 0} erro(s).
          {syncResult.error_details && <div style={{ color: 'var(--danger)', marginTop: '0.25rem' }}>{syncResult.error_details.join(', ')}</div>}
        </div>
      )}
      {syncResult?.error && (
        <div className="error-banner" style={{ marginBottom: '1rem' }}>Erro: {syncResult.error}</div>
      )}

      <div className="users-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Buscar por nome, e-mail ou celular..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="users-filters">
          <label className="users-filter">
            <ArrowUpDown size={14} />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Ordenar por">
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </label>

          <select
            className="users-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filtrar por status"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>

          <select
            className="users-filter-select"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filtrar por permissão"
          >
            <option value="all">Toda permissão</option>
            <option value="user">Somente usuários</option>
            <option value="admin">Somente administradores</option>
          </select>

          <select
            className="users-filter-select"
            value={pushFilter}
            onChange={(e) => setPushFilter(e.target.value)}
            aria-label="Filtrar por notificação push"
          >
            <option value="all">Push: todos</option>
            <option value="with">Com push ativado</option>
            <option value="without">Sem push</option>
          </select>

          {hasActiveFilters && (
            <button
              className="users-filter-clear"
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
                setRoleFilter('all');
                setPushFilter('all');
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="error-banner">
          Erro ao carregar usuários: {error}
        </div>
      )}

      {loading ? (
        <div className="loading-state">
          <Loader2 size={32} className="spin" />
          <p>Carregando usuários...</p>
        </div>
      ) : (
        <div className="users-table-card">
          <div className="table-responsive">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Contato</th>
                  <th>Permissão</th>
                  <th>Status</th>
                  <th>Cadastro</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => (
                  <tr key={user.id}>
                    <td>
                      <div className="user-cell">
                        <div className="user-avatar">
                          {user.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <strong>{user.name}</strong>
                          <span>{user.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="contact-cell">
                        <Phone size={14} />
                        {user.phone || 'Não informado'}
                      </div>
                    </td>
                    <td>
                      <span className={`role-badge ${user.role}`}>
                        {user.role === 'admin' ? (
                          <><Shield size={12} /> Administrador</>
                        ) : (
                          <><User size={12} /> Usuário</>
                        )}
                      </span>
                      {user.push_notifications_enabled_at && (
                        <span className="role-badge push-enabled" style={{ marginLeft: '0.35rem', background: 'rgba(16,185,129,0.1)', color: '#10b981', fontSize: '0.7rem' }}>
                        Push
                      </span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${user.status}`}>
                        {STATUS_LABELS[user.status] || user.status || '—'}
                      </span>
                    </td>
                    <td>
                      <span className="date-cell">
                        {new Date(user.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button
                          className="action-btn whatsapp"
                          title={user.phone ? `Falar no WhatsApp com ${user.name}` : 'Usuário sem WhatsApp cadastrado'}
                          onClick={() => handleWhatsApp(user)}
                          disabled={!user.phone}
                          style={!user.phone ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
                        >
                          <MessageCircle size={18} />
                        </button>
                        <Link to={`/admin/users/${user.id}`} className="action-btn" title="Ver detalhes">
                          <Eye size={18} />
                        </Link>
                        <button
                          className="action-btn danger"
                          title="Excluir usuário"
                          onClick={() => handleDeleteUser(user.id, user.name)}
                          disabled={deletingUser === user.id || user.role === 'admin'}
                        >
                          {deletingUser === user.id ? <Loader2 size={18} className="spin" /> : <Trash2 size={18} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredUsers.length === 0 && !loading && (
            <div className="empty-table">
              <p>Nenhum usuário encontrado.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Users;
