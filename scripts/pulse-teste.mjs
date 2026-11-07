/**
 * TESTES DA INTEGRAÇÃO PULSE CODING (sem rede)
 * ============================================
 *
 * Roda o `pulseClient` de verdade — o mesmo arquivo que vai para a edge
 * function — contra um `fetch` MOCKADO. Nada sai para a internet e nada é
 * cobrado.
 *
 * POR QUE UM SCRIPT E NÃO UM TESTE COM DENO
 * ------------------------------------------
 * O Deno não está instalado nesta máquina (o `deno check` do projeto depende
 * dele). O Node 24 remove os tipos do TypeScript sozinho, então este runner
 * importa o módulo real e exercita o comportamento — inclusive o `Deno.env`
 * (que aqui é um shim).
 *
 * O QUE É COBERTO
 * ---------------
 *   - as 6 ações (ping, get_balance, list_packages, create_order,
 *     check_status, list_orders);
 *   - a tradução de erro pelo `code` do corpo (que é o que a doc NÃO
 *     descreve: 400 pode ser saldo, 404 pode ser pacote ou pedido);
 *   - o retry de 429 e o de erro de rede;
 *   - o timeout de 30 s (aqui, encurtado);
 *   - a assinatura do webhook (HMAC do corpo cru) e a recusa de corpo
 *     adulterado;
 *   - a idempotência: o external_id nasce e não muda;
 *   - as regras de catálogo: ciclo, markup, margem e exclusão de Serviços.
 *
 * COMO USA
 * --------
 *   node scripts/pulse-teste.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const nome of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(ROOT, nome));
  } catch {
    /* sem .env — o shim abaixo usa uma chave de teste */
  }
}

// ── Shim do Deno (o módulo usa Deno.env.get) ───────────────────────────────
const CHAVE_DE_TESTE = process.env.PULSE_API_KEY || "pk_teste_local_000000";
globalThis.Deno = {
  env: {
    get: (chave) => (chave === "PULSE_API_KEY" ? CHAVE_DE_TESTE : undefined),
  },
};

// ── Cores ──────────────────────────────────────────────────────────────────
const C = {
  ok: "\x1b[32m", fail: "\x1b[31m", dim: "\x1b[90m",
  bold: "\x1b[1m", fim: "\x1b[0m",
};

let passou = 0;
let falhou = 0;
const falhas = [];

function ok(nome) {
  passou++;
  console.log(`${C.ok}  ok${C.fim}   ${nome}`);
}

function falha(nome, detalhe) {
  falhou++;
  falhas.push({ nome, detalhe });
  console.log(`${C.fail}  FALHA${C.fim} ${nome}`);
  if (detalhe) console.log(`       ${C.dim}${detalhe}${C.fim}`);
}

function igual(nome, recebido, esperado) {
  const ok1 = JSON.stringify(recebido) === JSON.stringify(esperado);
  if (ok1) ok(nome);
  else falha(nome, `esperado ${JSON.stringify(esperado)} · recebido ${JSON.stringify(recebido)}`);
}

function verdade(nome, condicao, detalhe) {
  if (condicao) ok(nome);
  else falha(nome, detalhe || "condição falsa");
}

// ── Mocks ──────────────────────────────────────────────────────────────────
/** Guarda as chamadas feitas e responde conforme o roteiro. */
function mockFetch(roteiro) {
  const chamadas = [];
  let indice = 0;
  globalThis.fetch = async (url, opts = {}) => {
    chamadas.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null });
    const resposta = roteiro[indice] ?? roteiro[roteiro.length - 1];
    indice++;
    if (resposta === "timeout") {
      // Nunca resolve: só o AbortController derruba.
      return await new Promise((_, reject) => {
        opts.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }
    if (resposta.excecao) throw resposta.excecao;
    return new Response(JSON.stringify(resposta.corpo ?? {}), {
      status: resposta.status ?? 200,
      headers: { "Content-Type": "application/json", ...(resposta.headers || {}) },
    });
  };
  return chamadas;
}

// ── Carrega os módulos DEPOIS do shim ─────────────────────────────────────
const pulse = await import("../supabase/functions/_shared/pulse.ts");
const catalogo = await import("../supabase/functions/_shared/pulse-catalog.ts");
const pedidos = await import("../supabase/functions/_shared/pulse-orders.ts");

console.log(`\n${C.bold}TESTES DA INTEGRAÇÃO PULSE CODING${C.fim} ${C.dim}(sem rede)${C.fim}\n`);

// ===========================================================================
// 1. AS AÇÕES
// ===========================================================================
{
  const chamadas = mockFetch([
    { status: 200, corpo: { ok: true, pong: true, api_version: "2.2" } },
  ]);
  const r = await pulse.pulsePing();
  igual("ping devolve pong", r.pong, true);
  igual("ping envia a action certa", chamadas[0].body.action, "ping");
  igual("ping manda a chave no header x-api-key", chamadas[0].opts.headers["x-api-key"], CHAVE_DE_TESTE);
}

{
  mockFetch([{ status: 200, corpo: { ok: true, balance: 12.5, available_for_orders: 12.5 } }]);
  const r = await pulse.pulseGetBalance();
  igual("get_balance devolve o saldo", r.balance, 12.5);
}

{
  mockFetch([
    {
      status: 200,
      corpo: {
        ok: true,
        packages: [
          { id: "p1", title: "Netflix Premium 4K HDR - 1 Mês", category: "Streaming", original_price: 31.9, price: 25.5, orderable_via_api: false },
          { id: "p2", title: "Amazon Prime Video 6M", category: "Streaming", original_price: 9.9, price: 7.92, orderable_via_api: true, stock: 12 },
        ],
      },
    },
  ]);
  const r = await pulse.pulseListPackages();
  igual("list_packages devolve 2 pacotes", r.packages.length, 2);
  igual("list_packages guarda o preço de revenda", r.packages[1].price, 7.92);
}

{
  const chamadas = mockFetch([{ status: 200, corpo: { ok: true, order_id: "o1", status: "completed" } }]);
  const r = await pulse.pulseCreateOrder({
    package_id: "p2",
    external_id: "AB12CD34",
    customer_name: "Cliente Teste",
    dry_run: true,
  });
  igual("create_order devolve o id do pedido", r.order_id, "o1");
  igual("create_order envia a action", chamadas[0].body.action, "create_order");
  igual("create_order envia o external_id", chamadas[0].body.external_id, "AB12CD34");
  igual("create_order marca dry_run", chamadas[0].body.dry_run, true);
  igual("create_order não manda webhook_url vazio", "webhook_url" in chamadas[0].body, false);
}

{
  const chamadas = mockFetch([{ status: 200, corpo: { ok: true, status: "completed", delivery: { accounts: [] } } }]);
  await pulse.pulseCheckStatus({ external_id: "AB12CD34" });
  igual("check_status envia o external_id", chamadas[0].body.external_id, "AB12CD34");
}

{
  mockFetch([{ status: 200, corpo: { ok: true, orders: [{ id: "o1" }] } }]);
  const r = await pulse.pulseListOrders({ limit: 10 });
  igual("list_orders devolve os pedidos", r.orders.length, 1);
}

// ===========================================================================
// 2. TRADUÇÃO DE ERRO — o `code` manda, não o status
// ===========================================================================
{
  mockFetch([{ status: 400, corpo: { ok: false, error: "Saldo insuficiente", code: "saldo_insuficiente", needed: 7.92, balance: 0 } }]);
  try {
    await pulse.pulseCreateOrder({ package_id: "p2", external_id: "AA11BB22" });
    falha("400 com saldo_insuficiente vira erro", "não lançou");
  } catch (e) {
    igual("400 + code saldo_insuficiente → saldo_insuficiente", e.code, "saldo_insuficiente");
    igual("o erro guarda o quanto faltava", e.details.needed, 7.92);
  }
}

{
  mockFetch([{ status: 409, corpo: { ok: false, error: "sem estoque", code: "sem_estoque", available: 0 } }]);
  try {
    await pulse.pulseCreateOrder({ package_id: "p2", external_id: "AA11BB33" });
    falha("409 sem_estoque vira erro", "não lançou");
  } catch (e) {
    igual("409 + code sem_estoque → sem_estoque", e.code, "sem_estoque");
  }
}

{
  mockFetch([{ status: 404, corpo: { ok: false, error: "Pacote não existe", code: "pacote_inexistente" } }]);
  try {
    await pulse.pulseCreateOrder({ package_id: "sumiu", external_id: "AA11BB44" });
    falha("404 de pacote vira erro", "não lançou");
  } catch (e) {
    igual("404 + code pacote_inexistente → pacote_inexistente", e.code, "pacote_inexistente");
    verdade("pacote sumido pede remapeamento", e.precisaRemapear === true);
  }
}

{
  // A Pulse responde 404 SEM code quando o pedido não existe.
  mockFetch([{ status: 404, corpo: { ok: false, error: "Order not found" } }]);
  try {
    await pulse.pulseCheckStatus({ external_id: "NAOEXISTE" });
    falha("404 de pedido vira erro", "não lançou");
  } catch (e) {
    igual("404 sem code em check_status → pedido_inexistente", e.code, "pedido_inexistente");
    verdade("pedido inexistente NÃO pede remapeamento", e.precisaRemapear === false);
  }
}

{
  mockFetch([{ status: 401, corpo: { ok: false, error: "chave inválida" } }]);
  try {
    await pulse.pulsePing();
    falha("401 vira erro", "não lançou");
  } catch (e) {
    igual("401 → chave_invalida", e.code, "chave_invalida");
  }
}

{
  mockFetch([{ status: 410, corpo: { ok: false, error: "pacote antigo" } }]);
  try {
    await pulse.pulseCreateOrder({ package_id: "antigo", external_id: "AA11BB55" });
    falha("410 vira erro", "não lançou");
  } catch (e) {
    igual("410 → pacote_antigo", e.code, "pacote_antigo");
    verdade("pacote antigo pede remapeamento", e.precisaRemapear === true);
  }
}

// ===========================================================================
// 3. RETRY E TIMEOUT
// ===========================================================================
{
  const chamadas = mockFetch([
    { status: 429, corpo: { ok: false, error: "limite" }, headers: { "retry-after": "1" } },
    { status: 200, corpo: { ok: true, pong: true } },
  ]);
  const r = await pulse.pulsePing();
  igual("429 é repetido e depois passa", r.pong, true);
  igual("o 429 consumiu duas chamadas", chamadas.length, 2);
}

{
  const chamadas = mockFetch([
    { excecao: Object.assign(new Error("sem rede"), { name: "TypeError" }) },
    { status: 200, corpo: { ok: true, pong: true } },
  ]);
  const r = await pulse.pulsePing();
  igual("erro de rede é repetido", r.pong, true);
  igual("o retry de rede fez duas chamadas", chamadas.length, 2);
}

{
  mockFetch(["timeout"]);
  try {
    await pulse.pulseRequest("ping", {}, { timeoutMs: 60, tentativas: 1 });
    falha("timeout vira erro", "não lançou");
  } catch (e) {
    igual("timeout → timeout", e.code, "timeout");
  }
}

// ===========================================================================
// 4. ASSINATURA DO WEBHOOK
// ===========================================================================
{
  const corpo = JSON.stringify({ event: "order.completed", external_id: "AB12CD34" });
  const assinatura = await pulse.pulseAssinaWebhook(corpo, CHAVE_DE_TESTE);
  verdade("a assinatura começa com sha256=", assinatura.startsWith("sha256="));

  const confere = await pulse.pulseConfereAssinatura(corpo, assinatura, CHAVE_DE_TESTE);
  verdade("assinatura do corpo certo é aceita", confere === true);

  const adulterado = await pulse.pulseConfereAssinatura(
    JSON.stringify({ event: "order.completed", external_id: "OUTRO123" }),
    assinatura,
    CHAVE_DE_TESTE,
  );
  verdade("assinatura de outro corpo é recusada", adulterado === false);

  const semHeader = await pulse.pulseConfereAssinatura(corpo, null, CHAVE_DE_TESTE);
  verdade("sem header é recusado", semHeader === false);

  const assinaturaErrada = await pulse.pulseConfereAssinatura(corpo, "sha256=deadbeef", CHAVE_DE_TESTE);
  verdade("assinatura errada é recusada", assinaturaErrada === false);

  const outraChave = await pulse.pulseConfereAssinatura(corpo, assinatura, "outra-chave");
  verdade("assinatura feita com outra chave é recusada", outraChave === false);
}

// ===========================================================================
// 5. IDEMPOTÊNCIA — o external_id
// ===========================================================================
{
  const a = pedidos.gerarExternalId();
  const b = pedidos.gerarExternalId();
  verdade("o external_id tem 8 caracteres", a.length === 8, `veio ${a.length}: ${a}`);
  verdade("o external_id é só letra e número", /^[A-Z0-9]{8}$/.test(a), `veio ${a}`);
  verdade("o external_id muda a cada chamada", a !== b);
}

// ===========================================================================
// 6. CLASSIFICAÇÃO DA ENTREGA
// ===========================================================================
{
  const c1 = pedidos.classificarEntrega({ accounts: [{ email: "a@b.com", password: "123", credits: 50 }] });
  verdade("entrega com contas → accounts", c1.kind === "accounts");
  verdade("a conta traz os créditos", c1.contas[0].credits === 50);

  const c2 = pedidos.classificarEntrega({ delivery_link: "https://exemplo.com/ativar" });
  verdade("entrega com link → link", c2.kind === "link");

  const c3 = pedidos.classificarEntrega({ license_key: "ABC-123" });
  verdade("entrega com licença → code", c3.kind === "code");

  const c4 = pedidos.classificarEntrega({ cloud_code_key: "CODE-9" });
  verdade("entrega com cloud code → custom", c4.kind === "custom");

  const c5 = pedidos.classificarEntrega({});
  verdade("entrega vazia → sem tipo", c5.kind === null);
}

// ===========================================================================
// 7. REGRAS DE CATÁLOGO
// ===========================================================================
{
  igual("'6M' → 180 dias / semiannual", catalogo.derivarCiclo("Amazon Prime Video 6M").duration_days, 180);
  igual("'1 Mês' → 30 dias / monthly", catalogo.derivarCiclo("Netflix Premium 4K HDR - 1 Mês").duration_days, 30);
  igual("'3 Meses' → 90 dias / quarterly", catalogo.derivarCiclo("Spotify Premium - 3 Meses").duration_days, 90);
  igual("'1 Ano' → 365 dias / annual", catalogo.derivarCiclo("Lovable 1 Ano").duration_days, 365);
  igual("'1 dia' → 1 dia / days", catalogo.derivarCiclo("Extensão - Duração De 1 dia - 100 créditos").duration_days, 1);
  igual(
    "'30 dias' ganha de 'Por Dia' (primeira ocorrência)",
    catalogo.derivarCiclo("Extensão Pulse Coding - Duração De 30 dias - 100 créditos Por Dia").duration_days,
    30,
  );
  igual("sem duração → 30 dias", catalogo.derivarCiclo("Claude — 25 milhões de tokens").duration_days, 30);
}

{
  igual("markup de 20% sobre 9,90 → 11,88", catalogo.calcularPrecoVenda(9.9, 20), 11.88);
  igual("markup de 20% sobre 49,70 → 59,64", catalogo.calcularPrecoVenda(49.7, 20), 59.64);
  igual("margem = venda - custo", catalogo.calcularMargem(11.88, 7.92), 3.96);
}

{
  igual("Netflix vai para a plataforma netflix", catalogo.resolverPlataforma({ title: "Netflix Premium 4K HDR - 1 Mês" }).slug, "netflix");
  igual("Prime Video vai para prime-video", catalogo.resolverPlataforma({ title: "Amazon Prime Video 6M" }).slug, "prime-video");
  igual("ChatGPT vai para chatgpt", catalogo.resolverPlataforma({ title: "ChatGPT Go — Link de Ativação" }).slug, "chatgpt");
  igual("Claude vai para claude", catalogo.resolverPlataforma({ title: "Claude — 25 milhões de tokens" }).slug, "claude");
  igual("Antigravity cria plataforma nova", catalogo.resolverPlataforma({ title: "Antigravity Pro" }).criar, true);
  igual("Combos vai para combos-pulse", catalogo.resolverPlataforma({ title: "Combo Play — Spotify + YouTube" }).slug, "combos-pulse");
}

{
  verdade("categoria Serviços é ignorada", catalogo.categoriaEhIgnorada("Serviços") === true);
  verdade("categoria Streaming NÃO é ignorada", catalogo.categoriaEhIgnorada("Streaming") === false);
}

{
  // Pacote fora do catálogo da Pulse (orderable_via_api = false) é "vendável"?
  verdade("pacote indisponível na Pulse não é vendável", catalogo.pacoteEhVendavel({ orderable_via_api: false }) === false);
  verdade("pacote vendável é vendável", catalogo.pacoteEhVendavel({ orderable_via_api: true, availability: "automatic" }) === true);
}

// ===========================================================================
// 8. DATA DE VALIDADE
// ===========================================================================
{
  const validade = pedidos.dataValidade(30, new Date("2026-11-06T12:00:00Z"));
  igual("30 dias de validade a partir de 06/11", validade, "2026-12-06");
  const instante = pedidos.instanteValidade(30, new Date("2026-11-06T12:00:00Z"));
  verdade("o instante de validade é ISO", /^\d{4}-\d{2}-\d{2}T/.test(instante), instante);
}

// ===========================================================================
// RESULTADO
// ===========================================================================
console.log(`\n${C.bold}${passou} passaram · ${falhou} falharam${C.fim}\n`);
if (falhou > 0) {
  console.log(`${C.fail}Falhas:${C.fim}`);
  for (const f of falhas) console.log(`  - ${f.nome}${f.detalhe ? `: ${f.detalhe}` : ""}`);
  process.exit(1);
}
process.exit(0);
