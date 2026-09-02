import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Loader2, Save, AlertTriangle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import './SubscriptionEdit.css';

const STATUS_OPTIONS = ['active', 'inactive', 'cancelled', 'expired', 'pending', 'first_attempt', 'overdue'];
const CYCLE_OPTIONS = ['monthly', 'quarterly', 'semiannual', 'annual', 'days', 'custom'];

const statusLabel = (s) => ({ active: 'Ativa', inactive: 'Inativa', cancelled: 'Cancelada', expired: 'Expirada', pending: 'Pendente', first_attempt: 'Primeira Tentativa', overdue: 'Atrasada' }[s] || s);
const cycleLabel = (c) => ({ monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual', days: 'Dias', custom: 'Personalizado' }[c] || c);

export default function SubscriptionEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const fetchSub = async () => {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*, user:user_id (id, name, email), group:group_id (id, name, owner_id), service:service_id (id, name, full_name)')
        .eq('id', id)
        .single();
      if (error) { setError(error.message); setLoading(false); return; }
      setSub(data);
      setLoading(false);
    };
    fetchSub();
  }, [id]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const prevCycle = sub.billing_cycle;
      const prevAmount = Number(sub.amount);
      const newCycle = sub.billing_cycle;
      const newAmount = Number(sub.amount);
      const cycleChanged = prevCycle !== newCycle || prevAmount !== newAmount;

      const payload = {
        amount: Number(sub.amount),
        billing_cycle: sub.billing_cycle,
        custom_cycle_days: sub.billing_cycle === 'days' ? (sub.custom_cycle_days || null) : null,
        custom_cycle_months: sub.billing_cycle === 'custom' ? (sub.custom_cycle_months || null) : null,
        status: sub.status,
        card_id: sub.card_id || null,
        card_last4: sub.card_last4 || null,
        card_brand: sub.card_brand || null,
        started_at: sub.started_at || null,
        expires_at: sub.expires_at || null,
        next_charge_at: sub.next_charge_at || null,
        updated_at: new Date().toISOString(),
      };

      const { error: subError } = await supabase
        .from('user_subscriptions')
        .update(payload)
        .eq('id', sub.id);
      if (subError) throw subError;

      if (sub.status === 'cancelled' || sub.status === 'inactive') {
        await supabase
          .from('group_members')
          .update({ status: 'inactive', left_at: new Date().toISOString(), payment_status: 'cancelled' })
          .eq('group_id', sub.group_id)
          .eq('user_id', sub.user_id);
      } else if (sub.status === 'active') {
        await supabase
          .from('group_members')
          .update({ payment_status: 'active' })
          .eq('group_id', sub.group_id)
          .eq('user_id', sub.user_id);
      }

      if (cycleChanged && sub.status === 'active') {
        const nextCharge = new Date();
        if (newCycle === 'days' && sub.custom_cycle_days) {
          nextCharge.setDate(nextCharge.getDate() + Number(sub.custom_cycle_days));
        } else if (newCycle === 'custom' && sub.custom_cycle_months) {
          nextCharge.setMonth(nextCharge.getMonth() + Number(sub.custom_cycle_months));
        } else {
          const monthsMap = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
          nextCharge.setMonth(nextCharge.getMonth() + (monthsMap[newCycle] || 1));
        }

        await supabase
          .from('group_members')
          .update({ subscription_deadline: nextCharge.toISOString() })
          .eq('group_id', sub.group_id)
          .eq('user_id', sub.user_id);

        setSuccess('Assinatura atualizada. Próxima cobrança re-agendada.');
      } else {
        setSuccess('Assinatura atualizada com sucesso!');
      }

      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const toInputDate = (d) => d ? new Date(d).toISOString().split('T')[0] : '';

  if (loading) return (
    <div className="fade-in subscription-edit-page">
      <div className="loading-state"><Loader2 size={32} className="spin" /><p>Carregando...</p></div>
    </div>
  );

  if (error && !sub) return (
    <div className="fade-in subscription-edit-page">
      <div className="error-banner">{error}</div>
      <button className="btn btn-outline" onClick={() => navigate(-1)} style={{ marginTop: '1rem' }}>Voltar</button>
    </div>
  );

  return (
    <div className="fade-in subscription-edit-page">
      <button onClick={() => navigate(-1)} className="back-btn">
        <ChevronLeft size={18} /> Voltar
      </button>

      <div className="page-header">
        <h1>Editar Assinatura</h1>
        <p>Altere os dados e salve para atualizar. Mudanças de ciclo/value re-agendam a cobrança.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <form onSubmit={handleSave} className="sub-edit-card">
        <div className="sub-edit-info-grid">
          <div className="sub-edit-info">
            <label>Usuário</label>
            <p>{sub.user?.name || '—'}</p>
            <span>{sub.user?.email || '—'}</span>
          </div>
          <div className="sub-edit-info">
            <label>Grupo</label>
            <p>{sub.group?.name || '—'}</p>
          </div>
          <div className="sub-edit-info">
            <label>Serviço</label>
            <p>{sub.service?.full_name || sub.service?.name || '—'}</p>
          </div>
          <div className="sub-edit-info">
            <label>ID Externo</label>
            <p className="mono">{sub.external_reference || '—'}</p>
          </div>
          <div className="sub-edit-info">
            <label>Cartão</label>
            <p>{sub.card_last4 ? `•••• ${sub.card_last4} ${sub.card_brand || ''}` : 'Sem cartão'}</p>
            {sub.card_id && <span className="mono" style={{ fontSize: '0.78rem' }}>ID: {sub.card_id}</span>}
          </div>
        </div>

        <div className="sub-edit-divider" />

        <div className="sub-edit-fields">
          <div className="form-row-2">
            <div className="form-group">
              <label>Valor (R$)</label>
              <input
                type="number" step="0.01" min="0"
                value={sub.amount}
                onChange={(e) => setSub({ ...sub, amount: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Ciclo de Faturamento</label>
              <select value={sub.billing_cycle} onChange={(e) => setSub({ ...sub, billing_cycle: e.target.value })}>
                {CYCLE_OPTIONS.map(c => <option key={c} value={c}>{cycleLabel(c)}</option>)}
              </select>
            </div>
          </div>

          {sub.billing_cycle === 'days' && (
            <div className="form-group">
              <label>Ciclo em Dias</label>
              <input
                type="number" min="1"
                value={sub.custom_cycle_days || ''}
                onChange={(e) => setSub({ ...sub, custom_cycle_days: e.target.value ? Number(e.target.value) : null })}
                placeholder="Ex: 7 para cobrança a cada 7 dias"
                required
              />
            </div>
          )}

          {sub.billing_cycle === 'custom' && (
            <div className="form-group">
              <label>Ciclo em Meses</label>
              <input
                type="number" min="1"
                value={sub.custom_cycle_months || ''}
                onChange={(e) => setSub({ ...sub, custom_cycle_months: e.target.value ? Number(e.target.value) : null })}
                placeholder="Ex: 2 para cobrança a cada 2 meses"
                required
              />
            </div>
          )}

          <div className="sub-edit-divider" />

          <div className="form-row-2">
            <div className="form-group">
              <label>ID do Cartão (IOPay)</label>
              <input
                type="text"
                value={sub.card_id || ''}
                onChange={(e) => setSub({ ...sub, card_id: e.target.value || null })}
                placeholder="ID do cartão no IOPay"
              />
            </div>
            <div className="form-group">
              <label>Bandeira</label>
              <input
                type="text"
                value={sub.card_brand || ''}
                onChange={(e) => setSub({ ...sub, card_brand: e.target.value || null })}
                placeholder="Ex: visa, mastercard"
              />
            </div>
          </div>
          <div className="form-group">
            <label>Últimos 4 Dígitos</label>
            <input
              type="text"
              maxLength={4}
              value={sub.card_last4 || ''}
              onChange={(e) => setSub({ ...sub, card_last4: e.target.value || null })}
              placeholder="Ex: 1234"
            />
          </div>

          <div className="sub-edit-divider" />

          <div className="form-group">
            <label>Status</label>
            <select value={sub.status} onChange={(e) => setSub({ ...sub, status: e.target.value })}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label>Data de Início</label>
              <input type="date" value={toInputDate(sub.started_at)} onChange={(e) => setSub({ ...sub, started_at: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Próxima Cobrança</label>
              <input type="date" value={toInputDate(sub.next_charge_at)} onChange={(e) => setSub({ ...sub, next_charge_at: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>Data de Vencimento</label>
            <input type="date" value={toInputDate(sub.expires_at)} onChange={(e) => setSub({ ...sub, expires_at: e.target.value })} />
          </div>
        </div>

          <div className="sub-edit-note">
            <AlertTriangle size={16} />
            <span>Alterar o ciclo, valor ou próxima data de cobrança re-agendará automaticamente a cobrança.</span>
          </div>

        <div className="sub-edit-actions">
          <button type="button" className="btn btn-outline" onClick={() => navigate(-1)}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <><Loader2 size={16} className="spin" /> Salvando...</> : <><Save size={16} /> Salvar Alterações</>}
          </button>
        </div>
      </form>
    </div>
  );
}
