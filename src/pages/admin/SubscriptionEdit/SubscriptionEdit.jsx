import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Loader2, Save, AlertTriangle, ArrowRightLeft, Users } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { cycleLabel, cycleMonths, cycleTotalFromMonthly, round2 } from '../../../lib/subscriptionCycles';
import './SubscriptionEdit.css';

const STATUS_OPTIONS = ['active', 'inactive', 'cancelled', 'expired', 'pending', 'first_attempt', 'overdue'];
const CYCLE_OPTIONS = ['monthly', 'quarterly', 'semiannual', 'annual', 'days', 'custom'];

const statusLabel = (s) => ({ active: 'Ativa', inactive: 'Inativa', cancelled: 'Cancelada', expired: 'Expirada', pending: 'Pendente', first_attempt: 'Primeira Tentativa', overdue: 'Atrasada' }[s] || s);

const money = (v) => `R$ ${Number(v || 0).toFixed(2)}`;

/**
 * Meses do ciclo para efeito de preço.
 * `groups.price_per_slot` é o preço MENSAL da vaga e `user_subscriptions.amount`
 * é o TOTAL do ciclo: por isso o total é sempre preço × meses.
 * Ciclo personalizado sem `custom_cycle_months` cai para 1 mês (a tela avisa).
 */
function monthsForPrice(cycle, customCycleMonths) {
  if (cycle === 'custom') {
    const months = Number(customCycleMonths);
    return months > 0 ? months : 1;
  }
  // Ciclo em dias: 0 meses — o preço da vaga já é o total do período.
  return cycleMonths(cycle, customCycleMonths);
}

function customCycleMissing(cycle, customCycleMonths) {
  return cycle === 'custom' && !(Number(customCycleMonths) > 0);
}

// Libera o perfil/credencial que estava atribuído ao usuário no grupo informado.
async function releaseAssignments(groupId, userId) {
  await supabase
    .from('group_profiles')
    .update({ assigned_to: null })
    .eq('group_id', groupId)
    .eq('assigned_to', userId);

  await supabase
    .from('group_credentials')
    .update({ assigned_to: null })
    .eq('group_id', groupId)
    .eq('assigned_to', userId);
}

// Move a assinatura de um grupo para outro, mantendo o usuário vinculado
// (e com acesso às credenciais) apenas no grupo de destino.
async function transferSubscription({ sub, targetGroup, payload }) {
  const now = new Date().toISOString();
  const oldGroupId = sub.group_id;
  const newGroupId = targetGroup.id;
  const userId = sub.user_id;

  // 1) Conflito: o usuário já tem assinatura no grupo de destino.
  //    A constraint UNIQUE(user_id, group_id) impede duas assinaturas no
  //    mesmo grupo, então a antiga precisa ser removida.
  const { data: conflicts, error: conflictErr } = await supabase
    .from('user_subscriptions')
    .select('id, status')
    .eq('user_id', userId)
    .eq('group_id', newGroupId)
    .neq('id', sub.id);
  if (conflictErr) throw conflictErr;

  if (conflicts && conflicts.length > 0) {
    const lista = conflicts.map(c => statusLabel(c.status)).join(', ');
    const ok = window.confirm(
      `Este usuário já possui uma assinatura (${lista}) no grupo de destino.\n\n` +
      `A assinatura existente será cancelada e removida para permitir a transferência ` +
      `(o banco não permite duas assinaturas do mesmo usuário no mesmo grupo).\n\n` +
      `Os pagamentos já feitos continuam no histórico. ` +
      `Se o gateway ainda cobrar essa assinatura, cancele a recorrência lá também.\n\n` +
      `Deseja continuar?`
    );
    if (!ok) return { ok: false, cancelled: true };

    await supabase
      .from('user_subscriptions')
      .update({ status: 'cancelled', updated_at: now })
      .eq('id', conflicts[0].id);

    await supabase
      .from('group_members')
      .update({ status: 'cancelled', left_at: now, payment_status: 'cancelled' })
      .eq('group_id', newGroupId)
      .eq('user_id', userId);

    await releaseAssignments(newGroupId, userId);

    const { error: delErr } = await supabase
      .from('user_subscriptions')
      .delete()
      .eq('id', conflicts[0].id);
    if (delErr) throw delErr;
  }

  // 2) Vaga no grupo de destino (max_size).
  const { data: targetMembers, error: memErr } = await supabase
    .from('group_members')
    .select('id, user_id, status')
    .eq('group_id', newGroupId)
    .eq('status', 'active');
  if (memErr) throw memErr;

  const activeCount = (targetMembers || []).filter(m => m.user_id !== userId).length;
  const maxSize = Number(targetGroup.max_size || 0);
  if (maxSize > 0 && activeCount >= maxSize) {
    const ok = window.confirm(
      `O grupo de destino já tem ${activeCount} membro(s) ativo(s) e o limite é ${maxSize}.\n\n` +
      `Transferir mesmo assim?`
    );
    if (!ok) return { ok: false, cancelled: true };
  }

  // 3) Move a assinatura. Feito antes de soltar o grupo antigo: se falhar,
  //    o usuário continua vinculado ao grupo anterior.
  const { error: subError } = await supabase
    .from('user_subscriptions')
    .update({
      ...payload,
      group_id: newGroupId,
      service_id: targetGroup.service_id || sub.service_id,
      updated_at: now,
    })
    .eq('id', sub.id);
  if (subError) throw subError;

  // 4) Desvincula do grupo antigo (dispara release de perfil/credencial).
  await supabase
    .from('group_members')
    .update({ status: 'cancelled', left_at: now, payment_status: 'cancelled' })
    .eq('group_id', oldGroupId)
    .eq('user_id', userId);

  await releaseAssignments(oldGroupId, userId);

  // 5) Vincula no grupo novo. O INSERT/UPDATE dispara os triggers
  //    auto_assign_profile / auto_assign_credential, que entregam a
  //    credencial do novo grupo para o usuário.
  const isActive = sub.status === 'active';
  const { error: upsertErr } = await supabase
    .from('group_members')
    .upsert({
      group_id: newGroupId,
      user_id: userId,
      status: isActive ? 'active' : 'cancelled',
      payment_status: isActive ? 'active' : 'cancelled',
      joined_at: now,
      left_at: isActive ? null : now,
      subscription_deadline: isActive ? (payload.next_charge_at || null) : null,
    }, { onConflict: 'group_id, user_id' });
  if (upsertErr) throw upsertErr;

  return { ok: true };
}

export default function SubscriptionEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sub, setSub] = useState(null);
  const [original, setOriginal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [targetGroupId, setTargetGroupId] = useState('');
  // O admin digitou o valor à mão? aí o valor manual vale sobre o cálculo.
  const [amountTouched, setAmountTouched] = useState(false);
  const [priceNotice, setPriceNotice] = useState('');

  useEffect(() => {
    const fetchSub = async () => {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*, user:user_id (id, name, email), group:group_id (id, name, owner_id), service:service_id (id, name, full_name)')
        .eq('id', id)
        .single();
      if (error) { setError(error.message); setLoading(false); return; }
      setSub(data);
      setOriginal({
        amount: Number(data.amount || 0),
        billing_cycle: data.billing_cycle,
        group_id: data.group_id,
      });
      setTargetGroupId(data.group_id);
      setLoading(false);
    };
    fetchSub();
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    const fetchGroups = async () => {
      try {
        // `custom_cycle_months` existe em alguns ambientes: se a coluna não
        // existir, a consulta volta sem ela em vez de quebrar a tela.
        const fields = 'id, name, service_id, price_per_slot, billing_cycle, max_size, status, cycle_discount, custom_cycle_months, service:service_id (id, name)';
        const fallbackFields = 'id, name, service_id, price_per_slot, billing_cycle, max_size, status, cycle_discount, service:service_id (id, name)';

        let result = await supabase
          .from('groups')
          .select(fields)
          .order('name', { ascending: true });

        if (result.error) {
          const retry = await supabase
            .from('groups')
            .select(fallbackFields)
            .order('name', { ascending: true });
          if (retry.error) throw retry.error;
          result = { data: retry.data, error: null };
        }

        if (result.error) throw result.error;
        if (!cancelled) setGroups(result.data || []);
      } catch (err) {
        if (!cancelled) setError('Erro ao carregar grupos: ' + err.message);
      } finally {
        if (!cancelled) setGroupsLoading(false);
      }
    };

    fetchGroups();
    return () => { cancelled = true; };
  }, []);

  const groupedGroups = useMemo(() => {
    const map = new Map();
    for (const g of groups) {
      const key = g.service?.name || 'Sem serviço vinculado';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(g);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [groups]);

  const targetGroup = useMemo(
    () => groups.find(g => g.id === targetGroupId) || null,
    [groups, targetGroupId]
  );

  const isTransfer = !!(sub && targetGroupId && targetGroupId !== sub.group_id);

  // Grupo que manda no preço: o de destino numa transferência, o atual da
  // assinatura nos demais casos.
  const priceGroup = useMemo(() => {
    if (targetGroup) return targetGroup;
    return groups.find(g => g.id === sub?.group_id) || null;
  }, [targetGroup, groups, sub?.group_id]);

  // `groups.price_per_slot` é o preço MENSAL da vaga.
  const groupMonthlyPrice = priceGroup?.price_per_slot != null ? Number(priceGroup.price_per_slot) : null;
  const groupCycleDiscount = Number(priceGroup?.cycle_discount || 0);

  // Meses do ciclo atual da assinatura (1 quando o ciclo é personalizado sem
  // informação; 0 no ciclo em dias, em que o preço já é o total).
  const priceMonths = useMemo(
    () => monthsForPrice(sub?.billing_cycle, sub?.custom_cycle_months),
    [sub?.billing_cycle, sub?.custom_cycle_months]
  );

  // Decomposição exibida abaixo do campo de valor.
  const priceBreakdown = useMemo(() => {
    if (!sub) return '';
    if (groupMonthlyPrice == null) {
      return 'Este grupo não tem preço por vaga definido — o valor gravado é mantido como está.';
    }
    if (sub.billing_cycle === 'days') {
      return `Ciclo em dias: R$ ${groupMonthlyPrice.toFixed(2)} é o total do período (${sub.custom_cycle_days || '—'} dias).`;
    }

    const total = cycleTotalFromMonthly(groupMonthlyPrice, priceMonths);
    const current = Number(sub.amount || 0);
    const differs = Math.abs(current - total) > 0.005;

    return `R$ ${groupMonthlyPrice.toFixed(2)}/mês × ${priceMonths} ${priceMonths > 1 ? 'meses' : 'mês'} = R$ ${total.toFixed(2)}`
      + (differs ? ` · valor atual R$ ${current.toFixed(2)} (ajuste manual)` : '');
  }, [sub, groupMonthlyPrice, priceMonths]);

  const handleGroupChange = (value) => {
    setTargetGroupId(value);
    const g = groups.find(x => x.id === value);
    if (!g || !sub) return;

    // Herda preço e ciclo do novo grupo. O valor gravado é o TOTAL do ciclo
    // (preço mensal × meses) — nunca o preço mensal sozinho.
    const cycle = g.billing_cycle || sub.billing_cycle;
    const groupCustomMonths = Number(g.custom_cycle_months) > 0 ? Number(g.custom_cycle_months) : null;
    const customMonths = cycle === 'custom' ? (groupCustomMonths || sub.custom_cycle_months || null) : null;
    const months = monthsForPrice(cycle, customMonths);
    const price = g.price_per_slot != null ? Number(g.price_per_slot) : null;

    setSub(prev => ({
      ...prev,
      billing_cycle: cycle,
      custom_cycle_months: customMonths,
      amount: price != null ? cycleTotalFromMonthly(price, months) : prev.amount,
    }));
    setAmountTouched(false);

    if (price == null) {
      setPriceNotice(`"${g.name}" não tem preço por vaga definido: o valor atual foi mantido.`);
    } else if (customCycleMissing(cycle, customMonths)) {
      setPriceNotice(`"${g.name}" usa ciclo personalizado: informe quantos meses o ciclo dura. Foi usado 1 mês como referência (R$ ${price.toFixed(2)}).`);
    } else {
      setPriceNotice(`Valor do ciclo ajustada para "${g.name}": R$ ${price.toFixed(2)}/mês × ${months} ${months > 1 ? 'meses' : 'mês'} = R$ ${cycleTotalFromMonthly(price, months).toFixed(2)}.`);
    }
  };

  const handleCycleChange = (cycle) => {
    if (!sub) return;

    const prevAmount = Number(sub.amount || 0);
    const customMonths = cycle === 'custom' ? (sub.custom_cycle_months || null) : null;
    const months = monthsForPrice(cycle, customMonths);
    const price = groupMonthlyPrice;
    const nextAmount = price != null ? cycleTotalFromMonthly(price, months) : prevAmount;
    const delta = nextAmount - prevAmount;

    setSub(prev => ({
      ...prev,
      billing_cycle: cycle,
      custom_cycle_days: cycle === 'days' ? (prev.custom_cycle_days || null) : null,
      custom_cycle_months: customMonths,
      amount: nextAmount,
    }));
    setAmountTouched(false);

    if (price == null) {
      setPriceNotice('Este grupo não tem preço por vaga definido: o valor atual foi mantido.');
    } else if (customCycleMissing(cycle, customMonths)) {
      setPriceNotice('Ciclo personalizado: informe quantos meses o ciclo dura (1 mês foi usado como referência).');
    } else if (Math.abs(delta) > 0.005) {
      setPriceNotice(`Ciclo ${cycleLabel(cycle)}: total do ciclo R$ ${nextAmount.toFixed(2)} (antes R$ ${prevAmount.toFixed(2)}, ${delta > 0 ? '+' : '-'}R$ ${Math.abs(delta).toFixed(2)}).`);
    } else {
      setPriceNotice(`Ciclo ${cycleLabel(cycle)}: total do ciclo R$ ${nextAmount.toFixed(2)}.`);
    }
  };

  const handleCustomMonthsChange = (months) => {
    if (!sub) return;

    const prevAmount = Number(sub.amount || 0);
    const nextAmount = (groupMonthlyPrice != null && !amountTouched)
      ? cycleTotalFromMonthly(groupMonthlyPrice, monthsForPrice('custom', months))
      : prevAmount;

    setSub(prev => ({ ...prev, custom_cycle_months: months, amount: nextAmount }));

    if (groupMonthlyPrice == null) {
      setPriceNotice('Este grupo não tem preço por vaga definido: o valor atual foi mantido.');
    } else if (!(months > 0)) {
      setPriceNotice('Informe quantos meses o ciclo dura: o total do ciclo depende disso (1 mês foi usado como referência).');
    } else {
      setPriceNotice(`Ciclo de ${months} ${months > 1 ? 'meses' : 'mês'}: total do ciclo R$ ${nextAmount.toFixed(2)}.`);
    }
  };

  const notifyTransfer = async (fromName, toName) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      const baseUrl = import.meta.env.VITE_SUPABASE_URL || supabase.supabaseUrl;
      if (!accessToken || !baseUrl) return;

      await fetch(`${baseUrl}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || supabase.supabaseKey,
        },
        body: JSON.stringify({
          audience: { type: 'users', user_ids: [sub.user_id] },
          title: 'Assinatura transferida',
          message: `Sua assinatura foi transferida do grupo "${fromName}" para o grupo "${toName}".`,
          event_type: 'subscription_transferred',
          channels: ['in_app'],
          url: '/dashboard/credentials',
          metadata: { from_group: sub.group_id, to_group: targetGroup.id, admin: true },
        }),
      });
    } catch {
      // notificação é best-effort: não bloqueia a transferência
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const prevCycle = original?.billing_cycle;
      const prevAmount = Number(original?.amount || 0);
      const newCycle = sub.billing_cycle;
      const cycleChanged = prevCycle !== newCycle || prevAmount !== Number(sub.amount);

      // O valor gravado é o TOTAL do ciclo (preço mensal × meses). Se o admin
      // trocou o ciclo e não digitou o valor à mão, o total é recalculado a
      // partir do preço da vaga; se ele digitou, o valor manual vale.
      const months = monthsForPrice(newCycle, sub.custom_cycle_months);
      const amountToSave = (!amountTouched && groupMonthlyPrice != null)
        ? cycleTotalFromMonthly(groupMonthlyPrice, months)
        : Number(sub.amount);
      const newAmount = amountToSave;

      const payload = {
        amount: round2(amountToSave),
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

      if (isTransfer && targetGroup) {
        const oldGroupName = sub.group?.name || 'grupo atual';
        const ok = window.confirm(
          `Transferir a assinatura de "${sub.user?.name || 'usuário'}"\n` +
          `de "${oldGroupName}" para "${targetGroup.name}"?\n\n` +
          `• O membro sai do grupo atual e passa a ter acesso às credenciais do novo grupo.\n` +
          `• Valor do ciclo: ${money(prevAmount)} → ${money(newAmount)} (${cycleLabel(newCycle)}).`
          + (groupMonthlyPrice != null ? ` ${money(groupMonthlyPrice)}/mês × ${months} ${months > 1 ? 'meses' : 'mês'}.` : '') + '\n' +
          `• Os pagamentos já feitos permanecem linked ao grupo antigo.\n` +
          `• Se o gateway cobrar recorrência pelo valor antigo (Mercado Pago), ajuste lá.`
        );
        if (!ok) { setSaving(false); return; }

        const result = await transferSubscription({ sub, targetGroup, payload });
        if (!result.ok) { setSaving(false); return; }

        await notifyTransfer(oldGroupName, targetGroup.name);

        setSub(prev => ({
          ...prev,
          ...payload,
          group_id: targetGroup.id,
          service_id: targetGroup.service_id || prev.service_id,
          group: { ...(prev.group || {}), id: targetGroup.id, name: targetGroup.name },
        }));
        setOriginal({
          amount: newAmount,
          billing_cycle: newCycle,
          group_id: targetGroup.id,
        });
        setTargetGroupId(targetGroup.id);
        setSuccess(`Assinatura transferida para "${targetGroup.name}". O usuário já está vinculado ao novo grupo.`);
        setTimeout(() => setSuccess(''), 6000);
        return;
      }

      const { error: subError } = await supabase
        .from('user_subscriptions')
        .update(payload)
        .eq('id', sub.id);
      if (subError) throw subError;

      setOriginal({
        amount: newAmount,
        billing_cycle: newCycle,
        group_id: sub.group_id,
      });

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
            <label>ID Externo</label>
            <p className="mono">{sub.external_reference || '—'}</p>
          </div>
          <div className="sub-edit-info">
            <label>Cartão</label>
            <p>{sub.card_last4 ? `•••• ${sub.card_last4} ${sub.card_brand || ''}` : 'Sem cartão'}</p>
            {sub.card_id && <span className="mono" style={{ fontSize: '0.78rem' }}>ID: {sub.card_id}</span>}
          </div>
          <div className="sub-edit-info">
            <label>Assinatura criada em</label>
            <p>{sub.created_at ? new Date(sub.created_at).toLocaleDateString('pt-BR') : '—'}</p>
          </div>
        </div>

        <div className="sub-edit-divider" />

        <div className="sub-edit-fields">
          <div className="form-group">
            <label>Grupo</label>
            <select
              value={targetGroupId}
              onChange={(e) => handleGroupChange(e.target.value)}
              disabled={groupsLoading}
            >
              {groupsLoading && <option value={targetGroupId}>Carregando grupos...</option>}
              {!groupsLoading && groups.length === 0 && <option value="">Nenhum grupo encontrado</option>}
              {!groupsLoading && groupedGroups.map(([serviceName, items]) => (
                <optgroup key={serviceName} label={serviceName}>
                  {items.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name} — {money(g.price_per_slot)}/mês
                      {g.billing_cycle ? ` (ciclo do grupo: ${cycleLabel(g.billing_cycle)})` : ''}
                      {g.status && g.status !== 'open' ? ` (${g.status})` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="field-hint">
              Grupo atual: <strong>{sub.group?.name || '—'}</strong>
              {sub.service ? ` · Serviço: ${sub.service.full_name || sub.service.name}` : ''}
            </span>
          </div>

          {isTransfer && targetGroup && (
            <div className="transfer-box">
              <div className="transfer-head">
                <ArrowRightLeft size={16} />
                <span>Transferindo assinatura</span>
              </div>
              <ul>
                <li>
                  <span className="transfer-label">De</span>
                  {sub.group?.name || '—'}
                  {sub.service ? ` (${sub.service.full_name || sub.service.name})` : ''}
                </li>
                <li>
                  <span className="transfer-label">Para</span>
                  {targetGroup.name}
                  {targetGroup.service ? ` (${targetGroup.service.name})` : ''}
                </li>
                <li>
                  <span className="transfer-label">Valor</span>
                  {money(original?.amount)} → {money(sub.amount)} · {cycleLabel(sub.billing_cycle)}
                  {targetGroup.price_per_slot != null && (
                    <em className="transfer-hint">
                      {' '}(vaga do novo grupo: {money(targetGroup.price_per_slot)}/mês × {priceMonths} {priceMonths > 1 ? 'meses' : 'mês'}
                      {' '}= {money(cycleTotalFromMonthly(Number(targetGroup.price_per_slot), priceMonths))})
                    </em>
                  )}
                </li>
                <li>
                  <span className="transfer-label">Efeito</span>
                  O membro sai do grupo atual e entra no novo, já com a credencial do destino.
                </li>
                {targetGroup.service_id && sub.service_id && targetGroup.service_id !== sub.service_id && (
                  <li className="transfer-warn">
                    <AlertTriangle size={14} />
                    Serviço muda de {sub.service?.name || '—'} para {targetGroup.service?.name || '—'}.
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="form-row-2">
            <div className="form-group">
              <label>Valor do ciclo (R$)</label>
              <input
                type="number" step="0.01" min="0"
                value={sub.amount}
                onChange={(e) => {
                  setSub({ ...sub, amount: e.target.value });
                  setAmountTouched(true);
                  setPriceNotice('');
                }}
                required
              />
              <span className="field-hint">{priceBreakdown}</span>
              {amountTouched && (
                <span className="field-hint field-hint-manual">
                  Valor digitado à mão: ele prevalece sobre o cálculo automático.
                </span>
              )}
              {groupCycleDiscount > 0 && (
                <span className="field-hint field-hint-discount">
                  Este grupo tem {groupCycleDiscount}% de desconto para ciclos maiores — informação apenas,
                  o valor gravado não é descontado.
                </span>
              )}
            </div>
            <div className="form-group">
              <label>Ciclo de Faturamento</label>
              <select value={sub.billing_cycle} onChange={(e) => handleCycleChange(e.target.value)}>
                {CYCLE_OPTIONS.map(c => <option key={c} value={c}>{cycleLabel(c)}</option>)}
              </select>
              <span className="field-hint">
                O valor gravado é sempre o total do ciclo ({priceMonths > 0 ? `${priceMonths} ${priceMonths > 1 ? 'meses' : 'mês'}` : 'ciclo em dias'}).
              </span>
            </div>
          </div>

          {priceNotice && (
            <div className="price-notice">
              <AlertTriangle size={16} />
              <span>{priceNotice}</span>
            </div>
          )}

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
                onChange={(e) => handleCustomMonthsChange(e.target.value ? Number(e.target.value) : null)}
                placeholder="Ex: 2 para cobrança a cada 2 meses"
                required
              />
              <span className="field-hint">
                Define quantos meses o ciclo dura — o total do ciclo é o preço mensal × esses meses.
              </span>
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

          {isTransfer && (
            <div className="sub-edit-note transfer-note">
              <Users size={16} />
              <span>
                Salvar com um grupo diferente move o usuário: ele é desvinculado do grupo atual
                (perde o acesso às credenciais dele) e vinculado ao novo grupo.
              </span>
            </div>
          )}

        <div className="sub-edit-actions">
          <button type="button" className="btn btn-outline" onClick={() => navigate(-1)}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <><Loader2 size={16} className="spin" /> Salvando...</> : <><Save size={16} /> {isTransfer ? 'Transferir assinatura' : 'Salvar Alterações'}</>}
          </button>
        </div>
      </form>
    </div>
  );
}
