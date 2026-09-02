import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Camera, Save, ArrowLeft, Trash2, AlertTriangle, Loader2, MessageCircle, Bell, BellOff, Copy, Check } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { optimizeImage } from '../../lib/imageOptimizer';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import './UserProfile.css';

export default function UserProfile() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const fileInputRef = useRef(null);
  const { supported: pushSupported, permission: pushPermission, enabled: pushEnabled, loading: pushLoading, enablePush, disablePush } = usePushNotifications();

  const [form, setForm] = useState(() => ({
    name: profile?.name || '',
    nickname: profile?.nickname || '',
    phone: profile?.phone || '',
    birthdate: profile?.birthdate || '',
  }));
  const [avatarUrl, setAvatarUrl] = useState(() => profile?.avatar_url || null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [pendingPayments, setPendingPayments] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Selecione uma imagem válida.' });
      return;
    }

    const optimized = await optimizeImage(file, 'avatar');
    setAvatarFile(optimized);
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target.result);
    reader.readAsDataURL(optimized);
  };

  const uploadAvatar = async () => {
    if (!avatarFile) return avatarUrl;

    const ext = avatarFile.name.split('.').pop();
    const path = `${user.id}/avatar.${ext}`;

    const { error } = await supabase.storage
      .from('profile-photos')
      .upload(path, avatarFile, { upsert: true });

    if (error) {
      console.error('Upload error:', error);
      setMessage({ type: 'error', text: 'Erro no upload: ' + error.message });
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(path);

    return urlData?.publicUrl || null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      let newAvatarUrl = avatarUrl;

      if (avatarFile) {
        newAvatarUrl = await uploadAvatar();
        if (!newAvatarUrl) {
          setSaving(false);
          return;
        }
      }

      const updateData = {
        name: form.name,
        avatar_url: newAvatarUrl,
      };

      if (form.phone !== undefined) updateData.phone = form.phone || null;
      if (form.nickname !== undefined) updateData.nickname = form.nickname || null;
      if (form.birthdate !== undefined) updateData.birthdate = form.birthdate || null;

      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', user.id);

      if (error) {
        console.error('Update error:', error);
        if (error.message.includes('column') && error.message.includes('does not exist')) {
          setMessage({ type: 'error', text: 'Execute a migração SQL no Supabase primeiro. Veja: database/add-user-profile-fields.sql' });
        } else {
          setMessage({ type: 'error', text: 'Erro ao salvar: ' + error.message });
        }
      } else {
        setAvatarUrl(newAvatarUrl);
        setAvatarFile(null);
        setAvatarPreview(null);
        setMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' });
        await refreshProfile();
      }
    } catch (err) {
      console.error('Unexpected error:', err);
      setMessage({ type: 'error', text: 'Erro inesperado: ' + err.message });
    } finally {
      setSaving(false);
    }
  };

  const displayImage = avatarPreview || avatarUrl;
  const initials = (form.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const handleDeleteAccount = async () => {
    if (!window.confirm('Tem certeza que deseja excluir sua conta?\n\nEsta ação irá:\n- Remover todos os seus dados\n- Remover de todos os grupos\n- Excluir sua conta permanentemente\n\nEsta ação NÃO pode ser desfeita.')) {
      return;
    }

    setDeleting(true);
    setDeleteError('');
    setPendingPayments(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('delete-account');

      if (fnError) {
        const errData = typeof fnError === 'object' ? fnError : { error: fnError };
        if (errData.error === 'has_pending_payments') {
          setDeleteError(errData.message);
          setPendingPayments(errData.pending);
          return;
        }
        throw new Error(errData.error || fnError.message || 'Erro ao excluir conta');
      }

      if (data?.error === 'has_pending_payments') {
        setDeleteError(data.message);
        setPendingPayments(data.pending);
        return;
      }

      if (data?.error) throw new Error(data.error);

      await supabase.auth.signOut();
      navigate('/');
      alert('Conta excluída com sucesso');
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleTogglePush = async () => {
    try {
      if (pushEnabled) {
        await disablePush();
      } else {
        await enablePush();
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleCopyName = async () => {
    try {
      await navigator.clipboard.writeText(form.name);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  return (
    <div className="profile-page fade-in">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1>Meu Perfil</h1>
          <p>Gerencie seus dados pessoais</p>
        </div>
      </div>

      <form className="profile-card" onSubmit={handleSubmit}>
        <div className="profile-notifications-card">
          <div className="profile-notifications-header">
            <div>
              <h3>Notificações push</h3>
              <p>Receba alertas mesmo fora da tela do app.</p>
            </div>
            <span className={`profile-notifications-status ${pushEnabled ? 'on' : 'off'}`}>
              {pushEnabled ? 'Ativo' : 'Inativo'}
            </span>
          </div>
          <div className="profile-notifications-body">
            <div className="profile-notifications-text">
              <strong>{pushSupported ? 'Notificações em segundo plano disponíveis' : 'Este navegador não suporta push'}</strong>
              <span>
                {pushPermission === 'granted'
                  ? 'Permissão já concedida para este dispositivo.'
                  : 'Você precisa autorizar o navegador para receber notificações.'}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleTogglePush}
              disabled={!pushSupported || pushLoading}
            >
              {pushLoading ? <Loader2 size={14} className="spin" /> : (pushEnabled ? <BellOff size={14} /> : <Bell size={14} />)}
              {pushEnabled ? 'Desativar push' : 'Ativar push'}
            </button>
          </div>
        </div>

        <div className="profile-avatar-section">
          <button
            type="button"
            className="profile-avatar-btn"
            onClick={handleAvatarClick}
            title="Trocar foto"
          >
            {displayImage ? (
              <img src={displayImage} alt="Avatar" className="profile-avatar-img" />
            ) : (
              <span className="profile-avatar-initials">{initials}</span>
            )}
            <div className="profile-avatar-overlay">
              <Camera size={20} />
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <span className="profile-avatar-hint">Clique para trocar a foto</span>
        </div>

        {message && (
          <div className={`profile-message ${message.type}`}>
            {message.text}
          </div>
        )}

        <div className="profile-fields">
          <div className="form-group">
            <label htmlFor="name">Nome completo</label>
            <div className="profile-name-copy-row">
              <input
                id="name"
                name="name"
                type="text"
                value={form.name}
                onChange={handleChange}
                required
                placeholder="Seu nome completo"
              />
              <button
                type="button"
                className="profile-copy-btn"
                onClick={handleCopyName}
                title="Copiar nome do perfil"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="nickname">Apelido</label>
            <input
              id="nickname"
              name="nickname"
              type="text"
              value={form.nickname}
              onChange={handleChange}
              placeholder="Como prefere ser chamado"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="phone">Celular</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                value={form.phone}
                onChange={handleChange}
                placeholder="(11) 99999-9999"
              />
            </div>

            <div className="form-group">
              <label htmlFor="birthdate">Data de nascimento</label>
              <input
                id="birthdate"
                name="birthdate"
                type="date"
                value={form.birthdate}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="form-group">
            <label>E-mail</label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="disabled-field"
            />
            <span className="field-hint">O e-mail não pode ser alterado</span>
          </div>
        </div>

        <div className="profile-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => navigate(-1)}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
          >
            <Save size={16} />
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </form>

      <div className="danger-zone">
        <h3><AlertTriangle size={18} /> Zona de Perigo</h3>
        <p>Excluir sua conta irá remover permanentemente todos os seus dados, incluindo assinaturas, pagamentos e histórico.</p>

        {deleteError && (
          <div className="delete-error">
            <AlertTriangle size={16} />
            <div>
              <p>{deleteError}</p>
              {pendingPayments && pendingPayments.length > 0 && (
                <div className="pending-payments-list">
                  <p><strong>Pagamentos pendentes:</strong></p>
                  <ul>
                    {pendingPayments.map((p, i) => (
                      <li key={i}>{p.group_name} — {p.status === 'first_attempt' ? 'Primeira tentativa' : p.status === 'awaiting_entrance' ? 'Aguardando entrada' : 'Aguardando assinatura'}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="danger-actions">
          <button
            className="btn btn-danger"
            onClick={handleDeleteAccount}
            disabled={deleting}
          >
            {deleting ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
            {deleting ? 'Excluindo...' : 'Excluir Minha Conta'}
          </button>
          <Link to="/dashboard/support" className="btn btn-outline">
            <MessageCircle size={16} /> Abrir Chamado ao Suporte
          </Link>
        </div>
      </div>
    </div>
  );
}
