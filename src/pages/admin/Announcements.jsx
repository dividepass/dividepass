import { useState, useEffect } from 'react';
import { Users, UsersRound } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import NotificationComposerCard from '../../components/NotificationComposerCard';
import { UserSearchSelect, GroupSearchSelect } from '../../components/SearchSelect';
import './Announcements.css';

function Announcements() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    message: '',
    type: 'info',
    target: 'all',
    selectedUsers: [],
    selectedGroup: null,
    channels: 'both',
  });
  const [error, setError] = useState(null);

  const fetchAnnouncements = async () => {
    setLoading(true);
    const { data, error: fetchErr } = await supabase
      .from('announcements')
      .select('*, target_user:target_user_id(id, name, email)')
      .order('created_at', { ascending: false });

    if (!fetchErr) setAnnouncements(data || []);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error: fetchErr } = await supabase
        .from('announcements')
        .select('*, target_user:target_user_id(id, name, email)')
        .order('created_at', { ascending: false });

      if (!cancelled) {
        if (!fetchErr) setAnnouncements(data || []);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const resetForm = () => {
    setForm({
      title: '',
      message: '',
      type: 'info',
      target: 'all',
      selectedUsers: [],
      selectedGroup: null,
      channels: 'both',
    });
    setError(null);
  };

  const submitAnnouncement = async () => {
    if (!form.title.trim() || !form.message.trim()) {
      setError('Título e mensagem são obrigatórios.');
      return;
    }

    if (form.target === 'users' && form.selectedUsers.length === 0) {
      setError('Selecione pelo menos um usuário.');
      return;
    }

    if (form.target === 'group' && !form.selectedGroup) {
      setError('Selecione um grupo.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        throw new Error('Você precisa estar autenticado.');
      }

      const channels = form.channels === 'push'
        ? ['push']
        : form.channels === 'alert'
          ? ['in_app']
          : ['in_app', 'push'];

      let audience;
      switch (form.target) {
        case 'users':
          audience = { type: 'users', user_ids: form.selectedUsers.map(u => u.id) };
          break;
        case 'group':
          audience = { type: 'group', group_id: form.selectedGroup.id };
          break;
        default:
          audience = { type: 'all' };
      }

      const metadata = {
        source: 'admin_announcements',
        announcement_type: form.type,
        target: form.target,
      };

      if (form.target === 'users') {
        metadata.target_users = form.selectedUsers.map(u => ({ id: u.id, name: u.name, email: u.email }));
      } else if (form.target === 'group' && form.selectedGroup) {
        metadata.target_group = { id: form.selectedGroup.id, name: form.selectedGroup.name };
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          title: form.title.trim(),
          message: form.message.trim(),
          event_type: `manual_${form.type}`,
          metadata,
          audience,
          channels,
          url: '/dashboard',
          created_by: sessionData?.session?.user?.id || null,
        }),
      });

      const result = await response.json().catch(() => ({}));
      console.log('[Announcements] send-notification result:', result);
      if (!response.ok) {
        throw new Error(result.error || 'Erro desconhecido');
      }

      await supabase.from('announcements').insert({
        title: form.title.trim(),
        message: form.message.trim(),
        type: form.type,
        is_active: true,
        status: 'published',
        target_user_id: form.target === 'users' && form.selectedUsers.length === 1
          ? form.selectedUsers[0].id
          : null,
        metadata,
      });

      resetForm();
      fetchAnnouncements();
    } catch (err) {
      setError('Erro ao enviar notificação: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = (e) => {
    e.preventDefault();
    submitAnnouncement();
  };

  const toggleActive = async (id, currentStatus) => {
    await supabase
      .from('announcements')
      .update({ is_active: !currentStatus })
      .eq('id', id);
    fetchAnnouncements();
  };

  const deleteAnnouncement = async (id) => {
    if (!window.confirm('Excluir este aviso permanentemente?')) return;
    await supabase.from('announcements').delete().eq('id', id);
    fetchAnnouncements();
  };

  const typeLabel = (type) => {
    const map = {
      info: 'Informativo',
      warning: 'Aviso',
      success: 'Sucesso',
      urgent: 'Urgente',
    };
    return map[type] || type;
  };

  const getRecipientsLabel = () => {
    switch (form.target) {
      case 'users':
        if (form.selectedUsers.length === 0) return 'Selecione os usuários';
        if (form.selectedUsers.length === 1) return `1 usuário selecionado`;
        return `${form.selectedUsers.length} usuários selecionados`;
      case 'group':
        return form.selectedGroup ? `Grupo: ${form.selectedGroup.name}` : 'Selecione um grupo';
      default:
        return 'Todos os usuários';
    }
  };

  return (
    <div className="fade-in">
      <div className="admin-header">
        <h1>Avisos</h1>
        <p>Crie avisos para todos os usuários, selecionados ou para um grupo.</p>
      </div>

      <div className="admin-card announcement-form-card">
        <h2>Criar Novo Aviso</h2>
        <form onSubmit={handleCreate} className="announcement-form">
          <div className="form-row">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="info">Informativo</option>
              <option value="warning">Aviso</option>
              <option value="success">Sucesso</option>
              <option value="urgent">Urgente</option>
            </select>
          </div>

          <div className="form-row target-row">
            <div className="target-toggle">
              <button
                type="button"
                className={`target-btn ${form.target === 'all' ? 'active' : ''}`}
                onClick={() => setForm({ ...form, target: 'all', selectedUsers: [], selectedGroup: null })}
              >
                Todos
              </button>
              <button
                type="button"
                className={`target-btn ${form.target === 'users' ? 'active' : ''}`}
                onClick={() => setForm({ ...form, target: 'users', selectedGroup: null })}
              >
                <Users size={14} /> Usuários
              </button>
              <button
                type="button"
                className={`target-btn ${form.target === 'group' ? 'active' : ''}`}
                onClick={() => setForm({ ...form, target: 'group', selectedUsers: [] })}
              >
                <UsersRound size={14} /> Grupo
              </button>
            </div>

            {form.target === 'users' && (
              <UserSearchSelect
                selected={form.selectedUsers}
                onChange={(users) => setForm({ ...form, selectedUsers: users })}
                placeholder="Buscar por nome ou e-mail..."
              />
            )}

            {form.target === 'group' && (
              <GroupSearchSelect
                selected={form.selectedGroup}
                onChange={(group) => setForm({ ...form, selectedGroup: group })}
                placeholder="Buscar grupo por nome..."
              />
            )}
          </div>

          <NotificationComposerCard
            title={form.title}
            setTitle={(value) => setForm({ ...form, title: value })}
            message={form.message}
            setMessage={(value) => setForm({ ...form, message: value })}
            channels={form.channels}
            setChannels={(value) => setForm({ ...form, channels: value })}
            onSubmit={handleCreate}
            loading={saving}
            error={error}
            titleLabel="Título do Aviso"
            messageLabel="Mensagem"
            titlePlaceholder="Título do aviso"
            messagePlaceholder="Mensagem do aviso..."
            recipientsLabel={getRecipientsLabel()}
            scopeBadge={form.type === 'urgent' ? 'Urgente' : 'Aviso manual'}
            submitLabel="Publicar Aviso"
            description="Escolha o canal de envio e publique o aviso manualmente."
            buttonType="button"
          />
        </form>
      </div>

      <div className="admin-card table-responsive">
        <h2>Avisos Publicados</h2>
        {loading ? (
          <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Carregando...
          </p>
        ) : announcements.length === 0 ? (
          <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Nenhum aviso publicado ainda.
          </p>
        ) : (
          <table className="invoice-table" style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Título</th>
                <th>Tipo</th>
                <th>Alvo</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {announcements.map((a) => (
                <tr key={a.id}>
                  <td>
                    {new Date(a.created_at).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td>{a.title}</td>
                  <td>
                    <span className={`status-badge ${a.type}`}>{typeLabel(a.type)}</span>
                  </td>
                  <td>
                    {a.target_user
                      ? `${a.target_user.name} (${a.target_user.email})`
                      : a.metadata?.target === 'users' && a.metadata?.target_users?.length
                        ? a.metadata.target_users.map(u => u.name || u.email).join(', ')
                        : a.metadata?.target === 'group' && a.metadata?.target_group
                          ? `Grupo: ${a.metadata.target_group.name}`
                          : 'Todos'}
                  </td>
                  <td>
                    <span className={`status-badge ${a.is_active ? 'pago' : 'cancelado'}`}>
                      {a.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="actions-cell">
                    <button
                      className="btn btn-outline toggle-btn"
                      onClick={() => toggleActive(a.id, a.is_active)}
                    >
                      {a.is_active ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      className="btn btn-outline delete-btn"
                      onClick={() => deleteAnnouncement(a.id)}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default Announcements;
