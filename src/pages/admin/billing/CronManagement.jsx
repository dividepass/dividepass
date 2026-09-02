import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { Link } from 'react-router-dom';
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
  Trash2,
  Zap,
  Eye,
  Users,
  CreditCard,
  AlertCircle,
  X,
  ChevronRight,
} from 'lucide-react';
import './CronManagement.css';

function CronManagement() {
  const [loading, setLoading] = useState(true);
  const [crons, setCrons] = useState([]);
  const [runningId, setRunningId] = useState(null);
  const [showScheduler, setShowScheduler] = useState(false);
  const [detailsJob, setDetailsJob] = useState(null);
  const [detailsData, setDetailsData] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Scheduler states
  const [emailSearch, setEmailSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userSubs, setUserSubs] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [form, setForm] = useState({
    subscription_id: '',
    charge_date: '',
    amount: '',
    reason: '',
  });
  const [result, setResult] = useState(null);

  const fetchCrons = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-crons`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'list' }),
      });
      const data = await resp.json();
      setCrons(data.crons || []);
    } catch (e) {
      console.error('Error fetching crons:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCrons(); }, [fetchCrons]);

  const handleToggle = async (jobid, currentActive) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-crons`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'toggle', jobid, active: !currentActive }),
      });
      const data = await resp.json();
      if (data.needsManual) {
        alert(data.message);
      } else {
        fetchCrons();
      }
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  };

  const handleRunNow = async (jobname) => {
    setRunningId(jobname);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-crons`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'run_now', jobname }),
      });
      const data = await resp.json();
      if (data.success) {
        alert(`${jobname} executado com sucesso!\n${data.response?.substring(0, 500) || ''}`);
      } else {
        alert(`Erro ao executar: ${data.response || data.error || 'Desconhecido'}`);
      }
    } catch (e) {
      alert('Erro: ' + e.message);
    }
    setRunningId(null);
  };

  const openScheduler = () => {
    setShowScheduler(true);
    setEmailSearch('');
    setSearchResults([]);
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
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-crons`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'cron_details', jobname: cron.jobname }),
      });
      const data = await resp.json();
      setDetailsData(data.details || {});
    } catch (e) {
      console.error('Error fetching details:', e);
      setDetailsData({ error: e.message });
    }
    setLoadingDetails(false);
  };

  const handleSearchEmail = async () => {
    if (!emailSearch || emailSearch.length < 3) return;
    setSearching(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/schedule-billing`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'search_user', email: emailSearch }),
      });
      const rawText = await resp.text();
      console.log('Search raw response:', resp.status, rawText);
      let data;
      try { data = JSON.parse(rawText); } catch { data = { error: rawText }; }

      if (!resp.ok) {
        console.error('Search failed:', resp.status, data);
        setSearchResults([]);
        return;
      }
      setSearchResults(data.users || []);
    } catch (e) {
      console.error('Search error:', e);
      setSearchResults([]);
    }
    setSearching(false);
  };

  const handleSelectUser = async (user) => {
    setSelectedUser(user);
    setSearchResults([]);
    setEmailSearch(user.email);
    setLoadingSubs(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/schedule-billing`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'list_subscriptions', user_id: user.id }),
      });
      const data = await resp.json();
      setUserSubs(data.subscriptions || []);
    } catch (e) {
      console.error('Error fetching subs:', e);
    }
    setLoadingSubs(false);
  };

  const handleSchedule = async (e) => {
    e.preventDefault();
    if (!form.subscription_id || !form.charge_date) {
      alert('Selecione a assinatura e a data de cobrança.');
      return;
    }
    setScheduling(true);
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/schedule-billing`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'schedule',
          subscription_id: form.subscription_id,
          charge_date: form.charge_date,
          amount: form.amount ? parseFloat(form.amount) : undefined,
          reason: form.reason || undefined,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setResult({ type: 'success', data });
        setForm({ subscription_id: '', charge_date: '', amount: '', reason: '' });
        setSelectedUser(null);
        setUserSubs([]);
        setEmailSearch('');
      } else {
        setResult({ type: 'error', message: data.error });
      }
    } catch (e) {
      setResult({ type: 'error', message: e.message });
    }
    setScheduling(false);
  };

  const formatSchedule = (schedule) => {
    if (!schedule) return 'N/A';
    const parts = schedule.split(' ');
    if (parts.length === 5) {
      const [min, hour, dom, month, dow] = parts;
      if (dom === '*' && month === '*') {
        return `Todo dia às ${hour.padStart(2, '0')}:${min.padStart(2, '0')} (BRT)`;
      }
    }
    return schedule;
  };

  return (
    <div className="cron-management-page">
      <div className="admin-header">
        <h1><Clock size={24} /> Gerenciamento de Crons</h1>
        <p>Visualize, ative/desative e execute processos agendados</p>
      </div>

      <div className="billing-nav-links">
        <Link to="/admin/billing" className="billing-nav">Dashboard</Link>
        <Link to="/admin/subscriptions" className="billing-nav">Assinaturas SaaS</Link>
        <Link to="/admin/wallets" className="billing-nav">Carteiras</Link>
        <Link to="/admin/billing/calendar" className="billing-nav">Calendário</Link>
        <Link to="/admin/billing/failures" className="billing-nav">Falhas</Link>
        <Link to="/admin/billing/crons" className="billing-nav active">Crons</Link>
      </div>

      <div className="cron-actions-bar">
        <button className="cron-refresh-btn" onClick={fetchCrons} disabled={loading}>
          <RotateCcw size={16} className={loading ? 'spinning' : ''} />
          Atualizar
        </button>
        <button className="cron-schedule-btn" onClick={openScheduler}>
          <Plus size={16} />
          Agendar Cobrança Manual
        </button>
      </div>

      {loading ? (
        <div className="cron-loading">Carregando crons...</div>
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
                    <span>Próxima execução: {new Date(cron.next_run).toLocaleString('pt-BR')}</span>
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
              <button onClick={() => setShowScheduler(false)} className="close-btn">&times;</button>
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

                  {emailSearch.length >= 3 && !searching && searchResults.length === 0 && (
                    <p className="search-empty">Nenhum cliente encontrado com este email.</p>
                  )}
                </div>
              )}

              {/* Step 2: Cliente selecionado */}
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
                            <span className="sub-amount">R$ {parseFloat(sub.amount).toFixed(2)}</span>
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
                    <label>Data de Cobrança</label>
                    <input
                      type="date"
                      value={form.charge_date}
                      onChange={e => setForm({ ...form, charge_date: e.target.value })}
                      min={new Date().toISOString().split('T')[0]}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Valor (opcional - padrão: valor da assinatura)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Ex: 39.90"
                      value={form.amount}
                      onChange={e => setForm({ ...form, amount: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label>Motivo (opcional)</label>
                    <input
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
                      <p>{result.data.user_name} - {result.data.service_name} - R$ {parseFloat(result.data.amount).toFixed(2)}</p>
                      <p>Data: {new Date(result.data.charge_date).toLocaleDateString('pt-BR')}</p>
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
              <button onClick={() => { setDetailsJob(null); setDetailsData(null); }} className="close-btn">&times;</button>
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
                    <span>Cron: <code>{detailsJob.schedule || 'N/A'}</code></span>
                  </div>
                  <div className="details-schedule-row">
                    <span>Execução: <strong>{formatSchedule(detailsJob.schedule)}</strong></span>
                  </div>
                  {detailsData.next_run && (
                    <div className="details-schedule-row">
                      <Calendar size={14} />
                      <span>Próxima execução: <strong>{new Date(detailsData.next_run).toLocaleString('pt-BR')}</strong></span>
                    </div>
                  )}
                </div>

                {/* Estatísticas */}
                {detailsData.stats && Object.keys(detailsData.stats).length > 0 && (
                  <div className="details-section">
                    <h4>Estatísticas</h4>
                    <div className="details-stats-grid">
                      {detailsJob.jobname === 'process-recurring-billing' && (
                        <>
                          <div className="stat-card green">
                            <CreditCard size={16} />
                            <div>
                              <span className="stat-value">{detailsData.stats.total_with_card || 0}</span>
                              <span className="stat-label">Com cartão</span>
                            </div>
                          </div>
                          <div className="stat-card red">
                            <AlertCircle size={16} />
                            <div>
                              <span className="stat-value">{detailsData.stats.total_without_card || 0}</span>
                              <span className="stat-label">Sem cartão</span>
                            </div>
                          </div>
                          <div className="stat-card blue">
                            <Clock size={16} />
                            <div>
                              <span className="stat-value">{detailsData.stats.upcoming_charges || 0}</span>
                              <span className="stat-label">Próximas cobranças</span>
                            </div>
                          </div>
                          <div className="stat-card orange">
                            <RotateCcw size={16} />
                            <div>
                              <span className="stat-value">{detailsData.stats.retrying || 0}</span>
                              <span className="stat-label">Em retry</span>
                            </div>
                          </div>
                          <div className="stat-card purple">
                            <span className="stat-value">R$ {(detailsData.stats.total_upcoming_amount || 0).toFixed(2)}</span>
                            <span className="stat-label">Valor a cobrar</span>
                          </div>
                        </>
                      )}
                      {detailsJob.jobname === 'update-subscription-statuses' && (
                        <>
                          <div className="stat-card blue">
                            <span className="stat-value">{detailsData.stats.pending || 0}</span>
                            <span className="stat-label">Pendentes</span>
                          </div>
                          <div className="stat-card orange">
                            <span className="stat-value">{detailsData.stats.first_attempt || 0}</span>
                            <span className="stat-label">Primeira tentativa</span>
                          </div>
                          <div className="stat-card red">
                            <span className="stat-value">{detailsData.stats.overdue || 0}</span>
                            <span className="stat-label">Atrasadas</span>
                          </div>
                        </>
                      )}
                      {detailsJob.jobname === 'process-overdue-invoices' && (
                        <div className="stat-card red">
                          <span className="stat-value">{detailsData.stats.overdue_invoices || 0}</span>
                          <span className="stat-label">Faturas vencidas</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Usuários afetados */}
                {detailsData.affected_users && detailsData.affected_users.length > 0 && (
                  <div className="details-section">
                    <h4><Users size={14} /> Usuários afetados ({detailsData.affected_users.length})</h4>
                    <div className="details-users-list">
                      {detailsData.affected_users.map((u, i) => (
                        <div key={u.id || i} className={`details-user-row ${u.billing_status === 'retrying' ? 'retrying' : ''}`}>
                          <div className="user-row-info">
                            <strong>{u.user_name || 'Sem nome'}</strong>
                            <span>{u.user_email}</span>
                          </div>
                          <div className="user-row-details">
                            <span className="user-service">{u.service_name || 'Serviço'}</span>
                            <span className="user-group">{u.group_name || 'Grupo'}</span>
                          </div>
                          <div className="user-row-amount">
                            <span>R$ {(u.amount || 0).toFixed(2)}</span>
                            {u.next_charge_at && (
                              <span className="user-next-charge">
                                {new Date(u.next_charge_at).toLocaleDateString('pt-BR')}
                              </span>
                            )}
                          </div>
                          <div className="user-row-status">
                            {u.billing_status === 'retrying' ? (
                              <span className="status-badge retrying">Retry #{u.retry_count}</span>
                            ) : u.billing_status === 'active' ? (
                              <span className="status-badge active">Ativo</span>
                            ) : (
                              <span className="status-badge">{u.billing_status || 'N/A'}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Últimas execuções */}
                {detailsData.recent_executions && detailsData.recent_executions.length > 0 && (
                  <div className="details-section">
                    <h4>Últimas execuções</h4>
                    <div className="details-executions-list">
                      {detailsData.recent_executions.map((exec, i) => (
                        <div key={exec.id || i} className={`execution-row ${exec.action.includes('success') ? 'success' : exec.action.includes('failed') ? 'failed' : 'neutral'}`}>
                          <div className="exec-indicator" />
                          <div className="exec-info">
                            <span className="exec-action">{exec.action}</span>
                            <span className="exec-time">{new Date(exec.created_at).toLocaleString('pt-BR')}</span>
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
                  </div>
                )}

                {(!detailsData.affected_users || detailsData.affected_users.length === 0) && (!detailsData.recent_executions || detailsData.recent_executions.length === 0) && (
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
    </div>
  );
}

export default CronManagement;
