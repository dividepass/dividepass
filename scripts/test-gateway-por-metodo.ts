/**
 * Testes da DIVISÃO DE GATEWAY POR MÉTODO DE PAGAMENTO.
 *
 *   node --experimental-strip-types scripts/test-gateway-por-metodo.ts
 *   deno run scripts/test-gateway-por-metodo.ts
 *
 * (Node 24 já faz o strip de tipos sozinho; a flag é só para compatibilidade.)
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * A divisão por método (PIX num gateway, cartão em outro) só é segura se a
 * regra for EXATAMENTE a esperada. Dois erros aqui são silenciosos:
 *
 *   1. a divisão ligada sem querer → o checkout passa a cobrar no gateway
 *      errado (ou deixa de oferecer o cartão);
 *   2. a renovação trocando de gateway → ficam DUAS cobranças vivas (a
 *      antiga no gateway antigo e a nova no gateway novo) e o dinheiro do
 *      usuário vai para o lugar errado.
 *
 * A REGRA DE OURO é o primeiro teste: com a divisão desligada, o
 * comportamento tem de ser IDÊNTICO ao de hoje — tudo no gateway padrão.
 */
import {
  CHAVE_SPLIT_ATIVO,
  CHAVE_SPLIT_CARD,
  CHAVE_SPLIT_ESCOPO,
  CHAVE_SPLIT_PIX,
  ESCOPO_ALL,
  ESCOPO_V2,
  escopoDoSplit,
  gatewayDoMetodo,
  gatewayPadrao,
  normalizarGateway,
  normalizarMetodo,
  resolverGatewayParaPagamento,
  splitAplicavel,
  splitAtivo,
} from "../supabase/functions/_shared/gateway-por-metodo.ts";

// O espelho que o FRONTEND usa. Se os dois módulos divergirem, o frontend
// manda um gateway e o backend cobra em outro — e isso é silencioso.
import * as front from "../src/lib/gatewayPorMetodo.js";

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
// CENÁRIOS
// ────────────────────────────────────────────────────────────────────────────

const SO_PADRAO = { active_gateway: "iopay" };
const DIVIDIDO = {
  active_gateway: "iopay",
  [CHAVE_SPLIT_ATIVO]: "true",
  [CHAVE_SPLIT_PIX]: "woovi",
  [CHAVE_SPLIT_CARD]: "iopay",
};
// A divisão ligada com o ESCOPO 'v2' (o padrão): só o checkout de teste
// é afetado. O checkout de produção continua no gateway padrão.
const DIVIDIDO_SO_V2 = { ...DIVIDIDO };
// Já valendo em todo lugar.
const DIVIDIDO_TUDO = { ...DIVIDIDO, [CHAVE_SPLIT_ESCOPO]: ESCOPO_ALL };

// ── REGRA DE OURO: desligado = comportamento de hoje ───────────────────────

test("sem a chave split, o gateway padrão atende pix e cartão", () => {
  assertEquals(gatewayDoMetodo(SO_PADRAO, "pix"), "iopay", "pix");
  assertEquals(gatewayDoMetodo(SO_PADRAO, "card"), "iopay", "cartão");
});

test("split_gateway_enabled = 'false' também deixa tudo no gateway padrão", () => {
  const cfg = { ...DIVIDIDO, [CHAVE_SPLIT_ATIVO]: "false" };
  assertEquals(gatewayDoMetodo(cfg, "pix"), "iopay", "pix");
  assertEquals(gatewayDoMetodo(cfg, "card"), "iopay", "cartão");
});

test("qualquer valor diferente de 'true' significa divisão desligada", () => {
  for (const v of ["", "1", "sim", "talvez", "on", "false", "0"]) {
    const cfg = { ...DIVIDIDO, [CHAVE_SPLIT_ATIVO]: v };
    assertTrue(!splitAtivo(cfg), `splitAtivo com '${v}' deveria ser false`);
  }
});

test("'true' liga, ignorando caixa e espaço em volta", () => {
  for (const v of ["true", "TRUE", " True "]) {
    const cfg = { ...DIVIDIDO, [CHAVE_SPLIT_ATIVO]: v };
    assertTrue(splitAtivo(cfg), `splitAtivo com '${v}' deveria ser true`);
  }
  assertTrue(splitAtivo(DIVIDIDO), "splitAtivo com 'true' deveria ser true");
});

// ── DIVISÃO LIGADA ──────────────────────────────────────────────────────────

// ── DIVISÃO LIGADA ──────────────────────────────────────────────────────────
//
// Aqui a divisão é considerada NO ESCOPO 'all' (vale em qualquer checkout).
// O caso 'v2' tem testes próprios mais abaixo.

test("divisão ligada: o PIX vai para o gateway do PIX", () => {
  assertEquals(gatewayDoMetodo(DIVIDIDO_TUDO, "pix"), "woovi", "pix");
});

test("divisão ligada: o cartão vai para o gateway do cartão", () => {
  assertEquals(gatewayDoMetodo(DIVIDIDO_TUDO, "card"), "iopay", "cartão");
});

test("divisão ligada com os dois invertidos (cartão na Woovi, PIX na IO Pay)", () => {
  const cfg = {
    ...DIVIDIDO_TUDO,
    [CHAVE_SPLIT_PIX]: "iopay",
    [CHAVE_SPLIT_CARD]: "woovi",
  };
  assertEquals(gatewayDoMetodo(cfg, "pix"), "iopay", "pix");
  assertEquals(gatewayDoMetodo(cfg, "card"), "woovi", "cartão");
});

test("divisão ligada mas sem gateway para o método → cai no gateway padrão", () => {
  const cfg = { active_gateway: "iopay", [CHAVE_SPLIT_ATIVO]: "true", [CHAVE_SPLIT_ESCOPO]: ESCOPO_ALL };
  assertEquals(gatewayDoMetodo(cfg, "pix"), "iopay", "pix");
  assertEquals(gatewayDoMetodo(cfg, "card"), "iopay", "cartão");
});

test("divisão ligada com gateway DESCONHECIDO → cai no gateway padrão", () => {
  const cfg = { ...DIVIDIDO_TUDO, [CHAVE_SPLIT_PIX]: "banco-fantasma" };
  assertEquals(gatewayDoMetodo(cfg, "pix"), "iopay", "pix");
  // o cartão não é afetado pelo gateway inválido do pix
  assertEquals(gatewayDoMetodo(cfg, "card"), "iopay", "cartão");
});

test("divisão ligada sem método informado → gateway padrão", () => {
  assertEquals(gatewayDoMetodo(DIVIDIDO_TUDO, undefined), "iopay", "método ausente");
  assertEquals(gatewayDoMetodo(DIVIDIDO_TUDO, "boleto"), "iopay", "método desconhecido");
});

test("gateway padrão ausente ou inválido → iopay (nunca mercadopago quebrado)", () => {
  assertEquals(gatewayPadrao({}), "iopay", "sem chave");
  assertEquals(gatewayPadrao({ active_gateway: "" }), "iopay", "vazio");
  assertEquals(gatewayPadrao({ active_gateway: "desconhecido" }), "iopay", "inválido");
});

// ── RENOVAÇÃO: NÃO TROCA DE GATEWAY ────────────────────────────────────────

// ── RENOVAÇÃO ───────────────────────────────────────────────────────────────
//
// A renovação é uma cobrança NOVA e segue o gateway do MÉTODO escolhido
// agora: o PIX da assinatura é o Pix Automático (Woovi). A assinatura que já
// é da Woovi continua na Woovi no PIX (o mandate é dela).

test("renovação por PIX vai para o gateway do PIX (a divisão manda)", () => {
  const gateway = resolverGatewayParaPagamento({
    settings: DIVIDIDO_TUDO,
    metodo: "pix",
    renewal: true,
    gatewayAtual: "iopay",
    split: splitAplicavel(DIVIDIDO_TUDO, false),
  });
  assertEquals(gateway, "woovi", "renovação por PIX");
});

test("renovação por cartão vai para o gateway do cartão", () => {
  const gateway = resolverGatewayParaPagamento({
    settings: DIVIDIDO_TUDO,
    metodo: "card",
    renewal: true,
    gatewayAtual: "woovi",
    split: splitAplicavel(DIVIDIDO_TUDO, false),
  });
  assertEquals(gateway, "iopay", "renovação por cartão");
});

test("renovação de assinatura na Woovi fica na Woovi (mesmo pagando por PIX)", () => {
  const gateway = resolverGatewayParaPagamento({
    settings: DIVIDIDO,
    metodo: "pix",
    renewal: true,
    gatewayAtual: "woovi",
  });
  assertEquals(gateway, "woovi", "renovação de assinatura na Woovi");
});

test("renovação na Woovi fica na Woovi mesmo com a divisão desligada", () => {
  const cfg = { ...DIVIDIDO, [CHAVE_SPLIT_ATIVO]: "false" };
  const gateway = resolverGatewayParaPagamento({
    settings: cfg,
    metodo: "pix",
    renewal: true,
    gatewayAtual: "woovi",
    split: splitAplicavel(cfg, false),
  });
  assertEquals(gateway, "woovi", "o mandate é dela");
});

test("renovação sem método (desconhecido) fica no gateway da assinatura", () => {
  const gateway = resolverGatewayParaPagamento({
    settings: DIVIDIDO_TUDO,
    metodo: null,
    renewal: true,
    gatewayAtual: "iopay",
    split: splitAplicavel(DIVIDIDO_TUDO, false),
  });
  assertEquals(gateway, "iopay", "sem método, vale o gateway da assinatura");
});

test("renovação sem gateway da assinatura → cai na regra normal", () => {
  const gateway = resolverGatewayParaPagamento({
    settings: DIVIDIDO_SO_V2,
    metodo: "pix",
    renewal: true,
    gatewayAtual: null,
    split: splitAplicavel(DIVIDIDO_SO_V2, true),
  });
  assertEquals(gateway, "woovi", "sem gateway da assinatura, a divisão manda");
});

test("cobrança nova (não é renovação) segue a divisão", () => {
  const gateway = resolverGatewayParaPagamento({
    settings: DIVIDIDO_SO_V2,
    metodo: "pix",
    renewal: false,
    gatewayAtual: "iopay",
    split: splitAplicavel(DIVIDIDO_SO_V2, true),
  });
  assertEquals(gateway, "woovi", "cobrança nova ignora o gateway antigo");
});

test("cobrança nova NO CHECKOUT DE PRODUÇÃO ignora a divisão", () => {
  const gateway = resolverGatewayParaPagamento({
    settings: DIVIDIDO_SO_V2,
    metodo: "pix",
    renewal: false,
    split: splitAplicavel(DIVIDIDO_SO_V2, false),
  });
  assertEquals(gateway, "iopay", "V1 vai para o gateway padrão");
});

// ── ESCOPO: a divisão não pode vazar para o checkout de produção ─────────

test("sem a chave de escopo, o padrão é 'v2' (só o checkout de teste)", () => {
  assertEquals(escopoDoSplit(DIVIDIDO), ESCOPO_V2, "escopo padrão");
  assertEquals(escopoDoSplit({ [CHAVE_SPLIT_ESCOPO]: "lixo" }), ESCOPO_V2, "escopo inválido");
  assertEquals(escopoDoSplit(DIVIDIDO_TUDO), ESCOPO_ALL, "escopo 'all'");
});

test("escopo 'v2': o checkout de produção NÃO é afetado", () => {
  // O checkout V1 não manda `split_gateway: true` → clientePediuSplit = false.
  assertTrue(!splitAplicavel(DIVIDIDO_SO_V2, false), "V1 não pode ser afetado");
  assertEquals(
    gatewayDoMetodo(DIVIDIDO_SO_V2, "pix", { split: splitAplicavel(DIVIDIDO_SO_V2, false) }),
    "iopay",
    "V1 vai para o gateway padrão",
  );
});

test("escopo 'v2': o checkout V2 É afetado", () => {
  assertTrue(splitAplicavel(DIVIDIDO_SO_V2, true), "V2 deve usar a divisão");
  assertEquals(
    gatewayDoMetodo(DIVIDIDO_SO_V2, "pix", { split: splitAplicavel(DIVIDIDO_SO_V2, true) }),
    "woovi",
    "V2 manda o PIX para a Woovi",
  );
});

test("escopo 'all': vale em qualquer checkout, com ou sem o pedido do cliente", () => {
  assertTrue(splitAplicavel(DIVIDIDO_TUDO, false), "V1 também vale");
  assertTrue(splitAplicavel(DIVIDIDO_TUDO, true), "V2 também vale");
  assertEquals(gatewayDoMetodo(DIVIDIDO_TUDO, "pix"), "woovi", "sem override, escopo all divide");
});

test("divisão DESLIGADA: nem o V2 muda nada", () => {
  const cfg = { ...DIVIDIDO, [CHAVE_SPLIT_ATIVO]: "false" };
  assertTrue(!splitAplicavel(cfg, true), "desligada não vale nem para o V2");
  assertTrue(!splitAplicavel(cfg, false), "desligada não vale para o V1");
  assertEquals(gatewayDoMetodo(cfg, "pix"), "iopay", "pix no gateway padrão");
});

test("o resolver também respeita o escopo", () => {
  const gateway = resolverGatewayParaPagamento({
    settings: DIVIDIDO_SO_V2,
    metodo: "pix",
    split: splitAplicavel(DIVIDIDO_SO_V2, true),
  });
  assertEquals(gateway, "woovi", "V2");
});

// ── NORMALIZAÇÕES ───────────────────────────────────────────────────────────

test("normalizarMetodo aceita as grafias que o IO Pay usa", () => {
  assertEquals(normalizarMetodo("pix"), "pix", "pix");
  assertEquals(normalizarMetodo("PIX"), "pix", "PIX");
  assertEquals(normalizarMetodo("card"), "card", "card");
  assertEquals(normalizarMetodo("cartao"), "card", "cartao");
  assertEquals(normalizarMetodo("credit_card"), "card", "credit_card");
  assertEquals(normalizarMetodo("credito"), "card", "credito");
  assertEquals(normalizarMetodo("boleto"), null, "boleto");
  assertEquals(normalizarMetodo(undefined), null, "ausente");
});

test("normalizarGateway só aceita os gateways conhecidos", () => {
  assertEquals(normalizarGateway("woovi"), "woovi", "woovi");
  assertEquals(normalizarGateway("IOPay"), "iopay", "IOPay");
  assertEquals(normalizarGateway("banco-fantasma"), null, "desconhecido");
  assertEquals(normalizarGateway(""), null, "vazio");
});

// ── PARIDADE: o espelho JS do frontend tem que dar a MESMA resposta ───────

test("o espelho JS (frontend) dá a mesma resposta que o backend", () => {
  const cenarios = [
    SO_PADRAO,
    DIVIDIDO,
    DIVIDIDO_TUDO,
    { ...DIVIDIDO, [CHAVE_SPLIT_ATIVO]: "false" },
    { ...DIVIDIDO, [CHAVE_SPLIT_CARD]: "woovi" },
    { ...DIVIDIDO, [CHAVE_SPLIT_PIX]: "banco-fantasma" },
    { active_gateway: "asaas", [CHAVE_SPLIT_ATIVO]: "true", [CHAVE_SPLIT_PIX]: "pagarme" },
  ];

  for (const cfg of cenarios) {
    assertEquals(
      front.gatewayDoMetodo(cfg, "pix"),
      gatewayDoMetodo(cfg, "pix"),
      "pix divergiu entre backend e frontend",
    );
    assertEquals(
      front.gatewayDoMetodo(cfg, "card"),
      gatewayDoMetodo(cfg, "card"),
      "cartão divergiu entre backend e frontend",
    );
    assertEquals(front.splitAtivo(cfg), splitAtivo(cfg), "splitAtivo divergiu");
    assertEquals(front.gatewayPadrao(cfg), gatewayPadrao(cfg), "gatewayPadrao divergiu");
    assertEquals(front.escopoDoSplit(cfg), escopoDoSplit(cfg), "escopoDoSplit divergiu");
    assertEquals(
      front.splitAplicavel(cfg, true),
      splitAplicavel(cfg, true),
      "splitAplicavel divergiu",
    );
    assertEquals(
      front.splitAplicavel(cfg, false),
      splitAplicavel(cfg, false),
      "splitAplicavel divergiu",
    );
    // A RENOVAÇÃO também precisa bater: é a regra que decide para onde vai a
    // cobrança da renovação (o PIX da assinatura é o da Woovi).
    for (const renewal of [true, false]) {
      for (const metodo of ["pix", "card", null]) {
        for (const gatewayAtual of ["iopay", "woovi", null]) {
          assertEquals(
            front.resolverGatewayParaPagamento({
              settings: cfg,
              metodo,
              renewal,
              gatewayAtual,
              split: splitAplicavel(cfg, true),
            }),
            resolverGatewayParaPagamento({
              settings: cfg,
              metodo,
              renewal,
              gatewayAtual,
              split: splitAplicavel(cfg, true),
            }),
            `resolver divergiu (renewal=${renewal} metodo=${metodo} atual=${gatewayAtual})`,
          );
        }
      }
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────

console.log(`\n${passou} passou | ${falhou} falhou`);
if (falhou > 0) {
  process.exitCode = 1;
}
