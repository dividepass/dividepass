/**
 * TESTE REAL DA INTEGRAÇÃO PULSE CODING (dry_run — NÃO COBRA NADA)
 * ================================================================
 *
 * Roda a cadeia completa contra a API de verdade da Pulse, em modo
 * `dry_run`. Nenhum pedido é criado e nenhum centavo sai do seu saldo.
 *
 * POR QUE ISSO EXISTE
 * -------------------
 * A regra do projeto é: antes de ir para produção, testar o fluxo inteiro
 * com `dry_run: true`. Este script é esse teste — e ele roda na sua
 * máquina, com a chave do seu `.env`, sem precisar subir nada.
 *
 * O QUE ELE FAZ
 * -------------
 *   1. ping         → a chave vale?
 *   2. get_balance  → quanto há para gastar?
 *   3. list_packages→ o catálogo está acessível? Quantos pacotes vendáveis?
 *   4. create_order (dry_run) → quanto custaria a compra mais barata?
 *   5. check_status (dry)  → o external_id de teste responde?
 *
 * COMO USA
 * --------
 *   1. Tenha PULSE_API_KEY no `.env` (o arquivo está no .gitignore).
 *   2. node scripts/pulse-dry-run.mjs
 *
 * Saída 0 = tudo certo. Saída 1 = algo quebrou (o motivo vem escrito).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const nome of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(ROOT, nome));
  } catch {
    /* sem .env */
  }
}

const C = {
  ok: "\x1b[32m", fail: "\x1b[31m", warn: "\x1b[33m",
  dim: "\x1b[90m", bold: "\x1b[1m", fim: "\x1b[0m",
};

const CHAVE = (process.env.PULSE_API_KEY || "").trim();
const URL_API =
  process.env.PULSE_API_URL ||
  "https://nepatnfgqlcvunmrpddr.supabase.co/functions/v1/reseller-api";

let problemas = 0;

function titulo(texto) {
  console.log(`\n${C.bold}${texto}${C.fim}`);
}

function linha(rotulo, valor, cor = "") {
  console.log(`  ${rotulo.padEnd(26)} ${cor}${valor}${C.fim}`);
}

/** Chamada crua na API (o módulo _shared/pulse.ts roda dentro do Deno). */
async function chamar(action, payload = {}) {
  const resposta = await fetch(URL_API, {
    method: "POST",
    headers: {
      "x-api-key": CHAVE,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...payload }),
    signal: AbortSignal.timeout(30_000),
  });

  const texto = await resposta.text();
  let corpo = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = null;
  }
  return { status: resposta.status, corpo };
}

console.log(`\n${C.bold}TESTE REAL — PULSE CODING (dry_run, não cobra)${C.fim}`);
console.log(`${C.dim}${URL_API}${C.fim}`);

if (!CHAVE) {
  console.error(
    `\n${C.fail}Falta a chave.${C.fim} Cadastre PULSE_API_KEY no .env (o arquivo está no .gitignore):\n` +
    `  PULSE_API_KEY=pk_...\n`,
  );
  process.exit(1);
}

// ── 1. Conexão ────────────────────────────────────────────────────────────
titulo("1. Conexão");
{
  const { status, corpo } = await chamar("ping");
  if (status === 200 && corpo?.ok) {
    linha("status", "OK", C.ok);
    linha("versão da API", corpo.api_version || "—");
    linha("conta revenda", corpo.reseller_email || "—");
  } else {
    linha("status", `HTTP ${status} · ${corpo?.error || "sem resposta"}`, C.fail);
    console.error(`\n${C.fail}A chave foi recusada ou a API está fora.${C.fim}`);
    process.exit(1);
  }
}

// ── 2. Saldo ──────────────────────────────────────────────────────────────
titulo("2. Saldo");
let saldo = 0;
{
  const { status, corpo } = await chamar("get_balance");
  if (status === 200 && corpo?.ok) {
    saldo = Number(corpo.available_for_orders ?? corpo.balance ?? 0);
    linha("disponível para pedidos", `R$ ${saldo.toFixed(2)}`, saldo > 0 ? C.ok : C.warn);
    linha("saldo da API", `R$ ${Number(corpo.reseller_balance ?? 0).toFixed(2)}`);
    linha("saldo de compra", `R$ ${Number(corpo.purchase_balance ?? 0).toFixed(2)}`);
    if (saldo <= 0) {
      console.log(
        `\n  ${C.warn}Sem saldo: nenhum pedido real sai (e o dry_run responde 400).${C.fim}\n` +
        `  ${C.dim}Recarregue na Pulse Coding e rode este script de novo.${C.fim}`,
      );
      problemas++;
    }
  } else {
    linha("status", `HTTP ${status} · ${corpo?.error || "sem resposta"}`, C.fail);
    problemas++;
  }
}

// ── 3. Catálogo ───────────────────────────────────────────────────────────
titulo("3. Catálogo");
let maisBarato = null;
{
  const { status, corpo } = await chamar("list_packages");
  if (status === 200 && corpo?.ok) {
    const pacotes = Array.isArray(corpo.packages) ? corpo.packages : [];
    const vendaveis = pacotes.filter((p) => p.orderable_via_api !== false && p.availability !== "unavailable");
    const indisponiveis = pacotes.length - vendaveis.length;

    linha("pacotes no total", pacotes.length);
    linha("vendáveis via API", vendaveis.length, C.ok);
    linha("indisponíveis", indisponiveis, C.warn);

    const comPreco = vendaveis
      .filter((p) => Number(p.price) > 0)
      .sort((a, b) => Number(a.price) - Number(b.price));
    if (comPreco.length > 0) {
      maisBarato = comPreco[0];
      linha("mais barato", `${maisBarato.title} · R$ ${Number(maisBarato.price).toFixed(2)}`);
      linha("preço de venda ao cliente", `R$ ${Number(maisBarato.original_price ?? 0).toFixed(2)}`);
    }
  } else {
    linha("status", `HTTP ${status} · ${corpo?.error || "sem resposta"}`, C.fail);
    problemas++;
  }
}

// ── 4. Simulação de compra ─────────────────────────────────────────────────
titulo("4. Simulação de compra (dry_run — não cobra)");
if (maisBarato) {
  const externalId = `DRY${Date.now().toString(36).toUpperCase().slice(-5)}`;
  const { status, corpo } = await chamar("create_order", {
    package_id: maisBarato.id,
    external_id: externalId,
    dry_run: true,
  });

  if (corpo?.ok) {
    linha("resultado", "aprovado", C.ok);
    linha("external_id de teste", externalId);
    linha("custaria", `R$ ${Number(corpo.price ?? corpo.charge ?? maisBarato.price).toFixed(2)}`);
  } else {
    const codigo = corpo?.code || `HTTP ${status}`;
    const recuperavel = ["saldo_insuficiente", "sem_estoque"].includes(corpo?.code);
    linha("resultado", `${codigo} · ${corpo?.error || "sem resposta"}`, recuperavel ? C.warn : C.fail);
    if (corpo?.code === "saldo_insuficiente") {
      linha("faltaria", `R$ ${Number(corpo.needed ?? 0).toFixed(2)}`);
      console.log(
        `\n  ${C.dim}Isso é o esperado com o saldo zerado. Recarregue e rode de novo.${C.fim}`,
      );
    } else {
      problemas++;
    }
  }

  // ── 5. check_status com um id que não existe (testa o tratamento) ─────
  titulo("5. check_status com pedido inexistente");
  const resposta = await chamar("check_status", { external_id: "TESTEIDX" });
  if (resposta.status === 404) {
    linha("resposta", "404 · pedido inexistente (tratado)", C.ok);
  } else {
    linha("resposta", `HTTP ${resposta.status}`, C.warn);
  }
} else {
  console.log(`  ${C.dim}Sem pacote vendável com preço — simulação pulada.${C.fim}`);
}

// ── Resultado ─────────────────────────────────────────────────────────────
console.log("");
if (problemas === 0) {
  console.log(`${C.ok}${C.bold}Tudo certo.${C.fim} A integração fala com a Pulse.\n`);
  process.exit(0);
}
console.log(
  `${C.warn}${C.bold}${problemas} ponto(s) para resolver.${C.fim} ` +
  `O mais comum é saldo zerado — recarregue na Pulse Coding.\n`,
);
process.exit(1);
