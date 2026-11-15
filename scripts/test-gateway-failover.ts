/**
 * Testes do FAILOVER DE GATEWAY.
 *
 *   node --experimental-strip-types scripts/test-gateway-failover.ts
 *   npx -y deno run --allow-env scripts/test-gateway-failover.ts
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O failover mexe em "de onde sai o dinheiro do cliente". Dois erros aqui são
 * silenciosos e gravíssimos:
 *
 *   1. TROCAR DEMAIS — recusa do cliente (cartão recusado, saldo
 *      insuficiente) ou pedido inválido (CPF faltando) indo para OUTRO
 *      gateway: o cliente veria a mesma recusa de novo, e, no pior caso,
 *      seria cobrado duas vezes.
 *
 *   2. NÃO TROCAR NUNCA — o gateway principal fica fora do ar e o cliente
 *      simplesmente não é cobrado. É exatamente o problema que o pedido
 *      original queria resolver.
 *
 * A REGRA DE OURO é o primeiro teste: sem configuração, o failover é
 * DESLIGADO (comportamento de hoje, nada muda por acidente).
 */
import {
  CHAVE_FAILOVER_CARD,
  CHAVE_FAILOVER_PIX,
  falhaTecnicaDoGateway,
  filaDeGateways,
  gatewaysDeFailover,
} from "../supabase/functions/_shared/gateway-failover.ts";

let passou = 0;
let falhou = 0;

function test(nome: string, fn: () => void) {
  try {
    fn();
    passou++;
    console.log(`  OK    ${nome}`);
  } catch (e) {
    falhou++;
    console.log(`  FALHA ${nome} — ${(e as Error).message}`);
  }
}

function igual<T>(obtido: T, esperado: T, msg?: string) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a !== b) throw new Error(msg || `esperado ${b}, veio ${a}`);
}

console.log("\n=== FAILOVER DE GATEWAY ===\n");

// ── O padrão: desligado ─────────────────────────────────────────────────────
console.log("Padrão (failover desligado)");

test("sem configuração, a fila tem só o gateway principal", () => {
  igual(filaDeGateways("woovi", {}, "pix"), ["woovi"]);
  igual(filaDeGateways("iopay", null, "card"), ["iopay"]);
});

test("chave vazia = desligado", () => {
  igual(filaDeGateways("woovi", { [CHAVE_FAILOVER_PIX]: "" }, "pix"), ["woovi"]);
  igual(filaDeGateways("woovi", { [CHAVE_FAILOVER_PIX]: "   " }, "pix"), ["woovi"]);
});

test("método desconhecido = sem failover", () => {
  igual(filaDeGateways("woovi", { [CHAVE_FAILOVER_PIX]: "iopay" }, null), ["woovi"]);
  igual(filaDeGateways("woovi", { [CHAVE_FAILOVER_PIX]: "iopay" }, "boleto"), ["woovi"]);
});

test("cada método usa a SUA chave", () => {
  const settings = { [CHAVE_FAILOVER_PIX]: "iopay", [CHAVE_FAILOVER_CARD]: "mercadopago" };
  igual(filaDeGateways("woovi", settings, "pix"), ["woovi", "iopay"]);
  igual(filaDeGateways("iopay", settings, "card"), ["iopay", "mercadopago"]);
});

// ── A fila ──────────────────────────────────────────────────────────────────
console.log("\nA fila de gateways");

test("a lista é lida na ordem e sem repetir", () => {
  igual(gatewaysDeFailover({ [CHAVE_FAILOVER_PIX]: "iopay, mercadopago" }, "pix"), [
    "iopay",
    "mercadopago",
  ]);
  igual(gatewaysDeFailover({ [CHAVE_FAILOVER_PIX]: "iopay,iopay" }, "pix"), ["iopay"]);
});

test("gateway desconhecido na configuração é ignorado (não quebra a cobrança)", () => {
  igual(gatewaysDeFailover({ [CHAVE_FAILOVER_PIX]: "banana,iopay" }, "pix"), ["iopay"]);
});

test("o principal não aparece duas vezes na fila", () => {
  igual(filaDeGateways("iopay", { [CHAVE_FAILOVER_PIX]: "iopay,mercadopago" }, "pix"), [
    "iopay",
    "mercadopago",
  ]);
});

test("vários fallbacks são tentados em ordem", () => {
  igual(filaDeGateways("woovi", { [CHAVE_FAILOVER_PIX]: "iopay,mercadopago,pagarme" }, "pix"), [
    "woovi",
    "iopay",
    "mercadopago",
    "pagarme",
  ]);
});

// ── O que é falha técnica (e o que NÃO é) ───────────────────────────────────
console.log("\nO que conta como falha técnica");

test("5xx do gateway é falha técnica", () => {
  igual(falhaTecnicaDoGateway(500, null), true);
  igual(falhaTecnicaDoGateway(502, { error: "bad gateway" }), true);
  igual(falhaTecnicaDoGateway(503, null), true);
});

test("recusa do cliente NÃO é falha técnica (não troca de gateway)", () => {
  igual(falhaTecnicaDoGateway(402, { error: "cartão recusado" }), false);
  igual(falhaTecnicaDoGateway(400, { error: "CPF inválido" }), false);
  igual(falhaTecnicaDoGateway(409, { code: "recurrence_is_automatic" }), false);
});

test("erro de NEGÓCIO com `code` conhecido NÃO é falha técnica", () => {
  igual(falhaTecnicaDoGateway(400, { code: "cpf_required" }), false);
  igual(falhaTecnicaDoGateway(403, { code: "group_not_approved" }), false);
  igual(falhaTecnicaDoGateway(400, { code: "grupo_esgotado" }), false);
});

test("falha de CONFIGURAÇÃO do gateway É técnica (troca)", () => {
  igual(falhaTecnicaDoGateway(400, { code: "gateway_not_configured" }), true);
  igual(falhaTecnicaDoGateway(400, { code: "woovi_app_id_missing" }), true);
  igual(falhaTecnicaDoGateway(400, { code: "gateway_sem_credenciais" }), true);
});

test("2xx nunca é falha técnica", () => {
  igual(falhaTecnicaDoGateway(200, null), false);
  igual(falhaTecnicaDoGateway(201, null), false);
});

console.log(
  `\n${passou} teste(s) passaram, ${falhou} falharam.\n`,
);
// Sai com código 1 no Deno e no Node (o `process` existe no Deno 2).
if (falhou > 0) (globalThis as any).process?.exit?.(1);
