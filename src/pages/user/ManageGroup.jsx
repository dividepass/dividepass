import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Save, Trash2, Users, DollarSign, Settings, Key,
  CheckCircle, X, AlertTriangle, Eye, EyeOff, Link, Hash, Mail, MessageSquare, CreditCard,
  TrendingUp, ArrowDownRight, Calendar
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import './ManageGroup.css';

function ManageGroup() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [group, setGroup] = useState(null);
  const [service, setService] = useState(null);
  const [members, setMembers] = useState([]);
  const [credentials, setCredentials] = useState(null);
  const [stats, setStats] = useState({ totalRevenue: 0, activeMembers: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [feeSettings, setFeeSettings] = useState({ gateway_fee_percent: 4.98, platform_fee_percent: 3.95 });
  const [groupBalance, setGroupBalance] = useState(0);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingWithdrawal, setPendingWithdrawal] = useState(null);
  const [payments, setPayments] = useState([]);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [credentialType, setCredentialType] = useState('email_password');
  const [credentialUrl, setCredentialUrl] = useState('');
  const [credentialCode, setCredentialCode] = useState('');
  const [credentialInvite, setCredentialInvite] = useState('');
  const [credentialNotes, setCredentialNotes] = useState({
    email_password: '',
    link: '',
    code: '',
    invite: '',
    custom: ''
  });
  const [planType, setPlanType] = useState('');
  const [planTypeCustom, setPlanTypeCustom] = useState('');
  const [customPlanActive, setCustomPlanActive] = useState(false);

  const [availableCycles, setAvailableCycles] = useState([]);
  const [customCycleMonths, setCustomCycleMonths] = useState('');
  const [customCycleLabel, setCustomCycleLabel] = useState('');
  const [daysCycleDays, setDaysCycleDays] = useState('');
  const [daysCycleLabel, setDaysCycleLabel] = useState('');

  const PLAN_TYPES = [
    'Conta Individual', 'Conta Padrão', 'Conta Premium', 'Conta VIP',
    'Conta Go', 'Conta Light', 'Conta Enterprise', 'Conta Team',
    'Conta PRO', 'Conta PRO+', 'Conta PLUS', 'Conta MAX',
    'Conta Educação', 'Conta Duo', 'Conta Família',
  ];

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const fetchGroup = async () => {
      if (!groupId || !user) return;
      try {
        setLoading(true);

        const { data: groupData, error: groupError } = await supabase
          .from('groups')
          .select('*')
          .eq('id', groupId)
          .eq('owner_id', user.id)
          .single();

        if (groupError || !groupData) {
          setError('Grupo não encontrado ou você não é o proprietário.');
          setLoading(false);
          return;
        }

        setGroup(groupData);
        setPlanType(groupData.plan_type || '');
        setAvailableCycles(groupData.available_cycles || [groupData.billing_cycle || 'monthly']);
        setCustomCycleMonths(groupData.custom_cycle_months || '');
        setCustomCycleLabel(groupData.custom_cycle_label || '');
        setDaysCycleDays(groupData.custom_cycle_days || '');
        setDaysCycleLabel(groupData.custom_cycle_days ? (groupData.custom_cycle_label || `${groupData.custom_cycle_days} dias`) : '');
        setPlanTypeCustom(groupData.plan_type_custom || '');
        setCustomPlanActive(!groupData.plan_type && !!groupData.plan_type_custom);

        const [serviceRes, membersRes, credsRes, paymentsRes, subsRes, settingsRes, withdrawalsRes] = await Promise.all([
          supabase.from('streaming_services').select('id, name, full_name, icon, icon_url, color, slug').eq('id', groupData.service_id).single(),
          supabase.from('group_members').select('user_id, created_at, status, user:user_id (id, name, email)').eq('group_id', groupId).order('created_at'),
          supabase.from('group_credentials').select('*').eq('group_id', groupId).maybeSingle(),
          supabase.from('payments').select('id, amount, method, status, payment_type, transaction_code, created_at, paid_at').eq('group_id', groupId).eq('status', 'paid').order('paid_at', { ascending: false }),
          supabase.from('user_subscriptions').select('*, user:user_id (id, name, email)').eq('group_id', groupId).order('created_at', { ascending: false }),
          supabase.from('app_settings').select('key, value').in('key', ['gateway_fee_percent', 'platform_fee_percent']),
          supabase.from('wallet_withdrawals').select('id, amount, status, requested_at, processed_at, payment_method, notes').eq('user_id', user.id).order('requested_at', { ascending: false }),
        ]);

        if (serviceRes.data) setService(serviceRes.data);

        const activeMembers = (membersRes.data || []).filter(m => m.status === 'active');
        const paidPayments = paymentsRes.data || [];
        const allWithdrawals = withdrawalsRes.data || [];
        const pending = allWithdrawals.find(w => w.status === 'pending') || null;
        const completedWithdrawals = allWithdrawals.filter(w => w.status === 'completed');
        const gwSetting = settingsRes.data?.find(s => s.key === 'gateway_fee_percent');
        const pfSetting = settingsRes.data?.find(s => s.key === 'platform_fee_percent');
        const gwFee = gwSetting ? parseFloat(gwSetting.value) : 4.98;
        const pfFee = pfSetting ? parseFloat(pfSetting.value) : 3.95;
        const grossRevenue = paidPayments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
        const totalFees = paidPayments.reduce((sum, payment) => {
          const amt = parseFloat(payment.amount) || 0;
          return sum + (amt * (gwFee + pfFee) / 100);
        }, 0);
        const netRevenue = grossRevenue - totalFees;
        const totalWithdrawn = completedWithdrawals.reduce((sum, withdrawal) => sum + (parseFloat(withdrawal.amount) || 0), 0);

        setPayments(paidPayments);
        setMembers(activeMembers);
        setStats({
          activeMembers: activeMembers.length,
          totalRevenue: grossRevenue,
        });

        if (subsRes.data) setSubscriptions(subsRes.data);

        if (settingsRes.data) {
          setFeeSettings({
            gateway_fee_percent: gwFee,
            platform_fee_percent: pfFee,
          });
        }

        setGroupBalance(Math.max(0, netRevenue - totalWithdrawn));
        setPendingWithdrawal(pending);
        if (pending) {
          setWithdrawAmount(pending.amount?.toString() || '');
        } else {
          setWithdrawAmount('');
        }

        if (credsRes.data) {
          setCredentials(credsRes.data);
          setCredentialType(credsRes.data.credential_type || 'email_password');
          setLoginEmail(credsRes.data.login_email || '');
          setLoginPassword(credsRes.data.login_password || '');
          setCredentialUrl(credsRes.data.credential_url || '');
          setCredentialCode(credsRes.data.login_password || '');
          setCredentialInvite(credsRes.data.credential_url || '');
          const notes = credsRes.data.credential_notes;
          if (typeof notes === 'string') {
            setCredentialNotes({
              email_password: notes,
              link: '',
              code: '',
              invite: '',
              custom: ''
            });
          } else {
            setCredentialNotes(notes || {});
          }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchGroup();
  }, [groupId, user]);

  const financeGrossRevenue = payments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
  const financeFees = payments.reduce((sum, payment) => {
    const amount = parseFloat(payment.amount) || 0;
    return sum + (amount * (feeSettings.gateway_fee_percent + feeSettings.platform_fee_percent) / 100);
  }, 0);
  const financeNetRevenue = financeGrossRevenue - financeFees;

  const handleSaveCredentials = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        group_id: groupId,
        credential_type: credentialType,
        login_email: credentialType === 'email_password' ? loginEmail : null,
        login_password: credentialType === 'email_password' ? loginPassword : (credentialType === 'code' ? credentialCode : null),
        credential_url: credentialType === 'link' ? credentialUrl : (credentialType === 'invite' ? credentialInvite : null),
        credential_notes: credentialNotes[credentialType] || null,
        has_profiles: false,
      };

      if (credentials) {
        const { error } = await supabase.from('group_credentials').update(payload).eq('group_id', groupId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('group_credentials').insert(payload);
        if (error) throw error;
      }

      setCredentials(payload);
      setToast('Credenciais salvas com sucesso!');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRequestWithdrawal = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) {
      setError('Informe um valor válido para saque.');
      return;
    }
    if (amount > groupBalance) {
      setError('Valor indisponível. Saldo insuficiente.');
      return;
    }
    if (amount < 10) {
      setError('O valor mínimo para saque é R$ 10,00.');
      return;
    }

    setWithdrawing(true);
    setError('');
    try {
      const { error } = await supabase.from('wallet_withdrawals').insert({
        user_id: user.id,
        amount,
        status: 'pending',
        payment_method: 'pix',
        notes: `Saque do grupo: ${group?.name}`,
      });
      if (error) throw error;
      setToast('Solicitação de saque enviada com sucesso!');
      setPendingWithdrawal({ amount, status: 'pending' });
      setWithdrawAmount('');

      // Platform event: withdrawal requested
      try {
        await supabase.from('platform_events').insert({
          event_type: 'withdrawal_requested',
          title: 'Saque solicitado',
          message: `${user?.name || 'Usuário'} solicitou saque de R$ ${amount.toFixed(2)} do grupo "${group?.name}".`,
          metadata: JSON.stringify({ user_id: user.id, group_id: group?.id, amount, group_name: group?.name }),
          created_by: user.id,
        });
      } catch (e) { console.error('Platform event error:', e); }
    } catch (err) {
      setError(err.message);
    } finally {
      setWithdrawing(false);
    }
  };

  const handleSavePlanType = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('groups')
        .update({
          plan_type: customPlanActive ? null : (planType || null),
          plan_type_custom: customPlanActive ? (planTypeCustom || null) : null,
        })
        .eq('id', groupId);
      if (error) throw error;
      setToast('Tipo de conta salvo!');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCycleToggle = (cycle) => {
    setAvailableCycles(prev => {
      const updated = prev.includes(cycle)
        ? prev.filter(c => c !== cycle)
        : [...prev, cycle];
      return updated.length > 0 ? updated : prev;
    });
  };

  const handleSaveCycles = async () => {
    setSaving(true);
    try {
      const hasCustom = availableCycles.includes('custom');
      const hasDays = availableCycles.includes('days');
      const payload = {
        available_cycles: availableCycles,
        billing_cycle: availableCycles[0] || 'monthly',
        custom_cycle_months: hasCustom ? parseInt(customCycleMonths) || null : null,
        custom_cycle_label: hasCustom ? (customCycleLabel || null) : (hasDays ? (daysCycleLabel || null) : null),
        custom_cycle_days: hasDays ? parseInt(daysCycleDays) || null : null,
      };
      const { error } = await supabase.from('groups').update(payload).eq('id', groupId);
      if (error) throw error;
      setGroup(prev => ({ ...prev, ...payload }));
      setToast('Ciclos de cobrança salvos!');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSyncMembers = async () => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ group_id: groupId }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setToast({ type: 'success', text: `Sincronizado! ${data.synced || 0} membro(s) adicionado(s), ${data.already_ok || 0} já estavam OK.` });
      loadGroup();
    } catch (e) {
      setToast({ type: 'error', text: `Erro ao sincronizar: ${e.message}` });
    }
    setSyncing(false);
  };

  const handleDeleteGroup = async () => {
    if (!window.confirm('Tem certeza que deseja deletar este grupo? Esta ação é irreversível.')) return;
    if (!window.confirm('Última chance: todos os membros perderão acesso. Confirmar exclusão?')) return;

    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-group`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ group_id: groupId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao deletar grupo');
      navigate('/dashboard/my-groups');
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando grupo...</p>
      </div>
    );
  }

  if (error && !group) {
    return (
      <div className="fade-in manage-group-page">
        <button onClick={() => navigate(-1)} className="back-btn">
          <ArrowLeft size={18} />
          Voltar
        </button>
        <div className="empty-state">
          <AlertTriangle size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in manage-group-page">
      {toast && (
        <div className="toast-success">
          <CheckCircle size={18} />
          <span>{toast}</span>
          <button onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      )}

      <button onClick={() => navigate(-1)} className="back-btn">
        <ArrowLeft size={18} />
        Voltar
      </button>

      <div className="page-header">
        <h1>Gerenciar Grupo</h1>
        <p>{group?.name}</p>
      </div>

      <div className="manage-group-layout">
        <div className="manage-group-main">
          {/* Group Info Card */}
          <div className="manage-card" style={{ '--service-color': service?.color || '#4F46E5' }}>
            <div className="manage-card-header" style={{ backgroundColor: `${service?.color}15` }}>
              <div className="manage-service-info">
                <div className="manage-service-icon" style={{ backgroundColor: service?.color }}>
                  {service?.icon_url ? (
                    <img src={service.icon_url} alt={service.name} className="manage-service-icon-img" />
                  ) : (
                    service?.icon
                  )}
                </div>
                <div>
                  <h2 style={{ color: service?.color }}>{service?.full_name}</h2>
                  <span className="manage-group-label">{group?.name}</span>
                </div>
              </div>
              <span className={`manage-status ${group?.status}`}>
                {group?.status === 'open' ? 'Aberto' : group?.status === 'closed' ? 'Fechado' : 'Formando'}
              </span>
              {group?.approval_status === 'approved' && (
                <span className="manage-approved-badge" title="Aprovado pela equipe">
                  <CheckCircle size={14} /> Aprovado
                </span>
              )}
            </div>

            <div className="manage-stats-grid">
              <div className="manage-stat">
                <DollarSign size={20} />
                <div>
                  <span>Receita total</span>
                  <strong>R$ {stats.totalRevenue.toFixed(2)}</strong>
                </div>
              </div>
              <div className="manage-stat">
                <Users size={20} />
                <div>
                  <span>Membros ativos</span>
                  <strong>{stats.activeMembers}</strong>
                </div>
              </div>
              <div className="manage-stat">
                <Settings size={20} />
                <div>
                  <span>Preço por vaga</span>
                  <strong>R$ {parseFloat(group?.price_per_slot || 0).toFixed(2)}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Financial Dashboard */}
          <div className="manage-card">
            <div className="manage-card-title">
              <TrendingUp size={18} />
              <h3>Financeiro</h3>
            </div>

            <div className="finance-summary">
              <div className="finance-summary-item">
                <span>Receita Bruta</span>
                <strong>R$ {financeGrossRevenue.toFixed(2)}</strong>
              </div>
              <div className="finance-summary-item finance-total">
                <span>Receita Líquida</span>
                <strong className="finance-positive">R$ {financeNetRevenue.toFixed(2)}</strong>
              </div>
              <div className="finance-fee-info" style={{ fontSize: '0.75rem', marginTop: '0.25rem', opacity: 0.7 }}>
                <span>Taxa Gateway: {feeSettings.gateway_fee_percent}%</span>
                <span> • </span>
                <span>Taxa Plataforma: {feeSettings.platform_fee_percent}%</span>
                <span> • </span>
                <span>Total taxas: R$ {financeFees.toFixed(2)}</span>
              </div>
            </div>

            <div className="manage-card-section finance-history-section">
              <div className="manage-card-subtitle">
                <Calendar size={14} />
                <span>Histórico financeiro</span>
              </div>
              {payments.length === 0 ? (
                <p className="manage-empty-text">Nenhum pagamento aprovado ainda.</p>
              ) : (
                <div className="finance-history-scroll">
                  <table className="finance-history-table">
                    <thead>
                      <tr>
                        <th>Data hora</th>
                        <th>Grupo</th>
                        <th>Valor pago</th>
                        <th>Valor Taxa</th>
                        <th>Valor líquido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((payment) => {
                        const amount = parseFloat(payment.amount) || 0;
                        const fee = amount * (feeSettings.gateway_fee_percent + feeSettings.platform_fee_percent) / 100;
                        const net = amount - fee;
                        const when = payment.paid_at || payment.created_at;

                        return (
                          <tr key={payment.id}>
                            <td>{when ? new Date(when).toLocaleString('pt-BR') : '—'}</td>
                            <td>{group?.name || '—'}</td>
                            <td>R$ {amount.toFixed(2)}</td>
                            <td>- R$ {fee.toFixed(2)}</td>
                            <td>R$ {net.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Group Balance */}
            <div className="finance-balance-section">
              <div className="finance-balance-card">
                <div className="finance-balance-info">
                  <span>Saldo Disponível (Grupo)</span>
                  <strong className="finance-balance-value">R$ {groupBalance.toFixed(2)}</strong>
                </div>
                {pendingWithdrawal ? (
                  <div className="finance-withdrawal-pending">
                    <span className="finance-withdrawal-badge pending">Saque em análise</span>
                    <span className="finance-withdrawal-amount">R$ {parseFloat(pendingWithdrawal.amount).toFixed(2)}</span>
                  </div>
                ) : (
                  <div className="finance-withdrawal-form">
                    <input
                      type="number"
                      step="0.01"
                      min="10"
                      max={groupBalance}
                      placeholder="Valor do saque"
                      value={withdrawAmount}
                      onChange={e => setWithdrawAmount(e.target.value)}
                      className="finance-withdrawal-input"
                    />
                    <button
                      className="finance-withdrawal-btn"
                      onClick={handleRequestWithdrawal}
                      disabled={withdrawing || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
                    >
                      {withdrawing ? <Loader2 size={14} className="spin" /> : <ArrowDownRight size={14} />}
                      Solicitar Saque
                    </button>
                  </div>
                )}
              </div>
            </div>

            {subscriptions.filter(s => s.status === 'active').length > 0 ? (
              <div className="finance-members-table">
                <div className="finance-table-header">
                  <span>Membro</span>
                  <span>Pago</span>
                  <span>Taxas</span>
                  <span>Líquido</span>
                  <span>Renovação</span>
                </div>
                {subscriptions.filter(s => s.status === 'active').map(sub => {
                  const amt = parseFloat(sub.amount) || 0;
                  const totalFees = amt * (feeSettings.gateway_fee_percent + feeSettings.platform_fee_percent) / 100;
                  const net = amt - totalFees;
                  const renewalDate = sub.next_charge_at ? new Date(sub.next_charge_at).toLocaleDateString('pt-BR') : '—';
                  return (
                    <div key={sub.id} className="finance-table-row">
                      <div className="finance-member-cell">
                        <strong>{sub.user?.name || 'Sem nome'}</strong>
                        <span>{sub.user?.email || ''}</span>
                      </div>
                      <div className="finance-amount-cell">R$ {amt.toFixed(2)}</div>
                      <div className="finance-fee-cell">- R$ {totalFees.toFixed(2)}</div>
                      <div className="finance-net-cell">R$ {net.toFixed(2)}</div>
                      <div className="finance-renewal-cell">
                        <Calendar size={12} />
                        {renewalDate}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="manage-empty-text">Nenhuma assinatura ativa ainda.</p>
            )}
          </div>

          {/* Members */}
          <div className="manage-card">
            <div className="manage-card-title" style={{ justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Users size={18} />
                <h3>Membros ({members.length})</h3>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={handleSyncMembers} disabled={syncing}>
                {syncing ? <><Loader2 size={14} className="spin" /> Sincronizando...</> : 'Sincronizar Assinaturas'}
              </button>
            </div>

            {members.length === 0 ? (
              <p className="manage-empty-text">Nenhum membro no grupo ainda.</p>
            ) : (
              <div className="manage-members-list">
                {members.map((member, idx) => (
                  <div key={member.user_id} className="manage-member-row">
                    <div className="manage-member-number">#{idx + 1}</div>
                    <div className="manage-member-info">
                      <strong>{member.user?.name || 'Sem nome'}</strong>
                      <span>{member.user?.email || member.user_id}</span>
                    </div>
                    <CheckCircle size={16} className="manage-member-check" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="manage-group-sidebar">
          {/* Approval Status */}
          {group?.approval_status === 'pending' && (
            <div className="manage-card manage-approval-pending">
              <AlertTriangle size={18} />
              <h3>Aguardando Aprovação</h3>
              <p>Seu grupo está em análise pela equipe DividePass. Você será notificado quando for aprovado.</p>
            </div>
          )}

          {group?.approval_status === 'rejected' && (
            <div className="manage-card manage-approval-rejected">
              <AlertTriangle size={18} />
              <h3>Grupo Recusado</h3>
              <p><strong>Motivo:</strong> {group.rejection_reason || 'Não informado'}</p>
              <p className="rejected-hint">Faça as alterações necessárias e entre em contato com o suporte para reavaliação.</p>
            </div>
          )}

          {/* Plan Type */}
          <div className="manage-card">
            <div className="manage-card-title">
              <CreditCard size={18} />
              <h3>Tipo de Conta / Plano</h3>
            </div>
            <div className="plan-type-grid">
              {PLAN_TYPES.map(pt => (
                <button
                  key={pt}
                  type="button"
                  className={`plan-type-btn ${!customPlanActive && planType === pt ? 'active' : ''}`}
                  onClick={() => { setPlanType(pt); setCustomPlanActive(false); }}
                >
                  {pt}
                </button>
              ))}
              <button
                type="button"
                className={`plan-type-btn custom ${customPlanActive ? 'active' : ''}`}
                onClick={() => { setCustomPlanActive(true); setPlanType(''); }}
              >
                Personalizado
              </button>
            </div>
            {customPlanActive && (
              <input
                type="text"
                className="plan-type-custom-input"
                value={planTypeCustom}
                onChange={e => setPlanTypeCustom(e.target.value)}
                placeholder="Digite o tipo de conta personalizado"
                style={{ marginTop: '0.5rem' }}
              />
            )}
            <button className="manage-save-btn" onClick={handleSavePlanType} disabled={saving}>
              <Save size={14} />
              Salvar
            </button>
          </div>

          {/* Billing Cycles */}
          <div className="manage-card">
            <div className="manage-card-title">
              <Calendar size={18} />
              <h3>Ciclos de Cobrança</h3>
            </div>
            <p className="section-desc" style={{ marginBottom: '0.75rem' }}>
              Selecione quais ciclos os membros poderão escolher.
            </p>
            <div className="cycles-grid">
              {[
                { value: 'monthly', label: 'Mensal' },
                { value: 'quarterly', label: 'Trimestral' },
                { value: 'semiannual', label: 'Semestral' },
                { value: 'annual', label: 'Anual' },
                { value: 'days', label: 'Dias' },
                { value: 'custom', label: 'Personalizado' },
              ].map(opt => (
                <label key={opt.value} className={`cycle-check ${availableCycles.includes(opt.value) ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={availableCycles.includes(opt.value)}
                    onChange={() => handleCycleToggle(opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>

            {availableCycles.includes('days') && (
              <div className="custom-cycle-fields" style={{ marginTop: '0.75rem' }}>
                <div className="manage-form-group">
                  <label>Quantidade de dias do ciclo *</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={daysCycleDays}
                    onChange={e => setDaysCycleDays(e.target.value)}
                    placeholder="Ex: 15"
                  />
                </div>
                <div className="manage-form-group">
                  <label>Label do ciclo</label>
                  <input
                    value={daysCycleLabel}
                    onChange={e => setDaysCycleLabel(e.target.value)}
                    placeholder="Ex: 15 Dias"
                  />
                </div>
              </div>
            )}

            {availableCycles.includes('custom') && (
              <div className="custom-cycle-fields" style={{ marginTop: '0.75rem' }}>
                <div className="manage-form-group">
                  <label>Meses do ciclo personalizado *</label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={customCycleMonths}
                    onChange={e => setCustomCycleMonths(e.target.value)}
                    placeholder="Ex: 4"
                  />
                </div>
                <div className="manage-form-group">
                  <label>Label do ciclo</label>
                  <input
                    value={customCycleLabel}
                    onChange={e => setCustomCycleLabel(e.target.value)}
                    placeholder="Ex: 4 Meses"
                  />
                </div>
              </div>
            )}

            <button className="manage-save-btn" onClick={handleSaveCycles} disabled={saving}>
              <Save size={14} />
              Salvar
            </button>
          </div>

          {/* Credentials */}
          <div className="manage-card">
            <div className="manage-card-title">
              <Key size={18} />
              <h3>Credenciais</h3>
            </div>

            {/* Credential Type Selector */}
            <div className="manage-form-group">
              <label>Tipo de Credencial</label>
              <div className="cred-type-grid">
                {[
                  { value: 'email_password', label: 'E-mail / Senha', icon: <Mail size={14} /> },
                  { value: 'link', label: 'Link de Acesso', icon: <Link size={14} /> },
                  { value: 'code', label: 'Código', icon: <Hash size={14} /> },
                  { value: 'invite', label: 'Convite', icon: <MessageSquare size={14} /> },
                  { value: 'custom', label: 'Personalizado', icon: <Settings size={14} /> },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`cred-type-btn ${credentialType === opt.value ? 'active' : ''}`}
                    onClick={() => setCredentialType(opt.value)}
                  >
                    {opt.icon}
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Fields based on type */}
            {credentialType === 'email_password' && (
              <>
                <div className="manage-form-group">
                  <label>E-mail</label>
                  <input
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    placeholder="conta@plataforma.com"
                  />
                </div>
                <div className="manage-form-group">
                  <label>Senha</label>
                  <div className="manage-password-input">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={e => setLoginPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                    <button type="button" className="manage-password-toggle" onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="manage-form-group">
                  <label>Instruções / Notas (opcional)</label>
                  <textarea
                    rows={3}
                    value={credentialNotes[credentialType] || ''}
                    onChange={e => setCredentialNotes({...credentialNotes, [credentialType]: e.target.value})}
                    placeholder="Passo a passo para ativar a conta..."
                  />
                </div>
              </>
            )}

            {credentialType === 'link' && (
              <>
                <div className="manage-form-group">
                  <label>Link de Acesso</label>
                  <input
                    value={credentialUrl}
                    onChange={e => setCredentialUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
                <div className="manage-form-group">
                  <label>Instruções / Notas (opcional)</label>
                  <textarea
                    rows={3}
                    value={credentialNotes[credentialType] || ''}
                    onChange={e => setCredentialNotes({...credentialNotes, [credentialType]: e.target.value})}
                    placeholder="Passo a passo para acessar..."
                  />
                </div>
              </>
            )}

            {credentialType === 'code' && (
              <>
                <div className="manage-form-group">
                  <label>Código de Acesso</label>
                  <input
                    value={credentialCode}
                    onChange={e => setCredentialCode(e.target.value)}
                    placeholder="Código de acesso"
                  />
                </div>
                <div className="manage-form-group">
                  <label>Instruções / Notas (opcional)</label>
                  <textarea
                    rows={3}
                    value={credentialNotes[credentialType] || ''}
                    onChange={e => setCredentialNotes({...credentialNotes, [credentialType]: e.target.value})}
                    placeholder="Passo a passo para usar o código..."
                  />
                </div>
              </>
            )}

            {credentialType === 'invite' && (
              <>
                <div className="manage-form-group">
                  <label>Link de Convite</label>
                  <input
                    value={credentialInvite}
                    onChange={e => setCredentialInvite(e.target.value)}
                    placeholder="https://... (link de convite)"
                  />
                </div>
                <div className="manage-form-group">
                  <label>Instruções / Notas (opcional)</label>
                  <textarea
                    rows={3}
                    value={credentialNotes[credentialType] || ''}
                    onChange={e => setCredentialNotes({...credentialNotes, [credentialType]: e.target.value})}
                    placeholder="Passo a passo para aceitar o convite..."
                  />
                </div>
              </>
            )}

            {credentialType === 'custom' && (
              <div className="manage-form-group">
                <label>Instruções / Notas</label>
                <textarea
                  rows={4}
                  value={credentialNotes[credentialType] || ''}
                  onChange={e => setCredentialNotes({...credentialNotes, [credentialType]: e.target.value})}
                  placeholder="Instruções personalizadas de acesso..."
                />
              </div>
            )}
            <button
              className="btn btn-primary btn-full"
              onClick={handleSaveCredentials}
              disabled={saving}
            >
              {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
              Salvar Credenciais
            </button>
          </div>

          {/* Danger Zone */}
          <div className="manage-card manage-danger-zone">
            <div className="manage-card-title">
              <AlertTriangle size={18} />
              <h3>Zona de Perigo</h3>
            </div>
            <p>Deletar o grupo remove todos os membros e cancela assinaturas ativas.</p>
            <button
              className="btn btn-danger btn-full"
              onClick={handleDeleteGroup}
              disabled={deleting}
            >
              {deleting ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
              Deletar Grupo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ManageGroup;
