import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import {
  Megaphone, Plus, Trash2, Loader2, Edit3, Eye, EyeOff, DollarSign,
  MousePointerClick, Calendar, Filter, Check, AlertTriangle, Layers,
} from 'lucide-react';
import './SponsoredOffers.css';

const SPONSORED_SELECT = `
  id,
  service_id,
  group_id,
  sponsor_user_id,
  sponsor_name,
  headline,
  description,
  badge,
  cta_label,
  cta_url,
  banner_url,
  placement,
  amount_paid,
  period_start,
  period_end,
  status,
  priority,
  impressions,
  clicks,
  notes,
  created_at,
  service:service_id (id, name, slug, icon, icon_url, color),
  group:group_id (id, name, slug, owner_id, service_id)
`;

const INITIAL_FORM = {
  service_id: '',
  group_id: '',
  sponsor_name: '',
  headline: '',
  description: '',
  badge: 'Oferta em destaque',
  cta_label: 'Ver oferta',
  cta_url: '',
  banner_url: '',
  // Padrão: nos dois lugares (topo do catálogo E faixa de recomendados do
  // dashboard). Quem paga quer ser visto — o padrão é o que mais vende.
  placement: 'both',
  amount_paid: '',
  period_start: new Date().toISOString().slice(0, 10),
  period_end: '',
  status: 'active',
  priority: '0',
  notes: '',
};

const PLACEMENT_LABELS = {
  catalog: 'Topo do catálogo',
  recommendation: 'Recomendados para você',
  both: 'Nos dois lugares',
};

const STATUS_LABELS = {
  active: 'Ativa',
  paused: 'Pausada',
  ended: 'Encerrada',
};

function fmtBRL(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

function fmtDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('pt-BR');
}

/**
 * O valor pago vem de um campo que aceita "199,90" (vírgula, jeito brasileiro).
 *
 * Não dá para usar `type="number"` aqui: o navegador REJEITA a vírgula num
 * input numérico (o valor sanitizado volta vazio), então o admin digitava
 * "199,90" e o campo ficava em branco — e o `Number("199,90")` é `NaN`, que
 * virar `null` no payload (a oferta entrava sem valor nenhum).
 *
 * Aqui a vírgula vira ponto e o texto solto não quebra a tela.
 */
function valorPago(bruto) {
  const texto = String(bruto ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!texto) return 0;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Admin das "Ofertas patrocinadas no catálogo".
 *
 * É a tela que vende o espaço: o admin registra quem patrocinou, por quanto
 * tempo, em qual posição o anúncio aparece e quanto foi pago. O valor aqui é
 * registro comercial — o cobrança de verdade é feita fora (a tabela não
 * processa pagamento).
 */
export default function SponsoredOffers() {
  const [offers, setOffers] = useState([]);
  const [services, setServices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [result, setResult] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // "agora" é capturado uma vez por montagem: o cálculo de período fica
  // estável entre renders e não usa Date.now() dentro do render.
  const [now] = useState(() => Date.now());

  const fetchOffers = useCallback(async ({ spinner = false } = {}) => {
    if (spinner) setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('sponsored_offers')
        .select(SPONSORED_SELECT)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[sponsored_offers]', error.message);
        setResult({
          type: 'error',
          message:
            'Não foi possível carregar as ofertas. Se a tabela ainda não existe, aplique a migration database/add-sponsored-offers.sql.',
        });
        setOffers([]);
      } else {
        setOffers(data || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      if (spinner) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    // Carrega fora do corpo síncrono do effect: o setState do spinner acontece
    // no próximo tick e não vira um render em cascata.
    (async () => {
      await Promise.resolve();
      if (!alive) return;
      await fetchOffers();

      const [servicesRes, groupsRes] = await Promise.all([
        supabase
          .from('streaming_services')
          .select('id, name, slug, icon_url, color')
          .eq('status', 'active')
          .order('name'),
        supabase
          .from('groups')
          .select('id, name, slug, service_id, owner_id')
          .order('name'),
      ]);
      if (!alive) return;
      setServices(servicesRes.data || []);
      setGroups(groupsRes.data || []);
    })();
    return () => { alive = false; };
  }, [fetchOffers]);

  const stats = useMemo(() => {
    const active = offers.filter((o) => o.status === 'active');
    const inPeriod = active.filter(
      (o) =>
        new Date(o.period_start).getTime() <= now &&
        (!o.period_end || new Date(o.period_end).getTime() >= now)
    );
    const revenue = offers.reduce((acc, o) => acc + (Number(o.amount_paid) || 0), 0);
    const clicks = offers.reduce((acc, o) => acc + (Number(o.clicks) || 0), 0);
    return { total: offers.length, active: inPeriod.length, revenue, clicks };
  }, [offers, now]);

  const filteredGroups = useMemo(() => {
    if (!form.service_id) return groups;
    return groups.filter((g) => g.service_id === form.service_id);
  }, [groups, form.service_id]);

  const openCreate = () => {
    setForm(INITIAL_FORM);
    setEditingId(null);
    setResult(null);
    setShowForm(true);
  };

  const openEdit = (offer) => {
    setForm({
      service_id: offer.service_id || '',
      group_id: offer.group_id || '',
      sponsor_name: offer.sponsor_name || '',
      headline: offer.headline || '',
      description: offer.description || '',
      badge: offer.badge || 'Oferta em destaque',
      cta_label: offer.cta_label || 'Ver oferta',
      cta_url: offer.cta_url || '',
      banner_url: offer.banner_url || '',
      placement: offer.placement || 'catalog',
      amount_paid:
        offer.amount_paid != null
          ? Number(offer.amount_paid).toFixed(2).replace('.', ',')
          : '',
      period_start: offer.period_start
        ? new Date(offer.period_start).toISOString().slice(0, 10)
        : '',
      period_end: offer.period_end
        ? new Date(offer.period_end).toISOString().slice(0, 10)
        : '',
      status: offer.status || 'active',
      priority: String(offer.priority ?? 0),
      notes: offer.notes || '',
    });
    setEditingId(offer.id);
    setResult(null);
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.headline.trim()) {
      setResult({ type: 'error', message: 'O título da oferta é obrigatório.' });
      return;
    }
    if (!form.service_id && !form.group_id) {
      setResult({
        type: 'error',
        message: 'Escolha um serviço ou um grupo para a oferta.',
      });
      return;
    }
    if (!form.sponsor_name.trim()) {
      setResult({ type: 'error', message: 'Informe quem patrocinou.' });
      return;
    }

    setSaving(true);
    setResult(null);

    // Quando o anúncio é de um grupo, o patrocinador é o dono dele — é quem
    // "turbinou" e por isso ganha o boost nos recomendados.
    const group = form.group_id ? groups.find((g) => g.id === form.group_id) : null;

    const payload = {
      service_id: form.service_id || group?.service_id || null,
      group_id: form.group_id || null,
      sponsor_user_id: group?.owner_id || null,
      sponsor_name: form.sponsor_name.trim(),
      headline: form.headline.trim(),
      description: form.description.trim() || null,
      badge: form.badge.trim() || 'Oferta em destaque',
      cta_label: form.cta_label.trim() || 'Ver oferta',
      cta_url: form.cta_url.trim() || null,
      banner_url: form.banner_url.trim() || null,
      placement: form.placement,
      amount_paid: valorPago(form.amount_paid),
      period_start: form.period_start
        ? new Date(`${form.period_start}T00:00:00`).toISOString()
        : new Date().toISOString(),
      period_end: form.period_end
        ? new Date(`${form.period_end}T23:59:59`).toISOString()
        : null,
      status: form.status,
      priority: Number(form.priority) || 0,
      notes: form.notes.trim() || null,
    };

    try {
      const query = editingId
        ? supabase.from('sponsored_offers').update(payload).eq('id', editingId)
        : supabase.from('sponsored_offers').insert(payload);

      const { error } = await query;
      if (error) throw error;

      setResult({
        type: 'success',
        message: editingId ? 'Oferta atualizada!' : 'Oferta criada!',
      });
      setShowForm(false);
      setEditingId(null);
      fetchOffers();
    } catch (err) {
      console.error(err);
      setResult({ type: 'error', message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (offer) => {
    const nextStatus = offer.status === 'active' ? 'paused' : 'active';
    try {
      const { error } = await supabase
        .from('sponsored_offers')
        .update({ status: nextStatus })
        .eq('id', offer.id);
      if (error) throw error;
      fetchOffers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    try {
      const { error } = await supabase.from('sponsored_offers').delete().eq('id', id);
      if (error) throw error;
      setConfirmDelete(null);
      fetchOffers();
    } catch (err) {
      console.error(err);
    }
  };

  const isExpired = (offer) =>
    offer.period_end && new Date(offer.period_end).getTime() < now;

  return (
    <div className="spon-admin">
      <div className="admin-header">
        <h1>
          <Megaphone size={24} /> Ofertas Patrocinadas
        </h1>
        <p>
          Espaço comprado por parceiros para destacar serviços no topo do
          catálogo e nos recomendados
        </p>
      </div>

      {/* Resumo */}
      <div className="spon-stats">
        <div className="spon-stat-card">
          <Layers size={16} />
          <div>
            <span className="spon-stat-val">{stats.total}</span>
            <span className="spon-stat-lbl">Cadastradas</span>
          </div>
        </div>
        <div className="spon-stat-card spon-stat-card--green">
          <Check size={16} />
          <div>
            <span className="spon-stat-val">{stats.active}</span>
            <span className="spon-stat-lbl">No ar</span>
          </div>
        </div>
        <div className="spon-stat-card spon-stat-card--purple">
          <DollarSign size={16} />
          <div>
            <span className="spon-stat-val">{fmtBRL(stats.revenue)}</span>
            <span className="spon-stat-lbl">Patrocínio</span>
          </div>
        </div>
        <div className="spon-stat-card spon-stat-card--blue">
          <MousePointerClick size={16} />
          <div>
            <span className="spon-stat-val">{stats.clicks}</span>
            <span className="spon-stat-lbl">Cliques</span>
          </div>
        </div>
      </div>

      {result && !showForm && (
        <div className={`spon-result spon-result--${result.type}`}>
          {result.type === 'success' ? (
            <Check size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
          {result.message}
        </div>
      )}

      <div className="spon-actions-bar">
        <button
          className="spon-btn spon-btn--ghost"
          onClick={() => fetchOffers({ spinner: true })}
          disabled={refreshing}
        >
          <Loader2 size={16} className={refreshing ? 'spinning' : ''} /> Atualizar
        </button>
        <button className="spon-btn spon-btn--primary" onClick={openCreate}>
          <Plus size={16} /> Nova Oferta
        </button>
      </div>

      {/* Formulário */}
      {showForm && (
        <div className="spon-form-inline">
          <div className="spon-form-header">
            <h3>{editingId ? 'Editar Oferta' : 'Nova Oferta Patrocinada'}</h3>
          </div>

          <form onSubmit={handleSave} className="spon-form">
            <div className="spon-form-row">
              <div className="form-group">
                <label>Serviço</label>
                <select
                  value={form.service_id}
                  onChange={(e) =>
                    setForm({ ...form, service_id: e.target.value, group_id: '' })
                  }
                >
                  <option value="">Selecione...</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Grupo específico (opcional)</label>
                <select
                  value={form.group_id}
                  onChange={(e) => setForm({ ...form, group_id: e.target.value })}
                >
                  <option value="">Nenhum — destaque só do serviço</option>
                  {filteredGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Patrocinador *</label>
              <input
                type="text"
                placeholder="Ex: Studio Aurora"
                value={form.sponsor_name}
                onChange={(e) => setForm({ ...form, sponsor_name: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Título da oferta *</label>
              <input
                type="text"
                placeholder="Ex: Oferta em destaque"
                value={form.headline}
                onChange={(e) => setForm({ ...form, headline: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Descrição</label>
              <textarea
                rows={3}
                placeholder="Explique o que a pessoa ganha ao clicar"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="spon-form-row">
              <div className="form-group">
                <label>Selo</label>
                <input
                  type="text"
                  value={form.badge}
                  onChange={(e) => setForm({ ...form, badge: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Texto do botão</label>
                <input
                  type="text"
                  value={form.cta_label}
                  onChange={(e) => setForm({ ...form, cta_label: e.target.value })}
                />
              </div>
            </div>

            <div className="spon-form-row">
              <div className="form-group">
                <label>Link do botão (opcional)</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={form.cta_url}
                  onChange={(e) => setForm({ ...form, cta_url: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Imagem do banner (URL)</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={form.banner_url}
                  onChange={(e) => setForm({ ...form, banner_url: e.target.value })}
                />
              </div>
            </div>

            <div className="spon-form-row">
              <div className="form-group">
                <label>Onde aparece</label>
                <select
                  value={form.placement}
                  onChange={(e) => setForm({ ...form, placement: e.target.value })}
                >
                  {Object.entries(PLACEMENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="spon-form-row">
              <div className="form-group">
                <label>Valor pago (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={form.amount_paid}
                  onChange={(e) => setForm({ ...form, amount_paid: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Prioridade</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                />
              </div>
            </div>

            <div className="spon-form-row">
              <div className="form-group">
                <label>Início do período</label>
                <input
                  type="date"
                  value={form.period_start}
                  onChange={(e) => setForm({ ...form, period_start: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Fim do período (opcional)</label>
                <input
                  type="date"
                  value={form.period_end}
                  onChange={(e) => setForm({ ...form, period_end: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Anotações internas</label>
              <textarea
                rows={2}
                placeholder="Contrato, contato do parceiro, forma de pagamento..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            {result && (
              <div className={`spon-result spon-result--${result.type}`}>
                {result.type === 'success' ? (
                  <Check size={16} />
                ) : (
                  <AlertTriangle size={16} />
                )}
                {result.message}
              </div>
            )}

            <div className="spon-form-actions">
              <button
                type="button"
                className="spon-btn spon-btn--ghost"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setResult(null);
                }}
              >
                Cancelar
              </button>
              <button type="submit" className="spon-btn spon-btn--primary" disabled={saving}>
                {saving ? <Loader2 size={16} className="spinning" /> : <Check size={16} />}
                {editingId ? 'Salvar alterações' : 'Criar oferta'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="spon-empty">Carregando ofertas...</div>
      ) : offers.length === 0 ? (
        <div className="spon-empty">
          <Megaphone size={40} />
          <p>Nenhuma oferta patrocinada cadastrada</p>
          <button className="spon-btn spon-btn--primary" onClick={openCreate}>
            Criar primeira oferta
          </button>
        </div>
      ) : (
        <div className="spon-list">
          {offers.map((offer) => (
            <div key={offer.id} className={`spon-card spon-card--${offer.status}`}>
              <div className="spon-card-head">
                <div className="spon-card-titles">
                  <span className="spon-badge">{offer.badge || 'Oferta em destaque'}</span>
                  <h3>{offer.headline}</h3>
                  {offer.description && <p>{offer.description}</p>}
                </div>
                <span className={`spon-status spon-status--${offer.status}`}>
                  {STATUS_LABELS[offer.status] || offer.status}
                </span>
              </div>

              <div className="spon-card-meta">
                <div className="spon-meta-item">
                  <Filter size={12} />
                  {PLACEMENT_LABELS[offer.placement] || offer.placement}
                </div>
                <div className="spon-meta-item">
                  <Layers size={12} />
                  {offer.group?.name || offer.service?.name || '—'}
                </div>
                <div className="spon-meta-item">
                  <DollarSign size={12} />
                  {fmtBRL(offer.amount_paid)}
                </div>
                <div className="spon-meta-item">
                  <Calendar size={12} />
                  {fmtDate(offer.period_start)} → {offer.period_end ? fmtDate(offer.period_end) : 'sem fim'}
                </div>
                <div className="spon-meta-item">
                  <Eye size={12} />
                  {offer.impressions || 0} impressões
                </div>
                <div className="spon-meta-item">
                  <MousePointerClick size={12} />
                  {offer.clicks || 0} cliques
                </div>
              </div>

              <div className="spon-card-foot">
                <span className="spon-sponsor">
                  Patrocinado por <strong>{offer.sponsor_name}</strong>
                  {offer.group && <em> · grupo do usuário</em>}
                </span>

                <div className="spon-card-actions">
                  {isExpired(offer) && (
                    <span className="spon-expired">Período encerrado</span>
                  )}
                  <button
                    className="spon-btn spon-btn--ghost"
                    onClick={() => handleToggle(offer)}
                  >
                    {offer.status === 'active' ? <EyeOff size={14} /> : <Eye size={14} />}
                    {offer.status === 'active' ? 'Pausar' : 'Ativar'}
                  </button>
                  <button className="spon-btn spon-btn--ghost" onClick={() => openEdit(offer)}>
                    <Edit3 size={14} /> Editar
                  </button>
                  <button
                    className="spon-btn spon-btn--danger"
                    onClick={() => setConfirmDelete(offer)}
                  >
                    <Trash2 size={14} /> Excluir
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div className="spon-modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="spon-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Excluir oferta?</h3>
            <p>
              A oferta <strong>{confirmDelete.headline}</strong> sai do ar
              imediatamente. Essa ação não pode ser desfeita.
            </p>
            <div className="spon-modal-actions">
              <button
                className="spon-btn spon-btn--ghost"
                onClick={() => setConfirmDelete(null)}
              >
                Cancelar
              </button>
              <button
                className="spon-btn spon-btn--danger"
                onClick={() => handleDelete(confirmDelete.id)}
              >
                <Trash2 size={14} /> Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
