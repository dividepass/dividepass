import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Mail,
  MailCheck,
  Play,
  RefreshCw,
  Save,
  Search,
  Send,
  XCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './EmailManagement.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/** Eventos de e-mail do funil do cliente (espelha `user-emails.ts`). */
const EVENT_TYPES = [
  { value: 'welcome', label: 'Boas-vindas', hint: 'Cadastro na plataforma' },
  { value: 'subscription_created', label: 'Assinatura confirmada', hint: 'Pagamento aprovado' },
  { value: 'renewal_reminder', label: 'Lembrete de renovação', hint: 'Vence em breve' },
  { value: 'overdue_notice', label: 'Assinatura atrasada', hint: 'Dentro da carência' },
  { value: 'payment_failed', label: 'Cobrança recusada', hint: 'Cartão não autorizado' },
  { value: 'subscription_cancelled', label: 'Assinatura cancelada', hint: 'Fim da carência' },
  { value: 'admin_payment_notification', label: 'Aviso ao admin', hint: 'Pagamento recebido' },
];

const STATUS_LABELS = {
  sent: { label: 'Enviado', tone: 'success', Icon: CheckCircle2 },
  sending: { label: 'Enviando', tone: 'info', Icon: Clock },
  failed: { label: 'Falhou', tone: 'error', Icon: XCircle },
  skipped: { label: 'Ignorado', tone: 'muted', Icon: AlertTriangle },
};

const PAGE_SIZE = 25;

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

/** Janela de tempo legível ("há 2 dias"). */
function formatRelative(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
  return `há ${Math.floor(days / 30)} meses`;
}

function eventLabel(value) {
  return EVENT_TYPES.find((e) => e.value === value)?.label || value;
}

export default function EmailManagement() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ sent: 0, failed: 0, today: 0, byType: {} });

  const [settings, setSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState(null);

  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState(null);

  /* ---------------------------------------------------------------------
     CONFIGURAÇÃO
     --------------------------------------------------------------------- */
  const loadSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('key, value')
        .like('key', 'email_%');

      if (error) throw error;

      const map = {};
      (data || []).forEach((row) => {
        map[row.key] = row.value;
      });

      const on = (key, fallback = true) => {
        const raw = String(map[key] ?? '').trim().toLowerCase();
        if (raw === '') return fallback;
        return !['false', '0', 'off', 'no', 'nao', 'não'].includes(raw);
      };

      setSettings({
        welcome: on('email_welcome_enabled'),
        subscription: on('email_subscription_enabled'),
        renewalReminder: on('email_renewal_reminder_enabled'),
        overdue: on('email_overdue_enabled'),
        paymentFailed: on('email_payment_failed_enabled'),
        cancelled: on('email_cancelled_enabled'),
        reminderDays: parseInt(map.email_renewal_reminder_days ?? '3', 10) || 3,
        overdueRepeatDays: parseInt(map.email_overdue_repeat_days ?? '3', 10) || 0,
      });
    } catch (err) {
      console.error('Erro ao carregar configurações de e-mail:', err);
    }
  }, []);

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsMsg(null);
    try {
      const updates = [
        { key: 'email_welcome_enabled', value: settings.welcome ? 'true' : 'false' },
        { key: 'email_subscription_enabled', value: settings.subscription ? 'true' : 'false' },
        { key: 'email_renewal_reminder_enabled', value: settings.renewalReminder ? 'true' : 'false' },
        { key: 'email_overdue_enabled', value: settings.overdue ? 'true' : 'false' },
        { key: 'email_payment_failed_enabled', value: settings.paymentFailed ? 'true' : 'false' },
        { key: 'email_cancelled_enabled', value: settings.cancelled ? 'true' : 'false' },
        { key: 'email_renewal_reminder_days', value: String(settings.reminderDays) },
        { key: 'email_overdue_repeat_days', value: String(settings.overdueRepeatDays) },
      ];

      const { error } = await supabase
        .from('app_settings')
        .upsert(updates, { onConflict: 'key' });

      if (error) throw error;

      setSettingsMsg({ type: 'success', text: 'Configurações salvas.' });
    } catch (err) {
      setSettingsMsg({
        type: 'error',
        text: `Não foi possível salvar: ${err.message}`,
      });
    } finally {
      setSavingSettings(false);
    }
  };

  /* ---------------------------------------------------------------------
     TRILHA
     --------------------------------------------------------------------- */
  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('email_logs')
        .select('id, event_type, "to", subject, status, error, created_at, dedup_key, raw_event', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (filterType !== 'all') query = query.eq('event_type', filterType);
      if (filterStatus !== 'all') query = query.eq('status', filterStatus);
      if (search.trim()) {
        const term = search.trim().toLowerCase();
        query = query.or(`"to".ilike.%${term}%,subject.ilike.%${term}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      setLogs(data || []);
      setTotal(count || 0);
    } catch (err) {
      console.error('Erro ao carregar a trilha de e-mail:', err);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, filterType, filterStatus, search]);

  const loadStats = useCallback(async () => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const [totalRes, failedRes, todayRes, recentRes] = await Promise.all([
        supabase.from('email_logs').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
        supabase.from('email_logs').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
        supabase
          .from('email_logs')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'sent')
          .gte('created_at', startOfDay.toISOString()),
        supabase.from('email_logs').select('event_type').gte('created_at', startOfDay.toISOString()),
      ]);

      const byType = {};
      (recentRes.data || []).forEach((row) => {
        byType[row.event_type] = (byType[row.event_type] || 0) + 1;
      });

      setStats({
        sent: totalRes.count || 0,
        failed: failedRes.count || 0,
        today: todayRes.count || 0,
        byType,
      });
    } catch (err) {
      console.error('Erro ao carregar as estatísticas de e-mail:', err);
    }
  }, []);

  /* ---------------------------------------------------------------------
     EXECUTAR O JOB AGORA
     --------------------------------------------------------------------- */
  const runJobNow = async () => {
    setRunning(true);
    setRunMsg(null);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session) {
        throw new Error('Sessão do admin não encontrada. Faça login novamente.');
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/manage-crons`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'run_now', jobname: 'send-lifecycle-emails' }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.response || data?.error || `Falha na execução (${response.status})`);
      }

      let parsed = null;
      if (typeof data?.response === 'string') {
        try { parsed = JSON.parse(data.response); } catch { parsed = null; }
      }

      const summary = parsed || data;
      const total =
        (summary?.welcome?.sent || 0) +
        (summary?.renewal_reminder?.sent || 0) +
        (summary?.overdue_notice?.sent || 0);

      setRunMsg({
        type: 'success',
        text: `Job executado. ${total} e-mail(s) enviado(s) nesta rodada.`,
      });

      loadLogs();
      loadStats();
    } catch (err) {
      setRunMsg({ type: 'error', text: err.message });
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    // A carga inicial acontece dentro de uma tarefa assíncrona: o efeito
    // apenas agenda a busca, e o estado é atualizado quando ela termina.
    let alive = true;

    (async () => {
      await loadSettings();
      if (alive) await loadStats();
    })();

    return () => {
      alive = false;
    };
  }, [loadSettings, loadStats]);

  useEffect(() => {
    const timer = setTimeout(loadLogs, search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [loadLogs, search]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const cards = useMemo(
    () => [
      { label: 'Enviados no total', value: stats.sent, Icon: MailCheck, tone: 'success' },
      { label: 'Enviados hoje', value: stats.today, Icon: Send, tone: 'primary' },
      { label: 'Falhas', value: stats.failed, Icon: XCircle, tone: stats.failed > 0 ? 'error' : 'muted' },
    ],
    [stats],
  );

  return (
    <div className="email-admin-page">
      <header className="email-admin-header">
        <div>
          <h1>Gestão de e-mail</h1>
          <p className="page-subtitle">
            Os e-mails que saem sozinhos: boas-vindas, assinatura confirmada,
            lembrete de renovação e aviso de atraso.
          </p>
        </div>
        <div className="email-admin-header-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={runJobNow}
            disabled={running}
          >
            {running ? <RefreshCw size={15} className="spin" /> : <Play size={15} />}
            {running ? 'Executando...' : 'Executar job agora'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => { loadLogs(); loadStats(); }}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Atualizar
          </button>
        </div>
      </header>

      {runMsg && (
        <div className={`email-alert is-${runMsg.type}`}>
          {runMsg.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{runMsg.text}</span>
          <button type="button" onClick={() => setRunMsg(null)} aria-label="Fechar">
            ×
          </button>
        </div>
      )}

      <section className="email-stat-grid">
        {cards.map((card) => (
          <div className="email-stat-card" key={card.label}>
            <span className={`email-stat-icon is-${card.tone}`}>
              <card.Icon size={18} />
            </span>
            <div>
              <strong>{card.value.toLocaleString('pt-BR')}</strong>
              <span>{card.label}</span>
            </div>
          </div>
        ))}
      </section>

      {settings && (
        <section className="email-panel">
          <div className="email-panel-head">
            <div>
              <h2>Quando enviar</h2>
              <p>Cada tipo de e-mail pode ser ligado ou desligado sem novo deploy.</p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveSettings}
              disabled={savingSettings}
            >
              <Save size={15} />
              {savingSettings ? 'Salvando...' : 'Salvar'}
            </button>
          </div>

          {settingsMsg && (
            <div className={`email-alert is-${settingsMsg.type}`}>
              {settingsMsg.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <span>{settingsMsg.text}</span>
            </div>
          )}

          <div className="email-toggle-list">
            <label className="email-toggle">
              <input
                type="checkbox"
                checked={settings.welcome}
                onChange={(e) => setSettings({ ...settings, welcome: e.target.checked })}
              />
              <span className="email-toggle-body">
                <strong>Boas-vindas</strong>
                <em>Enviado no primeiro login de quem acabou de se cadastrar.</em>
              </span>
            </label>

            <label className="email-toggle">
              <input
                type="checkbox"
                checked={settings.subscription}
                onChange={(e) => setSettings({ ...settings, subscription: e.target.checked })}
              />
              <span className="email-toggle-body">
                <strong>Assinatura confirmada</strong>
                <em>Enviado quando o pagamento da assinatura é aprovado.</em>
              </span>
            </label>

            <label className="email-toggle">
              <input
                type="checkbox"
                checked={settings.renewalReminder}
                onChange={(e) => setSettings({ ...settings, renewalReminder: e.target.checked })}
              />
              <span className="email-toggle-body">
                <strong>Lembrete de renovação</strong>
                <em>Aviso antes da assinatura vencer, com o botão de renovar.</em>
              </span>
            </label>

            <label className="email-toggle">
              <input
                type="checkbox"
                checked={settings.overdue}
                onChange={(e) => setSettings({ ...settings, overdue: e.target.checked })}
              />
              <span className="email-toggle-body">
                <strong>Assinatura atrasada</strong>
                <em>Aviso no primeiro dia de atraso e uma repetição no meio da carência.</em>
              </span>
            </label>

            <label className="email-toggle">
              <input
                type="checkbox"
                checked={settings.paymentFailed}
                onChange={(e) => setSettings({ ...settings, paymentFailed: e.target.checked })}
              />
              <span className="email-toggle-body">
                <strong>Cobrança recusada</strong>
                <em>Aviso quando o cartão não autoriza e haverá nova tentativa.</em>
              </span>
            </label>

            <label className="email-toggle">
              <input
                type="checkbox"
                checked={settings.cancelled}
                onChange={(e) => setSettings({ ...settings, cancelled: e.target.checked })}
              />
              <span className="email-toggle-body">
                <strong>Assinatura cancelada</strong>
                <em>Aviso quando a carência acaba e o acesso é encerrado.</em>
              </span>
            </label>
          </div>

          <div className="email-number-grid">
            <label className="email-number-field">
              <span>Dias de antecedência do lembrete</span>
              <input
                type="number"
                min="1"
                max="30"
                value={settings.reminderDays}
                onChange={(e) =>
                  setSettings({ ...settings, reminderDays: e.target.value })
                }
              />
              <em>O e-mail sai quantos dias antes do vencimento.</em>
            </label>

            <label className="email-number-field">
              <span>Dia da repetição do aviso de atraso</span>
              <input
                type="number"
                min="0"
                max="7"
                value={settings.overdueRepeatDays}
                onChange={(e) =>
                  setSettings({ ...settings, overdueRepeatDays: e.target.value })
                }
              />
              <em>0 desliga a repetição. A carência total é de 7 dias.</em>
            </label>
          </div>
        </section>
      )}

      <section className="email-panel">
        <div className="email-panel-head">
          <div>
            <h2>Trilha de envios</h2>
            <p>Todo e-mail que saiu, com o motivo da falha quando houve.</p>
          </div>
        </div>

        <div className="email-filters">
          <div className="email-search">
            <Search size={15} />
            <input
              type="search"
              placeholder="Buscar por e-mail ou assunto..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            />
          </div>

          <select
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value); setPage(0); }}
            aria-label="Filtrar por tipo"
          >
            <option value="all">Todos os tipos</option>
            {EVENT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }}
            aria-label="Filtrar por situação"
          >
            <option value="all">Todas as situações</option>
            <option value="sent">Enviado</option>
            <option value="failed">Falhou</option>
            <option value="sending">Enviando</option>
          </select>
        </div>

        {loading ? (
          <div className="email-empty">Carregando...</div>
        ) : logs.length === 0 ? (
          <div className="email-empty">
            <Mail size={28} />
            <strong>Nenhum e-mail registrado ainda</strong>
            <span>
              A trilha começa a aparecer assim que o primeiro e-mail automático
              for enviado.
            </span>
          </div>
        ) : (
          <div className="email-table-wrap">
            <table className="email-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Tipo</th>
                  <th>Destinatário</th>
                  <th>Assunto</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const status = STATUS_LABELS[log.status] || {
                    label: log.status || '—',
                    tone: 'muted',
                    Icon: Mail,
                  };
                  return (
                    <tr key={log.id}>
                      <td className="email-cell-when">
                        <strong>{formatDateTime(log.created_at)}</strong>
                        <span>{formatRelative(log.created_at)}</span>
                      </td>
                      <td>
                        <span className="email-chip">{eventLabel(log.event_type)}</span>
                      </td>
                      <td className="email-cell-to">{log.to || '—'}</td>
                      <td className="email-cell-subject">
                        {log.subject || '—'}
                        {log.error && (
                          <em className="email-cell-error">{log.error}</em>
                        )}
                      </td>
                      <td>
                        <span className={`email-status is-${status.tone}`}>
                          <status.Icon size={13} />
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="email-pagination">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Anterior
            </button>
            <span>Página {page + 1} de {totalPages}</span>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Próxima
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
