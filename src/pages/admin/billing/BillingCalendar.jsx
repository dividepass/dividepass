import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X, CheckCircle, XCircle, Clock, AlertTriangle, CreditCard } from 'lucide-react';
import './BillingCalendar.css';

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

const CYCLE_LABELS = { monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual', days: 'Dias', custom: 'Personalizado' };

function BillingCalendar() {
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarData, setCalendarData] = useState({});
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedCharges, setSelectedCharges] = useState([]);
  const [loadingDay, setLoadingDay] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  useEffect(() => {
    async function fetchCalendarData() {
      setLoading(true);
      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

      const [bcRes, subRes] = await Promise.all([
        supabase
          .from('billing_cycles')
          .select('charge_date, amount, status')
          .gte('charge_date', startDate)
          .lte('charge_date', endDate),
        supabase
          .from('user_subscriptions')
          .select('next_charge_at, amount, status, billing_status, billing_cycle, custom_cycle_days, custom_cycle_months')
          .eq('status', 'active')
          .not('next_charge_at', 'is', null)
          .gte('next_charge_at', startDate)
          .lte('next_charge_at', endDate)
      ]);

      const grouped = {};

      (bcRes.data || []).forEach(item => {
        const date = item.charge_date;
        if (!grouped[date]) {
          grouped[date] = { total: 0, approved: 0, failed: 0, pending: 0, totalAmount: 0, source: 'billing_cycles', items: [] };
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
          grouped[date] = { total: 0, approved: 0, failed: 0, pending: 0, totalAmount: 0, source: 'subscriptions', items: [] };
        }
        grouped[date].total++;
        grouped[date].totalAmount += Number(item.amount || 0);
        grouped[date].items.push({ ...item, source: 'subscriptions' });
        const bs = item.billing_status || item.status;
        if (bs === 'active') {
          grouped[date].approved++;
        } else if (bs === 'overdue' || bs === 'failed') {
          grouped[date].failed++;
        } else {
          grouped[date].pending++;
        }
      });

      setCalendarData(grouped);
      setLoading(false);
    }
    fetchCalendarData();
  }, [year, month, daysInMonth]);

  async function handleDayClick(dateStr) {
    setSelectedDate(dateStr);
    setLoadingDay(true);

    const [bcRes, subRes] = await Promise.all([
      supabase
        .from('billing_cycles')
        .select(`
          id, amount, status, attempt_number, error_message, charge_date,
          user:users!billing_cycles_user_id_fkey (id, name, email),
          group:groups!billing_cycles_group_id_fkey (id, name),
          subscription:user_subscriptions!billing_cycles_subscription_id_fkey (id, card_last4, card_brand, service_id, billing_cycle, custom_cycle_days)
        `)
        .eq('charge_date', dateStr)
        .order('created_at', { ascending: false }),
      supabase
        .from('user_subscriptions')
        .select(`
          id, amount, status, billing_status, billing_cycle, custom_cycle_days, next_charge_at, card_last4, card_brand, retry_count,
          user:user_id (id, name, email),
          group:group_id (id, name),
          service:service_id (id, name)
        `)
        .eq('status', 'active')
        .not('next_charge_at', 'is', null)
        .gte('next_charge_at', dateStr + 'T00:00:00')
        .lte('next_charge_at', dateStr + 'T23:59:59')
    ]);

    const charges = [];

    (bcRes.data || []).forEach(bc => {
      charges.push({
        id: bc.id,
        type: 'billing_cycle',
        amount: bc.amount,
        status: bc.status,
        userName: bc.user?.name || '—',
        userEmail: bc.user?.email || '',
        userId: bc.user?.id,
        groupName: bc.group?.name || '—',
        groupId: bc.group?.id,
        serviceName: '—',
        cardLast4: bc.subscription?.card_last4,
        cardBrand: bc.subscription?.card_brand,
        attempt: bc.attempt_number,
        error: bc.error_message,
        billingCycle: bc.subscription?.billing_cycle,
      });
    });

    (subRes.data || []).forEach(sub => {
      charges.push({
        id: sub.id,
        type: 'subscription',
        amount: sub.amount,
        status: sub.billing_status || sub.status,
        userName: sub.user?.name || '—',
        userEmail: sub.user?.email || '',
        userId: sub.user?.id,
        groupName: sub.group?.name || '—',
        groupId: sub.group?.id,
        serviceName: sub.service?.name || '—',
        cardLast4: sub.card_last4,
        cardBrand: sub.card_brand,
        attempt: sub.retry_count,
        error: null,
        billingCycle: sub.billing_cycle,
      });
    });

    setSelectedCharges(charges);
    setLoadingDay(false);
  }

  function prevMonth() {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDate(null);
  }

  function nextMonth() {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDate(null);
  }

  const monthName = currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const cells = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} className="cal-cell empty" />);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const data = calendarData[dateStr];
    const isToday = dateStr === new Date().toISOString().split('T')[0];
    const isSelected = dateStr === selectedDate;

    cells.push(
      <div
        key={day}
        className={`cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${data ? 'has-data' : ''}`}
        onClick={() => data && handleDayClick(dateStr)}
      >
        <span className="cal-day">{day}</span>
        {data && (
          <div className="cal-summary">
            <span className="cal-amount">{formatCurrency(data.totalAmount)}</span>
            <span className="cal-count">{data.total} cobrança{data.total !== 1 ? 's' : ''}</span>
            <div className="cal-indicators">
              {data.approved > 0 && <span className="cal-dot green" title={`${data.approved} agendadas`} />}
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
        <h1>Calendário de Cobranças</h1>
        <p>Cobranças agendadas e histórico por dia</p>
      </div>

      <div className="billing-nav-links">
        <Link to="/admin/billing" className="billing-nav">Dashboard</Link>
        <Link to="/admin/subscriptions" className="billing-nav">Assinaturas SaaS</Link>
        <Link to="/admin/wallets" className="billing-nav">Carteiras</Link>
        <Link to="/admin/billing/calendar" className="billing-nav active">Calendário</Link>
        <Link to="/admin/billing/failures" className="billing-nav">Falhas</Link>
        <Link to="/admin/billing/crons" className="billing-nav">Crons</Link>
      </div>

      <div className="calendar-container">
        <div className="calendar-header">
          <button onClick={prevMonth} className="cal-nav-btn"><ChevronLeft size={20} /></button>
          <h2>{monthName}</h2>
          <button onClick={nextMonth} className="cal-nav-btn"><ChevronRight size={20} /></button>
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
      </div>

      {selectedDate && (
        <div className="day-panel-overlay" onClick={() => setSelectedDate(null)}>
          <div className="day-panel" onClick={e => e.stopPropagation()}>
            <div className="day-panel-header">
              <h3>{new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</h3>
              <button onClick={() => setSelectedDate(null)} className="day-panel-close"><X size={18} /></button>
            </div>

            {loadingDay ? (
              <div className="cal-loading">Carregando...</div>
            ) : selectedCharges.length === 0 ? (
              <div className="empty-state">
                <AlertTriangle size={32} />
                <p>Nenhuma cobrança agendada para este dia.</p>
              </div>
            ) : (
              <>
                <div className="day-panel-summary">
                  <span className="summary-item approved">
                    <CheckCircle size={14} /> {selectedCharges.filter(c => c.status === 'approved' || c.status === 'active' || c.status === 'paid').length} agendadas
                  </span>
                  <span className="summary-item failed">
                    <XCircle size={14} /> {selectedCharges.filter(c => c.status === 'failed' || c.status === 'overdue' || c.status === 'rejected').length} falhas
                  </span>
                  <span className="summary-item pending">
                    <Clock size={14} /> {selectedCharges.filter(c => !['approved', 'active', 'paid', 'failed', 'overdue', 'rejected'].includes(c.status)).length} pendentes
                  </span>
                </div>

                <div className="day-panel-list">
                  {selectedCharges.map(charge => (
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
                          {charge.billingCycle && (
                            <span className="day-charge-cycle">
                              {CYCLE_LABELS[charge.billingCycle] || charge.billingCycle}
                              {charge.billingCycle === 'days' && charge.custom_cycleDays ? ` (${charge.custom_cycle_days}d)` : ''}
                            </span>
                          )}
                          {charge.attempt > 0 && (
                            <span className="day-charge-attempt">{charge.attempt}ª tentativa</span>
                          )}
                        </div>
                      </div>
                      <div className="day-charge-details">
                        <span className="day-charge-amount">{formatCurrency(charge.amount)}</span>
                        <span className={`status-badge ${charge.status}`}>
                          {charge.status === 'approved' || charge.status === 'active' || charge.status === 'paid' ? 'Agendada' :
                           charge.status === 'failed' || charge.status === 'rejected' ? 'Falhou' :
                           charge.status === 'overdue' ? 'Atrasada' : 'Pendente'}
                        </span>
                        {charge.error && (
                          <span className="day-charge-error" title={charge.error}>{charge.error}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default BillingCalendar;
