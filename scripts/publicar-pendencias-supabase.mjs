/**
 * Publica as pendências do projeto DividePass no Supabase de produção.
 *
 * POR QUE ISTE SCRIPT EXISTE
 * --------------------------
 * O SQL Editor e o editor de Edge Functions do painel do Supabase travam o
 * navegador deste ambiente (a página do dashboard não termina de carregar), e
 * a CLI do `supabase` deste ambiente está ligada na outra organização
 * (`byefit`) — o deploy dá 403. O que trava, na prática, é o acesso.
 *
 * Com UM token de acesso pessoal do Supabase (sbp_...), tudo o que pendente
 * sai por aqui:
 *   1. a RPC `increment_sponsor_metric` (SQL via Management API) — é o que
 *      faz a métrica de cliques/impressões do anúncio patrocinado contar;
 *   2. as edge functions que ainda NÃO estão no ar;
 *   3. o agendamento da reconciliação de pagamentos.
 *
 * ONDE COLOCAR O TOKEN
 * --------------------
 *   - `.env.local`  →  SUPABASE_ACCESS_TOKEN=sbp_...
 *   - ou o arquivo  →  .tmp-verify/sbp-dividepass.txt  (uma linha com sbp_...)
 *   - ou no ambiente → SUPABASE_ACCESS_TOKEN=sbp_... node scripts/...
 *
 * (`.env.local` e `.tmp-verify/` estão no .gitignore — o token não vai para o
 * repositório.)
 *
 * USO
 * ---
 *   node scripts/publicar-pendencias-supabase.mjs --status   # só diagnostica
 *   node scripts/publicar-pendencias-supabase.mjs             # faz tudo
 *   node scripts/publicar-pendencias-supabase.mjs --sql       # só o SQL
 *   node scripts/publicar-pendencias-supabase.mjs --functions  # só as functions
 *   node scripts/publicar-pendencias-supabase.mjs --cron       # só o agendamento
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* ----------------------------------------------------------------- config */

const SQL_PENDENTE = 'database/apply-pending-2026-11-01.sql';
const SQL_CRON = 'database/add-reconcile-cron.sql';

/**
 * Funções que precisam ir para o ar (verificado em 01/11/2026 por sonda:
 * 404 "Requested function was not found" = ausente).
 */
const FUNCOES = [
  'notify-service-watchers', // "Avise-me quando houver uma vaga" — sem ela ninguém é avisado
  'reconcile-payments', // "paguei e não fui add ao grupo"
  'provision-group-mailbox', // e-mail gerenciado do grupo
  'send-welcome-email', // e-mail de boas-vindas
  'delete-account', // versão corrigida (limpa platform_events antes do DELETE)
];

/* ---------------------------------------------------------------- helpers */

function lerEnv() {
  const env = {};
  for (const nome of ['.env.local', '.env']) {
    try {
      for (const linha of fs
        .readFileSync(path.join(ROOT, nome), 'utf8')
        .split(/\r?\n/)) {
        const m = linha.match(/^\s*([^#=]+)=(.*)$/);
        if (m) env[m[1].trim()] = m[2].trim();
      }
    } catch {
      /* arquivo ausente */
    }
  }
  return env;
}

/** Token: ambiente → .env.local/.env → .tmp-verify/sbp-dividepass.txt */
function acharToken(env) {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN.trim();

  const arquivo = path.join(ROOT, '.tmp-verify', 'sbp-dividepass.txt');
  try {
    const m = fs
      .readFileSync(arquivo, 'utf8')
      .match(/sbp_[A-Za-z0-9_-]{20,}/);
    if (m) return m[0];
  } catch {
    /* arquivo ausente */
  }
  return '';
}

const env = lerEnv();
const URL_BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY || '';
const REF = URL_BASE ? new URL(URL_BASE).hostname.split('.')[0] : '';

function linha(msg) {
  console.log(msg);
}

/** Roda um comando e devolve { code, out }. */
function rodarComando(cmd, args, extraEnv = {}) {
  // Uma única string no shell (em vez de args separados): o Node 24 avisa
  // (DEP0190) ao passar array com shell:true. Os argumentos aqui são fixos
  // (nome de função) ou o `ref`, validado por regex.
  const linha = [cmd, ...args].join(' ');
  return new Promise((resolve) => {
    const child = spawn(linha, {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      shell: true,
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', (e) => resolve({ code: 1, out: `erro ao rodar ${cmd}: ${e.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

/* ------------------------------------------------------------- diagnóstico */

/** RPC existe? (PGRST202 = não existe) */
async function rpcExiste() {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/increment_sponsor_metric`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ANON}`,
    },
    body: JSON.stringify({
      p_offer_id: '00000000-0000-0000-0000-000000000000',
      p_metric: 'impression',
    }),
  });
  const body = await res.text();
  return { existe: !/PGRST202/i.test(body), status: res.status, body };
}

/** A função existe no ar? (404 = ausente) */
async function funcaoExiste(nome) {
  let status = 0;
  let body = '';
  try {
    const res = await fetch(`${URL_BASE}/functions/v1/${nome}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON },
      body: '{}',
    });
    status = res.status;
    body = (await res.text()).replace(/\s+/g, ' ').slice(0, 120);
  } catch (e) {
    body = 'erro: ' + e.message;
  }
  return { existe: status !== 404 && !/not found/i.test(body), status, body };
}

async function diagnostico() {
  linha(`projeto: ${REF || '(sem VITE_SUPABASE_URL)'}`);
  linha('');

  const rpc = await rpcExiste();
  linha(`RPC increment_sponsor_metric : ${rpc.existe ? 'EXISTE' : 'AUSENTE'}  (HTTP ${rpc.status})`);

  for (const nome of FUNCOES) {
    const f = await funcaoExiste(nome);
    linha(
      `edge ${nome.padEnd(26)}: ${f.existe ? 'NO AR ' : 'AUSENTE'}  (HTTP ${f.status})`
    );
  }

  linha('');
  linha('Para resolver o que falta:');
  linha('  1. token: https://supabase.com/dashboard/account/tokens → Generate new token');
  linha('  2. salve em .env.local  →  SUPABASE_ACCESS_TOKEN=sbp_...');
  linha('  3. node scripts/publicar-pendencias-supabase.mjs');
}

/* ------------------------------------------------------------------ ações */

/** Aplica um arquivo .sql via Management API (POST /v1/projects/{ref}/database/query). */
async function aplicarSql(token, arquivoRel) {
  const arquivo = path.join(ROOT, arquivoRel);
  const sql = fs.readFileSync(arquivo, 'utf8');

  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const texto = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${texto.slice(0, 400)}`);
  }
  return texto.slice(0, 600);
}

/** Publica uma edge function com a CLI, usando o token só nesta chamada. */
async function publicarFuncao(token, nome) {
  const r = await rodarComando(
    'supabase',
    ['functions', 'deploy', nome, '--project-ref', REF],
    { SUPABASE_ACCESS_TOKEN: token }
  );
  return r;
}

/* ------------------------------------------------------------------- main */

const args = process.argv.slice(2);
const soStatus = args.includes('--status');
const querSql = args.includes('--sql');
const querFunctions = args.includes('--functions');
const querCron = args.includes('--cron');
const tudo = !querSql && !querFunctions && !querCron;

if (!REF || !/^[a-z]{20}$/.test(REF)) {
  linha('ERRO: VITE_SUPABASE_URL não encontrada ou inválida em .env / .env.local');
  process.exit(1);
}

if (soStatus) {
  await diagnostico();
  process.exit(0);
}

const token = acharToken(env);
if (!token) {
  linha('ERRO: token do Supabase não encontrado.');
  linha('');
  linha('Gere um token de acesso pessoal em:');
  linha('  https://supabase.com/dashboard/account/tokens → Generate new token');
  linha('');
  linha('E salve em .env.local (gitignored):');
  linha('  SUPABASE_ACCESS_TOKEN=sbp_...');
  linha('');
  await diagnostico();
  process.exit(1);
}

linha(`projeto: ${REF}  (token ${token.slice(0, 8)}...)`);
linha('');

/* 1. SQL ---------------------------------------------------------------- */
if (tudo || querSql) {
  linha('== SQL ==');
  try {
    const saida = await aplicarSql(token, SQL_PENDENTE);
    linha(`  OK  ${SQL_PENDENTE}`);
    if (saida.trim()) linha(`      ${saida.replace(/\s+/g, ' ').slice(0, 300)}`);
  } catch (e) {
    linha(`  ERRO ${SQL_PENDENTE}: ${e.message}`);
  }
  linha('');
}

/* 2. Cron ---------------------------------------------------------------- */
if (tudo || querCron) {
  linha('== AGENDAMENTO DA RECONCILIAÇÃO ==');
  try {
    const saida = await aplicarSql(token, SQL_CRON);
    linha(`  OK  ${SQL_CRON}`);
    if (saida.trim()) linha(`      ${saida.replace(/\s+/g, ' ').slice(0, 300)}`);
  } catch (e) {
    linha(`  ERRO ${SQL_CRON}: ${e.message}`);
  }
  linha('');
}

/* 3. Edge functions ----------------------------------------------------- */
if (tudo || querFunctions) {
  linha('== EDGE FUNCTIONS ==');
  for (const nome of FUNCOES) {
    const r = await publicarFuncao(token, nome);
    const ok = r.code === 0;
    linha(`  ${ok ? 'OK  ' : 'ERRO'} ${nome}`);
    if (!ok) {
      const ultimas = r.out
        .split('\n')
        .filter((l) => l.trim())
        .slice(-4)
        .join(' | ');
      linha(`      ${ultimas.slice(0, 300)}`);
    }
  }
  linha('');
}

/* 4. Confere ------------------------------------------------------------ */
linha('== CONFERÊNCIA FINAL ==');
await diagnostico();
