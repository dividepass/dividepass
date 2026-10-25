import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import {
  Clock,
  Play,
  Pause,
  RotateCcw,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Plus,
  Zap,
  Eye,
  CreditCard,
  AlertCircle,
  X,
  Info,
} from 'lucide-react';
import './CronManagement.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR');
}

// Rótulos das estatísticas: nenhum número aparece sem contexto.
const STAT_LABELS = {
  overdue_invoices: 'Faturas vencidas (pendentes com vencimento passado)',
  with_card: 'Assinaturas com cartão salvo',
  without_card: 'Sem cartão salvo (a cobrança automática não acontece)',
  upcoming: 'Próximas cobranças agendadas',
  retrying: 'Assinaturas em retry (nova tentativa)',
  amount_to_charge: 'Valor a cobrar no próximo ciclo',
  pending: 'Assinaturas pendentes',
  first_attempt: 'Assinaturas na primeira tentativa',
  overdue: 'Assinaturas atrasadas',
  amount_overdue: 'Valor total das faturas vencidas',
  pending_invoices_total: 'Faturas pendentes no total (inclusive as que ainda não venceram)',
  // nomes usados pela versão anterior do manage-crons
  total_with_card: 'Assinaturas com cartão salvo',
  total_without_card: 'Sem cartão salvo (a cobrança automática não acontece)',
  upcoming_charges: 'Próximas cobranças agendadas',
  total_upcoming_amount: 'Valor a cobrar no próximo ciclo',
};

const AMOUNT_KEYS = ['amount_to_charge', 'total_upcoming_amount', 'amount_overdue'];

function statLabel(key) {
  if (STAT_LABELS[key]) return STAT_LABELS[key];
  return key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

function statValue(key, value) {
  if (AMOUNT_KEYS.includes(key)) return formatCurrency(value);
  return typeof value === 'number' ? value.toLocaleString('pt-BR') : String(value ?? 0);
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
  return data;
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(onClose, 7000);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;
  return (
    <div className={`cron-toast ${toast.type}`} role="status">
      {toast.type === 'success' && <CheckCircle size={16} />}
      {toast.type === 'error' && <AlertCircle size={16} />}
      {toast.type === 'warning' && <AlertTriangle size={16} />}
      {toast.type === 'info' && <Info size={16} />}
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Fechar aviso"><X size={14} /></button>
    </div>
  );
}

function CronManagement() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [crons, setCrons] = useState([]);
  const [cronSource, setCronSource] = useState(null);
  const [cronMessage, setCronMessage] = useState('');
  const [cronsError, setCronsError] = useState('');
  const [runningId, setRunningId] = useState(null);
  const [showScheduler, setShowScheduler] = useState(false);
  const [detailsJob, setDetailsJob] = useState(null);
  const [detailsData, setDetailsData] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [toast, setToast] = useState(null);
  const [manualNotice, setManualNotice] = useState(null);
  const [chargingRow, setChargingRow] = useState(null);

  // Scheduler states
  const [emailSearch, setEmailSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [userSubs, setUserSubs] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [chargingScheduled, setChargingScheduled] = useState(false);
  const [form, setForm] = useState({
    subscription_id: '',
    charge_date: '',
    amount: '',
    reason: '',
  });
  const [result, setResult] = useState(null);

  const showToast = useCallback((type, message) => setToast({ type, message }), []);
  const closeToast = useCallback(() => setToast(null), []);

  const fetchCrons = useCallback(async () => {
    try {
      const data = await callEdgeFunction('manage-crons', { action: 'list' });
      const source = data?.cron_source || null;
      setCronSource(source);
      setCronMessage(data?.message || '');
      if (source === 'database') {
        setCrons(Array.isArray(data?.crons) ? data.crons : []);
      } else {
        // Sem "cron_source: database" não há como confirmar que os jobs listados
        // existem de fato no banco — a lista não é exibida.
        setCrons([]);
      }
      setCronsError('');
    } catch (err) {
      setCronSource('unavailable');
      setCrons([]);
      setCronsError(err.message || 'Não foi possível ler os agendamentos do banco.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // o carregamento começa no próximo tick, fora do corpo do efeito
      await Promise.resolve();
      if (!cancelled) await fetchCrons();
    })();
    return () => { cancelled = true; };
  }, [fetchCrons]);

  const handleToggle = async (jobid, currentActive) => {
    try {
      const data = await callEdgeFunction('manage-crons', { action: 'toggle', jobid, active: !currentActive });
      if (data?.needsManual) {
        const message = data.message || 'Não foi possível alterar o agendamento automaticamente.';
        setManualNotice({ jobid, message });
        showToast('warning', message);
        return;
      }
      showToast('success', `Agendamento ${!currentActive ? 'ativado' : 'desativado'} com sucesso.`);
      fetchCrons();
    } catch (err) {
      showToast('error', `Erro ao alterar o agendamento: ${err.message}`);
    }
  };

  const handleRunNow = async (jobname) => {
    setRunningId(jobname);
    try {
      const data = await callEdgeFunction('manage-crons', { action: 'run_now', jobname });
      let parsed = null;
      if (typeof data?.response === 'string') {
        try { parsed = JSON.parse(data.response); } catch { parsed = null; }
      } else if (data?.response && typeof data.response === 'object') {
        parsed = data.response;
      }
      if (parsed) {
        showToast(
          parsed.failed > 0 ? 'error' : 'success',
          `${jobname}: processadas ${parsed.processed || 0}, aprovadas ${parsed.approved || 0}, falhas ${parsed.failed || 0}, ignoradas ${parsed.skipped || 0}, canceladas ${parsed.cancelled || 0}.`
        );
      } else if (data?.success) {
        showToast('success', `${jobname} executado. Resposta: ${String(data.response || '').slice(0, 200) || 'sem detalhes'}`);
      } else {
        showToast('error', `${jobname}: ${data?.response || data?.error || 'execução não concluída'}`);
      }
    } catch (err) {
      showToast('error', `Erro ao executar ${jobname}: ${err.message}`);
    } finally {
      setRunningId(null);
    }
  };

  const handleChargeSubscription = async (subscriptionId, label) => {
    if (!subscriptionId) {
      showToast('error', 'Este item não tem assinatura vinculada — não há o que cobrar.');
      return;
    }
    setChargingRow(subscriptionId);
    try {
      const data = await callEdgeFunction('process-recurring-billing', {
        manual: true,
        subscription_id: subscriptionId,
      });
      const approved = Number(data.approved || 0);
      const failed = Number(data.failed || 0);
      const skipped = Number(data.skipped || 0);
      const details = Array.isArray(data.details) ? data.details : [];
      const own = details.find(d => d.subscription_id === subscriptionId);
      const reason = own?.error || (Array.isArray(data.errors) && data.errors[0]) || null;

      if (approved > 0) {
        showToast('success', `Cobrança aprovada para ${label}.`);
      } else if (failed > 0) {
        showToast('error', `Cobrança recusada para ${label}${reason ? `: ${reason}` : '.'}`);
      } else if (skipped > 0) {
        showToast('warning', `Cobrança ignorada para ${label} (sem cartão salvo ou gateway não configurado).`);
      } else {
        showToast('info', `Nada foi cobrado para ${label}: a assinatura não é elegível agora.`);
      }
      if (detailsJob) handleOpenDetails(detailsJob);
    } catch (err) {
      showToast('error', `Erro ao cobrar ${label}: ${err.message}`);
    } finally {
      setChargingRow(null);
    }
  };

  const openScheduler = () => {
    setShowScheduler(true);
    setEmailSearch('');
    setSearchResults([]);
    setSearchError('');
    setSelectedUser(null);
    setUserSubs([]);
    setForm({ subscription_id: '', charge_date: '', amount: '', reason: '' });
    setResult(null);
  };

  const handleOpenDetails = async (cron) => {
    setDetailsJob(cron);
    setDetailsData(null);
    setLoadingDetails(true);
    try {
      const data = await callEdgeFunction('manage-crons', { action: 'cron_details', jobname: cron.jobname });
      // O backend pode devolver o objeto direto ou dentro de "details".
      setDetailsData(data?.details || data || {});
    } catch (err) {
      setDetailsData({ error: err.message });
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleSearchEmail = async () => {
    if (!emailSearch || emailSearch.length < 3) return;
    setSearching(true);
    setSearchError('');
    try {
      // "query" é o contrato novo; "email" é aceito pela versão anterior.
      const data = await callEdgeFunction('schedule-billing', {
        action: 'search_user',
        email: emailSearch,
        query: emailSearch,
      });
      setSearchResults(Array.isArray(data?.users) ? data.users : []);
    } catch (err) {
      setSearchResults([]);
      setSearchError(err.message || 'Não foi possível buscar o cliente.');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectUser = async (user) => {
    setSelectedUser(user);
    setSearchResults([]);
    setEmailSearch(user.email);
    setLoadingSubs(true);
    setSearchError('');
    try {
      const data = await callEdgeFunction('schedule-billing', { action: 'list_subscriptions', user_id: user.id });
      setUserSubs(Array.isArray(data?.subscriptions) ? data.subscriptions : []);
    } catch (err) {
      setUserSubs([]);
      setSearchError(err.message || 'Não foi possível carregar as assinaturas do cliente.');
    } finally {
      setLoadingSubs(false);
    }
  };

  const handleSchedule = async (e) => {
    e.preventDefault();
    if (!form.subscription_id || !form.charge_date) {
      setSearchError('Selecione a assinatura e a data de cobrança.');
      return;
    }
    setScheduling(true);
    setResult(null);
    try {
      const data = await callEdgeFunction('schedule-billing', {
        action: 'schedule',
        subscription_id: form.subscription_id,
        charge_date: form.charge_date,
        amount: form.amount ? parseFloat(form.amount) : undefined,
        reason: form.reason || undefined,
      });
      if (data?.success) {
        setResult({ type: 'success', data });
        setForm({ subscription_id: '', charge_date: '', amount: '', reason: '' });
        setSelectedUser(null);
        setUserSubs([]);
        setEmailSearch('');
      } else {
        setResult({ type: 'error', message: data?.error || 'Não foi possível agendar a cobrança.' });
      }
    } catch (err) {
      setResult({ type: 'error', message: err.message });
    } finally {
      setScheduling(false);
    }
  };

  const handleChargeScheduled = async () => {
    const subscriptionId = result?.data?.subscription_id;
    if (!subscriptionId) {
      showToast('error', 'A cobrança agendada não devolviu a assinatura — não dá para disparar agora.');
      return;
    }
    setChargingScheduled(true);
    try {
      const data = await callEdgeFunction('process-recurring-billing', {
        manual: true,
        subscription_id: subscriptionId,
      });
      const approved = Number(data.approved || 0);
      const failed = Number(data.failed || 0);
      const skipped = Number(data.skipped || 0);
      if (approved > 0) {
        showToast('success', `Cobrança aprovada para ${result.data.user_name || 'o cliente'}.`);
      } else if (failed > 0) {
        showToast('error', `A cobrança de ${result.data.user_name || 'o cliente'} foi recusada.`);
      } else if (skipped > 0) {
        showToast('warning', `Cobrança ignorada para ${result.data.user_name || 'o cliente'} (sem cartão salvo ou gateway não configurado).`);
      } else {
        showToast('info', 'Nada foi cobrado: a assinatura não é elegível agora.');
      }
    } catch (err) {
      showToast('error', `Erro ao cobrar agora: ${err.message}`);
    } finally {
      setChargingScheduled(false);
    }
  };

  const formatSchedule = (schedule) => {
    if (!schedule) return 'N/A';
    const parts = schedule.split(' ');
    if (parts.length === 5) {
      const [min, hour, dom, month] = parts;
      if (dom === '*' && month === '*') {
        return `Todo dia às ${hour.padStart(2, '0')}:${min.padStart(2, '0')} (BRT)`;
      }
    }
    return schedule;
  };

  const affectedUsers = Array.isArray(detailsData?.affected_users) ? detailsData.affected_users : [];
  const overdueInvoices = Array.isArray(detailsData?.overdue_invoices) ? detailsData.overdue_invoices : [];
  const recentExecutions = Array.isArray(detailsData?.recent_executions) ? detailsData.recent_executions : [];
  const stats = detailsData?.stats && typeof detailsData.stats === 'object' ? detailsData.stats : {};
  const statEntries = Object.entries(stats).filter(([, value]) => value !== null && value !== undefined);

  return (
    <div className="cron-management-page">
      <div className="admin-header">
        <div>
          <h1><Clock size={24} /> Gerenciamento de Crons</h1>
          <p>Visualize, ative/desative e execute processos agendados</p>
        </div>
      </div>

      <div className="cron-actions-bar">
        <button className="cron-refresh-btn" onClick={() => { setLoading(true); fetchCrons(); }} disabled={loading}>
          <RotateCcw size={16} className={loading ? 'spinning' : ''} />
          Atualizar
        </button>
        <button className="cron-schedule-btn" onClick={openScheduler}>
          <Plus size={16} />
          Agendar Cobrança Manual
        </button>
      </div>

      {manualNotice && (
        <div className="cron-manual-notice">
          <AlertTriangle size={18} />
          <div>
            <strong>Ajuste manual necessário no banco.</strong>
            <p>{manualNotice.message}</p>
            <button className="cron-notice-close" onClick={() => setManualNotice(null)}>Fechar aviso</button>
          </div>
        </div>
      )}

      {cronsError && (
        <div className="cron-source-warning">
          <AlertCircle size={18} />
          <div>
            <strong>Não foi possível ler o estado dos agendamentos.</strong>
            <p>{cronsError}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="cron-loading">Carregando crons...</div>
      ) : cronSource === 'unavailable' ? (
        <div className="cron-source-warning">
          <AlertTriangle size={18} />
          <div>
            <strong>O estado dos agendamentos não pôde ser lido do banco.</strong>
            <p>
              A função <code>manage-crons</code> respondeu <code>cron_source: unavailable</code>. Nenhum agendamento é
              exibido aqui porque não há como confirmar quais existem — confira o painel de cron do Supabase.
            </p>
            {cronMessage && <p>{cronMessage}</p>}
          </div>
        </div>
      ) : cronSource !== 'database' ? (
        <div className="cron-source-warning">
          <AlertTriangle size={18} />
          <div>
            <strong>A origem dos agendamentos não foi informada.</strong>
            <p>
              A função <code>manage-crons</code> não devolveu <code>cron_source</code>, então não é possível confirmar que
              os jobs listados existem de fato no banco. A lista fica oculta até a função informar a origem
              (<code>database</code> ou <code>unavailable</code>).
            </p>
          </div>
        </div>
      ) : crons.length === 0 ? (
        <div className="cron-loading">Nenhum agendamento encontrado no banco.</div>
      ) : (
        <div className="cron-list">
          {crons.map((cron) => (
            <div key={cron.jobid || cron.jobname} className={`cron-card ${cron.active ? 'active' : 'inactive'}`}>
              <div className="cron-card-header">
                <div className="cron-info">
                  <div className="cron-name">
                    <Zap size={16} className={cron.active ? 'text-success' : 'text-muted'} />
                    <strong>{cron.jobname}</strong>
                    <span className={`cron-status-badge ${cron.active ? 'active' : 'inactive'}`}>
                      {cron.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <p className="cron-description">{cron.description || cron.command || ''}</p>
                </div>
                <div className="cron-type-badge">{cron.type || 'custom'}</div>
              </div>

              <div className="cron-card-body">
                <div className="cron-detail">
                  <Clock size={14} />
                  <span>Agenda: {formatSchedule(cron.schedule)}</span>
                </div>
                {cron.next_run && (
                  <div className="cron-detail">
                    <Calendar size={14} />
                    <span>Próxima execução: {formatDateTime(cron.next_run)}</span>
                  </div>
                )}
              </div>

              <div className="cron-card-actions">
                <button
                  className="cron-details-btn"
                  onClick={() => handleOpenDetails(cron)}
                >
                  <Eye size={14} />
                  Detalhes
                </button>
                <button
                  className={`cron-toggle-btn ${cron.active ? 'deactivate' : 'activate'}`}
                  onClick={() => handleToggle(cron.jobid, cron.active)}
                >
                  {cron.active ? <Pause size={14} /> : <Play size={14} />}
                  {cron.active ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  className="cron-run-btn"
                  onClick={() => handleRunNow(cron.jobname)}
                  disabled={runningId === cron.jobname}
                >
                  {runningId === cron.jobname ? (
                    <Loader2 size={14} className="spinning" />
                  ) : (
                    <Play size={14} />
                  )}
                  {runningId === cron.jobname ? 'Executando...' : 'Executar Agora'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showScheduler && (
        <div className="scheduler-overlay" onClick={() => setShowScheduler(false)}>
          <div className="scheduler-panel" onClick={e => e.stopPropagation()}>
            <div className="scheduler-header">
              <h3><Calendar size={18} /> Agendar Cobrança Manual</h3>
              <button onClick={() => setShowScheduler(false)} className="close-btn" aria-label="Fechar">&times;</button>
            </div>

            <div className="scheduler-form">
              {/* Step 1: Buscar cliente */}
              {!selectedUser && (
                <div className="scheduler-step">
                  <label className="step-label">1. Buscar cliente por email</label>
                  <div className="search-row">
                    <input
                      type="email"
                      placeholder="email@exemplo.com"
                      value={emailSearch}
                      onChange={e => setEmailSearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleSearchEmail())}
                    />
                    <button type="button" className="search-btn" onClick={handleSearchEmail} disabled={searching || emailSearch.length < 3}>
                      {searching ? <Loader2 size={16} className="spinning" /> : 'Buscar'}
                    </button>
                  </div>

                  {searchError && <p className="search-empty search-error">{searchError}</p>}

                  {searchResults.length > 0 && (
                    <div className="search-results">
                      {searchResults.map(u => (
                        <div key={u.id} className="search-result-item" onClick={() => handleSelectUser(u)}>
                          <div className="result-avatar">{u.name?.charAt(0)?.toUpperCase() || '?'}</div>
                          <div className="result-info">
                            <strong>{u.name}</strong>
                            <span>{u.email}</span>
                          </div>
                          <span className="result-subs">{u.sub_count || 0} assinatura(s)</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {emailSearch.length >= 3 && !searching && searchResults.length === 0 && !searchError && (
                    <p className="search-empty">Nenhum cliente encontrado com este email.</p>
                  )}
                </div>
              )}

              {/* Step 1b: Cliente selecionado */}
              {selectedUser && (
                <div className="scheduler-step">
                  <label className="step-label">1. Cliente selecionado</label>
                  <div className="selected-user-card">
                    <div className="selected-avatar">{selectedUser.name?.charAt(0)?.toUpperCase() || '?'}</div>
                    <div className="selected-info">
                      <strong>{selectedUser.name}</strong>
                      <span>{selectedUser.email}</span>
                    </div>
                    <button type="button" className="change-btn" onClick={() => { setSelectedUser(null); setUserSubs([]); setEmailSearch(''); }}>
                      Trocar
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Selecionar assinatura */}
              {selectedUser && (
                <div className="scheduler-step">
                  <label className="step-label">2. Selecionar assinatura</label>
                  {loadingSubs ? (
                    <div className="loading-text"><Loader2 size={16} className="spinning" /> Carregando assinaturas...</div>
                  ) : userSubs.length === 0 ? (
                    <p className="search-empty">Este cliente não possui assinaturas ativas.</p>
                  ) : (
                    <div className="sub-options">
                      {userSubs.map(sub => (
                        <div
                          key={sub.id}
                          className={`sub-option ${form.subscription_id === sub.id ? 'selected' : ''}`}
                          onClick={() => setForm({ ...form, subscription_id: sub.id, amount: sub.amount?.toString() || '' })}
                        >
                          <div className="sub-option-info">
                            <strong>{sub.service?.name || 'Serviço'}</strong>
                            <span>{sub.group?.name || 'Grupo'}</span>
                          </div>
                          <div className="sub-option-details">
                            <span className="sub-amount">R$ {parseFloat(sub.amount || 0).toFixed(2)}</span>
                            <span className="sub-cycle">{sub.billing_cycle === 'monthly' ? 'Mensal' : sub.billing_cycle === 'quarterly' ? 'Trimestral' : sub.billing_cycle === 'annual' ? 'Anual' : sub.billing_cycle}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Dados da cobrança */}
              {selectedUser && form.subscription_id && (
                <form onSubmit={handleSchedule} className="scheduler-step">
                  <label className="step-label">3. Dados da cobrança</label>

                  <div className="form-group">
                    <label htmlFor="cron-charge-date">Data de Cobrança</label>
                    <input
                      id="cron-charge-date"
                      type="date"
                      value={form.charge_date}
                      onChange={e => setForm({ ...form, charge_date: e.target.value })}
                      min={new Date().toISOString().split('T')[0]}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="cron-charge-amount">Valor (opcional - padrão: valor da assinatura)</label>
                    <input
                      id="cron-charge-amount"
                      type="number"
                      step="0.01"
                      placeholder="Ex: 39.90"
                      value={form.amount}
                      onChange={e => setForm({ ...form, amount: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="cron-charge-reason">Motivo (opcional)</label>
                    <input
                      id="cron-charge-reason"
                      type="text"
                      placeholder="Ex: Cobrança referente a Junho/2026"
                      value={form.reason}
                      onChange={e => setForm({ ...form, reason: e.target.value })}
                    />
                  </div>

                  <button type="submit" className="scheduler-submit-btn" disabled={scheduling}>
                    {scheduling ? (
                      <><Loader2 size={16} className="spinning" /> Agendando...</>
                    ) : (
                      <><Calendar size={16} /> Agendar Cobrança</>
                    )}
                  </button>
                </form>
              )}
            </div>

            {result && (
              <div className={`scheduler-result ${result.type}`}>
                {result.type === 'success' ? (
                  <>
                    <CheckCircle size={18} />
                    <div>
                      <strong>Cobrança agendada com sucesso!</strong>
                      <p>{result.data.user_name} - {result.data.service_name} - R$ {parseFloat(result.data.amount || 0).toFixed(2)}</p>
                      <p>Data: {formatDate(result.data.charge_date)}</p>
                      <button
                        className="cron-charge-btn"
                        onClick={handleChargeScheduled}
                        disabled={chargingScheduled}
                      >
                        {chargingScheduled
                          ? <><Loader2 size={14} className="spinning" /> Cobrando...</>
                          : <><Zap size={14} /> Cobrar agora</>}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={18} />
                    <span>Erro: {result.message}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {detailsJob && (
        <div className="scheduler-overlay" onClick={() => { setDetailsJob(null); setDetailsData(null); }}>
          <div className="scheduler-panel details-panel" onClick={e => e.stopPropagation()}>
            <div className="scheduler-header">
              <h3><Eye size={18} /> Detalhes do Cron</h3>
              <button onClick={() => { setDetailsJob(null); setDetailsData(null); }} className="close-btn" aria-label="Fechar">&times;</button>
            </div>

            {loadingDetails ? (
              <div className="details-loading">
                <Loader2 size={24} className="spinning" />
                <span>Carregando detalhes...</span>
              </div>
            ) : detailsData?.error ? (
              <div className="details-error">
                <AlertCircle size={20} />
                <span>Erro ao carregar: {detailsData.error}</span>
              </div>
            ) : detailsData ? (
              <div className="details-content">
                {/* Header do cron */}
                <div className="details-cron-header">
                  <div className="details-cron-name">
                    <Zap size={20} className={detailsJob.active ? 'text-success' : 'text-muted'} />
                    <strong>{detailsJob.jobname}</strong>
                    <span className={`cron-status-badge ${detailsJob.active ? 'active' : 'inactive'}`}>
                      {detailsJob.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <span className="cron-type-badge">{detailsJob.type || 'custom'}</span>
                </div>

                {/* O que este cron faz */}
                <div className="details-section">
                  <h4>O que este cron faz</h4>
                  <p className="details-description">{detailsData.description || detailsJob.description || 'Sem descrição disponível.'}</p>
                </div>

                {/* Agenda */}
                <div className="details-section">
                  <h4>Agenda</h4>
                  <div className="details-schedule-row">
                    <Clock size={14} />
                    <span>Cron: <code>{detailsData.schedule || detailsJob.schedule || 'N/A'}</code></span>
                  </div>
                  <div className="details-schedule-row">
                    <span>Execução: <strong>{formatSchedule(detailsData.schedule || detailsJob.schedule)}</strong></span>
                  </div>
                  {detailsData.next_run && (
                    <div className="details-schedule-row">
                      <Calendar size={14} />
                      <span>Próxima execução: <strong>{formatDateTime(detailsData.next_run)}</strong></span>
                    </div>
                  )}
                </div>

                {/* Estatísticas (todo número com rótulo) */}
                {statEntries.length > 0 && (
                  <div className="details-section">
                    <h4>Estatísticas</h4>
                    <div className="details-stats-grid">
                      {statEntries.map(([key, value]) => (
                        <div key={key} className="stat-card blue">
                          <div>
                            <span className="stat-value">{statValue(key, value)}</span>
                            <span className="stat-label">{statLabel(key)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Faturas vencidas (filtradas por vencimento real) */}
                {overdueInvoices.length > 0 && (
                  <div className="details-section">
                    <h4><AlertTriangle size={14} /> Faturas vencidas ({overdueInvoices.length})</h4>
                    <div className="cron-table-wrap">
                      <table className="cron-table">
                        <thead>
                          <tr>
                            <th>Cliente</th>
                            <th>Grupo</th>
                            <th>Serviço</th>
                            <th>Valor</th>
                            <th>Vencimento</th>
                            <th>Dias de atraso</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overdueInvoices.map(invoice => (
                            <tr key={invoice.id}>
                              <td>
                                <div className="cron-table-user">
                                  <strong>{invoice.user_name || '—'}</strong>
                                  <span>{invoice.user_email || ''}</span>
                                </div>
                              </td>
                              <td>{invoice.group_name || '—'}</td>
                              <td>{invoice.service_name || '—'}</td>
                              <td><strong>{formatCurrency(invoice.amount)}</strong></td>
                              <td>{formatDate(invoice.due_date)}</td>
                              <td>
                                <span className="cron-days-overdue">
                                  {invoice.days_overdue !== undefined && invoice.days_overdue !== null
                                    ? `${invoice.days_overdue} dia(s)`
                                    : '—'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Assinaturas afetadas */}
                {affectedUsers.length > 0 && (
                  <div className="details-section">
                    <h4><Eye size={14} /> Assinaturas afetadas ({affectedUsers.length})</h4>
                    <div className="cron-table-wrap">
                      <table className="cron-table">
                        <thead>
                          <tr>
                            <th>Cliente</th>
                            <th>Grupo</th>
                            <th>Serviço</th>
                            <th>Valor</th>
                            <th>Próxima cobrança</th>
                            <th>Cartão</th>
                            <th>Status</th>
                            <th>Ação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {affectedUsers.map((user, index) => {
                            const subscriptionId = user.subscription_id || user.id;
                            const label = user.user_name || user.user_email || 'assinatura';
                            const status = user.status || user.billing_status || '—';
                            return (
                              <tr key={subscriptionId || index}>
                                <td>
                                  <div className="cron-table-user">
                                    <strong>{user.user_name || '—'}</strong>
                                    <span>{user.user_email || ''}</span>
                                  </div>
                                </td>
                                <td>{user.group_name || '—'}</td>
                                <td>{user.service_name || '—'}</td>
                                <td><strong>{formatCurrency(user.amount)}</strong></td>
                                <td>{formatDate(user.next_charge_at)}</td>
                                <td>
                                  {user.card_last4 ? (
                                    <span className="cron-card-chip"><CreditCard size={12} /> •••• {user.card_last4} {user.card_brand || ''}</span>
                                  ) : user.card_id ? (
                                    <span className="cron-card-chip"><CreditCard size={12} /> cartão salvo</span>
                                  ) : (
                                    <span className="cron-card-unknown">cartão não informado</span>
                                  )}
                                </td>
                                <td>
                                  <span className={`status-badge ${status === 'retrying' ? 'retrying' : status === 'active' ? 'active' : ''}`}>
                                    {status}
                                  </span>
                                </td>
                                <td>
                                  <div className="cron-row-actions">
                                    <button
                                      className="cron-charge-btn"
                                      onClick={() => handleChargeSubscription(subscriptionId, label)}
                                      disabled={chargingRow === subscriptionId || !subscriptionId}
                                      title={subscriptionId ? 'Cobrar agora' : 'Sem assinatura vinculada'}
                                    >
                                      {chargingRow === subscriptionId
                                        ? <><Loader2 size={14} className="spinning" /> Cobrando...</>
                                        : <><Zap size={14} /> Cobrar agora</>}
                                    </button>
                                    <button
                                      className="cron-open-btn"
                                      onClick={() => navigate(`/admin/subscriptions/${subscriptionId}/edit`)}
                                      disabled={!subscriptionId}
                                    >
                                      Abrir assinatura
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Últimas execuções */}
                <div className="details-section">
                  <h4>Últimas execuções</h4>
                  {recentExecutions.length === 0 ? (
                    <p className="details-empty-text">
                      Nenhuma execução registrada para este agendamento — o log só é gravado depois que o job roda.
                    </p>
                  ) : (
                    <div className="details-executions-list">
                      {recentExecutions.map((exec, i) => (
                        <div key={exec.id || i} className={`execution-row ${String(exec.action || '').includes('success') ? 'success' : String(exec.action || '').includes('failed') ? 'failed' : 'neutral'}`}>
                          <div className="exec-indicator" />
                          <div className="exec-info">
                            <span className="exec-action">{exec.action}</span>
                            <span className="exec-time">{formatDateTime(exec.created_at)}</span>
                          </div>
                          {exec.details && (
                            <span className="exec-details">
                              {exec.details.amount ? `R$ ${parseFloat(exec.details.amount).toFixed(2)}` : ''}
                              {exec.details.error ? ` - ${exec.details.error}` : ''}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {affectedUsers.length === 0 && overdueInvoices.length === 0 && recentExecutions.length === 0 && statEntries.length === 0 && (
                  <div className="details-empty">
                    <CheckCircle size={20} />
                    <span>Nenhuma atividade registrada para este cron.</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}

export default CronManagement;
