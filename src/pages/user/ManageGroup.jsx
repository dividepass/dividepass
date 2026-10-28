import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Save, Trash2, Users, DollarSign, Settings, Key,
  CheckCircle, X, AlertTriangle, Eye, EyeOff, Link, Hash, Mail, MessageSquare, CreditCard,
  TrendingUp, ArrowDownRight, Calendar, QrCode, Info, Receipt, Wallet, Tag
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { simulateAmount, simulatePrice, brl, MIN_PRICE_PER_SLOT } from '../../lib/platformFee';
import { solicitarSaque } from '../../lib/walletApi';
import { useAuth } from '../../hooks/useAuth';
import EmailCodeSearch from '../../components/EmailCodeSearch';
import AdsToggle from '../../components/AdsToggle';
import {
  PIX_TYPE_OPTIONS, pixTypeLabel, pixTypePlaceholder,
  maskPixKey, unmaskPixKey, remaskPixKey,
} from '../../lib/pixKeyMask';
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
  const [groupBalance, setGroupBalance] = useState(0);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPixKey, setWithdrawPixKey] = useState('');
  const [withdrawPixType, setWithdrawPixType] = useState('cpf');
  const [withdrawing, setWithdrawing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingWithdrawal, setPendingWithdrawal] = useState(null);
  const [payments, setPayments] = useState([]);

  /* Chave PIX do grupo (o membro paga PARA ela) e as chaves disponiveis para
     saque (o dono recebe NELA). `pixOptions` junta os grupos do dono — a chave
     de cada um com o tipo gravado. O valor em tela é MASCARADO; o que vai
     para o banco é o cru (ver lib/pixKeyMask.js). */
  const [pixKey, setPixKey] = useState('');
  const [pixType, setPixType] = useState('cpf');
  const [hasPixColumn, setHasPixColumn] = useState(true);
  const [pixOptions, setPixOptions] = useState([]);
  const [pixDirty, setPixDirty] = useState(false);

  /* Selo de anúncios da conta compartilhada (coluna groups.has_ads).
     true = Com anúncios, false = Sem anúncios, null = Não mostrar. */
  const [hasAds, setHasAds] = useState(null);
  const [hasAdsColumn, setHasAdsColumn] = useState(false);

  /* Pedido de mudança do preço por vaga — não é uma edição direta: o valor
     passa pela equipe DividePass. */
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [newPrice, setNewPrice] = useState('');
  const [priceReason, setPriceReason] = useState('');
  const [requestingPrice, setRequestingPrice] = useState(false);

  /* Exclusão do grupo: modal próprio, com confirmação digitada. */
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

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

  /* Carrega o grupo. O ponteiro permite recarregar em silêncio depois de
     sincronizar assinaturas, sem piscar a tela inteira. */
  const loadGroupRef = useRef(null);

  useEffect(() => {
    const fetchGroup = async ({ silent = false } = {}) => {
      if (!groupId || !user) return;
      try {
        if (!silent) setLoading(true);

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
        setPixKey(maskPixKey(groupData.pix_key || '', groupData.pix_type || 'cpf'));
        setPixType(groupData.pix_type || 'cpf');
        /* A coluna `has_ads` só existe depois da migration
           database/add-group-has-ads.sql — o `select('*')` só devolve a chave
           quando ela existe, então nela dá para detectar sem gerar erro. */
        setHasAdsColumn('has_ads' in groupData);
        setHasAds(
          groupData.has_ads === true ? true : (groupData.has_ads === false ? false : null)
        );

        const [serviceRes, membersRes, credsRes, paymentsRes, subsRes, withdrawalsRes, walletRes] = await Promise.all([
          supabase.from('streaming_services').select('id, name, full_name, icon, icon_url, color, slug').eq('id', groupData.service_id).single(),
          supabase.from('group_members').select('user_id, created_at, status, user:user_id (id, name, email)').eq('group_id', groupId).order('created_at'),
          supabase.from('group_credentials').select('*').eq('group_id', groupId).maybeSingle(),
          supabase.from('payments').select('id, amount, method, status, payment_type, transaction_code, created_at, paid_at').eq('group_id', groupId).eq('status', 'paid').order('paid_at', { ascending: false }),
          supabase.from('user_subscriptions').select('*, user:user_id (id, name, email)').eq('group_id', groupId).order('created_at', { ascending: false }),
          supabase.from('wallet_withdrawals').select('id, amount, status, requested_at, processed_at, payment_method, notes').eq('user_id', user.id).order('requested_at', { ascending: false }),
          supabase.from('user_wallets').select('balance').eq('user_id', user.id).maybeSingle(),
        ]);

        if (serviceRes.data) setService(serviceRes.data);

        const activeMembers = (membersRes.data || []).filter(m => m.status === 'active');
        const paidPayments = paymentsRes.data || [];
        const allWithdrawals = withdrawalsRes.data || [];
        const pending = allWithdrawals.find(w => w.status === 'pending') || null;
        const completedWithdrawals = allWithdrawals.filter(w => w.status === 'completed');
        const grossRevenue = paidPayments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
        // Mesma regra de faixas usada no wizard e no repasse do banco.
        const totalFees = paidPayments.reduce((sum, payment) => {
          const amt = parseFloat(payment.amount) || 0;
          return sum + simulateAmount(amt, groupData.price_per_slot).platformFee;
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

        /* Chaves PIX dos grupos do dono — alimentam o dropdown de saque.
           Se a coluna `pix_key` ainda não existir no banco, a query falha e a
           gente segue só com o grupo atual (sem quebrar a tela). */
        try {
          const { data: owned, error: pixErr } = await supabase
            .from('groups')
            .select('id, name, pix_key, pix_type')
            .eq('owner_id', user.id);

          if (pixErr) {
            // PGRST204 = a coluna `pix_key` não existe no schema cache. Nesse
            // caso a tela avisa em vez de quebrar.
            if (pixErr.code === 'PGRST204' || /pix_key/i.test(pixErr.message || '')) {
              setHasPixColumn(false);
            } else {
              console.warn('[ManageGroup] chaves PIX indisponíveis:', pixErr.message);
            }
          } else {
            setHasPixColumn(true);
            const lista = (owned || [])
              .filter(g => g.pix_key)
              .map(g => ({
                key: g.pix_key,
                type: g.pix_type || 'cpf',
                group: g.name,
                current: g.id === groupId,
              }));
            setPixOptions(lista);
            const atual = lista.find(o => o.current) || lista[0];
            if (atual) {
              setWithdrawPixKey(atual.key);
              setWithdrawPixType(atual.type);
            }
          }
        } catch (e) {
          console.warn('[ManageGroup] chaves PIX indisponíveis:', e);
        }

        // A carteira e a fonte da verdade do que o dono pode sacar. O valor
        // derivado dos pagamentos serve de fallback enquanto a carteira nao
        // existe (ainda sem trigger de repasse no banco).
        const saldoCarteira = walletRes.data ? (parseFloat(walletRes.data.balance) || 0) : null;
        const saldoDerived = Math.max(0, netRevenue - totalWithdrawn);

        setGroupBalance(saldoCarteira !== null ? saldoCarteira : saldoDerived);
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
        if (!silent) setLoading(false);
      }
    };

    loadGroupRef.current = fetchGroup;
    fetchGroup();
  }, [groupId, user]);

  const financeGrossRevenue = payments.reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
  // A margem da plataforma segue a regra de faixas (definida pelo preço MENSAL
  // do grupo) — a mesma do wizard de criação e do repasse no banco.
  const financeFees = payments.reduce((sum, payment) => {
    const amount = parseFloat(payment.amount) || 0;
    return sum + simulateAmount(amount, group?.price_per_slot).platformFee;
  }, 0);
  const financeNetRevenue = financeGrossRevenue - financeFees;

  /* Simulação de UM ciclo mensal — o mesmo cálculo do repasse no banco
     (lib/platformFee.js), para o dono ver na hora quanto ele recebe. */
  const simulacao = simulatePrice(group?.price_per_slot);

  /* Simulação do valor PEDIDO no modal de novo preço (só aparece com número
     válido digitado). */
  const valorNovo = parseFloat(String(newPrice).replace(',', '.'));
  const simulacaoNovo = Number.isFinite(valorNovo) && valorNovo > 0 ? simulatePrice(valorNovo) : null;

  /* Quantas pessoas já pagaram neste grupo. Muda o texto (e o peso) do aviso
     de exclusão: com dinheiro dentro, o grupo precisa do acerto da equipe. */
  const pagadores = payments.length;
  const totalRecebido = financeGrossRevenue;

  /* "Salvar" só acende quando o valor realmente mudou — evita clicar sem
     efeito e mostra que a mudança ainda não foi para o banco. */
  const adsSalvo = group?.has_ads === true ? true : (group?.has_ads === false ? false : null);
  const adsDirty = hasAdsColumn && adsSalvo !== hasAds;

  const planDirty = adsDirty || (customPlanActive
    ? (group?.plan_type_custom || '') !== planTypeCustom
    : (group?.plan_type || '') !== planType);

  const ciclosSalvos = group?.available_cycles || [group?.billing_cycle || 'monthly'];
  const cyclesDirty =
    ciclosSalvos.length !== availableCycles.length ||
    ciclosSalvos.some(c => !availableCycles.includes(c));

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
      const resultado = await solicitarSaque({
        amount,
        paymentMethod: 'pix',
        pixKey: withdrawPixKey || null,
        pixType: withdrawPixType || 'cpf',
        notes: `Saque do grupo: ${group?.name}`,
      });
      if (!resultado.ok) throw new Error(resultado.error);

      setToast('Solicitação de saque enviada com sucesso!');
      setPendingWithdrawal({ amount, status: 'pending' });
      setWithdrawAmount('');
      setWithdrawPixKey('');

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
    setError('');
    try {
      const payload = {
        plan_type: customPlanActive ? null : (planType || null),
        plan_type_custom: customPlanActive ? (planTypeCustom || null) : null,
      };
      /* `has_ads` só entra no payload quando a coluna existe. E null =
         "Não mostrar" PRECISA ser enviado: sem isso, um grupo que antes estava
         como "Sem anúncios" continuaria com o selo antigo no card. */
      if (hasAdsColumn) {
        payload.has_ads = hasAds === true ? true : (hasAds === false ? false : null);
      }

      const { error } = await supabase
        .from('groups')
        .update(payload)
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

  const handleSavePix = async () => {
    if (!hasPixColumn) {
      setError('A coluna pix_key ainda não existe no banco. Aplique a migration database/add-group-pix.sql para gravar a chave.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      /* O que vai para o banco é a chave CRUA (só dígitos no CPF/CNPJ/
         telefone): chave PIX é consumida por máquina. Na tela ela aparece
         mascarada. */
      const valorCru = unmaskPixKey(pixKey, pixType);
      const { error } = await supabase
        .from('groups')
        .update({ pix_key: valorCru || null, pix_type: pixType })
        .eq('id', groupId);
      if (error) throw error;

      setGroup(prev => ({ ...prev, pix_key: valorCru || null, pix_type: pixType }));
      setPixDirty(false);
      setPixOptions(prev => {
        const resto = prev.filter(o => !o.current);
        if (!valorCru) return resto;
        return [{ key: valorCru, type: pixType, group: group?.name, current: true }, ...resto];
      });
      setToast('Chave PIX do grupo salva!');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  /* O preço por vaga NÃO é editável aqui: o valordefine a faixa de taxa da
     plataforma e é o que os membros já assinaram. O dono pede a mudança e a
     equipe DividePass aplica — o pedido entra como ticket, na mesma fila do
     suporte, para o admin responder. */
  const handleRequestPriceChange = async () => {
    const valor = parseFloat(String(newPrice).replace(',', '.'));
    const atual = parseFloat(group?.price_per_slot || 0);

    if (!Number.isFinite(valor) || valor <= 0) {
      setError('Informe o novo valor por vaga.');
      return;
    }
    if (valor < MIN_PRICE_PER_SLOT) {
      setError(`O valor mínimo por vaga é R$ ${MIN_PRICE_PER_SLOT.toFixed(2).replace('.', ',')}.`);
      return;
    }
    if (valor === atual) {
      setError('O novo valor é igual ao valor atual.');
      return;
    }

    setRequestingPrice(true);
    setError('');
    try {
      const sim = simulatePrice(valor);
      const assunto = `Novo preço por vaga — ${group?.name}`;
      const mensagem = [
        `Quero mudar o preço por vaga do grupo "${group?.name}".`,
        '',
        `Valor atual: R$ ${atual.toFixed(2).replace('.', ',')}`,
        `Valor pedido: R$ ${valor.toFixed(2).replace('.', ',')}`,
        '',
        `Nesse valor, a plataforma retém R$ ${sim.platformFee.toFixed(2).replace('.', ',')} (${sim.percent}%) e eu recebo R$ ${sim.net.toFixed(2).replace('.', ',')} por pessoa.`,
        priceReason.trim() ? `\nMotivo: ${priceReason.trim()}` : '',
      ].join('\n');

      const { data: ticket, error: ticketError } = await supabase
        .from('support_tickets')
        .insert({
          user_id: user.id,
          subject: assunto,
          category: 'billing',
          priority: 'normal',
          archived: false,
        })
        .select('id')
        .single();
      if (ticketError) throw ticketError;

      const { error: msgError } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: ticket.id,
          user_id: user.id,
          message: mensagem,
        });
      if (msgError) throw msgError;

      setShowPriceModal(false);
      setNewPrice('');
      setPriceReason('');
      setToast('Pedido enviado. A equipe DividePass vai analisar o novo valor.');
      navigate(`/dashboard/support/${ticket.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setRequestingPrice(false);
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
      await loadGroupRef.current?.({ silent: true });
    } catch (e) {
      setToast({ type: 'error', text: `Erro ao sincronizar: ${e.message}` });
    }
    setSyncing(false);
  };

  /* Exclusão do grupo. A confirmação acontece no modal (não é mais um
     window.confirm): o modal explica o que acontece com quem já pagou e
     exige digitar o nome do grupo. A edge function notifica os membros,
     cancela as assinaturas e abre o pedido de acerto para a equipe
     DividePass quando existe dinheiro recebido. */
  const handleDeleteGroup = async () => {
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
      setShowDeleteModal(false);
      setDeleteConfirmText('');
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

      {/* Erro de ação (salvar, saque, exclusão). Sem este banner a página
          engolia o erro: o setError guardava a mensagem e nada aparecia. */}
      {error && group && (
        <div className="manage-error-banner">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Fechar"><X size={14} /></button>
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

          {/* Busca de Código por E-mail — o dono/gestor puxa o código de acesso
              da conta compartilhada direto por aqui. */}
          {group?.email_code_enabled && (
            <div className="manage-card">
              <div className="manage-card-title">
                <Mail size={18} />
                <h3>Busca de Código por E-mail</h3>
              </div>
              <div className="manage-card-body">
                <EmailCodeSearch
                  groupId={groupId}
                  serviceId={group?.service_id || null}
                  serviceName={service?.name || ''}
                  title="Código de Acesso"
                  description="Código de verificação mais recente enviado para o e-mail deste grupo."
                  className="email-code-search--embedded"
                />
              </div>
            </div>
          )}

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
                <span>Total taxas da plataforma: R$ {brl(financeFees)}</span>
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
                        const fee = simulateAmount(amount, group?.price_per_slot).platformFee;
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
                    <div className="finance-pix-field">
                      <label htmlFor="withdraw-pix-key">Chave PIX para receber</label>
                      <select
                        id="withdraw-pix-key"
                        value={withdrawPixKey}
                        onChange={e => {
                          setWithdrawPixKey(e.target.value);
                          const opt = pixOptions.find(o => o.key === e.target.value);
                          setWithdrawPixType(opt?.type || 'cpf');
                        }}
                        className="finance-withdrawal-input finance-pix-select"
                        disabled={pixOptions.length === 0}
                      >
                        {pixOptions.length === 0 ? (
                          <option value="">Nenhuma chave PIX cadastrada</option>
                        ) : (
                          pixOptions.map(o => (
                            <option key={`${o.group}-${o.key}`} value={o.key}>
                              {maskPixKey(o.key, o.type)} · {pixTypeLabel(o.type)}{o.current ? ' · este grupo' : ''}
                            </option>
                          ))
                        )}
                      </select>
                      {pixOptions.length === 0 && (
                        <span className="finance-pix-hint">
                          Cadastre a chave em <strong>Gestão do Grupo</strong>.
                        </span>
                      )}
                    </div>
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
                  const totalFees = simulateAmount(amt, group?.price_per_slot).platformFee;
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

          {/* ══ Gestão do Grupo ══════════════════════════════════════════
              Card-mãe: como o dinheiro chega (PIX), quanto sobra em cada
              ciclo (simulação) e a zona de perigo. */}
          <div className="manage-card manage-master-card">
            <div className="manage-card-title">
              <Wallet size={18} />
              <h3>Gestão do Grupo</h3>
            </div>

            <div className="manage-card-body">
              {/* ── Recebimento ───────────────────────────────────────── */}
              <section className="manage-block">
                <div className="manage-block-head">
                  <QrCode size={16} />
                  <div>
                    <h4>Como o dinheiro chega até você?</h4>
                    <p>
                      Os membros pagam por PIX para a chave do grupo. É para lá que vão
                      a mensalidade e a taxa de adesão.
                    </p>
                  </div>
                </div>

                <div className="manage-form-group">
                  <label>PIX para transferir o valor *</label>
                  <input
                    value={pixKey}
                    onChange={e => { setPixKey(maskPixKey(e.target.value, pixType)); setPixDirty(true); }}
                    placeholder={pixTypePlaceholder(pixType)}
                    inputMode={pixType === 'email' || pixType === 'random' ? 'text' : 'numeric'}
                  />
                  <div className="pix-type-row">
                    {PIX_TYPE_OPTIONS.map(t => (
                      <button
                        key={t.value}
                        type="button"
                        className={`pix-type-btn ${pixType === t.value ? 'active' : ''}`}
                        onClick={() => {
                          /* Trocar o tipo remascara o que já estava digitado. */
                          setPixKey(remaskPixKey(pixKey, pixType, t.value));
                          setPixType(t.value);
                          setPixDirty(true);
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {!hasPixColumn && (
                    <div className="manage-warn">
                      <Info size={15} />
                      <span>
                        A coluna <code>pix_key</code> ainda não existe no banco, então a chave
                        não é gravada. Aplique a migration <code>database/add-group-pix.sql</code>{' '}
                        no SQL Editor do Supabase.
                      </span>
                    </div>
                  )}
                </div>

                <div className="manage-readonly-grid">
                  <div className="manage-readonly-item">
                    <span>Taxa de adesão</span>
                    <strong>
                      {group?.has_entrance_fee ? `R$ ${brl(group?.entrance_fee)}` : 'Sem taxa'}
                    </strong>
                  </div>
                  <div className="manage-readonly-item">
                    <span>Mensalidade por vaga</span>
                    <strong>R$ {brl(group?.price_per_slot)}</strong>
                    <button
                      type="button"
                      className="manage-inline-link"
                      onClick={() => {
                        setNewPrice(String(group?.price_per_slot || ''));
                        setPriceReason('');
                        setShowPriceModal(true);
                      }}
                    >
                      <Tag size={13} />
                      Solicitar novo valor
                    </button>
                  </div>
                </div>

                <button
                  className="manage-save-btn"
                  onClick={handleSavePix}
                  disabled={!pixDirty || saving}
                >
                  {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                  Salvar chave PIX
                </button>
              </section>

              {/* ── Simulação ─────────────────────────────────────────── */}
              <section className="manage-block">
                <div className="manage-block-head">
                  <Receipt size={16} />
                  <div>
                    <h4>Simulação de recebimento</h4>
                    <p>Um ciclo mensal, no preço atual de R$ {brl(group?.price_per_slot)}.</p>
                  </div>
                </div>

                <div className="sim-receipt">
                  <div className="sim-row">
                    <span>Valor cobrado por pessoa</span>
                    <strong className="sim-charged">R$ {brl(simulacao.price)}</strong>
                  </div>
                  <div className="sim-row">
                    <span>Valor da plataforma ({simulacao.percent}%)</span>
                    <strong className="sim-fee">R$ {brl(simulacao.platformFee)}</strong>
                  </div>
                  <div className="sim-divider" />
                  <div className="sim-row sim-row-total">
                    <span>Você recebe</span>
                    <strong className="sim-net">R$ {brl(simulacao.net)}</strong>
                  </div>
                </div>
                <p className="sim-footnote">
                  Simulação de um ciclo mensal. O valor da plataforma é o que a DividePass
                  retém a cada pagamento.
                </p>
              </section>

              {/* ── Zona de perigo ───────────────────────────────────── */}
              <section className="manage-block manage-block-danger">
                <div className="manage-block-head">
                  <AlertTriangle size={16} />
                  <div>
                    <h4>Zona de Perigo</h4>
                    <p>Deletar o grupo remove todos os membros e cancela as assinaturas ativas.</p>
                  </div>
                </div>
                <button
                  className="btn btn-danger btn-full"
                  onClick={() => { setShowDeleteModal(true); setDeleteConfirmText(''); }}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
                  Deletar Grupo
                </button>
              </section>
            </div>
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

            {/* Selo de anúncios da conta compartilhada. Só aparece quando a
                coluna `has_ads` existe no banco (migration add-group-has-ads). */}
            {hasAdsColumn && (
              <div className="manage-ads-block">
                <span className="manage-ads-label">A conta compartilhada tem anúncios?</span>
                <AdsToggle
                  value={hasAds}
                  onChange={(v) => { setHasAds(v); }}
                  hint="Aparece como selo no card do grupo no catálogo."
                />
              </div>
            )}
            <button className="manage-save-btn" onClick={handleSavePlanType} disabled={!planDirty || saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
              Salvar tipo de conta
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

            <button className="manage-save-btn" onClick={handleSaveCycles} disabled={!cyclesDirty || saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
              Salvar ciclos
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

          {/* Zona de Perigo → mora dentro do card "Gestão do Grupo", na
              coluna principal. A exclusão é uma decisão de gestão, não um
              item solto no rodapé da lateral. */}
        </div>
      </div>

      {/* ══ Modal: solicitar novo preço por vaga ══════════════════════════
          O preço não é editável direto — o dono pede e a equipe DividePass
          aplica. A simulação mostra o que muda de bolso do dono. */}
      {showPriceModal && (
        <div
          className="modal-overlay"
          onClick={() => { if (!requestingPrice) setShowPriceModal(false); }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="price-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-head">
              <div className="modal-icon"><Tag size={20} /></div>
              <div className="modal-headings">
                <h3 id="price-modal-title">Solicitar novo preço por vaga</h3>
                <p>Hoje o grupo cobra R$ {brl(group?.price_per_slot)} por vaga.</p>
              </div>
              <button
                className="modal-close"
                onClick={() => setShowPriceModal(false)}
                aria-label="Fechar"
                disabled={requestingPrice}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="modal-alert modal-alert-info">
                <Info size={18} />
                <div>
                  <strong>O valor só muda depois da aprovação</strong>
                  <span>
                    O preço define a taxa da plataforma e é o que os membros já
                    assinaram. A equipe DividePass analisa o pedido e aplica o
                    novo valor.
                  </span>
                </div>
              </div>

              <div className="price-request-field">
                <label htmlFor="new-price">Novo preço por vaga *</label>
                <div className="price-request-input">
                  <span>R$</span>
                  <input
                    id="new-price"
                    type="number"
                    step="0.01"
                    min={MIN_PRICE_PER_SLOT}
                    value={newPrice}
                    onChange={e => setNewPrice(e.target.value)}
                    placeholder="0,00"
                  />
                </div>
                <span className="price-request-hint">
                  Mínimo de R$ {brl(MIN_PRICE_PER_SLOT)} por vaga.
                </span>
              </div>

              {simulacaoNovo && (
                <div className="sim-receipt sim-receipt-compact">
                  <div className="sim-row">
                    <span>Valor cobrado por pessoa</span>
                    <strong className="sim-charged">R$ {brl(simulacaoNovo.price)}</strong>
                  </div>
                  <div className="sim-row">
                    <span>Valor da plataforma ({simulacaoNovo.percent}%)</span>
                    <strong className="sim-fee">R$ {brl(simulacaoNovo.platformFee)}</strong>
                  </div>
                  <div className="sim-divider" />
                  <div className="sim-row sim-row-total">
                    <span>Você recebe</span>
                    <strong className="sim-net">R$ {brl(simulacaoNovo.net)}</strong>
                  </div>
                </div>
              )}

              <div className="price-request-field">
                <label htmlFor="price-reason">Motivo (opcional)</label>
                <textarea
                  id="price-reason"
                  rows={3}
                  value={priceReason}
                  onChange={e => setPriceReason(e.target.value)}
                  placeholder="Explique por que o preço precisa mudar."
                />
              </div>
            </div>

            <div className="modal-foot">
              <button
                className="btn btn-outline"
                onClick={() => setShowPriceModal(false)}
                disabled={requestingPrice}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRequestPriceChange}
                disabled={requestingPrice || !simulacaoNovo}
              >
                {requestingPrice ? <Loader2 size={16} className="spin" /> : <Tag size={16} />}
                Enviar pedido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal de exclusão ═══════════════════════════════════════════
          Explica o que acontece, avisa quem já pagou e exige a digitação do
          nome do grupo. O aviso de que a ação é irreversível aparece SEMPRE. */}
      {showDeleteModal && (
        <div
          className="modal-overlay"
          onClick={() => { if (!deleting) setShowDeleteModal(false); }}
        >
          <div
            className="modal modal--danger"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-head">
              <div className="modal-icon"><AlertTriangle size={22} /></div>
              <div className="modal-headings">
                <h3 id="modal-title">Deletar o grupo {group?.name}?</h3>
                <p>Esta ação não tem como ser desfeita.</p>
              </div>
              <button
                className="modal-close"
                onClick={() => setShowDeleteModal(false)}
                aria-label="Fechar"
                disabled={deleting}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {pagadores > 0 ? (
                <div className="modal-alert">
                  <AlertTriangle size={18} />
                  <div>
                    <strong>{pagadores} pessoa(s) já pagaram neste grupo</strong>
                    <span>
                      Total recebido: R$ {brl(totalRecebido)}. Todos os membros serão
                      notificados, as assinaturas ativas serão canceladas e a equipe
                      DividePass recebe o pedido para remover os membros e acertar os
                      valores com quem pagou.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="modal-alert modal-alert-soft">
                  <Info size={18} />
                  <div>
                    <strong>Ninguém pagou neste grupo ainda</strong>
                    <span>
                      Não há assinatura ativa nem valor a devolver. Ao excluir, os
                      membros ({stats.activeMembers} ativo(s)) perdem o acesso e as
                      assinaturas pendentes são canceladas.
                    </span>
                  </div>
                </div>
              )}

              <ul className="modal-list">
                <li>Todos os membros e assinaturas do grupo são removidos.</li>
                <li>As credenciais de acesso do serviço são apagadas.</li>
                <li>O grupo não pode ser recuperado depois.</li>
              </ul>

              <label className="modal-confirm-label" htmlFor="delete-confirm">
                Digite <strong>{group?.name}</strong> para confirmar
              </label>
              <input
                id="delete-confirm"
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder={group?.name}
                className="modal-input"
                autoFocus
              />
            </div>

            <div className="modal-foot">
              <button
                className="btn btn-outline"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
              >
                Cancelar
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDeleteGroup}
                disabled={deleting || deleteConfirmText.trim() !== (group?.name || '')}
              >
                {deleting ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
                Deletar grupo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ManageGroup;
