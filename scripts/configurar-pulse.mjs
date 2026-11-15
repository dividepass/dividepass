/**
 * CONFIGURA A INTEGRAÇÃO COM A PULSE CODING
 * =========================================
 *
 * Deixa a revenda pronta para funcionar, em um comando:
 *
 *   node scripts/configurar-pulse.mjs            # mostra o estado (não muda nada)
 *   node scripts/configurar-pulse.mjs --aplicar  # grava o segredo + config
 *
 * O QUE ELE FAZ
 * -------------
 *   1. Cadastra o SEGRED `PULSE_API_KEY` no projeto (Management API).
 *      A chave vem do `.env` da máquina — ela nunca é digitada no chat, nunca
 *      vai para o repositório e nunca aparece em log.
 *   2. Grava as configurações em `app_settings` (o mesmo lugar que o painel
 *      `/admin/settings` edita):
 *        - `pulse_webhook_url` → a URL que a Pulse chama;
 *        - `pulse_markup`     → a margem sobre o preço de venda ao consumidor.
 *   3. Mostra o estado: functions publicadas? segredo cadastrado? saldo?
 *
 * POR QUE UM SCRIPT E NÃO O PAINEL
 * --------------------------------
 * O segredo da API só pode ser gravado pela Management API do Supabase (com
 * um PAT do dono) — o navegador não escreve secret. As configurações do
 * painel (markup, URL do webhook) podem ser editadas em `/admin/settings`;
 * este script só oferece o caminho inicial e a conferência.
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

const API = "https://api.supabase.com/v1";
const REF = (process.env.VITE_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\./i)?.[1] || "lasoouwboxspstqvjbsv";
const FUNCOES = ["pulse-admin", "pulse-entrega", "pulse-webhook", "pulse-poll"];

const C = {
  ok: "\x1b[32m", fail: "\x1b[31m", warn: "\x1b[33m",
  dim: "\x1b[90m", bold: "\x1b[1m", fim: "\x1b[0m",
};

/** PAT do dono do projeto (Management API). */
function lerToken() {
  const doEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (doEnv) return doEnv;
  for (const nome of [".supabase_token", ".supabase_pat"]) {
    const p = path.join(ROOT, nome);
    if (fs.existsSync(p)) {
      const t = fs.readFileSync(p, "utf8").trim();
      if (t) return t;
    }
  }
  const daCli = path.join(process.env.USERPROFILE || "", ".supabase", "access-token");
  if (fs.existsSync(daCli)) {
    const t = fs.readFileSync(daCli, "utf8").trim();
    if (t) return t;
  }
  return null;
}

async function api(caminho, token, init = {}) {
  const r = await fetch(`${API}${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const texto = await r.text();
  let corpo = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${String(corpo).slice(0, 300)}`);
  }
  return corpo;
}

/** Roda SQL pela Management API (mesma porta que o scripts/supabase-sql.mjs). */
async function sql(query, token) {
  return await api(`/projects/${REF}/database/query`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

function linha(rotulo, valor, cor = "") {
  console.log(`  ${rotulo.padEnd(26)} ${cor}${valor}${C.fim}`);
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const token = lerToken();

  console.log(`\n${C.bold}INTEGRAÇÃO PULSE CODING${C.fim} ${C.dim}(projeto ${REF})${C.fim}\n`);

  if (!token) {
    console.error(`${C.fail}Falta o PAT do Supabase (Management API).${C.fim}`);
    console.error("Salve em `.supabase_token` (gitignored) ou exporte SUPABASE_ACCESS_TOKEN.\n");
    process.exit(1);
  }

  // ── 1. As functions estão no ar? ───────────────────────────────────────
  console.log(`${C.bold}Functions${C.fim}`);
  let lista = [];
  try {
    lista = await api(`/projects/${REF}/functions`, token);
  } catch (e) {
    console.error(`  ${C.fail}Não consegui listar: ${e.message}${C.fim}`);
  }
  for (const slug of FUNCOES) {
    const f = lista.find((x) => x.slug === slug);
    if (f) {
      linha(slug, `v${f.version} · verify_jwt=${f.verify_jwt} · ${f.status}`, C.ok);
    } else {
      linha(slug, "NÃO PUBLICADA", C.fail);
    }
  }

  // ── 2. O segredo está cadastrado? ──────────────────────────────────────
  console.log(`\n${C.bold}Segredos${C.fim}`);
  let temSegredo = false;
  try {
    const segredos = await api(`/projects/${REF}/secrets`, token);
    const listaSegredos = Array.isArray(segredos) ? segredos : segredos?.secrets || [];
    for (const s of listaSegredos) {
      const nome = s.name || s;
      if (nome === "PULSE_API_KEY") {
        temSegredo = true;
        linha("PULSE_API_KEY", "cadastrado", C.ok);
      }
    }
    if (!temSegredo) linha("PULSE_API_KEY", "NÃO CADASTRADO", C.warn);
  } catch (e) {
    linha("PULSE_API_KEY", `não consegui conferir (${e.message})`, C.warn);
  }

  // ── 3. As configurações ─────────────────────────────────────────────────
  console.log(`\n${C.bold}Configurações (app_settings)${C.fim}`);
  let atual = {};
  try {
    const r = await sql(
      "select key, value from app_settings where key in ('pulse_webhook_url','pulse_markup')",
      token,
    );
    for (const linha of r || []) atual[linha.key] = linha.value;
    linha("pulse_webhook_url", atual.pulse_webhook_url || "(não gravado)", atual.pulse_webhook_url ? C.ok : C.warn);
    linha("pulse_markup", atual.pulse_markup ?? "(não gravado — usa 20%)", atual.pulse_markup ? C.ok : C.warn);
  } catch (e) {
    linha("app_settings", `não consegui ler (${e.message})`, C.warn);
  }

  // ── 4. Saldo na revenda ─────────────────────────────────────────────────
  console.log(`\n${C.bold}Saldo na revenda${C.fim}`);
  const chave = (process.env.PULSE_API_KEY || "").trim();
  if (!chave) {
    linha("PULSE_API_KEY (local)", "ausente no .env — rode o script de teste", C.warn);
  } else {
    try {
      const r = await fetch("https://nepatnfgqlcvunmrpddr.supabase.co/functions/v1/reseller-api", {
        method: "POST",
        headers: { "x-api-key": chave, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_balance" }),
        signal: AbortSignal.timeout(30_000),
      });
      const corpo = await r.json();
      const disponivel = Number(corpo.available_for_orders ?? corpo.balance ?? 0);
      linha("disponível para pedidos", `R$ ${disponivel.toFixed(2)}`, disponivel > 0 ? C.ok : C.warn);
      if (disponivel <= 0) {
        console.log(`  ${C.warn}Sem saldo: nenhum pedido real sai até recarregar.${C.fim}`);
      }
    } catch (e) {
      linha("consulta de saldo", e.message, C.warn);
    }
  }

  // ── 5. Aplicar ─────────────────────────────────────────────────────────
  if (!aplicar) {
    console.log(`\n${C.dim}Nada foi alterado. Rode com --aplicar para gravar o segredo e as configurações.${C.fim}\n`);
    return;
  }

  console.log(`\n${C.bold}Aplicando...${C.fim}`);

  // 5.1. O segredo
  if (!chave) {
    console.error(`  ${C.fail}PULSE_API_KEY não está no .env — o segredo não pode ser gravado.${C.fim}`);
    process.exit(1);
  }
  if (temSegredo) {
    console.log(`  ${C.dim}PULSE_API_KEY já estava cadastrado (não sobrescrevi).${C.fim}`);
  } else {
    await api(`/projects/${REF}/secrets`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ name: "PULSE_API_KEY", value: chave }]),
    });
    console.log(`  ${C.ok}✓${C.fim} segredo PULSE_API_KEY cadastrado`);
  }

  // 5.2. As configurações
  const webhookUrl =
    atual.pulse_webhook_url ||
    `https://${REF}.supabase.co/functions/v1/pulse-webhook`;
  const markup = atual.pulse_markup ?? "20";

  await sql(
    `insert into app_settings (key, value) values
       ('pulse_webhook_url', ${literal(webhookUrl)}),
       ('pulse_markup', ${literal(markup)})
     on conflict (key) do update set value = excluded.value;`,
    token,
  );
  console.log(`  ${C.ok}✓${C.fim} app_settings gravado (pulse_webhook_url, pulse_markup=${markup})`);

  console.log(`\n${C.ok}${C.bold}Integração configurada.${C.fim}`);
  console.log(`${C.dim}Próximo passo: abra /admin/pulse e clique em "Simular sync" antes de sincronizar.${C.fim}\n`);
}

/** Escapa uma string para o SQL (aspas simples dobradas). */
function literal(valor) {
  return `'${String(valor).replace(/'/g, "''")}'`;
}

main().catch((e) => {
  console.error(`\n${C.fail}${e.message}${C.fim}\n`);
  process.exit(1);
});
