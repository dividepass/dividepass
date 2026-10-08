import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Save, Plus, Trash2, CheckCircle, X, Info, UserPlus, UserMinus, Camera, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import NotificationComposerCard from '../../components/NotificationComposerCard';
import './GroupForm.css';

function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="toast-success">
      <CheckCircle size={18} />
      <span>{message}</span>
      <button onClick={onClose}><X size={14} /></button>
    </div>
  );
}

function GroupForm() {
  const { user } = useAuth();
  const { groupId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isEditing = !!groupId;

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  const [formData, setFormData] = useState({
    service_id: '',
    name: '',
    price_per_slot: '',
    available_cycles: ['monthly'],
    cycle_discount: 0,
    max_size: 4,
    has_slot_limit: true,
    has_entrance_fee: false,
    entrance_fee: '',
    rules: '',
    tags: '',
    verified: false,
    status: 'open',
    custom_cycle_months: '',
    custom_cycle_label: '',
    custom_cycle_days: '',
  });

  const [ownerId, setOwnerId] = useState('');
  const [ownerQuery, setOwnerQuery] = useState('');
  const [ownerResults, setOwnerResults] = useState([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [currentOwnerName, setCurrentOwnerName] = useState('');
  const [ownerSearched, setOwnerSearched] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [credentialType, setCredentialType] = useState('email_password');
  const [credentialUrl, setCredentialUrl] = useState('');
  const [credentialNotes, setCredentialNotes] = useState('');
  const [hasProfiles, setHasProfiles] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [members, setMembers] = useState([]);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  const PLAN_TYPES = [
    'Conta Individual', 'Conta Padrão', 'Conta Premium', 'Conta VIP',
    'Conta Go', 'Conta Light', 'Conta Enterprise', 'Conta Team',
    'Conta PRO', 'Conta PRO+', 'Conta PLUS', 'Conta MAX',
    'Conta Educação', 'Conta Duo', 'Conta Família',
  ];
  const [planType, setPlanType] = useState('');
  const [planTypeCustom, setPlanTypeCustom] = useState('');
  const [customPlanActive, setCustomPlanActive] = useState(false);

  const [emailCodeEnabled, setEmailCodeEnabled] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [emailImapServer, setEmailImapServer] = useState('');
  const [emailImapPort, setEmailImapPort] = useState(993);
  const [emailImapUser, setEmailImapUser] = useState('');
  const [emailImapPassword, setEmailImapPassword] = useState('');
  const [emailAllowedSenders, setEmailAllowedSenders] = useState('');
  const [emailBlockedSubjects, setEmailBlockedSubjects] = useState('');
  const [emailCodePatterns, setEmailCodePatterns] = useState('');
  const [emailBodyKeywords, setEmailBodyKeywords] = useState('');
  const [emailSubjectIncludes, setEmailSubjectIncludes] = useState('');
  const [emailAiEnabled, setEmailAiEnabled] = useState(false);

  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [groupAlertTitle, setGroupAlertTitle] = useState('Aviso do grupo');
  const [groupAlertMessage, setGroupAlertMessage] = useState('');
  const [groupAlertChannels, setGroupAlertChannels] = useState('both');
  const [sendingGroupAlert, setSendingGroupAlert] = useState(false);
  const [settings, setSettings] = useState({});

  const priceSimulation = useMemo(() => {
    const price = parseFloat(formData.price_per_slot) || 0;
    const gatewayRate = parseFloat(settings.gateway_fee_percent || '4.98') / 100;
    const platformRate = parseFloat(settings.platform_fee_percent || '3.95') / 100;
    const gatewayFee = price * gatewayRate;
    const platformFee = price * platformRate;
    const net = price - gatewayFee - platformFee;
    return { price, gatewayFee, platformFee, net };
  }, [formData.price_per_slot, settings]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleCycleToggle = (cycle) => {
    setFormData(prev => {
      const current = prev.available_cycles || [];
      const updated = current.includes(cycle)
        ? current.filter(c => c !== cycle)
        : [...current, cycle];
      return { ...prev, available_cycles: updated.length > 0 ? updated : current };
    });
  };

  const handleProfileChange = (index, field, value) => {
    setProfiles(prev => prev.map((p, i) =>
      i === index ? { ...p, [field]: value } : p
    ));
  };

  const addProfile = () => {
    setProfiles(prev => [...prev, { profile_name: '', profile_password: '' }]);
  };

  const removeProfile = (index) => {
    setProfiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleOwnerSearch = async (query) => {
    setOwnerQuery(query);
    setOwnerSearched(false);
    if (query.trim().length < 2) { setOwnerResults([]); return; }
    setOwnerLoading(true);
    setOwnerSearched(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, email')
        .or(`name.ilike.%${query.trim()}%,email.ilike.%${query.trim()}%`)
        .limit(8);
      if (error) {
        console.error('[GroupForm] owner search error:', error);
      }
      setOwnerResults(data || []);
    } catch (err) {
      console.error('[GroupForm] owner search error:', err);
    }
    setOwnerLoading(false);
  };

  const handleAddMember = async () => {
    if (!newMemberEmail.trim() || !groupId) return;
    setAddingMember(true);
    try {
      const { data: targetUser, error: findError } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('email', newMemberEmail.trim())
        .single();

      if (findError || !targetUser) {
        alert('Usuário não encontrado com este e-mail.');
        return;
      }

      const existingMember = members.find(m => m.user_id === targetUser.id);
      if (existingMember) {
        alert('Este usuário já é membro do grupo.');
        return;
      }

      const { error: insertError } = await supabase
        .from('group_members')
        .insert({
          group_id: groupId,
          user_id: targetUser.id,
          status: 'active',
        });

      if (insertError) throw insertError;

      setMembers(prev => [...prev, {
        user_id: targetUser.id,
        created_at: new Date().toISOString(),
        user: { id: targetUser.id, name: targetUser.name, email: targetUser.email },
      }]);
      setNewMemberEmail('');
      setToast('Membro adicionado com sucesso!');
    } catch (err) {
      alert('Erro ao adicionar membro: ' + err.message);
    } finally {
      setAddingMember(false);
    }
  };

  const handleSyncMembers = async () => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ group_id: groupId }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const { data: updatedMembers } = await supabase
        .from('group_members')
        .select('user_id, status, payment_status, created_at, user:user_id (id, name, email)')
        .eq('group_id', groupId)
        .order('created_at');
      setMembers(updatedMembers || []);
      setToast(`Sincronizado! ${data.synced || 0} membro(s) adicionado(s), ${data.already_ok || 0} já estavam OK.`);
    } catch (e) {
      alert('Erro ao sincronizar: ' + e.message);
    }
    setSyncing(false);
  };

  const handleRemoveMember = async (userId) => {
    if (!window.confirm('Tem certeza que deseja remover este membro do grupo?')) return;
    try {
      const { error } = await supabase
        .from('group_members')
        .update({ status: 'cancelled', left_at: new Date().toISOString() })
        .eq('group_id', groupId)
        .eq('user_id', userId);

      if (error) throw error;

      setMembers(prev => prev.filter(m => m.user_id !== userId));
      setToast('Membro removido com sucesso!');
    } catch (err) {
      alert('Erro ao remover membro: ' + err.message);
    }
  };

  const getMemberOrder = (userId) => {
    const idx = members.findIndex(m => m.user_id === userId);
    return idx >= 0 ? idx + 1 : null;
  };

  const groupAlertMembers = members.filter(m => m.status === 'active' || m.status === 'pending');

  const handleSendGroupAlert = async () => {
    if (!groupId || !isEditing) return;
    const title = groupAlertTitle.trim();
    const message = groupAlertMessage.trim();

    if (!title || !message) {
      setError('Preencha o título e a mensagem do alerta.');
      return;
    }

    if (groupAlertMembers.length === 0) {
      setError('Este grupo não possui membros para receber o alerta.');
      return;
    }

    setSendingGroupAlert(true);
    setError('');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Você precisa estar logado.');

      const channels = groupAlertChannels === 'push'
        ? ['push']
        : groupAlertChannels === 'alert'
          ? ['in_app']
          : ['in_app', 'push'];

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          audience: { type: 'group', group_id: groupId },
          title,
          message,
          channels,
          event_type: 'group_alert',
          url: `/dashboard/groups/${groupId}`,
          metadata: { group_id: groupId, source: 'admin_group_form' },
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || 'Erro ao enviar alerta');
      }

      setGroupAlertMessage('');
      setToast(`Alerta enviado para ${data.recipients || groupAlertMembers.length} membro(s).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingGroupAlert(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        if (!cancelled) setLoading(true);

        const [servicesRes, groupRes, credsRes, profilesRes, membersRes] = await Promise.all([
          supabase.from('streaming_services').select('id, name, full_name').order('name'),
          isEditing
            ? supabase.from('groups').select('*, owner:owner_id (id, name, email)').eq('id', groupId).single()
            : Promise.resolve({ data: null }),
          isEditing
            ? supabase.from('group_credentials').select('*').eq('group_id', groupId).maybeSingle()
            : Promise.resolve({ data: null }),
          isEditing
            ? supabase.from('group_profiles').select('*, assigned_user:assigned_to (id, name, email)').eq('group_id', groupId).order('created_at')
            : Promise.resolve({ data: null }),
          isEditing
            ? supabase.from('group_members').select('user_id, status, payment_status, created_at, user:user_id (id, name, email)').eq('group_id', groupId).order('created_at')
            : Promise.resolve({ data: null }),
        ]);

        if (servicesRes.error) throw servicesRes.error;
        if (!cancelled) setServices(servicesRes.data || []);

        if (isEditing && !cancelled) {
          setMembers(membersRes.data || []);
        }

        if (isEditing) {
          if (groupRes.error) throw groupRes.error;
          const group = groupRes.data;
          if (group) {
            setOwnerId(group.owner_id || '');
            setCurrentOwnerName(group.owner?.name || group.owner?.email || '');
            setFormData({
              service_id: group.service_id || '',
              name: group.name || '',
              price_per_slot: group.price_per_slot || '',
              available_cycles: group.available_cycles || [group.billing_cycle || 'monthly'],
              cycle_discount: group.cycle_discount || 0,
              max_size: group.max_size || 4,
              has_slot_limit: group.has_slot_limit !== false,
              has_entrance_fee: group.has_entrance_fee || false,
              entrance_fee: group.entrance_fee || '',
              rules: group.rules || '',
              tags: Array.isArray(group.tags) ? group.tags.join(', ') : '',
              verified: group.verified || false,
              status: group.status || 'open',
              custom_cycle_months: group.custom_cycle_months || '',
              custom_cycle_label: group.custom_cycle_label || '',
              custom_cycle_days: group.custom_cycle_days || '',
            });
            if (group.photo_url) setPhotoPreview(group.photo_url);
            if (group.plan_type) { setPlanType(group.plan_type); setCustomPlanActive(false); }
            if (group.plan_type_custom) { setPlanTypeCustom(group.plan_type_custom); setCustomPlanActive(true); }
          }

          if (credsRes.data) {
            setLoginEmail(credsRes.data.login_email || '');
            setLoginPassword(credsRes.data.login_password || '');
            setCredentialType(credsRes.data.credential_type || 'email_password');
            setCredentialUrl(credsRes.data.credential_url || '');
            setCredentialNotes(credsRes.data.credential_notes || '');
            setHasProfiles(credsRes.data.has_profiles || false);
          }

          if (group) {
            setEmailCodeEnabled(group.email_code_enabled || false);
            setEmailAddress(group.email_address || '');
            setEmailImapServer(group.email_imap_server || '');
            setEmailImapPort(group.email_imap_port || 993);
            setEmailImapUser(group.email_imap_user || '');
            setEmailImapPassword(group.email_imap_password || '');
            setEmailAllowedSenders(
              Array.isArray(group.email_allowed_senders)
                ? group.email_allowed_senders.join('\n')
                : ''
            );
            setEmailBlockedSubjects(
              Array.isArray(group.email_blocked_subjects)
                ? group.email_blocked_subjects.join('\n')
                : ''
            );
            setEmailCodePatterns(
              Array.isArray(group.email_code_patterns)
                ? group.email_code_patterns.join('\n')
                : ''
            );
            setEmailBodyKeywords(
              Array.isArray(group.email_body_keywords)
                ? group.email_body_keywords.join('\n')
                : ''
            );
            setEmailSubjectIncludes(
              Array.isArray(group.email_subject_includes)
                ? group.email_subject_includes.join('\n')
                : ''
            );
            setEmailAiEnabled(group.email_ai_enabled || false);
          }

          if (profilesRes.data && profilesRes.data.length > 0) {
            setProfiles(profilesRes.data.map(p => ({
              id: p.id,
              profile_name: p.profile_name || '',
              profile_password: p.profile_password || '',
              assigned_to: p.assigned_to || null,
              assigned_user: p.assigned_user || null,
            })));
          }
        } else if (servicesRes.data?.length > 0) {
          const preselectedService = searchParams.get('service');
          const initialService = preselectedService && servicesRes.data.some(s => s.id === preselectedService)
            ? preselectedService
            : servicesRes.data[0].id;
          setFormData(prev => ({ ...prev, service_id: initialService }));
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [groupId, isEditing, searchParams]);

  useEffect(() => {
    supabase.from('app_settings').select('key, value').then(({ data }) => {
      const s = {};
      data?.forEach(d => { s[d.key] = d.value; });
      setSettings(s);
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const groupPayload = {
        service_id: formData.service_id,
        name: formData.name,
        price_per_slot: parseFloat(formData.price_per_slot),
        billing_cycle: formData.available_cycles[0] || 'monthly',
        available_cycles: formData.available_cycles,
        cycle_discount: parseFloat(formData.cycle_discount || 0),
        max_size: formData.has_slot_limit ? parseInt(formData.max_size, 10) : null,
        has_slot_limit: formData.has_slot_limit,
        has_entrance_fee: formData.has_entrance_fee,
        entrance_fee: formData.has_entrance_fee ? parseFloat(formData.entrance_fee || 0) : 0,
        rules: formData.rules || null,
        tags: formData.tags
          ? formData.tags.split(',').map(t => t.trim()).filter(Boolean)
          : [],
        verified: !!formData.verified,
        status: formData.status,
        owner_id: isEditing ? (ownerId || null) : (user?.id || null),
        email_code_enabled: emailCodeEnabled,
        email_code_method: emailCodeEnabled ? 'imap' : null,
        email_address: emailCodeEnabled ? emailAddress : null,
        verification_email: null,
        email_imap_server: emailCodeEnabled ? emailImapServer : null,
        email_imap_port: emailCodeEnabled ? emailImapPort : 993,
        email_imap_user: emailCodeEnabled ? emailImapUser : null,
        email_imap_password: emailCodeEnabled ? emailImapPassword : null,
        email_allowed_senders: emailCodeEnabled
          ? emailAllowedSenders.split('\n').map(s => s.trim()).filter(Boolean)
          : [],
        email_blocked_subjects: emailCodeEnabled
          ? emailBlockedSubjects.split('\n').map(s => s.trim()).filter(Boolean)
          : [],
        email_code_patterns: emailCodeEnabled
          ? emailCodePatterns.split('\n').map(s => s.trim()).filter(Boolean)
          : [],
        email_body_keywords: emailCodeEnabled
          ? emailBodyKeywords.split('\n').map(s => s.trim()).filter(Boolean)
          : [],
        email_subject_includes: emailCodeEnabled
          ? emailSubjectIncludes.split('\n').map(s => s.trim()).filter(Boolean)
          : [],
        email_ai_enabled: emailCodeEnabled ? emailAiEnabled : false,
        custom_cycle_months: formData.available_cycles.includes('custom') ? parseInt(formData.custom_cycle_months) || null : null,
        custom_cycle_label: formData.available_cycles.includes('custom') ? formData.custom_cycle_label || null : null,
        custom_cycle_days: formData.available_cycles.includes('days') ? parseInt(formData.custom_cycle_days) || null : null,
        plan_type: customPlanActive ? null : (planType || null),
        plan_type_custom: customPlanActive ? (planTypeCustom || null) : null,
      };

      let groupIdResult = groupId;

      if (isEditing) {
        const { error: updateError } = await supabase
          .from('groups')
          .update(groupPayload)
          .eq('id', groupId);
        if (updateError) throw updateError;
      } else {
        const { data: newGroup, error: insertError } = await supabase
          .from('groups')
          .insert(groupPayload)
          .select('id')
          .single();
        if (insertError) throw insertError;
        groupIdResult = newGroup.id;

        const shortSlug = newGroup.id.slice(0, 6).toUpperCase();
        const { error: slugError } = await supabase
          .from('groups')
          .update({ slug: shortSlug })
          .eq('id', newGroup.id);
        if (slugError) throw slugError;
      }

      if (photoFile) {
        const ext = photoFile.name.split('.').pop();
        const photoPath = `${groupIdResult}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('group-covers')
          .upload(photoPath, photoFile, { upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('group-covers').getPublicUrl(photoPath);
        await supabase.from('groups').update({ photo_url: urlData.publicUrl }).eq('id', groupIdResult);
      } else if (!photoPreview && isEditing) {
        await supabase.from('groups').update({ photo_url: null }).eq('id', groupIdResult);
      }

      if (loginEmail || loginPassword || credentialType !== 'email_password' || credentialUrl) {
        const credPayload = {
          group_id: groupIdResult,
          login_email: loginEmail || null,
          login_password: loginPassword || null,
          credential_type: credentialType,
          credential_url: credentialUrl || null,
          credential_notes: credentialNotes || null,
          has_profiles: hasProfiles,
        };

        const { data: existingCred } = await supabase
          .from('group_credentials')
          .select('id')
          .eq('group_id', groupIdResult)
          .maybeSingle();

        if (existingCred) {
          const { error: credError } = await supabase
            .from('group_credentials')
            .update(credPayload)
            .eq('id', existingCred.id);
          if (credError) throw credError;
        } else {
          const { error: credError } = await supabase
            .from('group_credentials')
            .insert(credPayload);
          if (credError) throw credError;
        }
      }

      if (hasProfiles) {
        const validProfiles = profiles.filter(p => p.profile_name || p.profile_password);
        const existingIds = validProfiles.filter(p => p.id).map(p => p.id);

        if (isEditing && existingIds.length > 0) {
          for (const p of validProfiles.filter(p => p.id)) {
            const { error } = await supabase
              .from('group_profiles')
              .update({ profile_name: p.profile_name, profile_password: p.profile_password, assigned_to: p.assigned_to || null })
              .eq('id', p.id);
            if (error) throw error;
          }

          const { error: delError } = await supabase
            .from('group_profiles')
            .delete()
            .eq('group_id', groupIdResult)
            .not('id', 'in', `(${existingIds.length > 0 ? existingIds.join(',') : '00000000-0000-0000-0000-000000000000'})`);
          if (delError) throw delError;
        } else if (isEditing) {
          const { error: delError } = await supabase
            .from('group_profiles')
            .delete()
            .eq('group_id', groupIdResult);
          if (delError) throw delError;
        }

        const newProfiles = validProfiles.filter(p => !p.id);
        if (newProfiles.length > 0) {
          const { error: profError } = await supabase
            .from('group_profiles')
            .insert(newProfiles.map(p => ({
              group_id: groupIdResult,
              profile_name: p.profile_name,
              profile_password: p.profile_password,
              assigned_to: p.assigned_to || null,
            })));
          if (profError) throw profError;
        }
      } else if (isEditing) {
        await supabase.from('group_profiles').delete().eq('group_id', groupIdResult);
      }

      setToast(isEditing ? 'Grupo atualizado com sucesso!' : 'Grupo criado com sucesso!');
      setTimeout(() => navigate('/admin/groups'), 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando...</p>
      </div>
    );
  }

  return (
    <div className="fade-in group-form-page">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <button onClick={() => navigate('/admin/groups')} className="back-btn">
        <ArrowLeft size={18} />
        Voltar para Grupos
      </button>

      <div className="admin-header">
        <h1>{isEditing ? 'Editar Grupo' : 'Novo Grupo'}</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handleSubmit} className="group-form-card">
        <section className="form-section">
          <h2>Dados do Grupo</h2>

          <div className="form-grid">
            <div className="form-group">
              <label>Plataforma *</label>
              <select name="service_id" value={formData.service_id} onChange={handleChange} required>
                <option value="">Selecione</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.full_name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Nome do grupo *</label>
              <input name="name" value={formData.name} onChange={handleChange} placeholder="Netflix - Grupo A" required />
            </div>

            <div className="form-group">
              <label>Foto do grupo</label>
              <div className="group-photo-upload">
                {photoPreview ? (
                  <div className="photo-preview">
                    <img src={photoPreview} alt="Preview" />
                    <button type="button" className="photo-remove" onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}>✕</button>
                  </div>
                ) : (
                  <label className="photo-placeholder">
                    <Camera size={24} />
                    <span>Adicionar foto</span>
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setPhotoFile(file);
                          setPhotoPreview(URL.createObjectURL(file));
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>Tipo de Conta / Plano</label>
              <div className="plan-type-grid">
                {PLAN_TYPES.map(pt => (
                  <button
                    key={pt}
                    type="button"
                    className={`plan-type-btn ${!customPlanActive && planType === pt ? 'active' : ''}`}
                    onClick={() => { setPlanType(pt); setCustomPlanActive(false); }}
                  >
                    {pt}
                  </button>
                ))}
                <button
                  type="button"
                  className={`plan-type-btn custom ${customPlanActive ? 'active' : ''}`}
                  onClick={() => { setCustomPlanActive(true); setPlanType(''); }}
                >
                  Personalizado
                </button>
              </div>
              {customPlanActive && (
                <input
                  type="text"
                  className="plan-type-custom-input"
                  value={planTypeCustom}
                  onChange={e => setPlanTypeCustom(e.target.value)}
                  placeholder="Digite o tipo de conta personalizado"
                  style={{ marginTop: '0.5rem' }}
                />
              )}
            </div>
          </div>

          <div className="form-group">
            <label>Preço por vaga (R$) *</label>
            <input type="number" step="0.01" min="0.01" name="price_per_slot" value={formData.price_per_slot} onChange={handleChange} required />
          </div>

          {formData.price_per_slot > 0 && (
            <div className="price-simulation">
              <div className="sim-header">
                <Info size={16} />
                <span>Simulação de recebimento</span>
              </div>
              <div className="sim-grid">
                <div className="sim-row">
                  <span>Valor cobrado</span>
                  <strong>R$ {priceSimulation.price.toFixed(2)}</strong>
                </div>
                <div className="sim-row fee">
                  <span>Taxa gateway ({(parseFloat(settings.gateway_fee_percent || '4.98')).toFixed(2)}%)</span>
                  <span>- R$ {priceSimulation.gatewayFee.toFixed(2)}</span>
                </div>
                <div className="sim-row fee">
                  <span>Taxa plataforma ({(parseFloat(settings.platform_fee_percent || '3.95')).toFixed(2)}%)</span>
                  <span>- R$ {priceSimulation.platformFee.toFixed(2)}</span>
                </div>
                <div className="sim-row total">
                  <span>Você recebe</span>
                  <strong>R$ {priceSimulation.net.toFixed(2)}</strong>
                </div>
              </div>
            </div>
          )}

          <div className="form-group">
            <label>Ciclos de cobrança disponíveis *</label>
            <p className="section-desc" style={{ marginBottom: '0.75rem' }}>
              Selecione quais formas de pagamento o usuário poderá escolher.
            </p>
            <div className="cycles-grid">
              {[
                { value: 'monthly', label: 'Mensal' },
                { value: 'quarterly', label: 'Trimestral' },
                { value: 'semiannual', label: 'Semestral' },
                { value: 'annual', label: 'Anual' },
                { value: 'days', label: 'Dias' },
                { value: 'custom', label: 'Personalizado' },
              ].map(opt => (
                <label key={opt.value} className={`cycle-check ${formData.available_cycles.includes(opt.value) ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={formData.available_cycles.includes(opt.value)}
                    onChange={() => handleCycleToggle(opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>

            {formData.available_cycles.includes('custom') && (
              <div className="form-grid" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Meses do ciclo personalizado *</label>
                  <input type="number" min="1" max="60"
                    value={formData.custom_cycle_months || ''}
                    onChange={e => setFormData(prev => ({ ...prev, custom_cycle_months: parseInt(e.target.value) || '' }))}
                    placeholder="Ex: 4"
                  />
                </div>
                <div className="form-group">
                  <label>Label do ciclo</label>
                  <input type="text"
                    value={formData.custom_cycle_label || ''}
                    onChange={e => setFormData(prev => ({ ...prev, custom_cycle_label: e.target.value }))}
                    placeholder="Ex: 4 Meses"
                  />
                </div>
              </div>
            )}

            {formData.available_cycles.includes('days') && (
              <div className="form-grid" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Quantidade de dias do ciclo *</label>
                  <input type="number" min="1" max="365"
                    value={formData.custom_cycle_days || ''}
                    onChange={e => setFormData(prev => ({ ...prev, custom_cycle_days: parseInt(e.target.value) || '' }))}
                    placeholder="Ex: 15"
                  />
                </div>
                <div className="form-group">
                  <label>Label do ciclo</label>
                  <input type="text"
                    value={formData.custom_cycle_label || ''}
                    onChange={e => setFormData(prev => ({ ...prev, custom_cycle_label: e.target.value }))}
                    placeholder="Ex: 15 Dias"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Desconto do ciclo (%)</label>
            <input type="number" step="0.01" min="0" max="100" name="cycle_discount" value={formData.cycle_discount} onChange={handleChange} />
          </div>

          <div className="toggle-section">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={formData.has_entrance_fee}
                onChange={e => setFormData(prev => ({ ...prev, has_entrance_fee: e.target.checked }))}
              />
              <span className="toggle-switch" />
              <span className="toggle-text">
                <strong>Cobrar valor de entrada?</strong>
                <small>Valor único pago na primeira vez + assinatura. Próximos ciclos somente assinatura.</small>
              </span>
            </label>
          </div>

          {formData.has_entrance_fee && (
            <div className="form-group">
              <label>Valor de entrada (R$) *</label>
              <input type="number" step="0.01" min="0" name="entrance_fee" value={formData.entrance_fee} onChange={handleChange} required={formData.has_entrance_fee} />
              <small className="field-hint">Cobrado apenas na primeira vez que o membro entra no grupo</small>
            </div>
          )}

          <div className="toggle-section">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={formData.has_slot_limit}
                onChange={e => setFormData(prev => ({ ...prev, has_slot_limit: e.target.checked }))}
              />
              <span className="toggle-switch" />
              <span className="toggle-text">
                <strong>Tem limite de vagas?</strong>
                <small>Quando ativado, define um limite de membros no grupo</small>
              </span>
            </label>
          </div>

          {formData.has_slot_limit && (
            <div className="form-group">
              <label>Limite de vagas *</label>
              <input type="number" min="1" name="max_size" value={formData.max_size} onChange={handleChange} required={formData.has_slot_limit} />
            </div>
          )}

          <div className="form-group">
            <label>Regras do grupo</label>
            <textarea rows={4} name="rules" value={formData.rules} onChange={handleChange} placeholder="Ex: Não compartilhar a senha; usar apenas 1 tela..." />
          </div>

          <div className="form-group">
            <label>Tags (separadas por vírgula)</label>
            <input name="tags" value={formData.tags} onChange={handleChange} placeholder="Ex: 4k, ultrahd, sem anúncios" />
          </div>

          <div className="form-inline">
            <div className="form-group">
              <label>Status</label>
              <select name="status" value={formData.status} onChange={handleChange}>
                <option value="open">Aberto</option>
                <option value="forming">Formando</option>
                <option value="closed">Fechado</option>
              </select>
            </div>
            <div className="form-group checkbox-group">
              <label>
                <input type="checkbox" name="verified" checked={formData.verified} onChange={handleChange} />
                Grupo verificado (DividePass)
              </label>
            </div>
          </div>

          {isEditing && (
            <div className="form-group">
              <label>Criado por (dono do grupo)</label>
              {ownerId ? (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ flex: 1, padding: '0.55rem 0.7rem', borderRadius: '0.5rem', border: '1px solid var(--border, #e2e8f0)', background: 'var(--surface, #fff)', fontSize: '0.85rem' }}>
                    {currentOwnerName || ownerId.slice(0, 8) + '...'}
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => { setOwnerId(''); setOwnerQuery(''); setOwnerResults([]); setCurrentOwnerName(''); }}>Trocar</button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={ownerQuery}
                    onChange={e => handleOwnerSearch(e.target.value)}
                    placeholder="Buscar por nome ou e-mail..."
                    disabled={ownerLoading}
                  />
                  {ownerLoading && <span style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)' }}>⏳</span>}
                  {ownerSearched && ownerResults.length === 0 && !ownerLoading && (
                    <div style={{ padding: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Nenhum usuário encontrado</div>
                  )}
                  {ownerResults.length > 0 && (
                    <div className="platform-dropdown" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, maxHeight: 200, overflowY: 'auto', borderRadius: '0.5rem', border: '1px solid var(--border, #e2e8f0)', background: 'var(--surface, #fff)', boxShadow: '0 8px 24px -4px rgba(15,23,42,0.15)' }}>
                      {ownerResults.map(u => (
                        <button key={u.id} type="button" style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', width: '100%', padding: '0.5rem 0.7rem', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', color: 'var(--text, #0f172a)', textAlign: 'left' }} onClick={() => { setOwnerId(u.id); setOwnerQuery(''); setOwnerResults([]); setCurrentOwnerName(u.name || u.email); }}>
                          <strong>{u.name || 'Sem nome'}</strong>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)' }}>{u.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <small className="field-hint">O dono recebe os pagamentos na carteira</small>
            </div>
          )}
        </section>

        <section className="form-section">
          <h2>Credenciais de Acesso</h2>
          <p className="section-desc">
            Configure as credenciais de acesso ao serviço. Compartilhadas entre todos os membros do grupo.
          </p>

          <div className="form-grid">
            <div className="form-group">
              <label>Tipo de credencial</label>
              <select value={credentialType} onChange={e => setCredentialType(e.target.value)}>
                <option value="email_password">E-mail + Senha</option>
                <option value="link">Link de Acesso</option>
                <option value="code">Código / Convite</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>
          </div>

          {credentialType === 'email_password' && (
            <div className="form-grid">
              <div className="form-group">
                <label>E-mail de acesso</label>
                <input
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  placeholder="conta@plataforma.com"
                />
              </div>
              <div className="form-group">
                <label>Senha de acesso</label>
                <input
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  type="text"
                />
              </div>
            </div>
          )}

          {credentialType === 'link' && (
            <div className="form-grid">
              <div className="form-group">
                <label>Link de acesso</label>
                <input
                  value={credentialUrl}
                  onChange={e => setCredentialUrl(e.target.value)}
                  placeholder="https://..."
                  type="url"
                />
                <small style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                  Link compartilhado que os membros usarão para acessar o serviço
                </small>
              </div>
              <div className="form-group">
                <label>Observações (opcional)</label>
                <input
                  value={credentialNotes}
                  onChange={e => setCredentialNotes(e.target.value)}
                  placeholder="Instruções adicionais ou URL de referência..."
                />
              </div>
            </div>
          )}

          {credentialType === 'code' && (
            <div className="form-grid">
              <div className="form-group">
                <label>Código de acesso / Convite</label>
                <input
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="Código ou link de convite"
                  type="text"
                />
              </div>
            </div>
          )}

          {credentialType === 'custom' && (
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Texto da credencial</label>
                <textarea
                  value={credentialNotes}
                  onChange={e => setCredentialNotes(e.target.value)}
                  placeholder="Descreva como os membros devem acessar o serviço..."
                  rows={4}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>
            </div>
          )}

          {credentialType !== 'email_password' && credentialType !== 'link' && (
            <div className="form-grid">
              <div className="form-group">
                <label>Observações (opcional)</label>
                <input
                  value={credentialNotes}
                  onChange={e => setCredentialNotes(e.target.value)}
                  placeholder="Instruções adicionais para os membros"
                />
              </div>
            </div>
          )}

          <div className="toggle-section">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={hasProfiles}
                onChange={e => {
                  setHasProfiles(e.target.checked);
                  if (e.target.checked && profiles.length === 0) {
                    setProfiles([{ profile_name: '', profile_password: '' }]);
                  }
                }}
              />
              <span className="toggle-switch" />
              <span className="toggle-text">
                <strong>Esta plataforma usa perfis individuais para membros</strong>
                <small>Ex: Netflix, Disney+ — cada membro recebe um perfil/tela com senha própria</small>
              </span>
            </label>
          </div>

          {hasProfiles && (
            <div className="profiles-section">
              <div className="section-header-row">
                <div>
                  <h3>Perfis / Telas</h3>
                  <p className="section-desc">
                    Cada membro que entrar no grupo receberá automaticamente um perfil.
                  </p>
                </div>
                <button type="button" className="btn btn-sm btn-primary" onClick={addProfile}>
                  <Plus size={16} />
                  Adicionar Perfil
                </button>
              </div>

              {profiles.map((profile, index) => {
                const memberOrder = profile.assigned_to ? getMemberOrder(profile.assigned_to) : null;
                const assignedMember = members.find(m => m.user_id === profile.assigned_to);
                const usedMemberIds = profiles.filter(p => p.assigned_to && p !== profile).map(p => p.assigned_to);
                return (
                  <div key={index} className="profile-entry">
                    <div className="profile-entry-header">
                      <h4>Perfil / Tela {index + 1}</h4>
                      <div className="profile-entry-badges">
                        {memberOrder ? (
                          <span className="assigned-badge">
                            Membro #{memberOrder} — {profile.assigned_user?.name || profile.assigned_user?.email || assignedMember?.user?.name || assignedMember?.user?.email}
                          </span>
                        ) : (
                          <span className="available-badge">Disponível</span>
                        )}
                        {profiles.length > 1 && (
                          <button type="button" className="btn-icon danger" onClick={() => removeProfile(index)} title="Remover">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="form-grid cred-fields">
                      <div className="form-group">
                        <label>Nome do Perfil</label>
                        <input
                          value={profile.profile_name}
                          onChange={e => handleProfileChange(index, 'profile_name', e.target.value)}
                          placeholder="Ex: Perfil 1, Tela João"
                        />
                      </div>
                      <div className="form-group">
                        <label>Senha do Perfil</label>
                        <input
                          value={profile.profile_password}
                          onChange={e => handleProfileChange(index, 'profile_password', e.target.value)}
                          placeholder="Senha específica do perfil"
                          type="text"
                        />
                      </div>
                      <div className="form-group">
                        <label>Vincular ao Membro</label>
                        <select
                          value={profile.assigned_to || ''}
                          onChange={e => handleProfileChange(index, 'assigned_to', e.target.value || null)}
                        >
                          <option value="">Não vinculado</option>
                          {members.map((m, mIdx) => (
                            <option
                              key={m.user_id}
                              value={m.user_id}
                              disabled={usedMemberIds.includes(m.user_id)}
                            >
                              Membro #{mIdx + 1} — {m.user?.name || m.user?.email || m.user_id}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}

              <button type="button" className="add-profile-inline-btn" onClick={addProfile}>
                <Plus size={18} />
                Adicionar novo perfil / tela
              </button>
            </div>
          )}
        </section>

        <section className="form-section">
          <h2>Busca de Código por E-mail (Opcional)</h2>
          <p className="section-desc">
            Quando habilitado, os membros do grupo poderão buscar códigos de verificação diretamente pela DividePass, sem precisar acessar o e-mail da conta.
          </p>

          <div className="toggle-section" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={emailCodeEnabled}
                onChange={e => setEmailCodeEnabled(e.target.checked)}
              />
              <span className="toggle-switch" />
              <span className="toggle-text">
                <strong>Habilitar busca de códigos por e-mail</strong>
                <small>Os membros poderão buscar códigos de verificação enviados para este e-mail</small>
              </span>
            </label>
          </div>

          {emailCodeEnabled && (
            <div style={{ marginTop: '1.25rem' }}>
              <div>
                <div className="form-grid">
                    <div className="form-group">
                      <label>E-mail da conta</label>
                      <input
                        value={emailAddress}
                        onChange={e => setEmailAddress(e.target.value)}
                        placeholder="conta@plataforma.com"
                      />
                    </div>
                    <div className="form-group">
                      <label>Servidor IMAP</label>
                      <input
                        value={emailImapServer}
                        onChange={e => setEmailImapServer(e.target.value)}
                        placeholder="imap.zoho.com"
                      />
                    </div>
                  </div>

                  <div className="form-grid">
                    <div className="form-group">
                      <label>Usuário IMAP</label>
                      <input
                        value={emailImapUser}
                        onChange={e => setEmailImapUser(e.target.value)}
                        placeholder="conta@plataforma.com"
                      />
                    </div>
                    <div className="form-group">
                      <label>Senha IMAP / App Password</label>
                      <input
                        type="text"
                        value={emailImapPassword}
                        onChange={e => setEmailImapPassword(e.target.value)}
                        placeholder="Senha ou App Password"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Porta IMAP</label>
                    <input
                      type="number"
                      value={emailImapPort}
                      onChange={e => setEmailImapPort(parseInt(e.target.value, 10) || 993)}
                      placeholder="993"
                      style={{ maxWidth: '120px' }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Remetentes permitidos (um por linha)</label>
                    <p className="section-desc" style={{ marginBottom: '0.5rem' }}>
                      Apenas e-mails destes remetentes serão processados. Se vazio, todos são aceitos.
                    </p>
                    <textarea
                      rows={3}
                      value={emailAllowedSenders}
                      onChange={e => setEmailAllowedSenders(e.target.value)}
                      placeholder={"netflix.com\nno-reply@netflix.com\ndisneyplus.com"}
                      style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Assuntos bloqueados (um por linha)</label>
                    <p className="section-desc" style={{ marginBottom: '0.5rem' }}>
                      E-mails com assuntos contendo estes termos serão ignorados.
                    </p>
                    <textarea
                      rows={3}
                      value={emailBlockedSubjects}
                      onChange={e => setEmailBlockedSubjects(e.target.value)}
                      placeholder={"password\nrecuperação\nredefinição\nsegurança"}
                      style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Assuntos permitidos (um por linha)</label>
                    <p className="section-desc" style={{ marginBottom: '0.5rem' }}>
                      Apenas e-mails cujo assunto contém estes termos serão processados. Se vazio, todos são aceitos.
                    </p>
                    <textarea
                      rows={3}
                      value={emailSubjectIncludes}
                      onChange={e => setEmailSubjectIncludes(e.target.value)}
                      placeholder={"verify\ncode\ncódigo\naccess\nverificação"}
                      style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Palavras-chave no corpo do e-mail (um por linha)</label>
                    <p className="section-desc" style={{ marginBottom: '0.5rem' }}>
                      Se o e-mail contiver estas palavras e também tiver dígitos, o código será extraído. Útil para plataformas que não seguem padrões padrão.
                    </p>
                    <textarea
                      rows={3}
                      value={emailBodyKeywords}
                      onChange={e => setEmailBodyKeywords(e.target.value)}
                      placeholder={"verificação\nverification\naccess code\ncódigo de acesso"}
                      style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Padrões regex de extração (um por linha)</label>
                    <p className="section-desc" style={{ marginBottom: '0.5rem' }}>
                      Regex customizados para este grupo. Use <code>(\d{'{4,8}'})</code> para capturar o código. Exemplo: <code>code[:\s]*(\d{'{6}'})</code>
                    </p>
                    <textarea
                      rows={3}
                      value={emailCodePatterns}
                      onChange={e => setEmailCodePatterns(e.target.value)}
                      placeholder={"code[:\\s]*(\\d{6})\npin[:\\s]*(\\d{4})"}
                      style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div className="toggle-section" style={{ marginTop: '0.5rem' }}>
                    <label className="toggle-label">
                      <input
                        type="checkbox"
                        checked={emailAiEnabled}
                        onChange={e => setEmailAiEnabled(e.target.checked)}
                      />
                      <span className="toggle-switch" />
                      <span className="toggle-text">
                        <strong>Usar IA para extração (Groq)</strong>
                        <small>Quando os padrões regex não encontram código, a IA tenta ler o e-mail inteligentemente. Requer <code>GROQ_API_KEY</code> no Supabase Secrets.</small>
                      </span>
                    </label>
                  </div>
                </div>
            </div>
          )}
        </section>

        {isEditing && (
          <section className="form-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2>Membros do Grupo</h2>
                <p className="section-desc">
                  {members.length} membro(s) neste grupo ({members.filter(m => m.status === 'active').length} ativo(s), {members.filter(m => m.status === 'pending').length} pendente(s)). Você pode adicionar ou remover membros manualmente.
                </p>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleSyncMembers} disabled={syncing}>
                {syncing ? <><Loader2 size={14} className="spin" /> Sincronizando...</> : <><RefreshCw size={14} /> Sincronizar Assinaturas</>}
              </button>
            </div>

            <NotificationComposerCard
              title={groupAlertTitle}
              setTitle={setGroupAlertTitle}
              message={groupAlertMessage}
              setMessage={setGroupAlertMessage}
              channels={groupAlertChannels}
              setChannels={setGroupAlertChannels}
              onSubmit={handleSendGroupAlert}
              loading={sendingGroupAlert || groupAlertMembers.length === 0}
              error={error}
              titleLabel="Enviar alerta para o grupo"
              description={`Envia uma notificação para ${groupAlertMembers.length} membro(s) deste grupo.`}
              recipientsLabel={`${groupAlertMembers.length} destinatário(s)`}
              scopeBadge="Somente este grupo"
              submitLabel="Enviar alerta"
              titlePlaceholder="Ex: Manutenção hoje às 22h"
              messagePlaceholder="Escreva o aviso que os membros vão receber"
              className="group-alert-card"
              buttonType="button"
              disabled={groupAlertMembers.length === 0}
            />

            <div className="members-list">
              {members.map((member, idx) => (
                <div key={member.user_id} className="member-entry">
                  <div className="member-info">
                    <span className="member-number">#{idx + 1}</span>
                    <div>
                      <strong>{member.user?.name || 'Sem nome'}</strong>
                      <span className="member-email">{member.user?.email || member.user_id}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      padding: '0.2rem 0.5rem',
                      borderRadius: '999px',
                      background: member.status === 'active' ? 'rgba(16, 185, 129, 0.12)' : member.status === 'pending' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                      color: member.status === 'active' ? '#10B981' : member.status === 'pending' ? '#F59E0B' : '#EF4444',
                    }}>
                      {member.status === 'active' ? 'Ativo' : member.status === 'pending' ? 'Pendente' : 'Cancelado'}
                    </span>
                    <button
                      type="button"
                      className="btn-icon danger"
                      onClick={() => handleRemoveMember(member.user_id)}
                      title="Remover membro"
                    >
                      <UserMinus size={16} />
                    </button>
                  </div>
                </div>
              ))}

              {members.length === 0 && (
                <p className="section-desc" style={{ textAlign: 'center', padding: '1rem' }}>
                  Nenhum membro neste grupo.
                </p>
              )}
            </div>

            <div className="add-member-row">
              <input
                type="email"
                value={newMemberEmail}
                onChange={e => setNewMemberEmail(e.target.value)}
                placeholder="E-mail do usuário para adicionar"
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddMember())}
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={handleAddMember}
                disabled={addingMember || !newMemberEmail.trim()}
              >
                {addingMember ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />}
                Adicionar
              </button>
            </div>
          </section>
        )}

        <div className="form-footer">
          <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/groups')}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {isEditing ? 'Salvar Alterações' : 'Criar Grupo'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default GroupForm;
