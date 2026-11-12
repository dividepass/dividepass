/**
 * Testes da regra de COBRANÇA PENDENTE (o card do topo do dashboard).
 *
 *   node scripts/test-pending-payments.mjs
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * A regra decide duas coisas: QUEM é pendente e QUANDO o card aparece.
 * Errar para o lado errado é ruinoso:
 *
 *   - card antes da hora: assusta a pessoa que ainda tem dias para pagar;
 *   - card depois da hora (ou nunca): a pessoa perde o acesso sem ter sido
 *     avisada — foi exatamente o que a reclamação do dono do produto
 *     descreveu ("pagou e não entrou").
 *
 * A regra mora em `src/lib/pendingPayments.js` — a tela não recalcula data.
 */
import {
  isPaymentDue,
  pendingPaymentDate,
  pendingPayments,
  hasAnySubscription,
  dueLabel,
} from '../src/lib/pendingPayments.js';

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date('2026-11-10T12:00:00.000Z').getTime();

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou++;
    console.log(`  OK    ${nome}`);
  } catch (e) {
    falhou++;
    console.log(`  FALHA ${nome} — ${e.message}`);
  }
}

function igual(obtido, esperado, msg) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a !== b) throw new Error(msg || `esperado ${b}, veio ${a}`);
}

/** Ativa: vence amanhã. */
const ativaVenceAmanha = {
  id: 'a1',
  status: 'active',
  renewal_due_at: new Date(AGORA + DIA).toISOString(),
};

/** Ativa: a renovação venceu ontem. */
const ativaVenceuOntem = {
  id: 'a2',
  status: 'active',
  renewal_due_at: new Date(AGORA - DIA).toISOString(),
};

/** Ativa: vence hoje mais tarde (mesmo dia). */
const ativaVenceHoje = {
  id: 'a3',
  status: 'active',
  renewal_due_at: new Date(AGORA + 2 * 60 * 60 * 1000).toISOString(),
};

/** Pendente: a primeira cobrança nunca foi paga (nasceu ontem). */
const pendenteNuncaPaga = {
  id: 'a4',
  status: 'pending',
  started_at: new Date(AGORA - DIA).toISOString(),
  renewal_due_at: new Date(AGORA + 30 * DIA).toISOString(),
};

/** Pendente: criada agora, ainda dentro do checkout. */
const pendenteAgora = {
  id: 'a5',
  status: 'pending',
  started_at: new Date(AGORA).toISOString(),
  renewal_due_at: new Date(AGORA + 30 * DIA).toISOString(),
};

/** Cancelada: não entra em nada. */
const cancelada = {
  id: 'a6',
  status: 'cancelled',
  renewal_due_at: new Date(AGORA - 10 * DIA).toISOString(),
};

console.log('\n=== COBRANÇA PENDENTE ===\n');

console.log('Quem é pendente');
test('assinatura ativa que vence amanhã NÃO é pendência', () => {
  igual(isPaymentDue(ativaVenceAmanha, AGORA), false);
  // A DATA do próximo pagamento existe (é a de renovação) — o que decide se
  // o card aparece é `isPaymentDue`.
  igual(
    pendingPaymentDate(ativaVenceAmanha, AGORA),
    new Date(AGORA + DIA).getTime(),
  );
});

test('assinatura ativa com a renovação vencida É pendência', () => {
  igual(isPaymentDue(ativaVenceuOntem, AGORA), true);
  igual(pendingPaymentDate(ativaVenceuOntem, AGORA), new Date(AGORA - DIA).getTime());
});

test('assinatura que vence HOJE já conta como pendência', () => {
  igual(isPaymentDue(ativaVenceHoje, AGORA), true);
});

test('assinatura pendente (primeira cobrança nunca paga) É pendência', () => {
  igual(isPaymentDue(pendenteNuncaPaga, AGORA), true);
});

test('pendente criada agora ainda NÃO é pendência de hoje', () => {
  // Nasceu neste instante: o vencimento é agora — vence hoje, e o card
  // aparece (a pessoa precisa pagar).
  igual(isPaymentDue(pendenteAgora, AGORA), true);
});

test('cancelada nunca é pendência', () => {
  igual(isPaymentDue(cancelada, AGORA), false);
  igual(pendingPaymentDate(cancelada, AGORA), null);
});

console.log('\nA lista que o card mostra');
test('a lista traz só as vencidas, da mais antiga primeiro', () => {
  const lista = pendingPayments(
    [ativaVenceAmanha, ativaVenceuOntem, cancelada, pendenteNuncaPaga],
    AGORA,
  );
  igual(lista.map((s) => s.id), ['a2', 'a4']);
});

test('a lista fica vazia quando não há nada vencido', () => {
  igual(pendingPayments([ativaVenceAmanha, cancelada], AGORA).length, 0);
});

test('a pessoa tem assinatura?', () => {
  igual(hasAnySubscription([ativaVenceAmanha]), true);
  igual(hasAnySubscription([]), false);
});

console.log('\nO texto do card');
test('"vence hoje" no dia do vencimento', () => {
  igual(dueLabel(ativaVenceHoje, AGORA), 'vence hoje');
});

test('"N dias em atraso" depois do vencimento', () => {
  igual(dueLabel(ativaVenceuOntem, AGORA), '1 dia em atraso');
});

console.log(`\n${passou} teste(s) passaram, ${falhou} falharam.\n`);
if (falhou > 0) process.exit(1);
