import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Save, Lock, Mail, Phone, User, Shield,
  CreditCard, FileText, Clock, Calendar, AlertTriangle, CheckCircle,
  RefreshCw, Plus, XCircle, Timer, Zap, Edit2, ClipboardList, Activity,
  ExternalLink, MapPin, Share2, UserPlus, Users, Layers, MessageCircle,
  LogIn
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { maskPhone, onlyDigits, phoneToNational, phoneToWhatsApp } from '../../lib/maskPhone';
import { ONBOARDING_STEPS, labelForValue } from '../../lib/onboardingQuestions';
import { buildServiceLookup, groupPlatformsByCategory } from '../../lib/onboardingPlatforms';
import EventLog from './EventLog';
import './UserDetail.css';
/* A aba de qualificação usa a mesma linguagem visual do relatório — por
   isso o CSS dele entra junto (a ficha é aberta direto, sem passar pela
   página do relatório). */
import './OnboardingReport.css';

const ROLE_OPTIONS = [
  { value: 'user', label: 'Usuário' },
  { value: 'admin', label: 'Administrador' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Ativo' },
  { value: 'inactive', label: 'Inativo' },
  { value: 'pending', label: 'Pendente' },
  { value: 'suspended', label: 'Suspenso' },
];

/* As abas da ficha. O `id` de cada uma vira o parâmetro `?tab=` da URL —
   assim o operador sempre sabe onde está e pode mandar o link já na aba
   certa (inclusive para o log de eventos). */
const USER_TABS = [
  { id: 'details', label: 'Detalhes e Edição', icon: User },
  { id: 'subscriptions', label: 'Assinaturas', icon: Shield },
  { id: 'invoices', label: 'Faturas', icon: FileText },
  { id: 'payments', label: 'Pagamentos', icon: CreditCard },
  { id: 'crons', label: 'Crons', icon: Clock },
  { id: 'onboarding', label: 'Qualificação', icon: ClipboardList },
  { id: 'events', label: 'Logs de Eventos', icon: Activity },
];

function UserDetail() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  /* `user` aqui é o CLIENTE da ficha. O admin logado vem do contexto —
     precisa de outro nome para não confundir as duas coisas. */
  const { user: adminUser, startImpersonation } = useAuth();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({});
  const [newPassword, setNewPassword] = useState('');
  const [impersonating, setImpersonating] = useState(false);

  /* A aba vive na URL (`?tab=events`), não em estado escondido — quem abre
     o link chega direto na aba pedida. */
  const tabParam = searchParams.get('tab');
  const activeTab = USER_TABS.some(t => t.id === tabParam) ? tabParam : 'details';
  const setActiveTab = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id === 'details') next.delete('tab');
    else next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  const [subscriptions, setSubscriptions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);

  const [userCrons, setUserCrons] = useState(null);
  const [loadingCrons, setLoadingCrons] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    subscription_id: '',
    charge_date: new Date().toISOString().split('T')[0],
    amount: '',
    notes: '',
  });
  const [scheduling, setScheduling] = useState(false);
  const [editingBC, setEditingBC] = useState(null);
  const [editBCForm, setEditBCForm] = useState({ charge_date: '', amount: '' });
  const [savingBC, setSavingBC] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [savingCard, setSavingCard] = useState(false);
  const [iopayCards, setIopayCards] = useState({});

  useEffect(() => {
    let cancelled = false;

    const fetchUser = async () => {
      if (!cancelled) {
        setLoading(true);
        setError('');
      }
      try {
        const { data, error: supabaseError } = await supabase
          .from('users')
          .select('id, name, email, phone, nickname, avatar_url, birthdate, role, status, email_verified, last_login_at, created_at, updated_at, pwa_installed_at, push_notifications_enabled_at, onboarding_completed_at, onboarding_step, onboarding_started_at')
          .eq('id', userId)
          .single();

        if (supabaseError) throw supabaseError;

        // Campos sensiveis (cpf, ids de gateway, dados de marketing) foram
        // revogados para `authenticated` — o admin os le por uma funcao
        // SECURITY DEFINER que so responde para admin.
        let user = data;
        try {
          const { data: priv } = await supabase.rpc('admin_get_user_private', { p_user_id: userId });
          if (priv && priv.length > 0) user = { ...data, ...priv[0] };
        } catch (e) {
          console.warn('[UserDetail] campos privados indisponíveis:', e?.message);
        }

        if (!cancelled) {
          setUser(user);
          setForm(user);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const fetchHistory = async () => {
      try {
        const [subsRes, invoicesRes, paymentsRes] = await Promise.all([
          supabase.from('user_subscriptions')
            .select('*, service:service_id(name, full_name), group:group_id(name)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false }),
          supabase.from('invoices')
            .select('*')
            .eq('user_id', userId)
            .order('due_date', { ascending: false }),
          supabase.from('payments')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false }),
        ]);

        if (subsRes.error) throw subsRes.error;
        if (invoicesRes.error) throw invoicesRes.error;
        if (paymentsRes.error) throw paymentsRes.error;

        if (!cancelled) {
          setSubscriptions(subsRes.data || []);
          setInvoices(invoicesRes.data || []);
          setPayments(paymentsRes.data || []);
        }
      } catch (err) {
        console.error('Erro ao carregar histórico:', err);
      }
    };

    fetchUser();
    fetchHistory();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const fetchUserCrons = async () => {
    setLoadingCrons(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Sessão expirada');

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-crons`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: 'user_crons', user_id: userId }),
        }
      );
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Erro ${resp.status}: ${errText}`);
      }
      const result = await resp.json();
      setUserCrons(result);
    } catch (err) {
      console.error('Erro ao carregar crons:', err);
    } finally {
      setLoadingCrons(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'crons' && !userCrons) {
      fetchUserCrons();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userId]);

  const handleScheduleCharge = async (e) => {
    e.preventDefault();
    setScheduling(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Sessão expirada');

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-crons`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            action: 'schedule_user_charge',
            user_id: userId,
            subscription_id: scheduleForm.subscription_id,
            charge_date: scheduleForm.charge_date,
            amount: scheduleForm.amount ? parseFloat(scheduleForm.amount) : undefined,
            notes: scheduleForm.notes || undefined,
          }),
        }
      );
      const result = await resp.json();
      if (result.error) throw new Error(result.error);

      setShowScheduleModal(false);
      setScheduleForm({ subscription_id: '', charge_date: new Date().toISOString().split('T')[0], amount: '', notes: '' });
      setUserCrons(null);
      fetchUserCrons();
      alert('Cobrança agendada com sucesso!');
    } catch (err) {
      alert('Erro ao agendar: ' + err.message);
    } finally {
      setScheduling(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const startEditBC = (bc) => {
    setEditingBC(bc.id);
    setEditBCForm({ charge_date: bc.charge_date?.split('T')[0] || '', amount: String(bc.amount || '') });
  };

  const saveEditBC = async (bcId) => {
    setSavingBC(true);
    try {
      const { error } = await supabase
        .from('billing_cycles')
        .update({
          charge_date: editBCForm.charge_date,
          amount: editBCForm.amount ? parseFloat(editBCForm.amount) : undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bcId);
      if (error) throw error;
      setEditingBC(null);
      setUserCrons(null);
      fetchUserCrons();
    } catch (err) {
      alert('Erro ao salvar ciclo: ' + err.message);
    } finally {
      setSavingBC(false);
    }
  };

  const fetchIopayCards = async (targetUserId) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Sessão expirada');

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-iopay-cards`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ user_id: targetUserId }),
        }
      );
      const result = await resp.json();
      setIopayCards(prev => ({ ...prev, [targetUserId]: result.cards || [] }));
      return result.cards || [];
    } catch (err) {
      console.error('Erro ao buscar cartões IOPay:', err);
      return [];
    }
  };

  const handleCardSelect = async (subId, targetUserId, cardId) => {
    if (!cardId) return;
    setSavingCard(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      const cards = iopayCards[targetUserId] || [];
      const selectedCard = cards.find(c => (c.id_card || c.id) === cardId);

      await supabase
        .from('user_subscriptions')
        .update({
          card_id: cardId,
          card_last4: selectedCard?.last4_digits || selectedCard?.last4 || null,
          card_brand: selectedCard?.card_brand || selectedCard?.brand || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', subId);

      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-iopay-cards`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ user_id: targetUserId, action: 'set_default', id_card: cardId }),
        }
      );

      setEditingCard(null);
      setUserCrons(null);
      fetchUserCrons();
    } catch (err) {
      alert('Erro ao definir cartão: ' + err.message);
    } finally {
      setSavingCard(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw new Error('Sessão expirada');
      }

      const payload = {
        user_id: userId,
        name: form.name,
        email: form.email,
        phone: onlyDigits(form.phone) || null,
        cpf: form.cpf,
        role: form.role,
        status: form.status,
      };

      if (newPassword.trim()) {
        payload.password = newPassword.trim();
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-update-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Erro ao atualizar usuário');
      }

      setNewPassword('');
      alert('Usuário atualizado com sucesso.');
      window.location.reload();
    } catch (err) {
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * IMPERSONAÇÃO: entra na conta do cliente sem saber a senha dele.
   *
   * O que acontece por baixo dos panos:
   *  - a edge `admin-impersonate` (que roda com SERVICE_ROLE_KEY) gera um
   *    token magiclink de uso único para o e-mail do cliente. Nenhum e-mail
   *    é enviado e a senha do cliente não é lida nem alterada;
   *  - a sessão do admin é guardada em sessionStorage ANTES da troca;
   *  - o navegador troca a sessão para a do cliente (verifyOtp).
   *
   * Para voltar ao painel: o banner que aparece no rodapé da tela devolve
   * a sessão do admin.
   */
  const handleImpersonate = async () => {
    if (impersonating || !user) return;

    const confirmado = window.confirm(
      `Você vai entrar na conta de ${user.name || user.email}.\n\n` +
      'A senha dele NÃO é lida nem alterada.\n' +
      'Para voltar ao painel, use o botão "Voltar ao painel admin" que aparece na tela.'
    );
    if (!confirmado) return;

    setImpersonating(true);
    try {
      await startImpersonation({
        userId: user.id,
        targetName: user.name,
        targetEmail: user.email,
      });

      /* Navegação dura: o app sobe limpo com a sessão do cliente — nada do
         painel admin (cache de dados, abas) fica na tela. */
      window.location.assign('/dashboard');
    } catch (err) {
      console.error('[UserDetail] falha na impersonação:', err);
      alert('Não foi possível entrar na conta do usuário: ' + err.message);
      setImpersonating(false);
    }
  };

  const statusBadge = (status) => {
    const labels = {
      active: 'Ativa', inactive: 'Inativa', cancelled: 'Cancelada',
      expired: 'Expirada', pending: 'Pendente',
      paid: 'Pago', failed: 'Falhou', refunded: 'Reembolsado',
      retrying: 'Retry', approved: 'Aprovado', overdue: 'Atrasado',
      first_attempt: '1ª Tentativa',
    };
    return labels[status] || status;
  };

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando usuário...</p>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="fade-in">
        <Link to="/admin/users" className="back-btn">
          <ArrowLeft size={18} />
          Voltar
        </Link>
        <div className="error-banner">Erro ao carregar usuário: {error}</div>
      </div>
    );
  }

  return (
    <div className="fade-in user-detail-page">
      <div className="user-detail-header">
        <Link to="/admin/users" className="back-btn">
          <ArrowLeft size={18} />
          Voltar
        </Link>
        <div className="admin-header">
          <div>
            <h1>{user.name}</h1>
            <p className="page-subtitle">{user.email}</p>
          </div>

          {/* Entrar na conta do cliente (suporte). O botão fica travado
              quando o alvo é um admin — impersonar outro admin seria
              escalada de privilégio (a edge também bloqueia). */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleImpersonate}
              disabled={
                impersonating ||
                user.role === 'admin' ||
                adminUser?.id === user.id
              }
              title={
                user.role === 'admin'
                  ? 'Não é possível entrar na conta de outro administrador'
                  : adminUser?.id === user.id
                    ? 'Você já está nesta conta'
                    : 'Entrar na conta do cliente sem a senha dele'
              }
            >
              {impersonating ? (
                <>
                  <Loader2 size={16} className="spin" />
                  Entrando...
                </>
              ) : (
                <>
                  <LogIn size={16} />
                  Entrar como este usuário
                </>
              )}
            </button>
            <span className="text-xs text-muted-foreground">
              A senha do cliente não é alterada.
            </span>
          </div>
        </div>
      </div>

      <div className="user-tabs ad-scroll-row">
        {USER_TABS.map(tab => (
          <button
            key={tab.id}
            className={`user-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'details' && (
        <form onSubmit={handleSave} className="admin-card user-form">
          <div className="form-grid">
            <div className="form-row">
              <label><User size={14} /> Nome</label>
              <input type="text" name="name" value={form.name || ''} onChange={handleChange} required />
            </div>
            <div className="form-row">
              <label><Mail size={14} /> E-mail</label>
              <input type="email" name="email" value={form.email || ''} onChange={handleChange} required />
            </div>
            <div className="form-row">
              <label><Phone size={14} /> Celular</label>
              <input type="tel" name="phone" inputMode="numeric" value={form.phone || ''} onChange={(e) => handleChange({ target: { name: 'phone', value: maskPhone(e.target.value) } })} placeholder="(11) 99999-9999" />
            </div>
            <div className="form-row">
              <label>CPF</label>
              <input type="text" name="cpf" value={form.cpf || ''} onChange={handleChange} />
            </div>
            <div className="form-row">
              <label><Shield size={14} /> Permissão</label>
              <select name="role" value={form.role || 'user'} onChange={handleChange}>
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>Status</label>
              <select name="status" value={form.status || 'pending'} onChange={handleChange}>
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label><Lock size={14} /> Nova senha</label>
              <input
                type="text"
                placeholder="Deixe em branco para não alterar"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>ID do usuário</label>
              <input type="text" value={user.id} disabled />
            </div>
          </div>

          <div className="form-row">
            <label>Cadastrado em</label>
            <input type="text" value={new Date(user.created_at).toLocaleString('pt-BR')} disabled />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
              Salvar Alterações
            </button>
          </div>
        </form>
      )}

      {activeTab === 'subscriptions' && (
        <div className="admin-card">
          {subscriptions.length === 0 ? (
            <div className="empty-table"><p>Nenhuma assinatura encontrada.</p></div>
          ) : (
            <table className="history-table ad-card-table">
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th>Grupo</th>
                  <th>Valor</th>
                  <th>Ciclo</th>
                  <th>Status</th>
                  <th>Próx. Cobrança</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map(sub => (
                  <tr key={sub.id}>
                    <td data-label="Serviço">{sub.service?.name || '—'}</td>
                    <td data-label="Grupo">
                      {sub.group_id ? (
                        <Link
                          to={`/admin/groups/${sub.group_id}/edit`}
                          className="user-sub-group-link"
                          title={`Abrir o grupo ${sub.group?.name || ''} no painel`}
                        >
                          <span className="user-sub-group-name">{sub.group?.name || 'Ver grupo'}</span>
                          <ExternalLink size={13} />
                        </Link>
                      ) : (
                        (sub.group?.name || '—')
                      )}
                    </td>
                    <td data-label="Valor">R$ {Number(sub.amount || 0).toFixed(2)}</td>
                    <td data-label="Ciclo">
                      {({
                        monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual',
                        custom: sub.custom_cycle_months ? `${sub.custom_cycle_months} meses` : 'Personalizado',
                        days: sub.custom_cycle_days ? `${sub.custom_cycle_days} dias` : 'Diário'
                      }[sub.billing_cycle] || sub.billing_cycle)}
                    </td>
                    <td data-label="Status">
                      <span className={`status-badge ${sub.status}`}>{statusBadge(sub.status)}</span>
                    </td>
                    <td data-label="Próx. Cobrança">
                      {sub.next_charge_at ? new Date(sub.next_charge_at).toLocaleDateString('pt-BR') : sub.expires_at ? new Date(sub.expires_at).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="ad-actions">
                      <button
                        className="action-btn"
                        onClick={() => navigate(`/admin/subscriptions/${sub.id}/edit`)}
                        title="Editar assinatura"
                      >
                        <Edit2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'invoices' && (
        <div className="admin-card">
          {invoices.length === 0 ? (
            <div className="empty-table"><p>Nenhuma fatura encontrada.</p></div>
          ) : (
            <table className="history-table ad-card-table">
              <thead>
                <tr>
                  <th>Vencimento</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th>Pago em</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td data-label="Vencimento">{new Date(inv.due_date).toLocaleDateString('pt-BR')}</td>
                    <td data-label="Valor">R$ {Number(inv.amount || 0).toFixed(2)}</td>
                    <td data-label="Status"><span className={`status-badge ${inv.status}`}>{statusBadge(inv.status)}</span></td>
                    <td data-label="Pago em">{inv.paid_at ? new Date(inv.paid_at).toLocaleString('pt-BR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="admin-card">
          {payments.length === 0 ? (
            <div className="empty-table"><p>Nenhum pagamento encontrado.</p></div>
          ) : (
            <table className="history-table ad-card-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Valor</th>
                  <th>Método</th>
                  <th>Status</th>
                  <th>Transação</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(pay => (
                  <tr key={pay.id}>
                    <td data-label="Data">{new Date(pay.created_at).toLocaleString('pt-BR')}</td>
                    <td data-label="Valor">R$ {Number(pay.amount || 0).toFixed(2)}</td>
                    <td data-label="Método">{pay.method}</td>
                    <td data-label="Status"><span className={`status-badge ${pay.status}`}>{statusBadge(pay.status)}</span></td>
                    <td data-label="Transação">{pay.transaction_code || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'onboarding' && (
        <OnboardingAnswers userId={userId} completedAt={user?.onboarding_completed_at} />
      )}

      {activeTab === 'events' && (
        <div className="admin-card user-events-tab">
          <EventLog userId={userId} />
        </div>
      )}

      {activeTab === 'crons' && (
        <div className="crons-tab">
          {loadingCrons ? (
            <div className="admin-card" style={{ textAlign: 'center', padding: '2rem' }}>
              <Loader2 size={24} className="spin" />
              <p style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>Carregando crons...</p>
            </div>
          ) : userCrons ? (
            <>
              {/* Assinaturas do Usuário */}
              <div className="admin-card">
                <div className="crons-section-header">
                  <h3><Shield size={18} /> Assinaturas do Usuário</h3>
                  <span className="crons-subtitle">{userCrons.subscriptions?.length || 0} assinatura(s)</span>
                </div>
                {userCrons.subscriptions?.length === 0 ? (
                  <div className="empty-table"><p>Nenhuma assinatura encontrada.</p></div>
                ) : (
                  <div className="table-responsive">
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Grupo</th>
                        <th>Serviço</th>
                        <th>Valor</th>
                        <th>Ciclo</th>
                        <th>Método</th>
                        <th>Status</th>
                        <th>Billing</th>
                        <th>Cartão</th>
                        <th>Próxima Cobrança</th>
                        <th>Retry</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userCrons.subscriptions?.map((sub) => (
                        <tr key={sub.id}>
                          <td>{sub.group_name}</td>
                          <td>{sub.service_name}</td>
                          <td>R$ {Number(sub.amount || 0).toFixed(2)}</td>
                          <td>{sub.billing_cycle}</td>
                          <td>{sub.payment_method || '—'}</td>
                          <td><span className={`status-badge ${sub.status}`}>{statusBadge(sub.status)}</span></td>
                          <td><span className={`status-badge ${sub.billing_status || 'active'}`}>{statusBadge(sub.billing_status || 'active')}</span></td>
                          <td>
                            {editingCard === sub.id ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 180 }}>
                                <select
                                  value={sub.card_id || '__none__'}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '__none__') return;
                                    handleCardSelect(sub.id, sub.user_id, val);
                                  }}
                                  style={{ padding: '0.35rem 0.5rem', fontSize: '0.82rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)' }}
                                >
                                  <option value="__none__">Selecione um cartão...</option>
                                  {(iopayCards[sub.user_id] || []).map(card => (
                                    <option key={card.id_card || card.id} value={card.id_card || card.id}>
                                      •••• {card.last4_digits || card.last4 || '????'} {card.card_brand || card.brand || ''} {card.is_default ? '(Padrão)' : ''}
                                    </option>
                                  ))}
                                </select>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button className="action-btn" onClick={() => { fetchIopayCards(sub.user_id); }} title="Buscar cartões IOPay" style={{ color: '#0ea5e9' }}>
                                    {savingCard ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
                                  </button>
                                  <button className="action-btn" onClick={() => setEditingCard(null)} title="Fechar" style={{ color: '#9ca3af' }}>
                                    <XCircle size={12} />
                                  </button>
                                </div>
                                {savingCard && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Buscando cartões do IOPay...</span>}
                                {(iopayCards[sub.user_id] || []).length === 0 && !savingCard && (
                                  <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>Nenhum cartão encontrado no IOPay</span>
                                )}
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {sub.card_last4 ? (
                                  <span>•••• {sub.card_last4} {sub.card_brand || ''}</span>
                                ) : (
                                  <span style={{ color: '#ef4444', fontSize: '0.82rem' }}>Sem cartão</span>
                                )}
                                <button className="action-btn" onClick={() => { setEditingCard(sub.id); fetchIopayCards(sub.user_id); }} title="Selecionar cartão IOPay" style={{ padding: 2 }}>
                                  <CreditCard size={11} />
                                </button>
                              </div>
                            )}
                          </td>
                          <td>{sub.next_charge_at ? new Date(sub.next_charge_at).toLocaleDateString('pt-BR') : '—'}</td>
                          <td>{sub.retry_count > 0 ? <span style={{ color: '#f59e0b' }}>{sub.retry_count}ª</span> : '0'}</td>
                          <td>
                            <button
                              className="action-btn"
                              onClick={() => navigate(`/admin/subscriptions/${sub.id}/edit`)}
                              title="Editar assinatura"
                            >
                              <Edit2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>

              {/* Cron Globais */}
              <div className="admin-card">
                <div className="crons-section-header">
                  <h3><Zap size={18} /> Crons Globais do Servidor</h3>
                  <span className="crons-subtitle">Jobs agendados no pg_cron que processam este usuário</span>
                </div>
                <div className="global-crons-grid">
                  {userCrons.global_crons?.map((cron) => (
                    <div key={cron.id} className={`global-cron-card ${cron.affected ? 'affected' : 'not-affected'}`}>
                      <div className="global-cron-header">
                        <div className="global-cron-icon">
                          {cron.type === 'billing' ? <CreditCard size={20} /> :
                           cron.type === 'overdue' ? <AlertTriangle size={20} /> :
                           <RefreshCw size={20} />}
                        </div>
                        <div className="global-cron-info">
                          <strong>{cron.name}</strong>
                          <span className="cron-schedule">{cron.schedule_human}</span>
                        </div>
                        <span className={`cron-affected-badge ${cron.affected ? 'yes' : 'no'}`}>
                          {cron.affected ? 'Afeta este usuário' : 'Não afeta'}
                        </span>
                      </div>
                      <p className="global-cron-desc">{cron.description}</p>
                      {cron.detail && cron.detail.length > 0 && (
                        <div className="global-cron-detail">
                          <strong>Assinaturas afetadas:</strong>
                          {cron.detail.map((d, i) => (
                            <div key={i} className="cron-detail-row">
                              <span>{d.group_name} / {d.service_name}</span>
                              <span className="cron-detail-amount">R$ {Number(d.amount || 0).toFixed(2)}</span>
                              <span className={`cron-detail-status ${d.billing_status}`}>{d.billing_status}</span>
                              {d.card_last4 && <span className="cron-card-info">•••• {d.card_last4}</span>}
                              {d.next_charge_at && <span className="cron-next-charge">Próxima: {new Date(d.next_charge_at).toLocaleDateString('pt-BR')}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Agendar Nova Cobrança */}
              <div className="admin-card">
                <div className="crons-section-header">
                  <h3><Calendar size={18} /> Agendar Nova Cobrança</h3>
                  <button className="btn btn-primary" onClick={() => setShowScheduleModal(true)}>
                    <Plus size={16} /> Agendar Cobrança
                  </button>
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Crie uma cobrança manual para este usuário. A cobrança será processada na data especificada.
                </p>
              </div>

              {/* Billing Cycles / Histórico */}
              <div className="admin-card">
                <div className="crons-section-header">
                  <h3><Timer size={18} /> Histórico de Ciclos de Cobrança</h3>
                  <button className="btn btn-outline" onClick={() => { setUserCrons(null); fetchUserCrons(); }}>
                    <RefreshCw size={14} /> Atualizar
                  </button>
                </div>
                {userCrons.billing_cycles?.length === 0 ? (
                  <div className="empty-table"><p>Nenhum ciclo de cobrança encontrado.</p></div>
                ) : (
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Data Prevista</th>
                        <th>Grupo / Serviço</th>
                        <th>Valor</th>
                        <th>Status</th>
                        <th>Tentativa</th>
                        <th>Gateway</th>
                        <th>Próximo Retry</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userCrons.billing_cycles?.map((bc) => (
                        <tr key={bc.id}>
                          <td>
                            {editingBC === bc.id ? (
                              <input
                                type="date"
                                value={editBCForm.charge_date}
                                onChange={(e) => setEditBCForm(prev => ({ ...prev, charge_date: e.target.value }))}
                                style={{ padding: '0.3rem 0.5rem', fontSize: '0.82rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)' }}
                              />
                            ) : (
                              new Date(bc.charge_date).toLocaleDateString('pt-BR')
                            )}
                          </td>
                          <td>{bc.group_name} / {bc.service_name}</td>
                          <td>
                            {editingBC === bc.id ? (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={editBCForm.amount}
                                onChange={(e) => setEditBCForm(prev => ({ ...prev, amount: e.target.value }))}
                                style={{ padding: '0.3rem 0.5rem', fontSize: '0.82rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', width: 90 }}
                              />
                            ) : (
                              `R$ ${Number(bc.amount || 0).toFixed(2)}`
                            )}
                          </td>
                          <td><span className={`status-badge ${bc.status}`}>{statusBadge(bc.status)}</span></td>
                          <td>{bc.attempt_number}ª</td>
                          <td>{bc.gateway}</td>
                          <td>{bc.next_retry_at ? new Date(bc.next_retry_at).toLocaleDateString('pt-BR') : '—'}</td>
                          <td>
                            {editingBC === bc.id ? (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  className="action-btn"
                                  onClick={() => saveEditBC(bc.id)}
                                  disabled={savingBC}
                                  title="Salvar"
                                  style={{ color: '#10b981' }}
                                >
                                  {savingBC ? <Loader2 size={14} className="spin" /> : <CheckCircle size={14} />}
                                </button>
                                <button
                                  className="action-btn"
                                  onClick={() => setEditingBC(null)}
                                  title="Cancelar"
                                  style={{ color: '#9ca3af' }}
                                >
                                  <XCircle size={14} />
                                </button>
                              </div>
                            ) : (
                              <button
                                className="action-btn"
                                onClick={() => startEditBC(bc)}
                                title="Editar ciclo"
                              >
                                <Edit2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Billing Logs */}
              <div className="admin-card">
                <div className="crons-section-header">
                  <h3><FileText size={18} /> Logs de Cobrança</h3>
                </div>
                {userCrons.billing_logs?.length === 0 ? (
                  <div className="empty-table"><p>Nenhum log encontrado.</p></div>
                ) : (
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Ação</th>
                        <th>Detalhes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userCrons.billing_logs?.map((log) => (
                        <tr key={log.id}>
                          <td>{new Date(log.created_at).toLocaleString('pt-BR')}</td>
                          <td><span className={`status-badge ${log.action.includes('success') ? 'active' : log.action.includes('failed') ? 'failed' : ''}`}>{log.action}</span></td>
                          <td className="log-details-cell">
                            {log.details ? (
                              typeof log.details === 'object' ? (
                                Object.entries(log.details).map(([k, v]) => (
                                  <span key={k} className="log-detail-item"><strong>{k}:</strong> {String(v)}</span>
                                ))
                              ) : String(log.details)
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Modal Agendar Cobrança */}
              {showScheduleModal && (
                <div className="modal-overlay" onClick={() => setShowScheduleModal(false)}>
                  <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <h3><Calendar size={18} /> Agendar Cobrança</h3>
                      <button className="modal-close" onClick={() => setShowScheduleModal(false)}>
                        <XCircle size={20} />
                      </button>
                    </div>
                    <form onSubmit={handleScheduleCharge} className="modal-body">
                      <div className="form-group">
                        <label>Assinatura *</label>
                        <select
                          value={scheduleForm.subscription_id}
                          onChange={(e) => {
                            const sub = userCrons.subscriptions?.find(s => s.id === e.target.value);
                            setScheduleForm(prev => ({
                              ...prev,
                              subscription_id: e.target.value,
                              amount: sub ? String(sub.amount) : prev.amount,
                            }));
                          }}
                          required
                        >
                          <option value="">Selecione uma assinatura</option>
                          {userCrons.subscriptions?.filter(s => s.status === 'active' || s.status === 'expired' || s.status === 'pending').map((sub) => (
                            <option key={sub.id} value={sub.id}>
                              {sub.group_name} / {sub.service_name} — R$ {Number(sub.amount || 0).toFixed(2)} [{sub.status}] {sub.card_last4 ? `(•••• ${sub.card_last4})` : '(sem cartão)'}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Data da Cobrança *</label>
                        <input
                          type="date"
                          value={scheduleForm.charge_date}
                          onChange={(e) => setScheduleForm(prev => ({ ...prev, charge_date: e.target.value }))}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Valor (R$) — deixe em branco para usar o valor da assinatura</label>
                        <input
                          type="number"
                          step="0.01"
                          min="1"
                          value={scheduleForm.amount}
                          onChange={(e) => setScheduleForm(prev => ({ ...prev, amount: e.target.value }))}
                          placeholder="Ex: 29.90"
                        />
                      </div>
                      <div className="form-group">
                        <label>Observações</label>
                        <input
                          type="text"
                          value={scheduleForm.notes}
                          onChange={(e) => setScheduleForm(prev => ({ ...prev, notes: e.target.value }))}
                          placeholder="Motivo da cobrança manual"
                        />
                      </div>
                      <div className="modal-actions">
                        <button type="button" className="btn btn-outline" onClick={() => setShowScheduleModal(false)}>
                          Cancelar
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={scheduling || !scheduleForm.subscription_id}>
                          {scheduling ? <Loader2 size={16} className="spin" /> : <Calendar size={16} />}
                          Agendar
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="admin-card" style={{ textAlign: 'center', padding: '2rem' }}>
              <p>Clique em "Crons" para carregar os dados.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Aba de qualificação: as respostas do onboarding do usuário.
 *
 * Usa a MESMA linguagem visual do relatório (/admin/onboarding): indicadores
 * no topo, cards com o catálogo de serviços agrupado por categoria e a
 * resposta aberta em citação. Antes esta aba listava os nomes crus das
 * plataformas, sem ícone e sem categoria — o operador via "netflix" e não
 * sabia se a pessoa queria criar ou entrar num grupo.
 */
function OnboardingAnswers({ userId, completedAt }) {
  const [profile, setProfile] = useState(null);
  const [interests, setInterests] = useState([]);
  const [invites, setInvites] = useState([]);
  const [origin, setOrigin] = useState(null);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const [pRes, iRes, invRes, svcRes] = await Promise.all([
        supabase.from('user_onboarding_profiles').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('user_onboarding_interests').select('*').eq('user_id', userId),
        supabase.from('user_onboarding_invites').select('*').eq('user_id', userId),
        // Catálogo: é ele que dá o ícone, a cor e a categoria de cada
        // plataforma marcada (inclusive das digitadas à mão).
        supabase.from('streaming_services').select('id, name, icon_url, color, category'),
      ]);
      if (cancelled) return;
      setProfile(pRes.data || null);
      setInterests(iRes.data || []);
      setInvites(invRes.data || []);
      setServices(svcRes.data || []);

      /* A origem do cadastro ("onde a pessoa nos conheceu") vem numa query
         separada: se o grant de lead_source faltar no banco, misturar as
         duas derrubaria o retorno inteiro com 42501 e a aba ficaria
         sem nada. */
      const originRes = await supabase
        .from('users')
        .select('lead_source, lead_source_other')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (!originRes.error) setOrigin(originRes.data || null);

      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [userId]);

  if (loading) {
    return (
      <div className="admin-card" style={{ textAlign: 'center', padding: '2rem' }}>
        <Loader2 size={22} className="spin" /> <p>Carregando...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="ob-answers-tab">
        <div className="ob-report-stats">
          <div className="ob-report-stat orange">
            <MapPin size={18} />
            <div>
              <span className="ob-report-stat-value is-text">{origemLabel(origin)}</span>
              <span className="ob-report-stat-label">Onde nos conheceu</span>
            </div>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <h3>Qualificação</h3>
          </div>
          <p className="ob-report-empty">
            Este usuário ainda não respondeu o onboarding
            {completedAt ? ' (o registro está com data, mas sem respostas salvas).' : '.'}
          </p>
        </div>
      </div>
    );
  }

  const share = interests.filter((i) => i.kind === 'share');
  const join = interests.filter((i) => i.kind === 'join');

  const lookup = buildServiceLookup(services);
  const shareGroups = groupPlatformsByCategory(share, lookup);
  const joinGroups = groupPlatformsByCategory(join, lookup);

  const intentStep = ONBOARDING_STEPS.find((s) => s.column === 'group_intent');
  const intentLabel = profile.group_intent
    ? labelForValue(intentStep, profile.group_intent)
    : null;
  const querCriar = ['criar', 'ambos'].includes(profile.group_intent);
  const querEntrar = ['entrar', 'ambos'].includes(profile.group_intent);

  /* A resposta aberta tem card próprio (citação) e a intenção de grupo tem
     rótulo curto — as duas saem da grade de detalhes para não repetir. */
  const temValor = (s) => {
    const v = profile[s.column];
    return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);
  };
  const respondidas = ONBOARDING_STEPS.filter((s) => s.column && s.type !== 'info').filter(temValor);
  const answered = respondidas.filter(
    (s) => s.column !== 'expectations' && s.column !== 'group_intent'
  );
  const totalPerguntas = ONBOARDING_STEPS.filter((s) => s.column).length;

  /* Indicadores no mesmo formato do relatório: o operador lê a ficha sem
     precisar abrir card nenhum. */
  const stats = [
    {
      label: 'Onde nos conheceu',
      value: origemLabel(origin),
      icon: <MapPin size={18} />,
      tone: 'orange',
      text: true,
    },
    {
      label: 'Quer criar grupo',
      value: querCriar ? 'Sim' : 'Não',
      icon: <Share2 size={18} />,
      tone: 'purple',
    },
    {
      label: 'Quer entrar em grupo',
      value: querEntrar ? 'Sim' : 'Não',
      icon: <UserPlus size={18} />,
      tone: 'blue',
    },
    {
      label: 'Pessoas indicadas',
      value: invites.length,
      icon: <Users size={18} />,
      tone: 'green',
    },
    {
      label: 'Serviços para criar',
      value: share.length,
      icon: <Layers size={18} />,
      tone: 'purple',
    },
    {
      label: 'Serviços para entrar',
      value: join.length,
      icon: <Layers size={18} />,
      tone: 'blue',
    },
  ];

  /* Cartão de plataformas por categoria — o mesmo bloco do relatório. */
  const cartaoPlataformas = (titulo, grupos, total, muted) => (
    <div className="chart-card" key={titulo}>
      <div className="chart-header">
        <h3>{titulo}</h3>
        <span className="chart-total">
          {total === 1 ? '1 serviço' : `${total} serviços`}
        </span>
      </div>
      {grupos.length === 0 ? (
        <p className="ob-report-empty">Nenhum serviço marcado nesta pergunta.</p>
      ) : (
        grupos.map((g) => (
          <div className="ob-platform-group" key={g.key}>
            <span className="ob-platform-group-label">{g.label}</span>
            <div className="ob-platform-list">
              {g.items.map((p) => (
                <span className={`ob-platform-chip ${muted ? 'is-muted' : ''}`} key={p.name}>
                  {p.icon ? (
                    <img src={p.icon} alt="" />
                  ) : (
                    <span className="ob-platform-initial" style={{ background: p.color || '#64748B' }}>
                      {p.name.charAt(0)}
                    </span>
                  )}
                  {p.name}
                  {p.custom && <em className="ob-custom-tag">outra</em>}
                </span>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="ob-answers-tab">
      <div className="ob-report-stats">
        {stats.map((s) => (
          <div className={`ob-report-stat ${s.tone}`} key={s.label}>
            {s.icon}
            <div>
              <span className={`ob-report-stat-value ${s.text ? 'is-text' : ''}`}>{s.value}</span>
              <span className="ob-report-stat-label">{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="charts-section">
        {/* Perfil de qualificação: as respostas, na ordem do questionário. */}
        <div className="chart-card">
          <div className="chart-header">
            <h3>Perfil de qualificação</h3>
            <span className="chart-total">
              {respondidas.length} de {totalPerguntas} perguntas respondidas
            </span>
          </div>
          <p className="ob-card-intro">
            As respostas do questionário, com os rótulos de cada pergunta.
          </p>

          <div className="ob-detail-grid">
            {answered.map((step) => {
              const raw = profile[step.column];
              const display = Array.isArray(raw)
                ? raw.join(', ')
                : step.type === 'yes_no'
                  ? raw ? 'Sim' : 'Não'
                  : labelForValue(step, raw);

              return (
                <div className="ob-detail-item" key={step.id}>
                  <span className="ob-detail-q">{step.title}</span>
                  <span className="ob-detail-a">{display}</span>
                </div>
              );
            })}

            {intentLabel && (
              <div className="ob-detail-item">
                <span className="ob-detail-q">Criar ou entrar em grupo</span>
                <span className="ob-detail-a">{intentLabel}</span>
              </div>
            )}

            {profile.main_barrier_other && (
              <div className="ob-detail-item">
                <span className="ob-detail-q">Outra barreira</span>
                <span className="ob-detail-a">{profile.main_barrier_other}</span>
              </div>
            )}

            {origin?.lead_source && (
              <div className="ob-detail-item">
                <span className="ob-detail-q">Onde nos encontraram</span>
                <span className="ob-detail-a">{origemLabel(origin)}</span>
              </div>
            )}
          </div>
        </div>

        {/* A resposta aberta — a última pergunta do onboarding. */}
        {profile.expectations && (
          <div className="chart-card ob-open-card">
            <div className="chart-header">
              <h3>O que a pessoa espera da plataforma</h3>
              <span className="chart-total">última pergunta</span>
            </div>
            <p className="ob-open-text">“{profile.expectations}”</p>
          </div>
        )}

        {cartaoPlataformas('Quer criar grupo', shareGroups, share.length, false)}
        {cartaoPlataformas('Quer entrar em grupo', joinGroups, join.length, true)}

        {/* Pessoas que ele convidou para um grupo. */}
        <div className="chart-card">
          <div className="chart-header">
            <h3>Pessoas que ele convidou</h3>
            <span className="chart-total">
              {invites.length === 1 ? '1 pessoa' : `${invites.length} pessoas`}
            </span>
          </div>
          {invites.length === 0 ? (
            <p className="ob-report-empty">Ninguém informado.</p>
          ) : (
            <div className="ob-platform-list">
              {invites.map((iv) => {
                /* O número é gravado sem o código do país — o link do WhatsApp
                   precisa dele, senão o wa.me abre a conversa errada. */
                const waNumber = phoneToWhatsApp(iv.phone);
                const nacional = phoneToNational(iv.phone);

                if (!waNumber) {
                  return (
                    <span key={iv.id} className="ob-invite-chip is-static">
                      {iv.name}
                    </span>
                  );
                }
                return (
                  <a
                    key={iv.id}
                    href={`https://wa.me/${waNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ob-invite-chip"
                    title={`Falar com ${iv.name} no WhatsApp`}
                  >
                    <MessageCircle size={12} />
                    {iv.name}
                    <span className="ob-invite-phone">{maskPhone(nacional) || ''}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Texto da origem do cadastro. "Outro" guarda o que a pessoa digitou em
 * `lead_source_other` — é a resposta mais informativa das opções livres.
 */
function origemLabel(origin) {
  if (!origin?.lead_source) return '—';
  const src = String(origin.lead_source).trim();
  if (src === 'Outro' && origin.lead_source_other) {
    return `${src} — ${String(origin.lead_source_other).trim()}`;
  }
  return src;
}

export default UserDetail;
