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
const statusParceiro = await import("../supabase/functions/_shared/pulse-status.ts");

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
  // Rótulo do período: é o que impede "1 dias" e "/mês por perfil" num
  // pacote que vale por 7 dias.
  igual(
    "1 dia → '1 dia' (no singular)",
    catalogo.rotuloCiclo(catalogo.derivarCiclo("Extensão - Duração De 1 dia - 100 créditos")),
    "1 dia",
  );
  igual(
    "7 dias → '7 dias'",
    catalogo.rotuloCiclo(catalogo.derivarCiclo("Extensão - Duração De 7 dias - 100 créditos")),
    "7 dias",
  );
  igual(
    "ciclo mensal não tem rótulo de período",
    catalogo.rotuloCiclo(catalogo.derivarCiclo("Netflix Premium 4K HDR - 1 Mês")),
    null,
  );
}

{
  igual("Netflix vai para a plataforma netflix", catalogo.resolverPlataforma({ title: "Netflix Premium 4K HDR - 1 Mês" }).slug, "netflix");
  igual("Prime Video vai para prime-video", catalogo.resolverPlataforma({ title: "Amazon Prime Video 6M" }).slug, "prime-video");
  igual("ChatGPT vai para chatgpt", catalogo.resolverPlataforma({ title: "ChatGPT Go — Link de Ativação" }).slug, "chatgpt");
  igual("Claude vai para claude", catalogo.resolverPlataforma({ title: "Claude — 25 milhões de tokens" }).slug, "claude");
  igual("Antigravity cria plataforma nova", catalogo.resolverPlataforma({ title: "Antigravity Pro" }).criar, true);
  igual("Combos vai para combos", catalogo.resolverPlataforma({ title: "Combo Play — Spotify + YouTube" }).slug, "combos");
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

{
  // Para o cliente, o fornecedor é a DIVIDEPASS (decisão do dono): a marca
  // some do texto e o nome que aparece é o da plataforma.
  igual(
    "'| PULSE' vira '| DividePass'",
    catalogo.marcarComoDividePass("ANTIGRAVITY — 1 BILHÃO DE TOKENS | PULSE"),
    "ANTIGRAVITY — 1 BILHÃO DE TOKENS | DividePass",
  );
  igual(
    "'Suporte da PULSE' vira 'Suporte da DividePass'",
    catalogo.marcarComoDividePass("Suporte da PULSE para dúvidas sobre a entrega."),
    "Suporte da DividePass para dúvidas sobre a entrega.",
  );
  igual(
    "'Pulse Codig' no meio do nome vira 'DividePass —'",
    catalogo.marcarComoDividePass("Extensão Pulse Codig Duração De 1 dia - 100 créditos"),
    "Extensão DividePass — Duração De 1 dia - 100 créditos",
  );
  igual(
    "'Pulse Clone' inteiro vira 'DividePass'",
    catalogo.marcarComoDividePass("Pulse Clone — 01 Clone"),
    "DividePass — 01 Clone",
  );
  igual(
    "título sem a marca fica intacto",
    catalogo.marcarComoDividePass("Combo Play — Spotify Premium + YouTube Premium | 3 Meses Cada"),
    "Combo Play — Spotify Premium + YouTube Premium | 3 Meses Cada",
  );
  igual(
    "plataforma Extensão não leva a marca",
    catalogo.resolverPlataforma({ title: "Extensão Pulse Coding Duração De 7 dias" }).slug,
    "extensoes",
  );
  igual(
    "plataforma Clone não leva a marca",
    catalogo.resolverPlataforma({ title: "Pulse Clone — 01 Clone" }).slug,
    "clones",
  );
  igual(
    "plataforma Combo não leva a marca",
    catalogo.resolverPlataforma({ title: "Combo Play — Spotify Premium" }).slug,
    "combos",
  );
}

{
  // ASSINATURA x PAGAMENTO ÚNICO — a API não tem campo para isso, então a
  // classificação sai do `delivery`, dos créditos e do período no título.
  igual(
    "Netflix 1 mês é recorrente",
    catalogo.classificarProduto(
      { title: "Netflix Premium 4K HDR - 1 Mês", delivery: "automatica" },
      catalogo.derivarCiclo("Netflix Premium 4K HDR - 1 Mês"),
    ).natureza,
    "recorrente",
  );
  igual(
    "Canva Pro 12 meses é recorrente",
    catalogo.classificarProduto(
      { title: "Canva Pro — 12 Meses", delivery: "automatica" },
      catalogo.derivarCiclo("Canva Pro — 12 Meses"),
    ).natureza,
    "recorrente",
  );
  igual(
    "extensão de 7 dias com créditos é pagamento único",
    catalogo.classificarProduto(
      { title: "Extensão Duração De 7 dias - 100 créditos Por Dia", delivery: "automatica" },
      catalogo.derivarCiclo("Extensão Duração De 7 dias - 100 créditos Por Dia"),
    ).natureza,
    "pagamento_unico",
  );
  igual(
    "pacote de tokens é pagamento único",
    catalogo.classificarProduto(
      { title: "ANTIGRAVITY — 1 BILHÃO DE TOKENS", delivery: "automatica" },
      catalogo.derivarCiclo("ANTIGRAVITY — 1 BILHÃO DE TOKENS"),
    ).natureza,
    "pagamento_unico",
  );
  igual(
    "produto sem período no título é pagamento único",
    catalogo.classificarProduto(
      { title: "CloneSupa - 2 Clones", delivery: "automatica" },
      catalogo.derivarCiclo("CloneSupa - 2 Clones"),
    ).natureza,
    "pagamento_unico",
  );
  igual(
    "delivery manual é sinalizado",
    catalogo.classificarProduto(
      { title: "VIDEOAPI — Plano Starter | 1 mês", delivery: "manual" },
      catalogo.derivarCiclo("VIDEOAPI — Plano Starter | 1 mês"),
    ).entrega,
    "manual",
  );
  igual(
    "delivery automatica é o padrão",
    catalogo.classificarProduto(
      { title: "Netflix Premium 4K HDR - 1 Mês", delivery: "automatica" },
      catalogo.derivarCiclo("Netflix Premium 4K HDR - 1 Mês"),
    ).entrega,
    "automatica",
  );
}

{
  // ESTOQUE DO PARCEIRO — quem decide é o `available_stock`, NÃO o `stock`
  // (em 22 produtos de entrega manual o `stock` é 0 e ainda há estoque).
  igual(
    "available_stock = 0 é sem estoque",
    catalogo.pacoteTemEstoque({ available_stock: 0, in_stock: true, available: true }),
    false,
  );
  igual(
    "available_stock > 0 tem estoque",
    catalogo.pacoteTemEstoque({ available_stock: 100, in_stock: true, available: true }),
    true,
  );
  igual(
    "stock = 0 mas available_stock = 100 TEM estoque",
    catalogo.pacoteTemEstoque({ stock: 0, available_stock: 100, in_stock: true, available: true }),
    true,
  );
  igual(
    "in_stock = false é sem estoque",
    catalogo.pacoteTemEstoque({ available_stock: 100, in_stock: false, available: true }),
    false,
  );
  igual(
    "sem estoque ganha a tag Esgotado",
    catalogo.tagsDoGrupo({ title: "X" }, false).join(","),
    "Via Parceiro,Esgotado",
  );
  igual(
    "com estoque fica só Via Parceiro",
    catalogo.tagsDoGrupo({ title: "X" }, true).join(","),
    "Via Parceiro",
  );
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
// 9. STATUS DO GRUPO NA PULSE (a sincronização de 5 em 5 horas)
// ===========================================================================
{
  // ── A regra do status ────────────────────────────────────────────────────
  igual(
    "produto vendável é 'Na vitrine'",
    catalogo.statusPulseDoPacote({ availability: "automatic", orderable_via_api: true, available: true }),
    "na_vitrine",
  );
  igual(
    "produto indisponível é 'Indisponível'",
    catalogo.statusPulseDoPacote({ availability: "unavailable", orderable_via_api: false, available: false }),
    "indisponivel",
  );
  igual(
    "produto que não dá para pedir pela API é 'Indisponível'",
    catalogo.statusPulseDoPacote({ availability: "manual", orderable_via_api: false, available: true }),
    "indisponivel",
  );
  igual(
    "rótulo do status: Na vitrine",
    catalogo.rotuloStatusPulse("na_vitrine"),
    "Na vitrine",
  );
  igual(
    "rótulo do status: Indisponível",
    catalogo.rotuloStatusPulse("indisponivel"),
    "Indisponível",
  );

  // ── O efeito no grupo ────────────────────────────────────────────────────
  const pkgVendavel = {
    id: "pkg-1",
    title: "Produto Na vitrine",
    availability: "automatic",
    orderable_via_api: true,
    available: true,
    in_stock: true,
    available_stock: 12,
  };
  const pkgIndisponivel = {
    id: "pkg-2",
    title: "Produto Indisponível",
    availability: "unavailable",
    orderable_via_api: false,
    available: false,
    in_stock: false,
    available_stock: 0,
  };
  const pkgSemEstoque = {
    id: "pkg-4",
    title: "Produto Na vitrine sem estoque",
    availability: "manual",
    orderable_via_api: true,
    available: true,
    in_stock: true,
    available_stock: 0,
  };
  const pkgVoltou = {
    id: "pkg-3",
    title: "Produto que voltou",
    availability: "automatic",
    orderable_via_api: true,
    available: true,
    in_stock: true,
    available_stock: 8,
  };

  // Um banco falso: só o que o módulo usa.
  function bancoFalso(grupos, pacotes, extras = {}) {
    const estado = { grupos, pacotes, ...extras };
    const tabelas = {
      groups: estado.grupos,
      pulse_pacotes: estado.pacotes,
      user_subscriptions: estado.user_subscriptions || [],
      group_members: estado.group_members || [],
    };
    return {
      estado,
      from(nome) {
        const tabela = tabelas[nome] || [];
        const filtros = [];
        let excluirNulos = false;
        let tagsExigidas = null;
        const api = {
          select: () => api,
          not: () => { excluirNulos = true; return api; },
          contains: (col, val) => { tagsExigidas = val; return api; },
          // Vários `.eq()` são E (AND), não o último vencendo: é o que o
          // PostgREST faz e o que o código do sync depende.
          eq: (col, val) => { filtros.push([col, val]); return api; },
          update: (patch) => ({
            eq: async (col, val) => {
              for (const linha of tabela) if (linha[col] === val) Object.assign(linha, patch);
              return { error: null };
            },
          }),
          maybeSingle: async () => {
            const linhas = api._linhas();
            return { data: linhas[0] ?? null };
          },
          _linhas: () => {
            let linhas = tabela.slice();
            if (excluirNulos) linhas = linhas.filter((l) => l.group_id !== null && l.group_id !== undefined);
            if (tagsExigidas) {
              linhas = linhas.filter((l) => (l.tags || []).some((t) => tagsExigidas.includes(t)));
            }
            for (const [col, val] of filtros) linhas = linhas.filter((l) => l[col] === val);
            return linhas;
          },
          then: (resolve, reject) => Promise.resolve({ data: api._linhas() }).then(resolve, reject),
        };
        return api;
      },
    };
  }

  // ── Cenário 1: o status do produto muda o estado do grupo ───────────────
  {
    const grupos = [
      // já está "Na vitrine" e continua
      { id: "g1", name: "APIFY 30 Credits", status: "open", visibility: "public", tags: ["Via Parceiro"] },
      // estava na vitrine e o parceiro tirou do cardápio → desativa
      { id: "g2", name: "Antigravity 1B", status: "open", visibility: "public", tags: ["Via Parceiro"] },
      // estava desativado e o parceiro voltou a liberar → reativa
      { id: "g3", name: "Claude Max 5x", status: "closed", visibility: "private", tags: ["Via Parceiro"] },
      // está na vitrine, mas sem estoque → continua anunciado como Esgotado
      { id: "g4", name: "CapCut PRO", status: "open", visibility: "public", tags: ["Via Parceiro"] },
    ];
    const pacotes = [
      { package_id: "pkg-1", group_id: "g1", status: "importado", visible: true, stock: 12 },
      { package_id: "pkg-2", group_id: "g2", status: "importado", visible: true, stock: 5 },
      { package_id: "pkg-3", group_id: "g3", status: "indisponivel", visible: false, stock: 0 },
      { package_id: "pkg-4", group_id: "g4", status: "importado", visible: true, stock: 3 },
    ];
    const db = bancoFalso(grupos, pacotes, {
      // g2 tem gente pagante: é o caso que o dono precisa ser avisado.
      user_subscriptions: [
        { id: "s1", group_id: "g2", status: "active" },
        { id: "s2", group_id: "g2", status: "active" },
        { id: "s3", group_id: "g1", status: "active" },
      ],
      group_members: [
        { id: "m1", group_id: "g2", status: "active" },
        { id: "m2", group_id: "g1", status: "active" },
      ],
    });

    mockFetch([
      {
        status: 200,
        corpo: { ok: true, packages: [pkgVendavel, pkgIndisponivel, pkgVoltou, pkgSemEstoque] },
      },
    ]);

    const rel = await statusParceiro.sincronizarStatusParceiro(db);

    igual("g1 (Na vitrine) continua aberto e público", [db.estado.grupos[0].status, db.estado.grupos[0].visibility], ["open", "public"]);
    igual("g2 (Indisponível na Pulse) é desativado", [db.estado.grupos[1].status, db.estado.grupos[1].visibility], ["closed", "private"]);
    igual("g3 (voltou a ser liberado) é reativado", [db.estado.grupos[2].status, db.estado.grupos[2].visibility], ["open", "public"]);
    igual(
      "g4 (Na vitrine sem estoque) continua anunciado e ganha a tag Esgotado",
      [db.estado.grupos[3].status, db.estado.grupos[3].tags],
      ["open", ["Via Parceiro", "Esgotado"]],
    );
    igual("1 grupo desativado na rodada", rel.desativados, 1);
    igual("1 grupo reativado na rodada", rel.reativados, 1);
    igual("3 grupos Na vitrine", rel.na_vitrine, 3);
    igual("1 grupo Indisponível", rel.indisponiveis, 1);
    igual("1 grupo esgotado (sem estoque)", rel.esgotados, 1);
    igual("o espelho do painel segue o status da Pulse", db.estado.pacotes[1].visible, false);
    igual(
      "desativado COM gente pagante entra no aviso do dono",
      rel.desativados_com_gente,
      [{ nome: "Antigravity 1B", assinaturas: 2, membros: 1 }],
    );
  }

  // ── Cenário 2: a API falha → NADA é tocado ───────────────────────────────
  {
    const grupos = [
      { id: "g1", name: "Antigravity 1B", status: "open", visibility: "public", tags: ["Via Pareiro"] },
    ];
    const pacotes = [{ package_id: "pkg-1", group_id: "g1", status: "importado", visible: true, stock: 12 }];
    const db = bancoFalso(grupos, pacotes);

    mockFetch([{ status: 500, corpo: { error: "boom" } }]);

    const rel = await statusParceiro.sincronizarStatusParceiro(db);
    verdade("falha da API é devolvida no relatório", !!rel.erro, rel.erro);
    igual("nenhum grupo foi desativado com a API fora", rel.desativados, 0);
    igual("o grupo continua como estava", [db.estado.grupos[0].status, db.estado.grupos[0].visibility], ["open", "public"]);
  }
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
