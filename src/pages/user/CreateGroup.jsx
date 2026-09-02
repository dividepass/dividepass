import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Save, Info, Info as InfoIcon, Mail, Link, Hash, MessageSquare, Settings, Camera } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import './CreateGroup.css';

function CreateGroup() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [defaultEntranceFee, setDefaultEntranceFee] = useState(15);

  const [formData, setFormData] = useState({
    service_id: '',
    name: '',
    price_per_slot: '',
    available_cycles: ['monthly'],
    has_slot_limit: false,
    max_size: 4,
    rules: '',
  });

  const [customCycleEnabled, setCustomCycleEnabled] = useState(false);
  const [customCycleMonths, setCustomCycleMonths] = useState(2);
  const [customCycleLabel, setCustomCycleLabel] = useState('');

  const [daysCycleEnabled, setDaysCycleEnabled] = useState(false);
  const [daysCycleDays, setDaysCycleDays] = useState(15);
  const [daysCycleLabel, setDaysCycleLabel] = useState('');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [credentialType, setCredentialType] = useState('email_password');
  const [credentialExtra, setCredentialExtra] = useState('');
  const [credentialNotes, setCredentialNotes] = useState('');

  const PLAN_TYPES = [
    'Conta Individual',
    'Conta Padrão',
    'Conta Premium',
    'Conta VIP',
    'Conta Go',
    'Conta Light',
    'Conta Enterprise',
    'Conta Team',
    'Conta PRO',
    'Conta PRO+',
    'Conta PLUS',
    'Conta MAX',
    'Conta Educação',
    'Conta Duo',
    'Conta Família',
  ];
  const [planType, setPlanType] = useState('');
  const [planTypeCustom, setPlanTypeCustom] = useState('');
  const [customPlanActive, setCustomPlanActive] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  const priceSimulation = useMemo(() => {
    const price = parseFloat(formData.price_per_slot) || 0;
    const gatewayFee = price * 0.0498;
    const platformFee = price * 0.0395;
    const net = price - gatewayFee - platformFee;
    return { price, gatewayFee, platformFee, net };
  }, [formData.price_per_slot]);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [servicesRes, settingsRes] = await Promise.all([
          supabase.from('streaming_services').select('id, name, full_name, icon, icon_url, color, slug').eq('status', 'active').order('name'),
          supabase.from('app_settings').select('key, value').in('key', ['default_entrance_fee']),
        ]);

        if (servicesRes.error) throw servicesRes.error;
        setServices(servicesRes.data || []);

        if (settingsRes.data) {
          const feeSetting = settingsRes.data.find(s => s.key === 'default_entrance_fee');
          if (feeSetting) setDefaultEntranceFee(parseFloat(feeSetting.value) || 15);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (!user?.id) throw new Error('Usuário não autenticado');

      const selectedCycles = [...formData.available_cycles];
      if (customCycleEnabled) {
        selectedCycles.push('custom');
      }
      if (daysCycleEnabled) {
        selectedCycles.push('days');
      }

      const groupPayload = {
        service_id: formData.service_id,
        name: formData.name,
        price_per_slot: parseFloat(formData.price_per_slot),
        billing_cycle: selectedCycles[0] || 'monthly',
        available_cycles: selectedCycles,
        max_size: formData.has_slot_limit ? parseInt(formData.max_size, 10) : null,
        has_slot_limit: formData.has_slot_limit,
        has_entrance_fee: true,
        entrance_fee: defaultEntranceFee,
        rules: formData.rules || null,
        tags: [],
        verified: false,
        status: 'open',
        owner_id: user.id,
        is_official: false,
        custom_cycle_months: customCycleEnabled ? parseInt(customCycleMonths, 10) : null,
        custom_cycle_label: customCycleEnabled ? customCycleLabel : (daysCycleEnabled ? daysCycleLabel : null),
        custom_cycle_days: daysCycleEnabled ? parseInt(daysCycleDays, 10) : null,
        approval_status: 'pending',
        plan_type: customPlanActive ? null : (planType || null),
        plan_type_custom: customPlanActive ? (planTypeCustom || null) : null,
      };

      const { data: newGroup, error: insertError } = await supabase
        .from('groups')
        .insert(groupPayload)
        .select('id')
        .single();

      if (insertError) throw insertError;

      const shortSlug = newGroup.id.slice(0, 6).toUpperCase();
      const { error: slugError } = await supabase
        .from('groups')
        .update({ slug: shortSlug })
        .eq('id', newGroup.id);
      if (slugError) throw slugError;

      // Platform event: group created
      try {
        await supabase.from('platform_events').insert({
          event_type: 'group_created',
          title: 'Grupo criado',
          message: `${user?.name || 'Usuário'} criou o grupo "${groupPayload.name}".`,
          metadata: JSON.stringify({ group_id: newGroup.id, group_name: groupPayload.name, owner_id: user.id }),
          created_by: user.id,
        });
      } catch (e) { console.error('Platform event error:', e); }

      if (photoFile) {
        const ext = photoFile.name.split('.').pop();
        const photoPath = `${newGroup.id}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('group-covers')
          .upload(photoPath, photoFile, { upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('group-covers').getPublicUrl(photoPath);
        await supabase.from('groups').update({ photo_url: urlData.publicUrl }).eq('id', newGroup.id);
      }

      if (loginEmail || loginPassword) {
        const { error: credError } = await supabase
          .from('group_credentials')
          .insert({
            group_id: newGroup.id,
            login_email: loginEmail,
            login_password: loginPassword,
            has_profiles: false,
            credential_type: credentialType,
            credential_link: credentialType === 'link' ? credentialExtra : null,
            credential_code: credentialType === 'code' ? credentialExtra : null,
            credential_invite: credentialType === 'invite' ? credentialExtra : null,
            credential_custom: credentialType === 'custom' ? credentialExtra : null,
          });
        if (credError) throw credError;
      }

      navigate('/dashboard/my-groups');
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
    <div className="fade-in create-group-page">
      <button onClick={() => navigate(-1)} className="back-btn">
        <ArrowLeft size={18} />
        Voltar
      </button>

      <div className="page-header">
        <h1>Criar Grupo</h1>
        <p>Monte seu grupo e comece a compartilhar assinaturas.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handleSubmit} className="create-group-form">
        <section className="form-section">
          <h2>Dados do Grupo</h2>

          <div className="form-group">
            <label>Plataforma *</label>
            <select name="service_id" value={formData.service_id} onChange={handleChange} required>
              <option value="">Selecione a plataforma</option>
              {services.map(s => (
                <option key={s.id} value={s.id}>{s.full_name || s.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Nome do grupo *</label>
            <input
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Ex: Netflix - Grupo Premium"
              required
            />
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

          <div className="form-group">
            <label>Preço por vaga (R$) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              name="price_per_slot"
              value={formData.price_per_slot}
              onChange={handleChange}
              placeholder="0.00"
              required
            />
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
                  <span>Taxa gateway (4,98%)</span>
                  <span>- R$ {priceSimulation.gatewayFee.toFixed(2)}</span>
                </div>
                <div className="sim-row fee">
                  <span>Taxa plataforma (3,95%)</span>
                  <span>- R$ {priceSimulation.platformFee.toFixed(2)}</span>
                </div>
                <div className="sim-row total">
                  <span>Você recebe</span>
                  <strong>R$ {priceSimulation.net.toFixed(2)}</strong>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="form-section">
          <h2>Ciclos de Cobrança</h2>
          <p className="section-desc">Selecione quais ciclos os membros poderão escolher.</p>

          <div className="cycles-grid">
            {[
              { value: 'monthly', label: 'Mensal' },
              { value: 'quarterly', label: 'Trimestral' },
              { value: 'semiannual', label: 'Semestral' },
              { value: 'annual', label: 'Anual' },
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

            <label className={`cycle-check ${daysCycleEnabled ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={daysCycleEnabled}
                onChange={e => setDaysCycleEnabled(e.target.checked)}
              />
              <span>Dias</span>
            </label>

            <label className={`cycle-check ${customCycleEnabled ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={customCycleEnabled}
                onChange={e => setCustomCycleEnabled(e.target.checked)}
              />
              <span>Personalizado</span>
            </label>
          </div>

          {daysCycleEnabled && (
            <div className="custom-cycle-fields">
              <div className="form-group">
                <label>Quantidade de dias do ciclo *</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={daysCycleDays}
                  onChange={e => setDaysCycleDays(e.target.value)}
                  required={daysCycleEnabled}
                />
              </div>
              <div className="form-group">
                <label>Label do ciclo *</label>
                <input
                  value={daysCycleLabel}
                  onChange={e => setDaysCycleLabel(e.target.value)}
                  placeholder="Ex: 15 Dias, Ciclo 7 dias"
                  required={daysCycleEnabled}
                />
              </div>
            </div>
          )}

          {customCycleEnabled && (
            <div className="custom-cycle-fields">
              <div className="form-group">
                <label>Meses do ciclo *</label>
                <input
                  type="number"
                  min="1"
                  max="36"
                  value={customCycleMonths}
                  onChange={e => setCustomCycleMonths(e.target.value)}
                  required={customCycleEnabled}
                />
              </div>
              <div className="form-group">
                <label>Label do ciclo *</label>
                <input
                  value={customCycleLabel}
                  onChange={e => setCustomCycleLabel(e.target.value)}
                  placeholder="Ex: Bimestral, Ciclo 5 meses"
                  required={customCycleEnabled}
                />
              </div>
            </div>
          )}
        </section>

        <section className="form-section">
          <h2>Configurações</h2>

          <div className="toggle-section">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={formData.has_slot_limit}
                onChange={e => setFormData(prev => ({ ...prev, has_slot_limit: e.target.checked }))}
              />
              <span className="toggle-switch" />
              <span className="toggle-text">
                <strong>Limitar vagas</strong>
                <small>Defina um limite de membros no grupo</small>
              </span>
            </label>
          </div>

          {formData.has_slot_limit && (
            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label>Limite de vagas *</label>
              <input
                type="number"
                min="1"
                name="max_size"
                value={formData.max_size}
                onChange={handleChange}
                required={formData.has_slot_limit}
              />
            </div>
          )}

          <div className="entrance-fee-display">
            <div className="entrance-fee-header">
              <InfoIcon size={16} />
              <span>Taxa de Adesão: R$ {defaultEntranceFee.toFixed(2).replace('.', ',')}</span>
            </div>
            <p className="entrance-fee-hint">
              Valor obrigatório cobrado uma única vez na entrada de cada membro. Definido pela plataforma.
            </p>
          </div>

          <div className="adesao-info-box">
            <h4>Taxa de Adesão — Informações para o criador do grupo</h4>
            <p>Ao criar um grupo, você não paga nenhuma Taxa de Adesão. O criador do grupo é totalmente isento dessa cobrança.</p>
            <p>A Taxa de Adesão é aplicada exclusivamente aos novos participantes que desejarem ingressar no seu grupo.</p>
            <ul className="adesao-info-list">
              <li>E cobrada apenas uma única vez de cada novo participante.</li>
              <li>E definida e recebida exclusivamente pela plataforma.</li>
              <li>Nao reduz nem altera o valor da mensalidade definido por voce.</li>
              <li>Tem como objetivo validar o ingresso do participante e reduzir desistencias apos a reserva da vaga.</li>
            </ul>
            <p>Apos o pagamento da Taxa de Adesao, o participante terá até 12 horas para concluir o pagamento da mensalidade da assinatura. Caso isso nao ocorra, sua participacao sera cancelada e a Taxa de Adesao sera reembolsada automaticamente.</p>
          </div>

          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label>Regras do grupo</label>
            <textarea
              rows={4}
              name="rules"
              value={formData.rules}
              onChange={handleChange}
              placeholder="Ex: Não compartilhar a senha; usar apenas 1 tela; etc."
            />
          </div>
        </section>

        <section className="form-section">
          <h2>Credenciais de Acesso</h2>
          <p className="section-desc">
            Configure como os membros vão acessar a conta da plataforma.
          </p>

          <div className="cred-type-grid">
            {[
              { value: 'email_password', icon: <Mail size={16} />, label: 'Email + Senha' },
              { value: 'link', icon: <Link size={16} />, label: 'Link de Acesso' },
              { value: 'code', icon: <Hash size={16} />, label: 'Código' },
              { value: 'invite', icon: <MessageSquare size={16} />, label: 'Convite' },
              { value: 'custom', icon: <Settings size={16} />, label: 'Personalizado' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`cred-type-btn ${credentialType === opt.value ? 'active' : ''}`}
                onClick={() => { setCredentialType(opt.value); setCredentialExtra(''); }}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
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
            <div className="form-group">
              <label>Link de acesso</label>
              <input
                value={credentialExtra}
                onChange={e => setCredentialExtra(e.target.value)}
                placeholder="https://..."
              />
            </div>
          )}

          {credentialType === 'code' && (
            <div className="form-group">
              <label>Código de acesso</label>
              <input
                value={credentialExtra}
                onChange={e => setCredentialExtra(e.target.value)}
                placeholder="Ex: ABCD-1234"
              />
            </div>
          )}

          {credentialType === 'invite' && (
            <div className="form-group">
              <label>Link de convite</label>
              <input
                value={credentialExtra}
                onChange={e => setCredentialExtra(e.target.value)}
                placeholder="https://..."
              />
            </div>
          )}

          {credentialType === 'custom' && (
            <div className="form-group">
              <label>Credencial personalizada</label>
              <textarea
                rows={3}
                value={credentialExtra}
                onChange={e => setCredentialExtra(e.target.value)}
                placeholder="Descreva ou cole a credencial de acesso..."
              />
            </div>
          )}

          {(credentialType === 'email_password' || credentialType === 'link' || credentialType === 'code' || credentialType === 'invite' || credentialType === 'custom') && (
            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label>Observações (opcional)</label>
              <textarea
                rows={2}
                value={credentialNotes}
                onChange={e => setCredentialNotes(e.target.value)}
                placeholder="Ex: Não compartilhar; usar apenas 1 tela; etc."
              />
            </div>
          )}
        </section>

        <div className="approval-notice">
          <Info size={16} />
          <span>Seu grupo ficará pendente de aprovação pela equipe DividePass antes de ficar visível no catálogo.</span>
        </div>

        <div className="form-footer">
          <button type="button" className="btn btn-outline" onClick={() => navigate(-1)}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            Criar Grupo
          </button>
        </div>
      </form>
    </div>
  );
}

export default CreateGroup;
