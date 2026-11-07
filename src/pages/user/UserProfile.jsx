import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Camera, Save, ArrowLeft, Trash2, AlertTriangle, Loader2, MessageCircle, Bell, BellOff, Copy, Check, Palette, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { optimizeImage } from '../../lib/imageOptimizer';
import { maskPhone, onlyDigits } from '../../lib/maskPhone';
import { cpfValido, mascararCpf, soDigitos } from '../../lib/cpf';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import AvatarPicker from '../../components/AvatarPicker';
import './UserProfile.css';

export default function UserProfile() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const fileInputRef = useRef(null);
  const { supported: pushSupported, permission: pushPermission, enabled: pushEnabled, loading: pushLoading, enablePush, disablePush } = usePushNotifications();

  const [form, setForm] = useState(() => ({
    name: profile?.name || '',
    nickname: profile?.nickname || '',
    phone: maskPhone(profile?.phone || ''),
    birthdate: profile?.birthdate || '',
  }));
  const [avatarUrl, setAvatarUrl] = useState(() => profile?.avatar_url || null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [pendingPayments, setPendingPayments] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarPreset, setAvatarPreset] = useState(null);
  const [showAvatars, setShowAvatars] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);

  // ── CPF ──────────────────────────────────────────────────────────────────
  // O Pix Automático (Woovi) amarra a cobrança recorrente ao CPF do pagador.
  // Quem tem CPF cadastrado NUNCA é perguntado de novo no checkout — por isso
  // ele precisa existir aqui, no perfil.
  //
  // A coluna `users.cpf` é sensível: o front NÃO consegue LÊ-la (o banco
  // bloqueia o SELECT) e só o dono pode GRAVÁ-la. O status chega pela função
  // `meu_cpf_status()`, que devolve só o necessário: se existe e uma versão
  // mascarada.
  const [cpfCadastrado, setCpfCadastrado] = useState(false);
  const [cpfMascarado, setCpfMascarado] = useState(null);
  const [cpfEditando, setCpfEditando] = useState(false);
  const [cpfValor, setCpfValor] = useState('');
  const [cpfErro, setCpfErro] = useState('');
  const [cpfRemovendo, setCpfRemovendo] = useState(false);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('meu_cpf_status');
        if (cancelado) return;
        if (error) {
          console.warn('[UserProfile] status do CPF indisponível:', error.message);
          return;
        }
        setCpfCadastrado(data?.cadastrado === true);
        setCpfMascarado(data?.mascarado || null);
      } catch (e) {
        console.warn('[UserProfile] status do CPF indisponível:', e?.message);
      }
    })();
    return () => { cancelado = true; };
  }, [user?.id]);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  // Aplica um arquivo escolhido (pelo input ou pelo seletor de avatar).
  const applyAvatarFile = async (file) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Selecione uma imagem válida.' });
      return;
    }

    const optimized = await optimizeImage(file, 'avatar');
    setAvatarFile(optimized);
    setAvatarPreset(null);
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target.result);
    reader.readAsDataURL(optimized);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    await applyAvatarFile(file);
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

      if (form.phone !== undefined) updateData.phone = onlyDigits(form.phone) || null;
      if (form.nickname !== undefined) updateData.nickname = form.nickname || null;
      if (form.birthdate !== undefined) updateData.birthdate = form.birthdate || null;

      // ── CPF ───────────────────────────────────────────────────────────────
      // Grava só o que o usuário mexeu. O banco só deixa o dono escrever a
      // própria linha (policy `auth.uid() = id`), então o grant da coluna é
      // do próprio dono por construção.
      if (cpfRemovendo) {
        updateData.cpf = null;
      } else if (cpfEditando) {
        const digitos = soDigitos(cpfValor);
        if (digitos) {
          if (!cpfValido(digitos)) {
            setSaving(false);
            setMessage({ type: 'error', text: 'CPF inválido. Confira os dígitos e tente de novo.' });
            return;
          }
          updateData.cpf = digitos;
        }
      }

      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', user.id);

      if (error) {
        console.error('Update error:', error);
        if (error.message.includes('column') && error.message.includes('does not exist')) {
          setMessage({ type: 'error', text: 'Execute a migração SQL no Supabase primeiro. Veja: database/add-user-profile-fields.sql' });
        } else if (error.message.includes('permission denied')) {
          setMessage({ type: 'error', text: 'Não foi possível salvar o CPF. Rode o arquivo database/add-cpf-perfil.sql no Supabase.' });
        } else {
          setMessage({ type: 'error', text: 'Erro ao salvar: ' + error.message });
        }
      } else {
        setAvatarUrl(newAvatarUrl);
        setAvatarFile(null);
        setAvatarPreview(null);
        if (cpfRemovendo) {
          setCpfCadastrado(false);
          setCpfMascarado(null);
          setCpfRemovendo(false);
        } else if (cpfEditando && updateData.cpf) {
          setCpfCadastrado(true);
          setCpfMascarado(mascararCpf(updateData.cpf));
        }
        setCpfEditando(false);
        setCpfValor('');
        setCpfErro('');
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
          <button
            type="button"
            className="profile-avatar-presets-btn"
            onClick={() => setShowAvatars(true)}
          >
            <Palette size={15} />
            Ver avatares prontos
          </button>
        </div>

        {showAvatars && (
          <div className="profile-avatars-modal" role="dialog" aria-modal="true" aria-label="Avatares prontos">
            <div className="profile-avatars-backdrop" onClick={() => setShowAvatars(false)} />
            <div className="profile-avatars-panel">
              <div className="profile-avatars-header">
                <h3>Escolher avatar</h3>
                <button
                  type="button"
                  className="profile-avatars-close"
                  onClick={() => setShowAvatars(false)}
                  aria-label="Fechar"
                >
                  <X size={18} />
                </button>
              </div>
              <AvatarPicker
                compact
                selectedPreset={avatarPreset?.id || null}
                onSelectPreset={(preset) => {
                  setAvatarPreset(preset);
                  setAvatarFile(null);
                  setAvatarPreview(null);
                  setAvatarUrl(preset.url);
                }}
                onSelectFile={applyAvatarFile}
              />
              <div className="profile-avatars-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setShowAvatars(false);
                    setMessage({ type: 'success', text: 'Avatar escolhido. Clique em Salvar para confirmar.' });
                  }}
                >
                  Usar este avatar
                </button>
              </div>
            </div>
          </div>
        )}

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
                inputMode="numeric"
                value={form.phone}
                onChange={(e) => handleChange({ target: { name: 'phone', value: maskPhone(e.target.value) } })}
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

          {/* ── CPF ─────────────────────────────────────────────────────────── */}
          {/* O Pix Automático (Woovi) amarra a cobrança recorrente ao CPF do
              pagador. Com o CPF aqui, o checkout nunca mais pergunta. */}
          <div className="form-group">
            <label htmlFor="cpf">CPF</label>

            {cpfCadastrado && !cpfEditando && !cpfRemovendo ? (
              <>
                <input
                  id="cpf"
                  type="text"
                  value={cpfMascarado || 'CPF cadastrado'}
                  disabled
                  className="disabled-field"
                />
                <span className="field-hint">
                  Usamos este CPF nas cobranças recorrentes (Pix Automático). Ele não fica
                  visível para mais ninguém.
                </span>
                <div className="profile-cpf-acoes">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => { setCpfEditando(true); setCpfRemovendo(false); setCpfErro(''); }}
                  >
                    Trocar CPF
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => { setCpfRemovendo(true); setCpfEditando(false); setCpfErro(''); }}
                  >
                    Remover
                  </button>
                </div>
              </>
            ) : (
              <>
                <input
                  id="cpf"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={14}
                  value={cpfValor}
                  onChange={(e) => { setCpfValor(mascararCpf(e.target.value)); setCpfErro(''); }}
                  placeholder="000.000.000-00"
                  aria-invalid={cpfErro ? 'true' : 'false'}
                />
                <span className="field-hint">
                  {cpfRemovendo
                    ? 'O CPF será removido ao salvar. Sem ele, o checkout volta a pedir.'
                    : 'Só os dígitos do seu CPF. Fica salvo no perfil — o checkout não pergunta de novo.'}
                </span>
                {cpfErro && <span className="profile-cpf-erro">{cpfErro}</span>}
                {cpfCadastrado && (
                  <div className="profile-cpf-acoes">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => { setCpfEditando(false); setCpfRemovendo(false); setCpfValor(''); setCpfErro(''); }}
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </>
            )}
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
