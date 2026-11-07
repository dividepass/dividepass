import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Phone, Shield, User, Eye, Loader2, Trash2, RefreshCw, MessageCircle, ArrowUpDown, CheckSquare, Square, Pencil, X } from 'lucide-react';
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

/** Campos que fazem sentido editar em lote (o resto é individual por usuário). */
const BULK_STATUS_OPTIONS = [
  { key: '', label: 'Não alterar status' },
  { key: 'active', label: 'Ativo' },
  { key: 'inactive', label: 'Inativo' },
  { key: 'pending', label: 'Pendente' },
  { key: 'suspended', label: 'Suspenso' },
];

const BULK_ROLE_OPTIONS = [
  { key: '', label: 'Não alterar permissão' },
  { key: 'user', label: 'Usuário' },
  { key: 'admin', label: 'Administrador' },
];

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

  // ── Seleção em lote ──────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkRole, setBulkRole] = useState('');
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkReport, setBulkReport] = useState(null);
  const selectAllRef = useRef(null);

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
          return (a.status || '').localeCompare(b.status || '', 'pt-BR') || byName(a, b);
        case 'created_desc':
        default:
          return new Date(b.created_at) - new Date(a.created_at);
      }
    });
  }, [users, search, statusFilter, roleFilter, pushFilter, sortBy]);

  const hasActiveFilters =
    statusFilter !== 'all' || roleFilter !== 'all' || pushFilter !== 'all' || search.trim() !== '';

  // Administrador não entra na seleção em lote (o botão de excluir individual
  // também fica bloqueado para ele).
  const selectableUsers = useMemo(() => filteredUsers.filter((u) => u.role !== 'admin'), [filteredUsers]);
  const selectableIds = useMemo(() => selectableUsers.map((u) => u.id), [selectableUsers]);
  const selectedList = useMemo(
    () => users.filter((u) => selectedIds.has(u.id)),
    [users, selectedIds]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

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

  const toggleUser = (userId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        selectableIds.forEach((id) => next.delete(id));
      } else {
        selectableIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkOpen(false);
    setBulkReport(null);
  };

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

  /** Exclui um usuário pela edge admin (limpa dados, grupos e login). */
  const deleteUserById = async (userId) => {
    const { data, error: fnError } = await supabase.functions.invoke('admin-delete-user', {
      body: { target_user_id: userId },
    });

    if (fnError) throw new Error(fnError.message || 'Erro ao excluir usuário');
    if (data?.error) throw new Error(data.error);
  };

  const handleDeleteUser = async (userId, userName) => {
    if (!window.confirm(`Tem certeza que deseja excluir o usuário "${userName}"?\n\nEsta ação irá:\n- Remover todos os dados do usuário\n- Remover de todos os grupos\n- Excluir a conta permanentemente\n\nEsta ação NÃO pode ser desfeita.`)) {
      return;
    }

    setDeletingUser(userId);
    try {
      await deleteUserById(userId);
      setUsers(prev => prev.filter(u => u.id !== userId));
      alert('Usuário excluído com sucesso');
    } catch (err) {
      alert('Erro: ' + err.message);
    } finally {
      setDeletingUser(null);
    }
  };

  /** Exclusão em lote: uma chamada por usuário, com relatório do que falhou. */
  const handleBulkDelete = async () => {
    const alvos = selectedList.filter((u) => u.role !== 'admin');
    if (alvos.length === 0) return;

    const lista = alvos.slice(0, 8).map((u) => u.email).join(', ');
    const extra = alvos.length > 8 ? ` e mais ${alvos.length - 8}` : '';
    const ok = window.confirm(
      `Excluir ${alvos.length} usuário(s) selecionado(s)?\n\n${lista}${extra}\n\nEsta ação irá:\n- Remover todos os dados de cada usuário\n- Remover de todos os grupos\n- Excluir as contas permanentemente\n\nEsta ação NÃO pode ser desfeita.`
    );
    if (!ok) return;

    setBulkWorking(true);
    setBulkReport(null);

    const deletados = [];
    const falhos = [];

    for (const user of alvos) {
      try {
        await deleteUserById(user.id);
        deletados.push(user.id);
      } catch (err) {
        falhos.push(`${user.email}: ${err.message}`);
      }
    }

    setUsers(prev => prev.filter(u => !deletados.includes(u.id)));
    setSelectedIds(prev => {
      const next = new Set(prev);
      deletados.forEach(id => next.delete(id));
      return next;
    });

    setBulkReport({
      tipo: 'delete',
      ok: deletados.length,
      falhas: falhos,
      total: alvos.length,
    });
    setBulkWorking(false);
  };

  /** Edição em massa: status e/ou permissão. */
  const handleBulkUpdate = async () => {
    if (!bulkStatus && !bulkRole) {
      alert('Escolha ao menos um campo para alterar (status ou permissão).');
      return;
    }

    const alvos = selectedList.filter((u) => u.role !== 'admin');
    if (alvos.length === 0) return;

    const campos = [
      bulkStatus ? `status = ${bulkStatus}` : null,
      bulkRole ? `permissão = ${bulkRole}` : null,
    ].filter(Boolean).join(' e ');

    const ok = window.confirm(
      `Alterar ${alvos.length} usuário(s) selecionado(s)?\n\n${campos}\n\nOs administradores não são alterados.`
    );
    if (!ok) return;

    setBulkWorking(true);
    setBulkReport(null);

    const atualizados = [];
    const falhos = [];

    for (const user of alvos) {
      try {
        const body = { user_id: user.id };
        if (bulkStatus) body.status = bulkStatus;
        if (bulkRole) body.role = bulkRole;

        const { data, error: fnError } = await supabase.functions.invoke('admin-update-user', { body });
        if (fnError) throw new Error(fnError.message || 'Erro ao atualizar usuário');
        if (data?.error) throw new Error(data.error);

        atualizados.push(user.id);
      } catch (err) {
        falhos.push(`${user.email}: ${err.message}`);
      }
    }

    setUsers(prev => prev.map(u => {
      if (!atualizados.includes(u.id)) return u;
      return {
        ...u,
        ...(bulkStatus ? { status: bulkStatus } : {}),
        ...(bulkRole ? { role: bulkRole } : {}),
      };
    }));

    setBulkReport({
      tipo: 'update',
      ok: atualizados.length,
      falhas: falhos,
      total: alvos.length,
    });
    setBulkWorking(false);
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
        <div className="admin-header-actions">
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

        <div className="users-filters ad-filter-grid">
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
              className="users-filter-clear ad-filter-wide"
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

      {/* ── Barra de ações em lote ───────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="users-bulk-bar">
          <div className="users-bulk-count">
            <CheckSquare size={16} />
            <strong>{selectedIds.size}</strong> selecionado{selectedIds.size > 1 ? 's' : ''}
          </div>

          <div className="users-bulk-actions">
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setBulkOpen((v) => !v)}
              disabled={bulkWorking}
            >
              <Pencil size={14} /> Editar em massa
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={handleBulkDelete}
              disabled={bulkWorking}
            >
              {bulkWorking ? <><Loader2 size={14} className="spin" /> Processando...</> : <><Trash2 size={14} /> Excluir selecionados</>}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={clearSelection} disabled={bulkWorking}>
              <X size={14} /> Limpar seleção
            </button>
          </div>

          {bulkOpen && (
            <div className="users-bulk-panel">
              <label className="users-bulk-field">
                Status
                <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                  {BULK_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
              </label>

              <label className="users-bulk-field">
                Permissão
                <select value={bulkRole} onChange={(e) => setBulkRole(e.target.value)}>
                  {BULK_ROLE_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
              </label>

              <button
                className="btn btn-primary btn-sm"
                onClick={handleBulkUpdate}
                disabled={bulkWorking || (!bulkStatus && !bulkRole)}
              >
                {bulkWorking ? <><Loader2 size={14} className="spin" /> Salvando...</> : 'Aplicar em massa'}
              </button>
            </div>
          )}
        </div>
      )}

      {bulkReport && (
        <div className={`users-bulk-report ${bulkReport.falhas.length ? 'has-errors' : ''}`}>
          <strong>
            {bulkReport.tipo === 'delete' ? 'Exclusão' : 'Atualização'} em massa:{' '}
            {bulkReport.ok} de {bulkReport.total} concluída(s).
          </strong>
          {bulkReport.falhas.length > 0 && (
            <ul>
              {bulkReport.falhas.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
        </div>
      )}

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
        <div className="users-table-card ad-cards">
          <div className="table-responsive">
            <table className="users-table ad-card-table ad-card-table--grid ad-card-table--pick">
              <thead>
                <tr>
                  <th className="users-select-cell">
                    <button
                      type="button"
                      className="users-check-btn"
                      onClick={toggleSelectAll}
                      title={allSelected ? 'Desmarcar todos' : 'Selecionar todos os visíveis'}
                      aria-label={allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                    >
                      {allSelected ? <CheckSquare size={18} /> : someSelected ? <Square size={18} className="users-check-mixed" /> : <Square size={18} />}
                    </button>
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className="users-check-hidden"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  </th>
                  <th>Usuário</th>
                  <th>Contato</th>
                  <th>Permissão</th>
                  <th>Status</th>
                  <th>Cadastro</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => {
                  const isSelected = selectedIds.has(user.id);
                  const isAdmin = user.role === 'admin';
                  return (
                    <tr key={user.id} className={isSelected ? 'row-selected' : ''}>
                      <td className="users-select-cell ad-pick">
                        <button
                          type="button"
                          className="users-check-btn"
                          onClick={() => toggleUser(user.id)}
                          disabled={isAdmin}
                          title={isAdmin ? 'Administrador não entra na seleção em lote' : (isSelected ? 'Desmarcar' : 'Selecionar')}
                          aria-label={`Selecionar ${user.email}`}
                        >
                          {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                        </button>
                      </td>
                      <td className="ad-lead">
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
                      <td data-label="Contato">
                        <div className="contact-cell">
                          <Phone size={14} />
                          {user.phone || 'Não informado'}
                        </div>
                      </td>
                      <td data-label="Permissão">
                        <span className="users-perm-cell">
                          <span className={`role-badge ${user.role}`}>
                            {user.role === 'admin' ? (
                              <><Shield size={12} /> Administrador</>
                            ) : (
                              <><User size={12} /> Usuário</>
                            )}
                          </span>
                          {user.push_notifications_enabled_at && (
                            <span className="role-badge push-enabled">Push</span>
                          )}
                        </span>
                      </td>
                      <td data-label="Status">
                        <span className={`status-badge ${user.status}`}>
                          {STATUS_LABELS[user.status] || user.status || '—'}
                        </span>
                      </td>
                      <td data-label="Cadastro">
                        <span className="date-cell">
                          {new Date(user.created_at).toLocaleDateString('pt-BR')}
                        </span>
                      </td>
                      <td className="ad-actions">
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
                            disabled={deletingUser === user.id || isAdmin}
                          >
                            {deletingUser === user.id ? <Loader2 size={18} className="spin" /> : <Trash2 size={18} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
