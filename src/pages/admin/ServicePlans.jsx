import { useState, useMemo, useEffect } from 'react';
import { Search, RefreshCw, Loader2, AlertCircle, CheckCircle, Edit2, Plus, X, Save, Tag, DollarSign, ExternalLink, Clock, Info } from 'lucide-react';
import { supabase } from '../../lib/supabase';
// fmtBRL e checkPriceStaleness inlined para evitar TDZ no bundler
const fmtBRL = (value) => {
  if (value == null || isNaN(value)) return 'R$ 0,00';
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
};
const checkPriceStaleness = (plan) => {
  if (!plan) return { isStale: false, daysSinceVerified: 0, daysSinceUpdate: 0 };
  const now = new Date();
  const verifiedAt = plan.last_verified_at ? new Date(plan.last_verified_at) : null;
  const updatedAt = plan.updated_at ? new Date(plan.updated_at) : null;
  const daysSinceVerified = verifiedAt ? Math.floor((now - verifiedAt) / (1000 * 60 * 60 * 24)) : 999;
  const daysSinceUpdate = updatedAt ? Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24)) : 999;
  return { isStale: daysSinceVerified > 90 || daysSinceUpdate > 180, daysSinceVerified, daysSinceUpdate, needsReview: daysSinceVerified > 90 };
};
import './ServicePlans.css';

const PRICE_TYPES = [
  { value: 'recurring', label: 'Recorrente' },
  { value: 'promotional', label: 'Promocional' },
  { value: 'annual', label: 'Anual' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'one_time', label: 'Único' },
];

const BILLING_CYCLES = [
  { value: 'monthly', label: 'Mensal' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'semiannual', label: 'Semestral' },
  { value: 'annual', label: 'Anual' },
];

function ServicePlans() {
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [services, setServices] = useState([]);
  const [error, setError] = useState('');

  // Filtros
  const [search, setSearch] = useState('');
  const [filterService, setFilterService] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStale, setFilterStale] = useState(false);

  // Modal de edição
  const [editingPlan, setEditingPlan] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({});

  // Modal de novo plano
  const [creatingNew, setCreatingNew] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [plansRes, servicesRes] = await Promise.all([
        supabase
          .from('service_plans')
          .select('*')
          .order('service_id')
          .order('official_price'),
        supabase
          .from('streaming_services')
          .select('id, name, full_name')
          .eq('status', 'active')
          .order('name'),
      ]);

      if (plansRes.error) throw plansRes.error;

      setPlans(plansRes.data || []);
      setServices(servicesRes.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Mapas
  const servicesMap = useMemo(() => {
    const map = {};
    services.forEach(s => { map[s.id] = s; });
    return map;
  }, [services]);

  // Estatísticas
  const stats = useMemo(() => {
    const total = plans.length;
    const active = plans.filter(p => p.is_active).length;
    const stale = plans.filter(p => {
      const s = checkPriceStaleness(p);
      return s.isStale || s.needsReview;
    }).length;
    const promo = plans.filter(p => p.price_type === 'promotional' || p.is_promo_active).length;
    const verified = plans.filter(p => p.is_verified).length;
    return { total, active, stale, promo, verified };
  }, [plans]);

  // Filtros
  const filteredPlans = useMemo(() => {
    let result = plans;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(p => {
        const svc = servicesMap[p.service_id];
        return (
          p.name?.toLowerCase().includes(q) ||
          p.plan_key?.toLowerCase().includes(q) ||
          svc?.name?.toLowerCase().includes(q) ||
          svc?.full_name?.toLowerCase().includes(q)
        );
      });
    }
    if (filterService) {
      result = result.filter(p => p.service_id === filterService);
    }
    if (filterType) {
      result = result.filter(p => p.price_type === filterType);
    }
    if (filterStale) {
      result = result.filter(p => {
        const s = checkPriceStaleness(p);
        return s.isStale || s.needsReview;
      });
    }
    return result;
  }, [plans, search, filterService, filterType, filterStale, servicesMap]);

  // Abrir edição
  const openEdit = (plan) => {
    setEditingPlan(plan);
    setFormData({
      name: plan.name,
      plan_key: plan.plan_key,
      billing_cycle: plan.billing_cycle || 'monthly',
      official_price: plan.official_price,
      price_type: plan.price_type || 'recurring',
      promotional_price: plan.promotional_price || '',
      promo_end_date: plan.promo_end_date || '',
      source_url: plan.source_url || '',
      notes: plan.notes || '',
      is_active: plan.is_active,
      is_verified: plan.is_verified || false,
      last_verified_at: plan.last_verified_at || '',
    });
    setIsModalOpen(true);
    setCreatingNew(false);
  };

  // Abrir criação
  const openCreate = (serviceId) => {
    setEditingPlan(null);
    setFormData({
      service_id: serviceId || '',
      name: '',
      plan_key: '',
      billing_cycle: 'monthly',
      official_price: '',
      price_type: 'recurring',
      promotional_price: '',
      promo_end_date: '',
      source_url: '',
      notes: '',
      is_active: true,
      is_verified: false,
      last_verified_at: '',
    });
    setIsModalOpen(true);
    setCreatingNew(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPlan(null);
    setCreatingNew(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.service_id) {
      alert('Selecione um serviço.');
      return;
    }
    if (!formData.name.trim()) {
      alert('Nome do plano é obrigatório.');
      return;
    }
    if (!formData.official_price || Number(formData.official_price) <= 0) {
      alert('Preço oficial inválido.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        service_id: formData.service_id,
        name: formData.name.trim(),
        plan_key: formData.plan_key.trim() || formData.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        billing_cycle: formData.billing_cycle,
        official_price: Number(formData.official_price),
        price_type: formData.price_type,
        promotional_price: formData.promotional_price ? Number(formData.promotional_price) : null,
        promo_end_date: formData.promo_end_date || null,
        source_url: formData.source_url.trim() || null,
        notes: formData.notes.trim() || null,
        is_active: formData.is_active,
        is_verified: formData.is_verified,
        last_verified_at: formData.last_verified_at || null,
      };

      if (creatingNew) {
        const { error } = await supabase.from('service_plans').insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('service_plans')
          .update(payload)
          .eq('id', editingPlan.id);
        if (error) throw error;
      }

      closeModal();
      await fetchData();
    } catch (err) {
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const fmtDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pt-BR');
  };

  return (
    <div className="service-plans-page">
      <div className="admin-page-header">
        <div>
          <h1><Tag size={24} /> Planos de Preços</h1>
          <p>Gerencie os preços oficiais dos planos de cada serviço.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={fetchData} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Atualizar
          </button>
          <button className="btn btn-primary" onClick={() => openCreate('')}>
            <Plus size={16} /> Novo Plano
          </button>
        </div>
      </div>

      {error && (
        <div className="admin-error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Cards de estatísticas */}
      <div className="sp-stats-cards">
        <div className="sp-stat-card">
          <span className="sp-stat-value">{stats.total}</span>
          <span className="sp-stat-label">Total de planos</span>
        </div>
        <div className="sp-stat-card">
          <span className="sp-stat-value success">{stats.active}</span>
          <span className="sp-stat-label">Planos ativos</span>
        </div>
        <div className="sp-stat-card">
          <span className="sp-stat-value warning">{stats.stale}</span>
          <span className="sp-stat-label">Precisa revisar</span>
        </div>
        <div className="sp-stat-card">
          <span className="sp-stat-value">{stats.promo}</span>
          <span className="sp-stat-label">Promocionais</span>
        </div>
        <div className="sp-stat-card">
          <span className="sp-stat-value success">{stats.verified}</span>
          <span className="sp-stat-label">Verificados</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="sp-filters">
        <div className="sp-filter-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Buscar plano ou serviço..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select value={filterService} onChange={e => setFilterService(e.target.value)}>
          <option value="">Todos os serviços</option>
          {services.map(s => (
            <option key={s.id} value={s.id}>{s.full_name || s.name}</option>
          ))}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">Todos os tipos</option>
          {PRICE_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <label className="sp-filter-stale">
          <input
            type="checkbox"
            checked={filterStale}
            onChange={e => setFilterStale(e.target.checked)}
          />
          Só desatualizados
        </label>
      </div>

      {/* Tabela */}
      <div className="sp-table-wrap">
        {loading ? (
          <div className="admin-loading">
            <Loader2 size={24} className="spin" />
            <span>Carregando...</span>
          </div>
        ) : filteredPlans.length === 0 ? (
          <div className="admin-empty">
            <Tag size={32} />
            <p>Nenhum plano encontrado.</p>
          </div>
        ) : (
          <table className="sp-table">
            <thead>
              <tr>
                <th>Serviço</th>
                <th>Plano</th>
                <th>Tipo</th>
                <th>Ciclo</th>
                <th>Preço Oficial</th>
                <th>Última Verificação</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredPlans.map(plan => {
                const service = servicesMap[plan.service_id];
                const staleness = checkPriceStaleness(plan);
                const priceType = PRICE_TYPES.find(t => t.value === plan.price_type) || { label: plan.price_type };

                return (
                  <tr key={plan.id} className={!plan.is_active ? 'inactive-row' : ''}>
                    <td>
                      <span className="sp-service-name">
                        {service?.full_name || service?.name || '—'}
                      </span>
                    </td>
                    <td>
                      <span className="sp-plan-name">{plan.name}</span>
                      {plan.plan_key && (
                        <span className="sp-plan-key">{plan.plan_key}</span>
                      )}
                    </td>
                    <td>
                      <span className={`sp-type-badge type-${plan.price_type || 'recurring'}`}>
                        {priceType.label}
                      </span>
                    </td>
                    <td>
                      <span className="sp-billing-cycle">{BILLING_CYCLES.find(c => c.value === plan.billing_cycle)?.label || plan.billing_cycle || '-'}</span>
                    </td>
                    <td>
                      <div className="sp-price-cell">
                        <span className="sp-price">{fmtBRL(plan.official_price)}</span>
                        {plan.promotional_price && plan.is_promo_active && (
                          <span className="sp-promo-price">
                            promo: {fmtBRL(plan.promotional_price)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="sp-verified-cell">
                        {staleness.isStale ? (
                          <span className="sp-stale-badge">
                            <AlertCircle size={12} />
                            {staleness.daysSinceVerified > 90
                              ? `Sem verificar há ${staleness.daysSinceVerified}d`
                              : `Atualizado há ${staleness.daysSinceUpdate}d`}
                          </span>
                        ) : plan.is_verified ? (
                          <span className="sp-verified-badge">
                            <CheckCircle size={12} />
                            {fmtDate(plan.last_verified_at)}
                          </span>
                        ) : (
                          <span className="sp-unverified-badge">
                            <Clock size={12} />
                            Não verificado
                          </span>
                        )}
                        {plan.source_url && (
                          <a
                            href={plan.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="sp-source-link"
                            title="Ver fonte"
                          >
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`sp-status-badge ${plan.is_active ? 'active' : 'inactive'}`}>
                        {plan.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-icon btn-ghost"
                        onClick={() => openEdit(plan)}
                        title="Editar"
                      >
                        <Edit2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {filteredPlans.length > 0 && (
          <p className="sp-table-info">
            Mostrando {filteredPlans.length} de {plans.length} planos
          </p>
        )}
      </div>

      {/* Modal de edição/criação */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content sp-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{creatingNew ? 'Novo Plano' : 'Editar Plano'}</h3>
              <button className="btn btn-icon btn-ghost" onClick={closeModal}>
                <X size={18} />
              </button>
            </div>
            <form className="modal-body" onSubmit={handleSave}>
              <div className="sp-form-grid">
                {/* Serviço */}
                <div className="sp-form-field full">
                  <label>Serviço *</label>
                  <select
                    value={formData.service_id}
                    onChange={e => setFormData(f => ({ ...f, service_id: e.target.value }))}
                    required
                    disabled={!creatingNew}
                  >
                    <option value="">Selecione...</option>
                    {services.map(s => (
                      <option key={s.id} value={s.id}>{s.full_name || s.name}</option>
                    ))}
                  </select>
                </div>

                {/* Nome do plano */}
                <div className="sp-form-field full">
                  <label>Nome do Plano *</label>
                  <input
                    type="text"
                    placeholder="Ex: Premium, Padrão, Família..."
                    value={formData.name}
                    onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>

                {/* Plan key */}
                <div className="sp-form-field">
                  <label>Chave (slug)</label>
                  <input
                    type="text"
                    placeholder="premium, padrao, familia..."
                    value={formData.plan_key}
                    onChange={e => setFormData(f => ({ ...f, plan_key: e.target.value }))}
                  />
                </div>

                {/* Ciclo */}
                <div className="sp-form-field">
                  <label>Ciclo de Cobrança</label>
                  <select
                    value={formData.billing_cycle}
                    onChange={e => setFormData(f => ({ ...f, billing_cycle: e.target.value }))}
                  >
                    {BILLING_CYCLES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>

                {/* Preço oficial */}
                <div className="sp-form-field">
                  <label>Preço Oficial (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={formData.official_price}
                    onChange={e => setFormData(f => ({ ...f, official_price: e.target.value }))}
                    required
                  />
                </div>

                {/* Tipo de preço */}
                <div className="sp-form-field">
                  <label>Tipo de Preço</label>
                  <select
                    value={formData.price_type}
                    onChange={e => setFormData(f => ({ ...f, price_type: e.target.value }))}
                  >
                    {PRICE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* Preço promocional */}
                {(formData.price_type === 'promotional') && (
                  <>
                    <div className="sp-form-field">
                      <label>Preço Promocional (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={formData.promotional_price}
                        onChange={e => setFormData(f => ({ ...f, promotional_price: e.target.value }))}
                      />
                    </div>
                    <div className="sp-form-field">
                      <label>Fim da Promoção</label>
                      <input
                        type="date"
                        value={formData.promo_end_date}
                        onChange={e => setFormData(f => ({ ...f, promo_end_date: e.target.value }))}
                      />
                    </div>
                  </>
                )}

                {/* Fonte */}
                <div className="sp-form-field full">
                  <label>URL da Fonte (site oficial)</label>
                  <input
                    type="url"
                    placeholder="https://www.netflix.com/br/..."
                    value={formData.source_url}
                    onChange={e => setFormData(f => ({ ...f, source_url: e.target.value }))}
                  />
                </div>

                {/* Data última verificação */}
                <div className="sp-form-field">
                  <label>Última Verificação</label>
                  <input
                    type="date"
                    value={formData.last_verified_at}
                    onChange={e => setFormData(f => ({ ...f, last_verified_at: e.target.value }))}
                  />
                </div>

                {/* Status ativo */}
                <div className="sp-form-field">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={e => setFormData(f => ({ ...f, is_active: e.target.checked }))}
                    />
                    Plano ativo
                  </label>
                </div>

                {/* Verificado */}
                <div className="sp-form-field">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.is_verified}
                      onChange={e => setFormData(f => ({ ...f, is_verified: e.target.checked }))}
                    />
                    Preço verificado
                  </label>
                </div>

                {/* Observações */}
                <div className="sp-form-field full">
                  <label>Observações</label>
                  <textarea
                    rows={2}
                    placeholder="Notas sobre atualização, fontes alternativas, etc."
                    value={formData.notes}
                    onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>

              {/* Info alert sobre economia negativa */}
              <div className="sp-form-alert">
                <Info size={14} />
                <span>
                  Se o preço DividePass de algum grupo for <strong>superior</strong> ao preço oficial cadastrado aqui, a economia será negativa e um alerta será gerado automaticamente. O sistema não exibirá economia negativa como economia real.
                </span>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={closeModal}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ServicePlans;
