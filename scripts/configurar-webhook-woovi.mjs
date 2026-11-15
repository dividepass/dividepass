/**
 * Cadastra (ou lista) o WEBHOOK da Woovi para o DividePass.
 *
 * POR QUE UM SCRIPT
 * -----------------
 * O Pix Automático só se renova sozinho se a Woovi avisar quando a cobrança
 * do ciclo foi paga. Esse aviso chega por webhook. Sem o webhook cadastrado,
 * a assinatura é criada mas a renovação nunca é confirmada (o polling do
 * navegador ainda salva o PRIMEIRO pagamento, mas só enquanto a aba estiver
 * aberta).
 *
 * COMO USA
 * --------
 *   1. Garanta que a edge function `woovi-webhook` está no ar.
 *   2. Rode:
 *        node scripts/configurar-webhook-woovi.mjs            # lista os webhooks
 *        node scripts/configurar-webhook-woovi.mjs --criar     # cadastra o nosso
 *
 * O AppID é lido do AppID do AMBIENTE em `app_settings`
 * (`woovi_app_id_production` em produção; `woovi_app_id_sandbox` no sandbox) —
 * a mesma regra que a edge function usa (`_shared/woovi.ts`).
 *
 * A SCRIPT É IDEMPOTENTE POR EVENTO: ele cadastra só o que falta, então
 * rodar de novo não cria duplicata e não precisa apagar nada no painel.
 *
 * AUTENTICAÇÃO
 * ------------
 * A Woovi usa o AppID no header `Authorization`, CRU — sem o prefixo
 * "Bearer". (developers.woovi.com/docs/apis/api-getting-started)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizarAmbiente, getAmbiente } from "../supabase/functions/_shared/ambiente.ts";
// A MESMA regra de escolha do AppID que a edge function usa
// (`_shared/woovi.ts` -> `appIdDoAmbiente`). Importar de lá, em vez de
// reescrever a regra aqui, é o que impede o script de falar com a conta
// errada.
import { appIdDoAmbiente } from "../supabase/functions/_shared/woovi.ts";
import { consultarSql } from "./supabase-sql.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const nome of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(ROOT, nome));
  } catch {
    // sem .env — ok, usa só o que vier do ambiente
  }
}

const API_PROD = "https://api.woovi.com";
const API_SANDBOX = "https://api.woovi-sandbox.com";

/**
 * Eventos que o DividePass trata.
 *
 * - CHARGE_*: a cobrança avulsa (taxa de adesão, fatura, ou a parte "paga
 *   agora" do fluxo combinado).
 * - PIX_AUTOMATIC_APPROVED/REJECTED: o pagador autorizou (ou recusou) o
 *   mandato.
 * - PIX_AUTOMATIC_COBR_*: o ciclo da recorrência (gerada, aprovada, paga,
 *   recusada).
 */
const EVENTOS = [
  "OPENPIX:CHARGE_COMPLETED",
  "OPENPIX:CHARGE_EXPIRED",
  "PIX_AUTOMATIC_APPROVED",
  "PIX_AUTOMATIC_REJECTED",
  "PIX_AUTOMATIC_COBR_CREATED",
  "PIX_AUTOMATIC_COBR_APPROVED",
  "PIX_AUTOMATIC_COBR_COMPLETED",
  "PIX_AUTOMATIC_COBR_REJECTED",
  "PIX_AUTOMATIC_COBR_TRY_REJECTED",
];

/**
 * Lê os AppIDs do banco.
 *
 * POR QUE TODOS E NÃO SÓ UM
 * -------------------------
 * A Woovi tem DUAS contas (sandbox e produção) e cada uma tem o seu AppID.
 * Este script lia SEMPRE `woovi_app_id` — que, no banco atual, é o AppID do
 * SANDBOX. Resultado: em 10/11/2026 os 9 webhooks foram cadastrados na conta
 * de TESTE, e a conta de PRODUÇÃO ficou com UM webhook só (criado à mão no
 * painel). Como o evento que confirma o pagamento do ciclo
 * (`PIX_AUTOMATIC_COBR_COMPLETED`) nunca chegou, o cliente pagou e o
 * sistema não confirmou.
 *
 * Agora o AppID é escolhido pelo AMBIENTE, com a mesma regra do app.
 */
async function lerAppIdDoBanco(ambiente) {
  const chaves = ["woovi_app_id_production", "woovi_app_id_sandbox", "woovi_app_id"];
  // As chaves entram entre aspas: `key in (a,b,c)` sem aspas é SQL inválido.
  const listaSql = chaves.map((k) => `'${k}'`).join(",");

  const url = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";
  if (url && key) {
    const resp = await fetch(`${url}/rest/v1/app_settings?key=in.(${chaves.join(",")})&select=key,value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (resp.ok) {
      const dados = await resp.json();
      const mapa = {};
      for (const linha of dados || []) mapa[linha.key] = linha.value;
      const escolhido = appIdDoAmbiente(mapa, ambiente);
      if (escolhido) return escolhido;
    }
  }

  // Sem `service_role`: usa a Management API com o token da CLI do Supabase
  // (o mesmo que o `npx supabase login` grava). Assim o AppID — que fica
  // FORA do git — pode ser lido sem pedir nada ao usuario.
  try {
    const linhas = await consultarSql(
      `select key, value from app_settings where key in (${listaSql})`,
    );
    const mapa = {};
    for (const linha of linhas || []) mapa[linha.key] = linha.value;
    const escolhido = appIdDoAmbiente(mapa, ambiente);
    if (escolhido) return escolhido;
  } catch {
    /* sem token da CLI — tenta o proximo caminho */
  }

  return null;
}

/**
 * Descobre o ambiente de operação.
 *
 * A MESMA regra do app (ver `supabase/functions/_shared/ambiente.ts`):
 *
 *   1. `--ambiente=...` na linha de comando (força);
 *   2. variável de ambiente `AMBIENTE`;
 *   3. `app_settings.ambiente` (o toggle do Admin);
 *   4. produção.
 *
 * Importa a função de `ambiente.ts` de propósito: se o app trocar a regra,
 * este script troca junto — não fica uma cópia defasada deciding para onde o
 * webhook aponta.
 */
async function resolverAmbiente() {
  const flag = process.argv.find((a) => a.startsWith("--ambiente="));
  if (flag) return normalizarAmbiente(flag.split("=")[1]);

  if (process.env.AMBIENTE) return normalizarAmbiente(process.env.AMBIENTE);

  const url = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";
  if (url && key) {
    try {
      const resp = await fetch(`${url}/rest/v1/app_settings?key=eq.ambiente&select=value`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (resp.ok) {
        const dados = await resp.json();
        if (dados?.[0]?.value) return getAmbiente({ ambiente: dados[0].value });
      }
    } catch {
      /* sem permissao — tenta a Management API */
    }
  }

  // Mesmo truque do AppID: o toggle do Admin lido pela Management API.
  try {
    const linhas = await consultarSql(
      "select value from app_settings where key = 'ambiente' limit 1",
    );
    if (linhas?.[0]?.value) return getAmbiente({ ambiente: linhas[0].value });
  } catch {
    /* sem token da CLI — segue o padrao */
  }

  return normalizarAmbiente(null);
}

async function lerAppId(ambiente) {
  if (process.env.WOOVI_APP_ID) return process.env.WOOVI_APP_ID.trim();
  const doBanco = await lerAppIdDoBanco(ambiente);
  if (doBanco) return doBanco.trim();
  return null;
}

async function woovi(appId, baseUrl, method, caminho, body) {
  const resp = await fetch(`${baseUrl}${caminho}`, {
    method,
    headers: {
      // AppID CRU — sem "Bearer".
      Authorization: appId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await resp.text();
  let dados = null;
  try {
    dados = JSON.parse(texto);
  } catch {
    dados = { raw: texto };
  }
  return { ok: resp.ok, status: resp.status, dados };
}

async function main() {
  // O ambiente vem PRIMEIRO: é ele que decide de qual conta lemos o AppID.
  const ambiente = await resolverAmbiente();
  const baseUrl = ambiente === "sandbox" ? API_SANDBOX : API_PROD;

  const appId = await lerAppId(ambiente);
  if (!appId) {
    console.error(
      "\nNao encontrei o AppID da Woovi para o ambiente " +
        ambiente +
        ".\n" +
        "  Opcao 1: cadastre em Admin > Configuracoes > Woovi > AppID do ambiente.\n" +
        "  Opcao 2: exporta WOOVI_APP_ID=... antes de rodar este script.\n",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`AppID:    ${appId.slice(0, 6)}...${appId.slice(-4)}`);
  console.log(`Ambiente: ${ambiente} (${baseUrl})`);
  if (ambiente === "sandbox") {
    console.log("           >>> ambiente de TESTE: os webhooks apontam para a Woovi de sandbox");
  }

  const listar = await woovi(appId, baseUrl, "GET", "/api/v1/webhook");
  if (!listar.ok) {
    console.error("\nA Woovi recusou a chamada:", JSON.stringify(listar.dados).slice(0, 400));
    process.exitCode = 1;
    return;
  }

  const existentes = listar.dados?.webhooks || listar.dados?.data?.webhooks || [];
  console.log(`\nWebhooks cadastrados: ${existentes.length}`);
  for (const w of existentes) {
    console.log(`  - [${w.event}] ${w.name || ""} -> ${w.url}`);
  }

  const urlBase = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  if (!urlBase) {
    console.error("\nFalta VITE_SUPABASE_URL para saber o endereco do webhook.");
    process.exitCode = 1;
    return;
  }
  const urlWebhook = `${urlBase}/functions/v1/woovi-webhook`;

  // ── O QUE FALTA ──────────────────────────────────────────────────────────
  // Compara por EVENTO (e não por URL): em 10/11/2026 a conta de producao
  // tinha UM webhook nosso (PIX_AUTOMATIC_APPROVED) e o script dizia "ja
  // existe, nada a fazer" — e os outros 8 eventos ficavam de fora. O evento
  // que CONFIRMA o pagamento do ciclo e' justamente um deles.
  const jaTem = new Set(
    existentes
      .filter((w) => String(w.url || "").startsWith(urlWebhook))
      .map((w) => String(w.event || "").trim()),
  );
  const faltando = EVENTOS.filter((e) => !jaTem.has(e));

  console.log(`\nEventos que ja apontam para ${urlWebhook}: ${jaTem.size}`);
  console.log(`Eventos que faltam: ${faltando.length}`);
  if (faltando.length) {
    for (const e of faltando) console.log(`  - ${e}`);
  }

  if (faltando.length === 0) {
    console.log("\nTodos os eventos ja estao cadastrados. Nada a fazer.");
    return;
  }

  if (!process.argv.includes("--criar")) {
    console.log(`\nPara cadastrar, rode com --criar:`);
    console.log(`  node scripts/configurar-webhook-woovi.mjs --criar`);
    console.log(`\nEle criara ${faltando.length} webhook(s) em ${urlWebhook}.`);
    return;
  }

  console.log(`\nCriando ${faltando.length} webhooks em ${urlWebhook} ...`);
  let criados = 0;
  let falhos = 0;

  for (const evento of faltando) {
    const res = await woovi(appId, baseUrl, "POST", "/api/v1/webhook", {
      webhook: {
        name: `DividePass - ${evento}`,
        event: evento,
        url: urlWebhook,
        isActive: true,
      },
    });
    if (res.ok) {
      criados++;
      console.log(`  OK   ${evento}`);
    } else {
      falhos++;
      console.log(`  ERRO ${evento}: ${JSON.stringify(res.dados).slice(0, 200)}`);
    }
  }

  console.log(`\nCriados: ${criados} | Falhos: ${falhos}`);
  if (falhos > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
