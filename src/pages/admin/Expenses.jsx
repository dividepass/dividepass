import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, Edit2, X, Repeat, DollarSign, BarChart3, Search, Save, Calendar, AlertTriangle, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './Expenses.css';

const CATEGORIES = [
  { value: 'hosting', label: 'Hosting/Infra', color: '#6366f1' },
  { value: 'api', label: 'APIs/Serviços', color: '#8b5cf6' },
  { value: 'domain', label: 'Domínio/SSL', color: '#0ea5e9' },
  { value: 'marketing', label: 'Marketing', color: '#f59e0b' },
  { value: 'tools', label: 'Ferramentas', color: '#10b981' },
  { value: 'personnel', label: 'Pessoal', color: '#ef4444' },
  { value: 'payment', label: 'Gateway Pagamento', color: '#ec4899' },
  { value: 'other', label: 'Outros', color: '#64748b' },
];

const STATUS_MAP = {
  pending: { label: 'Pendente', color: '#f59e0b' },
  paid: { label: 'Pago', color: '#10b981' },
  overdue: { label: 'Atrasado', color: '#ef4444' },
};

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.value, c]));

const EMPTY_FORM = {
  amount: '',
  platform: '',
  description: '',
  category: 'other',
  is_recurring: false,
  recurrence_day: '',
  start_date: '',
  recurrence_limit_type: 'none',
  recurrence_end_date: '',
  recurrence_count: '',
  due_date: '',
  paid_date: '',
  status: 'pending',
  notes: '',
};

function getRecurrenceMonths(recurrenceDay, startDate, endDate, count, skippedMonths) {
  const months = [];
  if (!startDate || !recurrenceDay) return months;
  const start = new Date(startDate + 'T12:00:00');
  const limit = endDate ? new Date(endDate + 'T12:00:00') : null;
  const day = parseInt(recurrenceDay);
  const skipped = skippedMonths || [];
  let current = new Date(start.getFullYear(), start.getMonth(), day);
  let iterations = 0;
  const maxIterations = count || 120;
  while (iterations < maxIterations) {
    if (limit && current > limit) break;
    if (current >= start) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const key = `${y}-${m}`;
      if (!skipped.includes(key)) {
        months.push(key);
      }
    }
    current = new Date(current.getFullYear(), current.getMonth() + 1, day);
    iterations++;
  }
  return months;
}

function DeleteModal({ expense, filterMonth, onClose, onDeleteAll, onDeleteMonth }) {
  if (!expense) return null;
  const isCurrentMonthSkipped = (expense.skipped_months || []).includes(filterMonth);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Excluir despesa</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="delete-modal-body">
          <p><strong>{expense.description}</strong></p>
          {expense.is_recurring ? (
            <>
              <p>Esta é uma despesa recorrente (todo dia {expense.recurrence_day}).</p>
              <div className="delete-options">
                <button className="delete-option delete-option-month" onClick={() => onDeleteMonth(expense.id, filterMonth)}>
                  <span className="delete-option-title">Excluir só de {new Date(filterMonth + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                  <span className="delete-option-desc">A despesa continua aparecendo nos outros meses</span>
                </button>
                <button className="delete-option delete-option-all" onClick={() => onDeleteAll(expense.id)}>
                  <span className="delete-option-title">Excluir todas</span>
                  <span className="delete-option-desc">Remove esta despesa de todos os meses</span>
                </button>
              </div>
            </>
          ) : (
            <p>Tem certeza que deseja excluir esta despesa?</p>
          )}
          {!expense.is_recurring && (
            <div className="delete-actions">
              <button className="btn" onClick={onClose}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => onDeleteAll(expense.id)}>Excluir</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [filterSearch, setFilterSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [filterMonth, setFilterMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const [platformQuery, setPlatformQuery] = useState('');
  const [platformResults, setPlatformResults] = useState([]);
  const [platformOpen, setPlatformOpen] = useState(false);
  const platformRef = useRef(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showUpcoming, setShowUpcoming] = useState(true);
  const [showCharts, setShowCharts] = useState(false);

  const fetchExpenses = async () => {
    setLoading(true);
    const { data, error: fetchErr } = await supabase
      .from('expenses')
      .select('*')
      .order('created_at', { ascending: false });
    if (!fetchErr) setExpenses(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchExpenses(); }, []);

  useEffect(() => {
    const handleClick = (e) => {
      if (platformRef.current && !platformRef.current.contains(e.target)) setPlatformOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (platformQuery.trim().length < 1) { setPlatformResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('streaming_services')
        .select('id, name, full_name, icon')
        .ilike('name', `%${platformQuery.trim()}%`)
        .limit(10);
      setPlatformResults(data || []);
      setPlatformOpen(true);
    }, 250);
    return () => clearTimeout(t);
  }, [platformQuery]);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setError(null);
    setPlatformQuery('');
    setPlatformResults([]);
  };

  const handleSave = async () => {
    if (!form.amount) {
      setError('Valor é obrigatório.');
      return;
    }
    const desc = form.platform || form.description.trim();
    if (!desc) {
      setError('Selecione uma plataforma ou preencha a descrição.');
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      description: desc,
      amount: parseFloat(form.amount),
      category: form.category,
      platform: form.platform || null,
      is_recurring: form.is_recurring,
      recurrence_day: form.is_recurring && form.recurrence_day ? parseInt(form.recurrence_day) : null,
      start_date: form.is_recurring ? (form.start_date || null) : null,
      recurrence_end_date: form.is_recurring && form.recurrence_limit_type === 'date' ? (form.recurrence_end_date || null) : null,
      recurrence_count: form.is_recurring && form.recurrence_limit_type === 'count' ? (parseInt(form.recurrence_count) || null) : null,
      due_date: form.is_recurring ? null : (form.due_date || null),
      paid_date: form.paid_date || null,
      status: form.status,
      notes: form.notes.trim() || null,
    };

    try {
      if (editingId) {
        const { error: updErr } = await supabase
          .from('expenses')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingId);
        if (updErr) throw updErr;
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        payload.created_by = session?.user?.id || null;
        const { error: insErr } = await supabase.from('expenses').insert(payload);
        if (insErr) throw insErr;
      }
      resetForm();
      setShowForm(false);
      fetchExpenses();
    } catch (err) {
      console.error('[Expenses] save error:', err);
      setError('Erro ao salvar: ' + (err.message || 'desconhecido'));
    }
    setSaving(false);
  };

  const handleEdit = (exp) => {
    let limitType = 'none';
    let endDate = '';
    let count = '';
    if (exp.recurrence_end_date) { limitType = 'date'; endDate = exp.recurrence_end_date; }
    else if (exp.recurrence_count) { limitType = 'count'; count = exp.recurrence_count; }

    setForm({
      amount: exp.amount,
      platform: exp.platform || '',
      description: exp.platform ? '' : (exp.description || ''),
      category: exp.category,
      is_recurring: exp.is_recurring,
      recurrence_day: exp.recurrence_day || '',
      start_date: exp.start_date || '',
      recurrence_limit_type: limitType,
      recurrence_end_date: endDate,
      recurrence_count: count,
      due_date: exp.due_date || '',
      paid_date: exp.paid_date || '',
      status: exp.status,
      notes: exp.notes || '',
    });
    setEditingId(exp.id);
    setShowForm(true);
  };

  const handleDeleteClick = (exp) => {
    setDeleteTarget(exp);
  };

  const handleDeleteAll = async (id) => {
    await supabase.from('expenses').delete().eq('id', id);
    setDeleteTarget(null);
    fetchExpenses();
  };

  const handleDeleteMonth = async (id, month) => {
    const exp = expenses.find(e => e.id === id);
    if (!exp) return;
    const skipped = [...(exp.skipped_months || []), month];
    await supabase.from('expenses').update({ skipped_months: skipped, updated_at: new Date().toISOString() }).eq('id', id);
    setDeleteTarget(null);
    fetchExpenses();
  };

  const toggleStatus = async (id, current) => {
    const next = current === 'paid' ? 'pending' : 'paid';
    const update = { status: next };
    if (next === 'paid') update.paid_date = new Date().toISOString().split('T')[0];
    else update.paid_date = null;
    await supabase.from('expenses').update(update).eq('id', id);
    fetchExpenses();
  };

  const filtered = useMemo(() => {
    return expenses.filter(e => {
      if (filterSearch) {
        const q = filterSearch.toLowerCase();
        const matchDesc = (e.description || '').toLowerCase().includes(q);
        const matchPlatform = (e.platform || '').toLowerCase().includes(q);
        const matchNotes = (e.notes || '').toLowerCase().includes(q);
        if (!matchDesc && !matchPlatform && !matchNotes) return false;
      }
      if (filterCategory !== 'all' && e.category !== filterCategory) return false;
      if (filterPlatform !== 'all') {
        if (filterPlatform === '_with_platform' && !e.platform) return false;
        if (filterPlatform === '_without_platform' && e.platform) return false;
        if (filterPlatform !== '_with_platform' && filterPlatform !== '_without_platform' && e.platform !== filterPlatform) return false;
      }
      if (filterMonth) {
        if (e.is_recurring) {
          if (!e.start_date || !e.recurrence_day) return false;
          const months = getRecurrenceMonths(e.recurrence_day, e.start_date, e.recurrence_end_date, e.recurrence_count, e.skipped_months);
          if (!months.includes(filterMonth)) return false;
        } else {
          const dateField = e.due_date;
          if (dateField && !dateField.startsWith(filterMonth)) return false;
          if (!dateField) return false;
        }
      }
      return true;
    });
  }, [expenses, filterSearch, filterCategory, filterPlatform, filterMonth]);

  const allPlatforms = useMemo(() => {
    const set = new Set();
    expenses.forEach(e => { if (e.platform) set.add(e.platform); });
    return [...set].sort();
  }, [expenses]);

  const stats = useMemo(() => {
    const monthExpenses = expenses.filter(e => {
      if (e.is_recurring) {
        if (!e.start_date || !e.recurrence_day) return false;
        const months = getRecurrenceMonths(e.recurrence_day, e.start_date, e.recurrence_end_date, e.recurrence_count, e.skipped_months);
        return months.includes(filterMonth);
      }
      return e.due_date && e.due_date.startsWith(filterMonth);
    });
    const total = monthExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const paid = monthExpenses.filter(e => e.status === 'paid').reduce((s, e) => s + Number(e.amount), 0);
    const pending = monthExpenses.filter(e => e.status === 'pending').reduce((s, e) => s + Number(e.amount), 0);
    const overdue = monthExpenses.filter(e => e.status === 'overdue').reduce((s, e) => s + Number(e.amount), 0);
    const byCategory = {};
    const byPlatform = {};
    monthExpenses.forEach(e => {
      byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
      if (e.platform) byPlatform[e.platform] = (byPlatform[e.platform] || 0) + Number(e.amount);
    });
    return { total, paid, pending, overdue, count: monthExpenses.length, byCategory, byPlatform };
  }, [expenses, filterMonth]);

  const maxCatAmount = Math.max(...Object.values(stats.byCategory), 1);
  const maxPlatAmount = Math.max(...Object.values(stats.byPlatform), 1);
  const formatCurrency = (v) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;

  const upcomingExpenses = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = [];

    expenses.forEach(exp => {
      if (exp.status === 'paid') return;

      if (exp.is_recurring && exp.start_date && exp.recurrence_day) {
        const months = getRecurrenceMonths(exp.recurrence_day, exp.start_date, exp.recurrence_end_date, exp.recurrence_count, exp.skipped_months);
        const futureMonths = months.filter(m => m >= `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
        futureMonths.slice(0, 3).forEach(m => {
          const dueDate = new Date(`${m}-${String(exp.recurrence_day).padStart(2, '0')}T12:00:00`);
          const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
          if (diffDays <= 20) {
            upcoming.push({ ...exp, dueDateStr: `${m}-${String(exp.recurrence_day).padStart(2, '0')}`, daysUntilDue: diffDays, instanceMonth: m });
          }
        });
      } else if (exp.due_date) {
        const dueDate = new Date(`${exp.due_date}T12:00:00`);
        const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
        if (diffDays <= 20 && diffDays >= -30) {
          upcoming.push({ ...exp, dueDateStr: exp.due_date, daysUntilDue: diffDays });
        }
      }
    });

    return upcoming.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  }, [expenses]);
  const selectedPlatformCategory = useMemo(() => {
    if (!form.platform) return null;
    const svc = expenses.find(e => e.platform === form.platform);
    return svc ? svc.category : null;
  }, [form.platform, expenses]);

  return (
    <div className="fade-in">
      <div className="admin-header">
        <div>
          <h1>Despesas</h1>
          <p>Controle de despesas do SaaS</p>
        </div>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(!showForm); }}>
          {showForm ? <><X size={16} /> Fechar</> : <><Plus size={16} /> Nova Despesa</>}
        </button>
      </div>

      {showForm && (
        <div className="admin-card expense-inline-form">
          <h3>{editingId ? 'Editar Despesa' : 'Nova Despesa'}</h3>
          {error && <div className="form-error">{error}</div>}

          <div className="expense-form-grid">
            <div className="form-group form-group-highlight">
              <label>Valor (R$) *</label>
              <input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0,00" autoFocus />
            </div>

            <div className="form-group" ref={platformRef} style={{ position: 'relative' }}>
              <label>Plataforma</label>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={form.platform || platformQuery}
                  onChange={e => {
                    setPlatformQuery(e.target.value);
                    setForm({ ...form, platform: '' });
                    setPlatformOpen(true);
                  }}
                  onFocus={() => platformResults.length > 0 && setPlatformOpen(true)}
                  placeholder="Buscar plataforma..."
                  style={{ paddingLeft: '2rem' }}
                />
              </div>
              {platformOpen && platformResults.length > 0 && (
                <div className="platform-dropdown">
                  {platformResults.map(p => (
                    <button key={p.id} type="button" className="platform-option" onClick={() => {
                      setForm({ ...form, platform: p.name, description: '' });
                      setPlatformQuery('');
                      setPlatformOpen(false);
                    }}>
                      <span className="platform-icon">{p.icon || '?'}</span>
                      <span>{p.name}</span>
                      {p.full_name && p.full_name !== p.name && <span className="platform-sub">{p.full_name}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!form.platform && (
              <div className="form-group">
                <label>Descrição</label>
                <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Ex: Vercel Pro, Supabase" />
              </div>
            )}

            <div className="form-group">
              <label>Categoria</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              {form.platform && selectedPlatformCategory && selectedPlatformCategory !== form.category && (
                <span className="form-hint">Plataforma usa: {CATEGORY_MAP[selectedPlatformCategory]?.label}</span>
              )}
            </div>

            <div className="form-group">
              <label>Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="pending">Pendente</option>
                <option value="paid">Pago</option>
                <option value="overdue">Atrasado</option>
              </select>
            </div>

            <div className="form-group form-checkbox">
              <label className="checkbox-label">
                <input type="checkbox" checked={form.is_recurring} onChange={e => setForm({ ...form, is_recurring: e.target.checked, start_date: e.target.checked ? (form.due_date || new Date().toISOString().split('T')[0]) : '', due_date: e.target.checked ? '' : form.start_date })} />
                <Repeat size={14} /> Recorrente (todo mês)
              </label>
            </div>

            {form.is_recurring && (
              <>
                <div className="form-group">
                  <label>Dia do mês</label>
                  <input type="number" min="1" max="31" value={form.recurrence_day} onChange={e => setForm({ ...form, recurrence_day: e.target.value })} placeholder="Ex: 10" />
                </div>

                <div className="form-group">
                  <label>Data de início</label>
                  <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
                </div>

                <div className="form-group">
                  <label>Repetir até</label>
                  <select value={form.recurrence_limit_type} onChange={e => setForm({ ...form, recurrence_limit_type: e.target.value, recurrence_end_date: '', recurrence_count: '' })}>
                    <option value="none">Sem limite</option>
                    <option value="date">Até uma data</option>
                    <option value="count">Número de vezes</option>
                  </select>
                </div>

                {form.recurrence_limit_type === 'date' && (
                  <div className="form-group">
                    <label>Data fim</label>
                    <input type="date" value={form.recurrence_end_date} onChange={e => setForm({ ...form, recurrence_end_date: e.target.value })} />
                  </div>
                )}

                {form.recurrence_limit_type === 'count' && (
                  <div className="form-group">
                    <label>Quantas vezes</label>
                    <input type="number" min="1" value={form.recurrence_count} onChange={e => setForm({ ...form, recurrence_count: e.target.value })} placeholder="Ex: 12" />
                  </div>
                )}
              </>
            )}

            {!form.is_recurring && (
              <div className="form-group">
                <label>Data de vencimento</label>
                <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
              </div>
            )}

            {form.status === 'paid' && (
              <div className="form-group">
                <label>Data de pagamento</label>
                <input type="date" value={form.paid_date} onChange={e => setForm({ ...form, paid_date: e.target.value })} />
              </div>
            )}

            <div className="form-group">
              <label>Observações</label>
              <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notas..." />
            </div>
          </div>

          <div className="expense-form-actions">
            <button className="btn" onClick={() => { resetForm(); setShowForm(false); }}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              <Save size={14} /> {saving ? 'Salvando...' : editingId ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </div>
      )}

      <div className="expenses-stats">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}><DollarSign size={20} /></div>
          <div className="stat-info">
            <span className="stat-value">{formatCurrency(stats.total)}</span>
            <span className="stat-label">Total {filterMonth}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}><DollarSign size={20} /></div>
          <div className="stat-info">
            <span className="stat-value">{formatCurrency(stats.paid)}</span>
            <span className="stat-label">Pago</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}><DollarSign size={20} /></div>
          <div className="stat-info">
            <span className="stat-value">{formatCurrency(stats.pending)}</span>
            <span className="stat-label">Pendente</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}><DollarSign size={20} /></div>
          <div className="stat-info">
            <span className="stat-value">{formatCurrency(stats.overdue)}</span>
            <span className="stat-label">Atrasado</span>
          </div>
        </div>
      </div>

      {/* Próximos Vencimentos */}
      {upcomingExpenses.length > 0 && (
        <div className="upcoming-section">
          <button className="collapsible-header" onClick={() => setShowUpcoming(!showUpcoming)}>
            <h3><Calendar size={16} /> Próximos Vencimentos ({upcomingExpenses.length})</h3>
            <span className={`collapsible-arrow ${showUpcoming ? 'open' : ''}`}>›</span>
          </button>
          {showUpcoming && (
            <div className="upcoming-list">
              {upcomingExpenses.map(exp => {
                const daysLeft = exp.daysUntilDue;
                const urgency = daysLeft < 0 ? 'overdue' : daysLeft <= 3 ? 'urgent' : daysLeft <= 7 ? 'warning' : 'normal';
                const catInfo = CATEGORY_MAP[exp.category] || CATEGORY_MAP.other;
                return (
                  <div key={`${exp.id}-${exp.dueDateStr}`} className={`upcoming-card ${urgency}`}>
                    <div className="upcoming-left">
                      <div className="upcoming-cat-dot" style={{ background: catInfo.color }} />
                      <div className="upcoming-info">
                        <span className="upcoming-desc">{exp.description}</span>
                        <span className="upcoming-meta">
                          {exp.platform || catInfo.label}
                          {exp.is_recurring && <> · Dia {exp.recurrence_day}</>}
                        </span>
                      </div>
                    </div>
                    <div className="upcoming-right">
                      <span className="upcoming-amount">{formatCurrency(exp.amount)}</span>
                      <span className={`upcoming-countdown ${urgency}`}>
                        {daysLeft < 0
                          ? `${Math.abs(daysLeft)}d atrasado`
                          : daysLeft === 0
                          ? 'Vence hoje'
                          : `${daysLeft}d restante${daysLeft > 1 ? 's' : ''}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {(Object.keys(stats.byCategory).length > 0 || Object.keys(stats.byPlatform).length > 0) && (
        <div className="admin-card">
          <button className="collapsible-header" onClick={() => setShowCharts(!showCharts)}>
            <h3 style={{ margin: 0 }}><BarChart3 size={16} /> Gráficos</h3>
            <span className={`collapsible-arrow ${showCharts ? 'open' : ''}`}>›</span>
          </button>
          {showCharts && (
            <>
              {Object.keys(stats.byCategory).length > 0 && (
                <div className="expenses-chart-card">
                  <h3><BarChart3 size={16} /> Por Categoria</h3>
                  <div className="expenses-chart">
                    {Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amount]) => {
                      const catInfo = CATEGORY_MAP[cat] || CATEGORY_MAP.other;
                      return (
                        <div key={cat} className="chart-bar-row">
                          <span className="chart-bar-label">{catInfo.label}</span>
                          <div className="chart-bar-track">
                            <div className="chart-bar-fill" style={{ width: `${(amount / maxCatAmount) * 100}%`, background: catInfo.color }} />
                          </div>
                          <span className="chart-bar-value">{formatCurrency(amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {Object.keys(stats.byPlatform).length > 0 && (
                <div className="expenses-chart-card">
                  <h3><BarChart3 size={16} /> Por Plataforma</h3>
                  <div className="expenses-chart">
                    {Object.entries(stats.byPlatform).sort((a, b) => b[1] - a[1]).map(([platform, amount]) => (
                      <div key={platform} className="chart-bar-row">
                        <span className="chart-bar-label">{platform}</span>
                        <div className="chart-bar-track">
                          <div className="chart-bar-fill" style={{ width: `${(amount / maxPlatAmount) * 100}%`, background: '#8b5cf6' }} />
                        </div>
                        <span className="chart-bar-value">{formatCurrency(amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="expenses-filters">
        <div className="filter-search">
          <Search size={14} />
          <input type="text" value={filterSearch} onChange={e => setFilterSearch(e.target.value)} placeholder="Buscar despesa..." />
        </div>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="all">Todas categorias</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
          <option value="all">Todas plataformas</option>
          <option value="_with_platform">Com plataforma</option>
          <option value="_without_platform">Sem plataforma</option>
          {allPlatforms.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
      </div>

      <div className="admin-card">
        {loading ? (
          <p className="empty-msg">Carregando...</p>
        ) : filtered.length === 0 ? (
          <p className="empty-msg">Nenhuma despesa encontrada.</p>
        ) : (
          <div className="expenses-list">
            {filtered.map(exp => {
              const catInfo = CATEGORY_MAP[exp.category] || CATEGORY_MAP.other;
              const statusInfo = STATUS_MAP[exp.status] || STATUS_MAP.pending;
              const dateField = exp.is_recurring ? exp.start_date : exp.due_date;
              return (
                <div key={exp.id} className={`expense-item ${exp.status}`}>
                  <div className="expense-left">
                    <div className="expense-cat-dot" style={{ background: catInfo.color }} />
                    <div className="expense-info">
                      <span className="expense-desc">{exp.description}</span>
                      <span className="expense-meta">
                        {catInfo.label}
                        {exp.platform && <> · {exp.platform}</>}
                        {dateField && <> · {new Date(dateField + 'T12:00:00').toLocaleDateString('pt-BR')}</>}
                        {exp.is_recurring && <>
                          · <Repeat size={11} /> Dia {exp.recurrence_day}
                          {exp.recurrence_end_date && <> até {new Date(exp.recurrence_end_date + 'T12:00:00').toLocaleDateString('pt-BR')}</>}
                          {exp.recurrence_count && <> · {exp.recurrence_count}x</>}
                        </>}
                      </span>
                    </div>
                  </div>
                  <div className="expense-right">
                    <span className="expense-amount">{formatCurrency(exp.amount)}</span>
                    <span className="expense-status" style={{ color: statusInfo.color }}>{statusInfo.label}</span>
                    <div className="expense-actions">
                      <button className="icon-btn" onClick={() => toggleStatus(exp.id, exp.status)} title={exp.status === 'paid' ? 'Marcar pendente' : 'Marcar pago'}>
                        {exp.status === 'paid' ? '↩' : '✓'}
                      </button>
                      <button className="icon-btn" onClick={() => handleEdit(exp)} title="Editar"><Edit2 size={14} /></button>
                      <button className="icon-btn delete" onClick={() => handleDeleteClick(exp)} title="Excluir"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DeleteModal
        expense={deleteTarget}
        filterMonth={filterMonth}
        onClose={() => setDeleteTarget(null)}
        onDeleteAll={handleDeleteAll}
        onDeleteMonth={handleDeleteMonth}
      />
    </div>
  );
}

export default Expenses;
