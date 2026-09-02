import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Link } from 'react-router-dom';
import {
  Tag, Plus, Trash2, Loader2, CheckCircle, AlertTriangle,
  Edit3, X, Percent, DollarSign, Users, Calendar, Search,
  Eye, EyeOff, Copy, BarChart3, Filter,
} from 'lucide-react';
import './Coupons.css';

const INITIAL_FORM = {
  code: '',
  description: '',
  discount_type: 'percentage',
  discount_value: '',
  max_uses: '',
  min_amount: '',
  applies_to: 'all',
  group_id: '',
  expires_at: '',
  recurring: false,
};

function Coupons() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('list'); // list | create | edit
  const [form, setForm] = useState(INITIAL_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [stats, setStats] = useState(null);
  const [groups, setGroups] = useState([]);
  const [services, setServices] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [selectedService, setSelectedService] = useState('');
  const [groupSearch, setGroupSearch] = useState('');

  const fetchCoupons = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-coupons`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'list' }),
      });
      const data = await resp.json();
      setCoupons(data.coupons || []);
    } catch (e) {
      console.error('Error fetching coupons:', e);
    }
    setLoading(false);
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-coupons`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'stats' }),
      });
      const data = await resp.json();
      setStats(data.stats || null);
    } catch (e) {
      console.error('Error fetching stats:', e);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    const { data } = await supabase.from('groups').select('id, name, service_id, slug').order('name');
    setGroups(data || []);
  }, []);

  const fetchServices = useCallback(async () => {
    const { data } = await supabase.from('streaming_services').select('id, name, icon_url').order('name');
    setServices(data || []);
  }, []);

  useEffect(() => { fetchCoupons(); fetchStats(); fetchGroups(); fetchServices(); }, [fetchCoupons, fetchStats, fetchGroups, fetchServices]);

  const filteredGroups = useMemo(() => {
    let result = groups;
    if (selectedService) {
      result = result.filter(g => g.service_id === selectedService);
    }
    if (groupSearch.trim()) {
      const q = groupSearch.toLowerCase();
      result = result.filter(g =>
        g.name.toLowerCase().includes(q) ||
        g.id.toLowerCase().includes(q) ||
        (g.slug && g.slug.toLowerCase().includes(q))
      );
    }
    return result;
  }, [groups, selectedService, groupSearch]);

  const getServiceName = useCallback((serviceId) => {
    const s = services.find(s => s.id === serviceId);
    return s?.name || '';
  }, [services]);

  const openCreate = () => {
    setForm(INITIAL_FORM);
    setEditingId(null);
    setSelectedService('');
    setGroupSearch('');
    setResult(null);
    setActiveTab('create');
  };

  const openEdit = (coupon) => {
    setForm({
      code: coupon.code,
      description: coupon.description || '',
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value?.toString() || '',
      max_uses: coupon.max_uses?.toString() || '',
      min_amount: coupon.min_amount?.toString() || '',
      applies_to: coupon.applies_to || 'all',
      group_id: coupon.group_id || '',
      expires_at: coupon.expires_at ? coupon.expires_at.split('T')[0] : '',
      recurring: coupon.recurring || false,
    });
    setEditingId(coupon.id);
    // Set platform filter based on coupon's group
    if (coupon.group_id) {
      const g = groups.find(g => g.id === coupon.group_id);
      if (g) setSelectedService(g.service_id);
    } else {
      setSelectedService('');
    }
    setGroupSearch('');
    setResult(null);
    setActiveTab('edit');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.code || !form.discount_value) {
      setResult({ type: 'error', message: 'Código e valor são obrigatórios' });
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const payload = {
        action: editingId ? 'update' : 'create',
        id: editingId,
        code: form.code.toUpperCase().trim(),
        description: form.description || null,
        discount_type: form.discount_type,
        discount_value: parseFloat(form.discount_value),
        max_uses: form.max_uses ? parseInt(form.max_uses) : null,
        min_amount: form.min_amount ? parseFloat(form.min_amount) : 0,
        applies_to: form.applies_to,
        group_id: form.group_id || null,
        expires_at: form.expires_at ? new Date(form.expires_at + 'T23:59:59Z').toISOString() : null,
        recurring: form.recurring,
      };
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-coupons`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (data.success) {
        setResult({ type: 'success', message: editingId ? 'Cupom atualizado!' : 'Cupom criado!' });
        fetchCoupons();
        fetchStats();
        setTimeout(() => setActiveTab('list'), 1500);
      } else {
        setResult({ type: 'error', message: data.error });
      }
    } catch (e) {
      setResult({ type: 'error', message: e.message });
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-coupons`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'delete', id }),
      });
      const data = await resp.json();
      if (data.success) {
        setConfirmDelete(null);
        fetchCoupons();
        fetchStats();
      }
    } catch (e) {
      console.error('Delete error:', e);
    }
  };

  const handleToggleActive = async (coupon) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-coupons`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'update', id: coupon.id, active: !coupon.active }),
      });
      fetchCoupons();
    } catch (e) {
      console.error('Toggle error:', e);
    }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
  };

  const isExpired = (coupon) => coupon.expires_at && new Date(coupon.expires_at) < new Date();
  const isMaxed = (coupon) => coupon.max_uses && coupon.used_count >= coupon.max_uses;

  const isEditing = activeTab === 'edit';

  return (
    <div className="coupons-page">
      <div className="admin-header">
        <h1><Tag size={24} /> Cupons de Desconto</h1>
        <p>Gerencie cupons para entrada e assinaturas</p>
      </div>

      <div className="billing-nav-links">
        <Link to="/admin" className="billing-nav">Dashboard</Link>
        <Link to="/admin/coupons" className="billing-nav active">Cupons</Link>
      </div>

      {/* Stats */}
      {stats && (
        <div className="coupon-stats">
          <div className="coupon-stat-card">
            <Tag size={16} />
            <div>
              <span className="stat-val">{stats.total}</span>
              <span className="stat-lbl">Total</span>
            </div>
          </div>
          <div className="coupon-stat-card green">
            <CheckCircle size={16} />
            <div>
              <span className="stat-val">{stats.active}</span>
              <span className="stat-lbl">Ativos</span>
            </div>
          </div>
          <div className="coupon-stat-card blue">
            <Users size={16} />
            <div>
              <span className="stat-val">{stats.total_uses}</span>
              <span className="stat-lbl">Usos</span>
            </div>
          </div>
          <div className="coupon-stat-card purple">
            <DollarSign size={16} />
            <div>
              <span className="stat-val">R$ {stats.total_discount_given.toFixed(2)}</span>
              <span className="stat-lbl">Desconto total</span>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="coupon-tabs">
        <button
          className={`coupon-tab ${activeTab === 'list' ? 'active' : ''}`}
          onClick={() => { setActiveTab('list'); setResult(null); }}
        >
          <Tag size={14} /> Lista
        </button>
        <button
          className={`coupon-tab ${activeTab === 'create' ? 'active' : ''}`}
          onClick={openCreate}
        >
          <Plus size={14} /> Criar Cupom
        </button>
        {isEditing && (
          <button className={`coupon-tab active`}>
            <Edit3 size={14} /> Editar Cupom
          </button>
        )}
      </div>

      {/* LIST TAB */}
      {activeTab === 'list' && (
        <>
          <div className="coupon-actions-bar">
            <button className="coupon-refresh-btn" onClick={() => { fetchCoupons(); fetchStats(); }} disabled={loading}>
              <Loader2 size={16} className={loading ? 'spinning' : ''} /> Atualizar
            </button>
          </div>

          {loading ? (
            <div className="coupon-loading">Carregando cupons...</div>
          ) : coupons.length === 0 ? (
            <div className="coupon-empty">
              <Tag size={40} />
              <p>Nenhum cupom criado ainda</p>
              <button onClick={openCreate} className="coupon-add-btn">Criar Primeiro Cupom</button>
            </div>
          ) : (
            <div className="coupon-list">
              {coupons.map((coupon) => {
                const expired = isExpired(coupon);
                const maxed = isMaxed(coupon);
                const inactive = !coupon.active || expired || maxed;
                return (
                  <div key={coupon.id} className={`coupon-card ${inactive ? 'inactive' : ''}`}>
                    <div className="coupon-card-header">
                      <div className="coupon-code-row">
                        <span className="coupon-code">{coupon.code}</span>
                        <button className="copy-btn" onClick={() => copyCode(coupon.code)} title="Copiar código">
                          <Copy size={13} />
                        </button>
                        {coupon.discount_type === 'percentage' ? (
                          <span className="discount-badge percentage">
                            <Percent size={12} /> {coupon.discount_value}% OFF
                          </span>
                        ) : (
                          <span className="discount-badge fixed">
                            <DollarSign size={12} /> R$ {Number(coupon.discount_value).toFixed(2)} OFF
                          </span>
                        )}
                        {expired && <span className="status-tag expired">Expirado</span>}
                        {maxed && <span className="status-tag maxed">Esgotado</span>}
                        {!coupon.active && !expired && !maxed && <span className="status-tag inactive-tag">Inativo</span>}
                        {coupon.recurring && <span className="status-tag" style={{ background: '#1e3a5f', color: '#60a5fa' }}>Recorrente</span>}
                      </div>
                      {coupon.description && <p className="coupon-desc">{coupon.description}</p>}
                    </div>

                    <div className="coupon-card-body">
                      <div className="coupon-detail-row">
                        <span className="detail-label">Aplica-se a:</span>
                        <span className="detail-value">
                          {coupon.applies_to === 'all' ? 'Todos' : coupon.applies_to === 'entrance' ? 'Taxa de Adesão' : 'Assinatura'}
                        </span>
                      </div>
                      {coupon.group?.name && (
                        <div className="coupon-detail-row">
                          <span className="detail-label">Grupo:</span>
                          <span className="detail-value">{coupon.group.name}</span>
                        </div>
                      )}
                      {coupon.min_amount > 0 && (
                        <div className="coupon-detail-row">
                          <span className="detail-label">Valor mínimo:</span>
                          <span className="detail-value">R$ {Number(coupon.min_amount).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="coupon-detail-row">
                        <span className="detail-label">Usos:</span>
                        <span className="detail-value">
                          {coupon.used_count}{coupon.max_uses ? ` / ${coupon.max_uses}` : ' / ∞'}
                        </span>
                      </div>
                      {coupon.expires_at && (
                        <div className="coupon-detail-row">
                          <span className="detail-label">Expira:</span>
                          <span className="detail-value">
                            <Calendar size={12} />
                            {new Date(coupon.expires_at).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                      )}
                      <div className="coupon-detail-row">
                        <span className="detail-label">Usos últimos 30d:</span>
                        <span className="detail-value">{coupon.recent_uses_30d}</span>
                      </div>
                    </div>

                    <div className="coupon-card-actions">
                      <button
                        className={`toggle-active-btn ${coupon.active ? 'deactivate' : 'activate'}`}
                        onClick={() => handleToggleActive(coupon)}
                      >
                        {coupon.active ? <EyeOff size={14} /> : <Eye size={14} />}
                        {coupon.active ? 'Desativar' : 'Ativar'}
                      </button>
                      <button className="edit-btn" onClick={() => openEdit(coupon)}>
                        <Edit3 size={14} /> Editar
                      </button>
                      <button className="delete-btn" onClick={() => setConfirmDelete(coupon)}>
                        <Trash2 size={14} /> Excluir
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* CREATE / EDIT TAB (INLINE) */}
      {(activeTab === 'create' || activeTab === 'edit') && (
        <div className="coupon-form-inline">
          <div className="coupon-form-header">
            <h3>{isEditing ? 'Editar Cupom' : 'Criar Cupom'}</h3>
          </div>

          <form onSubmit={handleSave} className="coupon-form">
            <div className="form-group">
              <label>Código do Cupom *</label>
              <input
                type="text"
                placeholder="Ex: PROMO20"
                value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                maxLength={30}
                required
              />
            </div>

            <div className="form-group">
              <label>Descrição</label>
              <input
                type="text"
                placeholder="Ex: Desconto de inauguração"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>Tipo de Desconto *</label>
                <select value={form.discount_type} onChange={e => setForm({ ...form, discount_type: e.target.value })}>
                  <option value="percentage">Percentual (%)</option>
                  <option value="fixed">Valor Fixo (R$)</option>
                </select>
              </div>
              <div className="form-group">
                <label>Valor do Desconto *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={form.discount_type === 'percentage' ? '100' : undefined}
                  placeholder={form.discount_type === 'percentage' ? 'Ex: 10' : 'Ex: 15.00'}
                  value={form.discount_value}
                  onChange={e => setForm({ ...form, discount_value: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>Aplica-se a</label>
              <select value={form.applies_to} onChange={e => setForm({ ...form, applies_to: e.target.value })}>
                <option value="all">Todos os pagamentos</option>
                <option value="entrance">Taxa de Adesão</option>
                <option value="subscription">Assinatura</option>
              </select>
            </div>

            {/* GROUP SELECTOR — PLATFORM FIRST */}
            <div className="coupon-group-section">
              <label>Grupo Específico <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(opcional)</span></label>

              <div className="coupon-platform-filter">
                <Filter size={14} />
                <select value={selectedService} onChange={e => { setSelectedService(e.target.value); setForm({ ...form, group_id: '' }); }}>
                  <option value="">Todas as plataformas</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="coupon-group-search">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="Buscar por nome ou ID do grupo..."
                  value={groupSearch}
                  onChange={e => setGroupSearch(e.target.value)}
                />
              </div>

              <select
                value={form.group_id}
                onChange={e => setForm({ ...form, group_id: e.target.value })}
                className="coupon-group-select"
              >
                <option value="">Todos os grupos</option>
                {filteredGroups.map(g => {
                  const svcName = getServiceName(g.service_id);
                  return (
                    <option key={g.id} value={g.id}>
                      {svcName ? `${svcName} — ` : ''}{g.name} [{g.id.slice(0, 6)}]
                    </option>
                  );
                })}
              </select>
              {selectedService && (
                <span className="coupon-group-count">
                  {filteredGroups.length} grupo{filteredGroups.length !== 1 ? 's' : ''} encontrado{filteredGroups.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>Limite de Uso</label>
                <input
                  type="number"
                  min="1"
                  placeholder="Ilimitado"
                  value={form.max_uses}
                  onChange={e => setForm({ ...form, max_uses: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Valor Mínimo</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="R$ 0.00"
                  value={form.min_amount}
                  onChange={e => setForm({ ...form, min_amount: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Data de Expiração</label>
              <input
                type="date"
                value={form.expires_at}
                onChange={e => setForm({ ...form, expires_at: e.target.value })}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.recurring}
                  onChange={e => setForm({ ...form, recurring: e.target.checked })}
                />
                Desconto recorrente (aplicar em todos os pagamentos)
              </label>
              <small className="checkbox-help">
                Se marcado, o desconto será aplicado em TODAS as cobranças recorrentes.
                Se desmarcado, o desconto é aplicado apenas na primeira vez.
              </small>
            </div>

            <div className="coupon-form-actions">
              <button type="button" className="coupon-cancel-btn" onClick={() => setActiveTab('list')}>
                Cancelar
              </button>
              <button type="submit" className="coupon-save-btn" disabled={saving}>
                {saving ? <><Loader2 size={16} className="spinning" /> Salvando...</> : <><CheckCircle size={16} /> {isEditing ? 'Atualizar' : 'Criar Cupom'}</>}
              </button>
            </div>
          </form>

          {result && (
            <div className={`coupon-result ${result.type}`}>
              {result.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
              <span>{result.message}</span>
            </div>
          )}
        </div>
      )}

      {/* Confirm Delete */}
      {confirmDelete && (
        <div className="scheduler-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="delete-confirm-modal" onClick={e => e.stopPropagation()}>
            <AlertTriangle size={32} className="text-danger" />
            <h3>Excluir cupom?</h3>
            <p>Código: <strong>{confirmDelete.code}</strong></p>
            <p>Esta ação não pode ser desfeita.</p>
            <div className="delete-confirm-actions">
              <button className="cancel-delete-btn" onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button className="confirm-delete-btn" onClick={() => handleDelete(confirmDelete.id)}>Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Coupons;
