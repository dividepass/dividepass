import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import {
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  CreditCard,
  Zap,
  Loader2,
  Calendar as CalendarIcon,
  RefreshCw,
  Info,
  AlertCircle,
} from 'lucide-react';
import './BillingCalendar.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

function localDateStr(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

const CYCLE_LABELS = { monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual', days: 'Dias', custom: 'Personalizado' };

function cycleLabel(billingCycle, customCycleDays, customCycleMonths) {
  const base = CYCLE_LABELS[billingCycle] || billingCycle || '';
  if (!base) return '';
  if (billingCycle === 'days' && customCycleDays) return `${base} (${customCycleDays}d)`;
  if (billingCycle === 'custom' && customCycleMonths) return `${base} (${customCycleMonths}m)`;
  return base;
}

// Rótulo do item: assinatura agendada ("vai ser cobrada") é diferente de
// ciclo já processado ("aprovada"/"falhou").
function chargeBadge(charge) {
  if (charge.type === 'subscription') {
    return { label: 'Agendada', tone: 'scheduled' };
  }
  switch (charge.status) {
    case 'approved': return { label: 'Aprovada', tone: 'approved' };
    case 'failed': return { label: 'Falhou', tone: 'failed' };
    case 'processing': return { label: 'Processando', tone: 'processing' };
    case 'cancelled': return { label: 'Cancelada', tone: 'cancelled' };
    default: return { label: 'Pendente', tone: 'pending' };
  }
}

async function callEdgeFunction(functionName, body) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session) {
    throw new Error('Sessão do admin não encontrada. Faça login novamente.');
  }
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${sessionData.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Resposta inválida de ${functionName} (HTTP ${response.status}): ${raw.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status} ao chamar ${functionName}`);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Nomes de serviços resolvidos por id (evita depender do nome da FK).
async function fetchServiceNames(serviceIds) {
  const ids = [...new Set(serviceIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('streaming_services').select('id, name').in('id', ids);
  return new Map((data || []).map(s => [s.id, s.name]));
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(onClose, 7000);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;
  return (
    <div className={`cal-toast ${toast.type}`} role="status">
      {toast.type === 'success' && <CheckCircle size={16} />}
      {toast.type === 'error' && <AlertCircle size={16} />}
      {toast.type === 'warning' && <AlertTriangle size={16} />}
      {toast.type === 'info' && <Info size={16} />}
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Fechar aviso"><X size={14} /></button>
    </div>
  );
}

function BillingCalendar() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarData, setCalendarData] = useState({});
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedCharges, setSelectedCharges] = useState([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [dayError, setDayError] = useState('');
  const [toast, setToast] = useState(null);
  const [chargingId, setChargingId] = useState(null);
  const [bulkCharging, setBulkCharging] = useState(false);
  const [rescheduleId, setRescheduleId] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleBusy, setRescheduleBusy] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const todayStr = localDateStr();

  const showToast = useCallback((type, message) => setToast({ type, message }), []);
  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    let cancelled = false;

    async function fetchCalendarData() {
      setLoading(true);
      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

      // A grade só mostra agendamentos futuros: meses passados ficam vazios.
      if (endDate < todayStr) {
        if (!cancelled) {
          setCalendarData({});
          setLoading(false);
        }
        return;
      }
      const rangeStart = todayStr > startDate ? todayStr : startDate;

      const [bcRes, subRes] = await Promise.all([
        supabase
          .from('billing_cycles')
          .select('charge_date, amount, status')
          .gte('charge_date', rangeStart)
          .lte('charge_date', endDate),
        supabase
          .from('user_subscriptions')
          .select('next_charge_at, amount, status, billing_status, billing_cycle, custom_cycle_days, custom_cycle_months')
          .eq('status', 'active')
          .not('next_charge_at', 'is', null)
          .gte('next_charge_at', rangeStart)
          .lte('next_charge_at', endDate),
      ]);

      if (cancelled) return;

      const grouped = {};

      (bcRes.data || []).forEach(item => {
        const date = item.charge_date;
        if (!grouped[date]) {
          grouped[date] = { total: 0, approved: 0, failed: 0, pending: 0, scheduled: 0, totalAmount: 0, items: [] };
        }
        grouped[date].total++;
        grouped[date].totalAmount += Number(item.amount || 0);
        grouped[date].items.push({ ...item, source: 'billing_cycles' });
        if (item.status === 'approved' || item.status === 'paid' || item.status === 'confirmed') {
          grouped[date].approved++;
        } else if (item.status === 'failed' || item.status === 'rejected') {
          grouped[date].failed++;
        } else {
          grouped[date].pending++;
        }
      });

      (subRes.data || []).forEach(item => {
        if (!item.next_charge_at) return;
        const date = item.next_charge_at.split('T')[0];
        if (!grouped[date]) {
          grouped[date] = { total: 0, approved: 0, failed: 0, pending: 0, scheduled: 0, totalAmount: 0, items: [] };
        }
        grouped[date].total++;
        grouped[date].totalAmount += Number(item.amount || 0);
        grouped[date].items.push({ ...item, source: 'subscriptions' });
        grouped[date].scheduled++;
      });

      setCalendarData(grouped);
      setLoading(false);
    }

    fetchCalendarData();
    return () => { cancelled = true; };
  }, [year, month, daysInMonth, todayStr]);

  async function handleDayClick(dateStr) {
    setSelectedDate(dateStr);
    setLoadingDay(true);
    setDayError('');
    setRescheduleId(null);

    try {
      const [bcRes, subRes] = await Promise.all([
        supabase
          .from('billing_cycles')
          .select(`
            id, amount, status, attempt_number, error_message, charge_date, subscription_id,
            user:users!billing_cycles_user_id_fkey (id, name, email),
            group:groups!billing_cycles_group_id_fkey (id, name),
            subscription:user_subscriptions!billing_cycles_subscription_id_fkey (
              id, card_last4, card_brand, service_id, billing_cycle, custom_cycle_days, custom_cycle_months
            )
          `)
          .eq('charge_date', dateStr)
          .order('created_at', { ascending: false }),
        supabase
          .from('user_subscriptions')
          .select(`
            id, amount, status, billing_status, billing_cycle, custom_cycle_days, custom_cycle_months,
            next_charge_at, card_last4, card_brand, retry_count,
            user:user_id (id, name, email),
            group:group_id (id, name),
            service:service_id (id, name)
          `)
          .eq('status', 'active')
          .not('next_charge_at', 'is', null)
          .gte('next_charge_at', dateStr + 'T00:00:00')
          .lte('next_charge_at', dateStr + 'T23:59:59'),
      ]);

      const cycleError = bcRes.error;
      const subError = subRes.error;
      if (cycleError || subError) {
        throw new Error(cycleError?.message || subError?.message);
      }

      const charges = [];

      const serviceNames = await fetchServiceNames(
        (bcRes.data || []).map(bc => bc.subscription?.service_id)
      );

      (bcRes.data || []).forEach(bc => {
        charges.push({
          id: bc.id,
          type: 'billing_cycle',
          subscriptionId: bc.subscription?.id || bc.subscription_id,
          amount: bc.amount,
          status: bc.status,
          userName: bc.user?.name || '—',
          userEmail: bc.user?.email || '',
          groupName: bc.group?.name || '—',
          serviceName: serviceNames.get(bc.subscription?.service_id) || '—',
          cardLast4: bc.subscription?.card_last4,
          cardBrand: bc.subscription?.card_brand,
          attempt: bc.attempt_number,
          error: bc.error_message,
          billingCycle: bc.subscription?.billing_cycle,
          customCycleDays: bc.subscription?.custom_cycle_days,
          customCycleMonths: bc.subscription?.custom_cycle_months,
          date: bc.charge_date,
        });
      });

      (subRes.data || []).forEach(sub => {
        charges.push({
          id: sub.id,
          type: 'subscription',
          subscriptionId: sub.id,
          amount: sub.amount,
          status: sub.billing_status || sub.status,
          userName: sub.user?.name || '—',
          userEmail: sub.user?.email || '',
          groupName: sub.group?.name || '—',
          serviceName: sub.service?.name || '—',
          cardLast4: sub.card_last4,
          cardBrand: sub.card_brand,
          attempt: sub.retry_count,
          error: null,
          billingCycle: sub.billing_cycle,
          customCycleDays: sub.custom_cycle_days,
          customCycleMonths: sub.custom_cycle_months,
          date: sub.next_charge_at ? sub.next_charge_at.split('T')[0] : dateStr,
        });
      });

      setSelectedCharges(charges);
    } catch (err) {
      setSelectedCharges([]);
      setDayError(err.message || 'Não foi possível carregar as cobranças deste dia.');
    } finally {
      setLoadingDay(false);
    }
  }

  const handleChargeNow = async (charge) => {
    if (!charge.subscriptionId) {
      showToast('error', 'Este item não tem assinatura vinculada — não há o que cobrar.');
      return;
    }
    setChargingId(charge.id);
    try {
      const data = await callEdgeFunction('process-recurring-billing', {
        manual: true,
        subscription_id: charge.subscriptionId,
      });
      const approved = Number(data.approved || 0);
      const failed = Number(data.failed || 0);
      const skipped = Number(data.skipped || 0);
      const details = Array.isArray(data.details) ? data.details : [];
      const own = details.find(d => d.subscription_id === charge.subscriptionId);
      const reason = own?.error || (Array.isArray(data.errors) && data.errors[0]) || null;

      if (approved > 0) {
        showToast('success', `Cobrança aprovada para ${charge.userName}.`);
      } else if (failed > 0) {
        showToast('error', `Cobrança recusada para ${charge.userName}${reason ? `: ${reason}` : '.'}`);
      } else if (skipped > 0) {
        showToast('warning', `Cobrança ignorada para ${charge.userName} (sem cartão salvo ou gateway não configurado).`);
      } else {
        showToast('info', `Nada foi cobrado para ${charge.userName}: a assinatura não é elegível agora.`);
      }
      handleDayClick(selectedDate);
    } catch (err) {
      showToast('error', `Erro ao cobrar ${charge.userName}: ${err.message}`);
    } finally {
      setChargingId(null);
    }
  };

  const handleChargeAll = async () => {
    const targets = selectedCharges.filter(c => c.subscriptionId && !['approved', 'paid', 'cancelled'].includes(c.status));
    if (targets.length === 0) {
      showToast('info', 'Nenhuma cobrança deste dia está pendente.');
      return;
    }
    setBulkCharging(true);
    let approved = 0;
    let failed = 0;
    let skipped = 0;
    const errors = [];

    for (const target of targets) {
      try {
        const data = await callEdgeFunction('process-recurring-billing', {
          manual: true,
          subscription_id: target.subscriptionId,
        });
        approved += Number(data.approved || 0);
        failed += Number(data.failed || 0);
        skipped += Number(data.skipped || 0);
        if (Array.isArray(data.errors) && data.errors.length > 0) errors.push(data.errors[0]);
      } catch (err) {
        failed += 1;
        errors.push(`${target.userName}: ${err.message}`);
      }
    }

    setBulkCharging(false);
    if (failed > 0) {
      showToast('error', `Cobranças do dia: ${approved} aprovada(s), ${failed} falha(s), ${skipped} ignorada(s). ${errors[0] || ''}`);
    } else if (approved > 0) {
      showToast('success', `Cobranças do dia: ${approved} aprovada(s), ${skipped} ignorada(s).`);
    } else {
      showToast('warning', `Cobranças do dia: nenhuma aprovada (${skipped} ignorada(s)).`);
    }
    handleDayClick(selectedDate);
  };

  const handleReschedule = async (charge) => {
    if (!charge.subscriptionId) {
      showToast('error', 'Este item não tem assinatura vinculada — não pode ser reagendado.');
      return;
    }
    if (!rescheduleDate) {
      showToast('error', 'Escolha a nova data da cobrança.');
      return;
    }
    setRescheduleBusy(true);
    try {
      await callEdgeFunction('schedule-billing', {
        action: 'schedule',
        subscription_id: charge.subscriptionId,
        charge_date: rescheduleDate,
        reason: 'Reagendado pelo admin no calendário de cobranças',
      });
      showToast('success', `Cobrança de ${charge.userName} reagendada para ${new Date(rescheduleDate + 'T12:00:00').toLocaleDateString('pt-BR')}.`);
      setRescheduleId(null);
      setRescheduleDate('');
      handleDayClick(selectedDate);
    } catch (err) {
      showToast('error', `Erro ao reagendar: ${err.message}`);
    } finally {
      setRescheduleBusy(false);
    }
  };

  function prevMonth() {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDate(null);
  }

  function nextMonth() {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDate(null);
  }

  const monthName = currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const daySummary = useMemo(() => {
    const total = selectedCharges.length;
    const amount = selectedCharges.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const scheduled = selectedCharges.filter(c => c.type === 'subscription').length;
    const approved = selectedCharges.filter(c => c.type === 'billing_cycle' && c.status === 'approved').length;
    const failed = selectedCharges.filter(c => c.type === 'billing_cycle' && (c.status === 'failed' || c.status === 'rejected')).length;
    const pending = total - scheduled - approved - failed;
    return { total, amount, scheduled, approved, failed, pending };
  }, [selectedCharges]);

  const cells = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} className="cal-cell empty" />);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const data = calendarData[dateStr];
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === selectedDate;
    const isPast = dateStr < todayStr;

    cells.push(
      <div
        key={day}
        className={`cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${data ? 'has-data' : ''} ${isPast ? 'past' : ''}`}
        onClick={() => data && handleDayClick(dateStr)}
      >
        <span className="cal-day">{day}</span>
        {data && (
          <div className="cal-summary">
            <span className="cal-amount">{formatCurrency(data.totalAmount)}</span>
            <span className="cal-count">{data.total} cobrança{data.total !== 1 ? 's' : ''}</span>
            <div className="cal-indicators">
              {data.scheduled > 0 && <span className="cal-dot blue" title={`${data.scheduled} agendadas para cobrar`} />}
              {data.approved > 0 && <span className="cal-dot green" title={`${data.approved} aprovadas`} />}
              {data.failed > 0 && <span className="cal-dot red" title={`${data.failed} com falha`} />}
              {data.pending > 0 && <span className="cal-dot yellow" title={`${data.pending} pendentes`} />}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="billing-calendar-page">
      <div className="admin-header">
        <div>
          <h1>Calendário de Cobranças</h1>
          <p>Clique em um dia para ver e cobrar as assinaturas agendadas.</p>
        </div>
      </div>

      <div className="calendar-container">
        <div className="calendar-header">
          <button onClick={prevMonth} className="cal-nav-btn" aria-label="Mês anterior"><ChevronLeft size={20} /></button>
          <h2>{monthName}</h2>
          <button onClick={nextMonth} className="cal-nav-btn" aria-label="Próximo mês"><ChevronRight size={20} /></button>
        </div>

        <div className="calendar-weekdays">
          {WEEKDAYS.map(d => <div key={d} className="cal-weekday">{d}</div>)}
        </div>

        {loading ? (
          <div className="cal-loading">Carregando...</div>
        ) : (
          <div className="calendar-grid">
            {cells}
          </div>
        )}

        <div className="calendar-legend">
          <Info size={14} />
          <span>
            A grade mostra apenas agendamentos futuros (a partir de hoje). O histórico de cobranças e o de falhas ficam na tela
            “Cobranças → Falhas”.
          </span>
        </div>
      </div>

      {selectedDate && (
        <div className="day-panel-overlay" onClick={() => setSelectedDate(null)}>
          <div className="day-panel" onClick={e => e.stopPropagation()}>
            <div className="day-panel-header">
              <h3>{new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</h3>
              <button onClick={() => setSelectedDate(null)} className="day-panel-close" aria-label="Fechar painel"><X size={18} /></button>
            </div>

            {loadingDay ? (
              <div className="cal-loading">Carregando...</div>
            ) : dayError ? (
              <div className="day-panel-error">
                <AlertCircle size={18} />
                <span>{dayError}</span>
              </div>
            ) : selectedCharges.length === 0 ? (
              <div className="empty-state">
                <AlertTriangle size={32} />
                <p>Nenhuma cobrança agendada para este dia.</p>
              </div>
            ) : (
              <>
                <div className="day-panel-summary">
                  <span className="summary-item scheduled">
                    <CalendarIcon size={14} /> {daySummary.scheduled} agendada(s)
                  </span>
                  <span className="summary-item approved">
                    <CheckCircle size={14} /> {daySummary.approved} aprovada(s)
                  </span>
                  <span className="summary-item failed">
                    <XCircle size={14} /> {daySummary.failed} falha(s)
                  </span>
                  <span className="summary-item pending">
                    <Clock size={14} /> {daySummary.pending} pendente(s)
                  </span>
                  <span className="summary-item amount">{formatCurrency(daySummary.amount)}</span>
                </div>

                <div className="day-panel-bulk">
                  <button
                    className="cal-bulk-btn"
                    onClick={handleChargeAll}
                    disabled={bulkCharging || chargingId !== null}
                  >
                    {bulkCharging ? <><Loader2 size={14} className="spinning" /> Cobrando todas...</> : <><Zap size={14} /> Cobrar todas as vencidas do dia</>}
                  </button>
                  <span className="cal-bulk-hint">
                    {daySummary.total} cobrança(s) no dia · {formatCurrency(daySummary.amount)} em jogo
                  </span>
                </div>

                <div className="day-panel-list">
                  {selectedCharges.map(charge => {
                    const badge = chargeBadge(charge);
                    const cycle = cycleLabel(charge.billingCycle, charge.customCycleDays, charge.customCycleMonths);
                    const isRescheduling = rescheduleId === charge.id;
                    return (
                      <div key={`${charge.type}-${charge.id}`} className="day-charge-item">
                        <div className="day-charge-info">
                          <div className="day-charge-user-row">
                            <strong>{charge.userName}</strong>
                            {charge.userEmail && <span className="day-charge-email">{charge.userEmail}</span>}
                          </div>
                          <span className="day-charge-service">{charge.serviceName}</span>
                          <span className="day-charge-group">{charge.groupName}</span>
                          <div className="day-charge-meta">
                            {charge.cardLast4 && (
                              <span className="day-charge-card">
                                <CreditCard size={12} /> •••• {charge.cardLast4} {charge.cardBrand || ''}
                              </span>
                            )}
                            {!charge.cardLast4 && (
                              <span className="day-charge-card day-charge-no-card">sem cartão salvo</span>
                            )}
                            {cycle && <span className="day-charge-cycle">{cycle}</span>}
                            {charge.attempt > 0 && (
                              <span className="day-charge-attempt">{charge.attempt}ª tentativa</span>
                            )}
                          </div>
                          {charge.error && (
                            <span className="day-charge-error" title={charge.error}>{charge.error}</span>
                          )}
                        </div>

                        <div className="day-charge-details">
                          <span className="day-charge-amount">{formatCurrency(charge.amount)}</span>
                          <span className={`cal-badge ${badge.tone}`}>{badge.label}</span>

                          <div className="day-charge-actions">
                            <button
                              className="cal-action-btn"
                              onClick={() => handleChargeNow(charge)}
                              disabled={chargingId === charge.id || bulkCharging || !charge.subscriptionId}
                              title={charge.subscriptionId ? 'Cobrar agora via process-recurring-billing' : 'Sem assinatura vinculada'}
                            >
                              {chargingId === charge.id
                                ? <><Loader2 size={12} className="spinning" /> Cobrando...</>
                                : <><Zap size={12} /> Cobrar agora</>}
                            </button>

                            <button
                              className="cal-action-btn"
                              onClick={() => { setRescheduleId(isRescheduling ? null : charge.id); setRescheduleDate(charge.date || todayStr); }}
                              disabled={!charge.subscriptionId}
                              title="Reagendar para outra data"
                            >
                              <RefreshCw size={12} /> Reagendar
                            </button>

                            <button
                              className="cal-action-btn"
                              onClick={() => navigate(`/admin/subscriptions/${charge.subscriptionId}/edit`)}
                              disabled={!charge.subscriptionId}
                              title="Abrir a assinatura"
                            >
                              Abrir assinatura
                            </button>
                          </div>

                          {isRescheduling && (
                            <div className="cal-reschedule">
                              <input
                                type="date"
                                value={rescheduleDate}
                                min={todayStr}
                                onChange={e => setRescheduleDate(e.target.value)}
                              />
                              <button
                                className="cal-action-btn primary"
                                onClick={() => handleReschedule(charge)}
                                disabled={rescheduleBusy}
                              >
                                {rescheduleBusy ? <><Loader2 size={12} className="spinning" /> Salvando...</> : 'Confirmar'}
                              </button>
                              <button className="cal-action-btn" onClick={() => setRescheduleId(null)} disabled={rescheduleBusy}>
                                Cancelar
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}

export default BillingCalendar;
