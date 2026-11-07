/**
 * Teste do `correlationID` da Woovi.
 *
 * POR QUE
 * -------
 * A Woovi trata o `correlationID` como CHAVE ÚNICA na assinatura:
 *
 *     POST /api/v1/subscriptions
 *     -> 400 {"error":"correlationID already used"}
 *
 * (Verificado na API em 07/11/2026.) Como o nosso era sempre
 * `{grupo}:{usuário}:{tipo}:{kind}`, a SEGUNDA tentativa de pagamento do mesmo
 * grupo/usuário/tipo era sempre recusada — ou seja, o retry do checkout
 * quebrava.
 *
 * A correção é a 5ª parte do correlationID (a "tentativa"), que o
 * `parseCorrelationId` precisa aceitar para continuar casando o webhook.
 *
 *   node scripts/test-woovi-correlacao.ts
 */
import {
  buildCorrelationId,
  parseCorrelationId,
  novaTentativa,
} from "../supabase/functions/_shared/woovi.ts";

let passou = 0;
let falhou = 0;

function ok(nome: string, condicao: boolean, detalhe = "") {
  if (condicao) {
    passou++;
    console.log(`ok    ${nome}`);
  } else {
    falhou++;
    console.log(`FALHA ${nome}${detalhe ? ` - ${detalhe}` : ""}`);
  }
}

const G = "76beac1d-e1b2-4239-a806-ba7dc7359413";
const U = "45e7fb01-fe95-4068-aa9e-ca26685f2cc8";

// ── Formato ────────────────────────────────────────────────────────────────
const semTentativa = buildCorrelationId(G, U, "subscription", "rec");
ok("formato antigo: 4 partes", semTentativa.split(":").length === 4, semTentativa);
ok("o formato antigo continua igual", semTentativa === `${G}:${U}:subscription:rec`);

const comTentativa = buildCorrelationId(G, U, "subscription", "rec", "abc123");
ok("formato novo: 5 partes", comTentativa.split(":").length === 5, comTentativa);
ok("a tentativa é a última parte", comTentativa.endsWith(":abc123"));
ok("o prefixo continua o mesmo",
  comTentativa.startsWith(`${G}:${U}:subscription:rec:`));

// ── O ponto central: duas tentativas do MESMO pagamento ────────────────────
const t1 = novaTentativa();
const t2 = novaTentativa();
ok("duas tentativas são diferentes", t1 !== t2, `${t1} / ${t2}`);
ok("duas tentativas do mesmo grupo/usuário dão correlationIDs diferentes",
  buildCorrelationId(G, U, "subscription", "rec", t1) !==
  buildCorrelationId(G, U, "subscription", "rec", t2));
ok("a tentativa é curta (limite da Woovi)", t1.length <= 16, `${t1.length} chars`);
ok("a tentativa é alfanumérica", /^[a-z0-9]+$/.test(t1), t1);

// ── Parse ──────────────────────────────────────────────────────────────────
const p4 = parseCorrelationId(semTentativa);
ok("parse do formato de 4 partes", !!p4);
ok("parse: groupId", p4?.groupId === G);
ok("parse: userId", p4?.userId === U);
ok("parse: type", p4?.type === "subscription");
ok("parse: kind", p4?.kind === "rec");
ok("parse: sem tentativa => attempt undefined", p4?.attempt === undefined);

const p5 = parseCorrelationId(comTentativa);
ok("parse do formato de 5 partes", !!p5);
ok("parse: groupId continua certo", p5?.groupId === G);
ok("parse: userId continua certo", p5?.userId === U);
ok("parse: type continua certo", p5?.type === "subscription");
ok("parse: kind continua certo", p5?.kind === "rec");
ok("parse: a tentativa é lida", p5?.attempt === "abc123");

// ── Casos inválidos ────────────────────────────────────────────────────────
ok("parse de lixo devolve null", parseCorrelationId("lixo") === null);
ok("parse de vazio devolve null", parseCorrelationId("") === null);
ok("parse de null devolve null", parseCorrelationId(null) === null);
ok("parse de 3 partes devolve null", parseCorrelationId(`${G}:${U}:subscription`) === null);
ok("parse de 6 partes devolve null", parseCorrelationId(`${G}:${U}:subscription:rec:a:b`) === null);
ok("kind desconhecido devolve null", parseCorrelationId(`${G}:${U}:subscription:outro`) === null);
ok("grupo vazio devolve null", parseCorrelationId(`:${U}:subscription:rec`) === null);

// ── O `kind` continua separando charge de rec (fluxo combined) ───────────
const c = buildCorrelationId(G, U, "combined", "charge", "t1");
const r = buildCorrelationId(G, U, "combined", "rec", "t1");
ok("charge e rec do mesmo fluxo são diferentes", c !== r);
ok("parse distingue charge", parseCorrelationId(c)?.kind === "charge");
ok("parse distingue rec", parseCorrelationId(r)?.kind === "rec");
ok("os dois casam o mesmo grupo/usuário",
  parseCorrelationId(c)?.groupId === parseCorrelationId(r)?.groupId &&
  parseCorrelationId(c)?.userId === parseCorrelationId(r)?.userId);

console.log(`\n${passou} passou | ${falhou} falhou`);
if (falhou > 0) process.exit(1);
