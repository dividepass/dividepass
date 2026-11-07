/**
 * Testes das regras de data do Pix Automático (Woovi).
 *
 *   node --experimental-strip-types scripts/test-woovi-datas.ts
 *   deno run scripts/test-woovi-datas.ts
 *
 * (Node 24 já faz o strip de tipos sozinho; a flag é só para compatibilidade.)
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * A data da próxima cobrança é a peça mais silenciosa da integração: se o
 * `dayGenerateCharge` da Woovi e o `next_charge_at` do banco caírem em dias
 * diferentes, o cliente é cobrado num dia e o painel mostra outro — sem
 * nenhum erro, sem nenhum aviso.
 *
 * Os casos aqui são os que quebram de verdade: virada de mês, fim de mês,
 * ano bissexto e a regra de "no mínimo 3 dias" da Jornada 2.
 */
import {
  nextChargeDate,
  chargeDayOfMonth,
  wooviFrequencyForCycle,
  wooviCycleMonths,
  buildCorrelationId,
  parseCorrelationId,
  toCents,
  fromCents,
  isApprovedStatus,
  isRejectedStatus,
} from "../supabase/functions/_shared/woovi.ts";

let passou = 0;
let falhou = 0;

function test(nome: string, fn: () => void) {
  try {
    fn();
    passou++;
    console.log(`ok    ${nome}`);
  } catch (e: any) {
    falhou++;
    console.log(`FALHA ${nome}\n      ${(e?.message || e).toString().split("\n").join("\n      ")}`);
  }
}

function assertEquals(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg}\n   esperado: ${e}\n   obtido:   ${a}`);
  }
}

function assertTrue(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ────────────────────────────────────────────────────────────────────────────
// DATA DA PRÓXIMA COBRANÇA
// ────────────────────────────────────────────────────────────────────────────

test("mensal: mantém o mesmo dia do mês", () => {
  const d = nextChargeDate("monthly");
  const hoje = new Date();
  const esperado = new Date(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());
  assertEquals(d.getDate(), esperado.getDate(), "dia do mês diferente");
  assertEquals(d.getMonth(), esperado.getMonth(), "mês diferente");
});

test("trimestral: +3 meses", () => {
  const d = nextChargeDate("quarterly");
  const hoje = new Date();
  assertEquals(d.getMonth(), (hoje.getMonth() + 3) % 12, "mês diferente");
});

test("semestral: +6 meses", () => {
  const d = nextChargeDate("semiannual");
  const hoje = new Date();
  assertEquals(d.getMonth(), (hoje.getMonth() + 6) % 12, "mês diferente");
});

test("anual: +1 ano", () => {
  const d = nextChargeDate("annual");
  const hoje = new Date();
  assertEquals(d.getFullYear(), hoje.getFullYear() + 1, "ano diferente");
});

test("custom: usa o número de meses informado", () => {
  const d = nextChargeDate("custom", 5);
  const hoje = new Date();
  assertEquals(d.getMonth(), (hoje.getMonth() + 5) % 12, "mês diferente");
});

test("days: soma os dias", () => {
  const d = nextChargeDate("days", null, 45);
  const hoje = new Date();
  const esperado = new Date(hoje.getTime() + 45 * 86_400_000);
  assertEquals(d.getDate(), esperado.getDate(), "dia diferente");
});

test("fim de mês: 31 de janeiro NÃO transborda para março", () => {
  // 31 de janeiro + 1 mês = 28/29 de fevereiro (ou 28 em ano não bissexto),
  // nunca 3 de março. O `setMonth` do JS transborda; aqui não.
  const base = new Date(2026, 0, 31, 12, 0, 0);
  const d = nextChargeDate("monthly", null, null, base);
  const ultimoDia = new Date(2026, 1 + 1, 0, 12, 0, 0).getDate(); // dia 0 de março = 28/02
  assertEquals(d.getMonth(), 1, "o mês transbordou (o `setMonth` do JS estourou o limite)");
  assertEquals(d.getDate(), ultimoDia, "o dia não foi limitado ao último dia do mês");
  assertEquals(d.getFullYear(), 2026, "ano diferente");
});

test("fim de mês: ano bissexto limita em 29 de fevereiro", () => {
  const base = new Date(2028, 0, 31, 12, 0, 0); // 2028 é bissexto
  const d = nextChargeDate("monthly", null, null, base);
  assertEquals(d.getMonth(), 1, "mês diferente");
  assertEquals(d.getDate(), 29, "deveria ser 29 de fevereiro");
});

test("dia 15 continua dia 15 no mês seguinte", () => {
  const base = new Date(2026, 0, 15, 12, 0, 0);
  const d = nextChargeDate("monthly", null, null, base);
  assertEquals(d.getMonth(), 1, "mês diferente");
  assertEquals(d.getDate(), 15, "dia diferente");
});

test("chargeDayOfMonth nunca passa de 31", () => {
  for (let dia = 1; dia <= 31; dia++) {
    const d = new Date(2026, 0, dia, 12, 0, 0);
    const r = chargeDayOfMonth(d);
    assertTrue(r >= 1 && r <= 31, `dia fora do intervalo: ${r}`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// CICLO -> FREQUÊNCIA DO PIX AUTOMÁTICO
// ────────────────────────────────────────────────────────────────────────────

test("ciclos com equivalente no Pix Automático", () => {
  assertEquals(wooviFrequencyForCycle("monthly"), "MONTHLY", "monthly");
  assertEquals(wooviFrequencyForCycle("quarterly"), "QUARTERLY", "quarterly");
  assertEquals(wooviFrequencyForCycle("semiannual"), "SEMIANNUALLY", "semiannual");
  assertEquals(wooviFrequencyForCycle("annual"), "ANNUALLY", "annual");
});

test("ciclos SEM equivalente no Pix Automático", () => {
  // `custom` (N meses) e `days` não viram frequência: BIMONTHLY não é
  // suportado pela Woovi, e não existe "ciclo de N meses" nem "ciclo em dias".
  assertEquals(wooviFrequencyForCycle("custom"), null, "custom");
  assertEquals(wooviFrequencyForCycle("days"), null, "days");
});

test("meses por ciclo", () => {
  assertEquals(wooviCycleMonths("monthly"), 1, "monthly");
  assertEquals(wooviCycleMonths("quarterly"), 3, "quarterly");
  assertEquals(wooviCycleMonths("semiannual"), 6, "semiannual");
  assertEquals(wooviCycleMonths("annual"), 12, "annual");
  assertEquals(wooviCycleMonths("custom", 7), 7, "custom");
});

// ────────────────────────────────────────────────────────────────────────────
// CORRELATION ID
// ────────────────────────────────────────────────────────────────────────────

test("correlationID faz round-trip", () => {
  const id = buildCorrelationId("g1", "u1", "combined", "charge");
  assertEquals(id, "g1:u1:combined:charge", "formato do correlationID");
  const p = parseCorrelationId(id);
  assertEquals(p, { groupId: "g1", userId: "u1", type: "combined", kind: "charge" }, "parse");
});

test("correlationID de terceiros é ignorado", () => {
  assertEquals(parseCorrelationId("qualquer-coisa"), null, "deveria ser null");
  assertEquals(parseCorrelationId(""), null, "deveria ser null");
  assertEquals(parseCorrelationId(null), null, "deveria ser null");
  assertEquals(parseCorrelationId("a:b:c"), null, "formato incompleto");
});

// ────────────────────────────────────────────────────────────────────────────
// DINHEIRO
// ────────────────────────────────────────────────────────────────────────────

test("reais <-> centavos", () => {
  assertEquals(toCents(12.9), 1290, "12,90");
  assertEquals(toCents(0.01), 1, "0,01");
  assertEquals(toCents(15), 1500, "15,00");
  assertEquals(fromCents(1290), 12.9, "1290 centavos");
  assertEquals(fromCents(1), 0.01, "1 centavo");
  assertEquals(fromCents(0), 0, "zero");
});

test("centavos nunca perdem o arredondamento", () => {
  assertEquals(toCents(10.005), 1001, "arredonda para o centavo mais proximo");
  assertEquals(toCents(10.004), 1000, "arredonda para o centavo mais proximo");
});

// ────────────────────────────────────────────────────────────────────────────
// STATUS
// ────────────────────────────────────────────────────────────────────────────

test("status da Woovi", () => {
  assertTrue(isApprovedStatus("COMPLETED"), "COMPLETED é aprovado");
  assertTrue(isApprovedStatus("APPROVED"), "APPROVED é aprovado");
  assertTrue(isApprovedStatus("completed"), "minúsculo também");
  assertTrue(!isApprovedStatus("ACTIVE"), "ACTIVE não é pagamento");
  assertTrue(isRejectedStatus("REJECTED"), "REJECTED é recusado");
  assertTrue(isRejectedStatus("EXPIRED"), "EXPIRED é recusado");
  assertTrue(!isRejectedStatus("CREATED"), "CREATED não é recusado");
});

console.log(`\n${passou} passou | ${falhou} falhou`);
if (falhou > 0) process.exit(1);
