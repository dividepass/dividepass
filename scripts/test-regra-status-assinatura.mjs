/**
 * Teste de regressão — a regra de status da assinatura por DATA.
 *
 * O bug (09/11/2026)
 * -----------------
 * O job `update-subscription-statuses` que rodava em produção era uma versão
 * ANTIGA, com um "fallback" que fazia isto:
 *
 *   1) pegava os `group_id` de TODOS os membros com `payment_status` overdue
 *   2) marcava TODAS as assinaturas `active` desses GRUPOS como `expired`
 *   3) o mesmo com `payment_status` cancelled → `cancelled`
 *
 * Ou seja: bastava UM membro atrasado/cancelado de um grupo para o job
 * derrubar o status de TODOS os outros membros daquele grupo — inclusive de
 * quem pagou até 2027. Foi exatamente o que aconteceu: 8 assinaturas com
 * vencimento no FUTURO foram parar como `cancelled` e 6 como `expired`.
 *
 * O que este teste trava
 * ----------------------
 *  1. Nenhuma edge function pode fazer UPDATE em `user_subscriptions`
 *     filtrando só por `group_id` (o escopo correto é o PAR
 *     `(user_id, group_id)`).
 *  2. A regra de status tem que ser derivada da DATA:
 *     - vencimento no futuro  → ATIVA
 *     - vencimento passou, dentro de 7 dias → ATRASADA (still visível)
 *     - vencimento passou há mais de 7 dias → CANCELADA
 *  3. O job não pode cancelar assinatura que tem `renewal_due_at` no futuro.
 *
 *   node scripts/test-regra-status-assinatura.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FN_DIR = path.join(ROOT, "supabase", "functions");

let falhas = 0;
const ok = (msg) => console.log(`  OK    ${msg}`);
const fail = (msg, detalhe) => {
  falhas++;
  console.log(`  FALHA ${msg}`);
  if (detalhe) {
    console.log(
      String(detalhe)
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, 6)
        .map((l) => `        ${l}`)
        .join("\n"),
    );
  }
};

/** Tira comentários (de linha e de bloco) — o teste olha CÓDIGO, não texto. */
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function listarTs(dir, acc = []) {  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listarTs(p, acc);
    else if (e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

/* ======================================================================
   1) NENHUMA FUNÇÃO PODE CANCELAR ASSINATURA FILTRANDO POR GROUP_ID
   ====================================================================== */
console.log("\n1) Escopo do cancelamento: precisa ser o PAR (user_id, group_id)\n");

const arquivos = listarTs(FN_DIR);

/**
 * Extrai as CADEIAS de chamadas do Supabase de um arquivo.
 *
 * Uma cadeia é `.from("user_subscriptions")` seguido de `.select(...)`,
 * `.update(...)`, `.eq(...)` etc. — tudo encadeado com ponto na frente.
 * Um `;` ou uma linha que não começa com ponto fecha a cadeia.
 */
function cadeias(src) {
  const linhas = src.split(/\r?\n/);
  const saida = [];
  let atual = null;

  for (const linha of linhas) {
    const t = linha.trim();
    if (!atual) {
      const m = t.match(/\.from\(["']([a-z_]+)["']\)/);
      if (m) atual = { tabela: m[1], linhas: [t] };
      continue;
    }
    if (t.startsWith(".")) {
      atual.linhas.push(t);
      continue;
    }
    // Fim da cadeia (statement novo).
    if (atual.linhas.some((l) => /\.update\(/.test(l))) {
      saida.push(atual);
    }
    atual = null;
    const m = t.match(/\.from\(["']([a-z_]+)["']\)/);
    if (m) atual = { tabela: m[1], linhas: [t] };
  }
  if (atual && atual.linhas.some((l) => /\.update\(/.test(l))) saida.push(atual);

  return saida;
}

for (const arq of arquivos) {
  const src = fs.readFileSync(arq, "utf8");
  for (const c of cadeias(src)) {
    if (c.tabela !== "user_subscriptions") continue;

    const trecho = c.linhas.join("\n");
    if (!/\.(?:eq|in)\(["']group_id["']/.test(trecho)) continue;

    // O escopo está correto se a cadeia também filtra por user_id ou por id
    // (o `id` já é a assinatura — escopo de uma linha só).
    const escopoCorreto =
      /\.eq\(["']user_id["']/.test(trecho) ||
      /\.eq\(["']id["']/.test(trecho) ||
      /\.in\(["']id["']/.test(trecho) ||
      /or\(and\(user_id/.test(trecho);

    if (!escopoCorreto) {
      fail(
        `${path.relative(ROOT, arq)} — update em user_subscriptions filtrando só por group_id`,
        trecho.split("\n").slice(0, 8).join("\n"),
      );
    }
  }
}
if (falhas === 0) {
  ok("nenhuma função cancela assinatura por escopo de grupo");
}

/* ======================================================================
   2) A REGRA DE DATA (mesma semântica do front e do back)
   ====================================================================== */
console.log("\n2) Regra de status derivada da data\n");

const GRACE = 7;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Regra oficial:
 *   ATIVA     → vencimento > agora
 *   ATRASADA  → vencimento <= agora e ainda não passou da carência de 7 dias
 *   CANCELADA → passou da carência de 7 dias
 */
function estado(dateISO, nowMs) {
  const due = new Date(dateISO).getTime();
  if (due > nowMs) return "ATIVA";
  if (due + GRACE * DAY < nowMs) return "CANCELADA";
  return "ATRASADA";
}

const AGORA = new Date("2026-11-09T12:00:00.000Z").getTime();

const casos = [
  { data: "2026-12-07T22:02:23.000Z", esperado: "ATIVA", nome: "vencimento no futuro" },
  { data: "2026-11-10T00:00:00.000Z", esperado: "ATIVA", nome: "vencimento amanhã" },
  { data: "2026-11-09T00:00:00.000Z", esperado: "ATRASADA", nome: "venceu hoje" },
  { data: "2026-11-05T00:00:00.000Z", esperado: "ATRASADA", nome: "4 dias de atraso" },
  // Limite exato: 7 dias de atraso ainda é ATRASADA (a carência não venceu).
  { data: "2026-11-02T12:00:00.000Z", esperado: "ATRASADA", nome: "7 dias de atraso (limite)" },
  // Passou da carência: 8 dias de atraso já é CANCELADA.
  { data: "2026-11-01T12:00:00.000Z", esperado: "CANCELADA", nome: "8 dias de atraso" },
  { data: "2026-10-01T00:00:00.000Z", esperado: "CANCELADA", nome: "39 dias de atraso" },
];

for (const c of casos) {
  const got = estado(c.data, AGORA);
  if (got === c.esperado) ok(`${c.nome} → ${got}`);
  else fail(`${c.nome}: esperado ${c.esperado}, veio ${got}`);
}

/* ======================================================================
   3) A SEMÂNTICA REAL DO CÓDIGO (front + back) bate com a regra
   ====================================================================== */
console.log("\n3) O código do projeto aplica a mesma regra\n");

const front = fs.readFileSync(
  path.join(ROOT, "src", "lib", "subscriptionAccess.js"),
  "utf8",
);
const back = fs.readFileSync(
  path.join(FN_DIR, "_shared", "subscription-dates.ts"),
  "utf8",
);

const temRegraFront = /isSubscriptionPastGrace/.test(front) && /OVERDUE_GRACE_DAYS/.test(front);
const temRegraBack = /isPastGrace/.test(back) && /OVERDUE_GRACE_DAYS/.test(back);
if (temRegraFront) ok("front (subscriptionAccess.js) tem a regra por data");
else fail("front (subscriptionAccess.js) não tem a regra por data");

if (temRegraBack) ok("back (_shared/subscription-dates.ts) tem a regra por data");
else fail("back (_shared/subscription-dates.ts) não tem a regra por data");

// A carência tem que ser a mesma nos dois lados (front e back).
const graceFront = front.match(/OVERDUE_GRACE_DAYS\s*=\s*(\d+)/)?.[1];
const graceBack = back.match(/OVERDUE_GRACE_DAYS\s*=\s*(\d+)/)?.[1];
if (graceFront && graceBack && graceFront === graceBack) {
  ok(`carência igual nos dois lados (${graceFront} dias)`);
} else {
  fail(`carência divergente: front=${graceFront} back=${graceBack}`);
}

// O job tem que ler a data de renovação (renewal_due_at) — não só o status.
const job = fs.readFileSync(
  path.join(FN_DIR, "update-subscription-statuses", "index.ts"),
  "utf8",
);
if (/applySubscriptionLifecycle/.test(job)) {
  ok("o job de status usa a regra compartilhada (applySubscriptionLifecycle)");
} else {
  fail("o job de status NÃO usa applySubscriptionLifecycle");
}

if (/renewal_due_at/.test(back)) {
  ok("a regra lê renewal_due_at (data de vencimento real)");
} else {
  fail("a regra não lê renewal_due_at");
}

/* ======================================================================
   4) EVENTO PERIFÉRICO NÃO CANCELA QUEM TEM ASSINATURA PAGA
   ====================================================================== */
console.log("\n4) Eventos periféricos (recusa de pagamento, prazo de 12h) não desvinculam\n");

const guard = await import(pathToFileURL(path.join(FN_DIR, "_shared", "subscription-guard.ts")).href).catch(
  (e) => {
    fail(`não consegui carregar _shared/subscription-guard.ts: ${e.message}`);
    return null;
  },
);

if (guard) {
  const AGORA_G = new Date("2026-11-09T12:00:00.000Z");
  const casosGuard = [
    {
      nome: "assinatura ativa com vencimento no futuro",
      sub: { status: "active", renewal_due_at: "2026-12-07T22:02:23.000Z" },
      esperado: true,
    },
    {
      nome: "assinatura vencida há 3 dias (dentro da carência)",
      sub: { status: "active", renewal_due_at: "2026-11-06T12:00:00.000Z" },
      esperado: true,
    },
    {
      nome: "assinatura vencida há 8 dias (carência perdida)",
      sub: { status: "active", renewal_due_at: "2026-11-01T12:00:00.000Z" },
      esperado: false,
    },
    { nome: "assinatura cancelada", sub: { status: "cancelled", renewal_due_at: "2026-12-07T22:02:23.000Z" }, esperado: false },
    { nome: "assinatura pendente (nunca paga)", sub: { status: "pending", renewal_due_at: "2026-12-07T22:02:23.000Z" }, esperado: false },
    { nome: "assinatura inativa", sub: { status: "inactive", renewal_due_at: "2026-12-07T22:02:23.000Z" }, esperado: false },
    {
      nome: "billing_status cancelado (só a cobrança automática desligou)",
      sub: { status: "active", billing_status: "cancelled", renewal_due_at: "2026-12-07T22:02:23.000Z" },
      esperado: true,
    },
  ];

  for (const c of casosGuard) {
    const got = guard.assinaturaEmVigor(c.sub, AGORA_G);
    if (got === c.esperado) ok(`guarda: ${c.nome} → ${got ? "em vigor" : "sem acesso"}`);
    else fail(`guarda: ${c.nome}: esperado ${c.esperado}, veio ${got}`);
  }
}

// Quem cancela o vínculo tem que perguntar antes se há assinatura em vigor.
const perifericos = [
  {
    arquivo: path.join(FN_DIR, "confirm-payment", "index.ts"),
    oQue: "pagamento recusado",
    cancela: /payment_status:\s*"expired",\s*status:\s*"cancelled"/,
  },
  {
    arquivo: path.join(FN_DIR, "check-entrance-deadline", "index.ts"),
    oQue: "prazo de 12h da entrada",
    cancela: /status:\s*"cancelled"/,
  },
  {
    arquivo: path.join(FN_DIR, "create-payment", "handlers", "iopay.ts"),
    oQue: "prazo de 12h (IO Pay)",
    cancela: /payment_status:\s*"expired",\s*status:\s*"cancelled"/,
  },
  {
    arquivo: path.join(FN_DIR, "create-payment", "handlers", "asaas.ts"),
    oQue: "prazo de 12h (Asaas)",
    cancela: /payment_status:\s*"expired",\s*status:\s*"cancelled"/,
  },
  {
    arquivo: path.join(FN_DIR, "create-payment", "handlers", "stripe.ts"),
    oQue: "prazo de 12h (Stripe)",
    cancela: /payment_status:\s*"expired",\s*status:\s*"cancelled"/,
  },
  {
    arquivo: path.join(FN_DIR, "create-payment", "handlers", "mercadopago.ts"),
    oQue: "prazo de 12h (Mercado Pago)",
    cancela: /payment_status:\s*"expired",\s*status:\s*"cancelled"/,
  },
  {
    arquivo: path.join(FN_DIR, "mercado-pago-create-subscription", "index.ts"),
    oQue: "prazo de 12h (assinatura MP)",
    cancela: /payment_status:\s*"expired",\s*status:\s*"cancelled"/,
  },
  {
    arquivo: path.join(FN_DIR, "mercado-pago-webhook", "index.ts"),
    oQue: "preapproval cancelado no gateway",
    cancela: /status:\s*"cancelled"/,
  },
];

for (const p of perifericos) {
  const src = fs.readFileSync(p.arquivo, "utf8");
  // A CHAMADA tem que existir (import sozinho não protege ninguém).
  const idxGuard = src.search(/await\s+buscarAssinaturaVigente\s*\(/);
  const idxCancela = src.search(p.cancela);

  if (idxGuard < 0) {
    fail(`${path.relative(ROOT, p.arquivo)} — ${p.oQue} não consulta a assinatura em vigor`);
  } else if (idxCancela < 0) {
    ok(`${path.relative(ROOT, p.arquivo)} — ${p.oQue} não cancela ninguém`);
  } else if (idxGuard < idxCancela) {
    ok(`${path.relative(ROOT, p.arquivo)} — ${p.oQue} consulta a assinatura antes de cancelar`);
  } else {
    fail(
      `${path.relative(ROOT, p.arquivo)} — ${p.oQue} cancela ANTES de consultar a assinatura em vigor`,
      src.slice(Math.max(0, idxCancela - 400), idxCancela + 200),
    );
  }
}

// `payments.method` é ENUM ('pix','credit_card','bank_slip'): gravar "refund"
// quebra o INSERT (22P02) e o estorno nunca é registrado.
for (const arq of arquivos) {
  const src = semComentarios(fs.readFileSync(arq, "utf8"));
  if (/method:\s*["']refund["']/.test(src)) {
    fail(`${path.relative(ROOT, arq)} — grava method "refund" (não existe no enum payment_method)`);
  }
}
if (!falhas) ok("nenhum pagamento grava method inválido no enum payment_method");

/* ======================================================================
   RESULTADO
   ====================================================================== */
console.log(
  `\n${falhas === 0 ? "Tudo OK" : `${falhas} verificação(ões) falharam`}`,
);
process.exit(falhas === 0 ? 0 : 1);
