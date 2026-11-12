/**
 * Pagamento pendente do usuário — o que o card do TOPO do dashboard usa.
 *
 * POR QUE ISTO EXISTE (e não fica dentro do componente)
 * ------------------------------------------------------
 * A regra "isto está vencido?" precisa de uma resposta única. Se a tela e o
 * card calculassem cada um por um lado, o painel dizia uma coisa e o card
 * dizia outra — e foi exatamente isso que aconteceu: o usuário via a
 * assinatura como "Pendente" enquanto o sistema já tinha cobrado.
 *
 * O QUE É "PENDENTE"
 * ------------------
 * Duas situações, e só duas:
 *
 *   1. A primeira cobrança nunca foi paga (`status = 'pending'`). A
 *      assinatura existe, mas o dinheiro não entrou — o acesso não foi
 *      liberado.
 *   2. A renovação venceu (`status = 'active'`/`'expired'` com a data de
 *      vencimento no passado). O acesso continua na carência, mas a
 *      renovação está em aberto.
 *
 * QUANDO O CARD APARECE
 * ---------------------
 * Só quando o vencimento **chegou**: é hoje ou já passou. Antes disso a
 * pessoa ainda tem tempo — mostrar um card de "pendência" no dia 25 de um
 * boleto que vence no dia 30 só assusta.
 *
 * Para a assinatura que nunca foi paga, o vencimento é o dia em que ela foi
 * criada (`started_at`): a primeira cobrança era devida dali para frente.
 */

import {
  ACCESS_CANCELLED,
  ACCESS_PENDING,
  subscriptionAccessState,
  subscriptionRenewalDate,
} from './subscriptionAccess.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Meia-noite do dia em que o instante cai.
 *
 * A regra é por DIA, não por instante: uma renovação que vence hoje às 18h
 * já é "de hoje" desde a meia-noite — o card aparece na primeira dobra do
 * dia, e não só depois das 18h.
 */
function inicioDoDia(time) {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Data em que o pagamento desta assinatura vence.
 *
 * `null` quando não há pendência nenhuma (assinatura em dia).
 */
export function pendingPaymentDate(sub, now = Date.now()) {
  if (!sub) return null;

  const state = subscriptionAccessState(sub, now);
  // Cancelada (ou inativa) não tem nada a pagar: o caminho é o histórico.
  if (state === ACCESS_CANCELLED) return null;

  if (state === ACCESS_PENDING) {
    // A primeira cobrança era devida quando a assinatura foi criada.
    const raw = sub.started_at || sub.created_at || null;
    if (!raw) return null;
    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? null : time;
  }

  // Ativa (ou atrasada): o próximo pagamento vence na data de renovação.
  // Ela conta mesmo antes do instante exato — o aviso é do DIA.
  const raw = subscriptionRenewalDate(sub);
  if (!raw) return null;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * O pagamento venceu (é hoje ou já passou)?
 *
 * "Hoje" conta o dia INTEIRO: uma cobrança que vence mais tarde hoje já
 * entra no card — o aviso é do dia, não do minuto.
 */
export function isPaymentDue(sub, now = Date.now()) {
  const time = pendingPaymentDate(sub, now);
  if (time === null) return false;
  return inicioDoDia(time) <= inicioDoDia(now);
}

/**
 * Dias até o vencimento. Negativo = dias de atraso; 0 = vence hoje.
 * `null` quando não há pendência nenhuma.
 */
export function daysUntilPaymentDue(sub, now = Date.now()) {
  const time = pendingPaymentDate(sub, now);
  if (time === null) return null;
  return Math.round((inicioDoDia(time) - inicioDoDia(now)) / DAY_MS);
}

/**
 * Assinaturas com pagamento em aberto e vencidas.
 *
 * A ordem é pela mais antiga primeiro: é a que está mais "perdida" e a que
 * a pessoa precisa resolver antes.
 */
export function pendingPayments(list, now = Date.now()) {
  return (list || [])
    .filter((sub) => isPaymentDue(sub, now))
    .sort((a, b) => {
      const ta = pendingPaymentDate(a, now) || 0;
      const tb = pendingPaymentDate(b, now) || 0;
      return ta - tb;
    });
}

/** O usuário tem assinatura (mesmo que pendente)? */
export function hasAnySubscription(list) {
  return (list || []).length > 0;
}

/** Texto curto do prazo, para o card ("vence hoje", "3 dias em atraso"). */
export function dueLabel(sub, now = Date.now()) {
  const days = daysUntilPaymentDue(sub, now);
  if (days === null) return '';
  if (days === 0) return 'vence hoje';
  if (days < 0) {
    const atraso = Math.abs(days);
    return `${atraso} ${atraso === 1 ? 'dia' : 'dias'} em atraso`;
  }
  return `vence em ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

export { DAY_MS };
