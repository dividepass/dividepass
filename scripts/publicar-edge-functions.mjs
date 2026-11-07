/**
 * Publica as EDGE FUNCTIONS que ainda não estão no ar do DividePass.
 *
 * POR QUE ISTE SCRIPT EXISTE
 * --------------------------
 * Edge function não se publica por SQL — só pelo deploy da CLI ou pelo
 * editor do painel do Supabase. O painel travou o navegador do agente, e a
 * CLI deste ambiente está linked na outra organização (`byefit`), então o
 * deploy daqui dá 403.
 *
 * Este script usa o **login da SUA máquina** (você roda `npx supabase login`
 * uma vez, no navegador). Ele sobe as 5 funções pendentes e confere no final
 * se cada uma respondeu.
 *
 * COMO USA
 * --------
 *   npx supabase login
 *   node scripts/publicar-edge-functions.mjs
 *
 * As funções:
 *   - notify-service-watchers  → o "Avise-me quando houver uma vaga" (quem
 *     está na lista de espera passa a ser avisado quando a vaga abre);
 *   - reconcile-payments       → a rede de segurança do "paguei e não fui
 *     add ao grupo" (pergunta o status real à IO Pay e libera);
 *   - provision-group-mailbox  → e-mail gerenciado do grupo;
 *   - send-welcome-email       → e-mail de boas-vindas;
 *   - delete-account           → a versão corrigida (limpa platform_events
 *     antes do DELETE, senão o perfil fica órfão no banco).
 *
 * O `verify_jwt` de cada uma vem do `supabase/config.toml` — importante para
 * as de cron (rodam com `verify_jwt = false` porque o cron manda um segredo,
 * que não é JWT).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const FUNCOES = [
  'notify-service-watchers',
  'reconcile-payments',
  'provision-group-mailbox',
  'send-welcome-email',
  'delete-account',
  // Integração Woovi (Pix Automático).
  'woovi-webhook',
  'check-woovi-tx',
  'create-payment',
  'confirm-payment',
  'process-recurring-billing',
];

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
      /* ausente */
    }
  }
  return env;
}

function rodar(cmd, args) {
  // Uma única string no shell (em vez de args separados): o Node 24 avisa
  // (DEP0190) ao passar array com shell:true. Os argumentos aqui são fixos
  // (nomes de função) ou o `ref`, que é validado como regex antes de entrar.
  const linha = [cmd, ...args].join(' ');
  return new Promise((resolve) => {
    const child = spawn(linha, {
      cwd: ROOT,
      env: process.env,
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

const env = lerEnv();
const URL_BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY || '';
const REF = URL_BASE ? new URL(URL_BASE).hostname.split('.')[0] : '';

if (!REF || !/^[a-z]{20}$/.test(REF)) {
  console.error('ERRO: VITE_SUPABASE_URL nao encontrada ou invalida em .env / .env.local');
  process.exit(1);
}

console.log(`projeto: ${REF}\n`);

/* 0. o login da CLI alcança este projeto? */

/*
 * Login por Personal Access Token (PAT).
 *
 * O `npx supabase login` abre o navegador e pede confirmação — impossible
 * num agente. Se existir um PAT no ambiente, o login é feito em modo
 * headless. Para criar um:
 *   https://supabase.com/dashboard/account/tokens  (nome "dividepass-deploy")
 *   e exportar:  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
 */
if (process.env.SUPABASE_ACCESS_TOKEN) {
  const login = await rodar('supabase', [
    'login',
    '--token',
    process.env.SUPABASE_ACCESS_TOKEN,
  ]);
  if (login.code === 0) {
    console.log('login por Personal Access Token: OK\n');
  } else {
    console.log('login por PAT falhou:\n' + login.out.split('\n').slice(-4).join('\n'));
  }
}

const projetos = await rodar('supabase', ['projects', 'list']);
const alcança = projetos.out.includes(REF);
if (!alcança) {
  console.log('A CLI nao esta logada nesta conta (ou a conta nao ve este projeto).');
  console.log('Rode primeiro:  npx supabase login');
  console.log('\n(precisa ser a conta que tem o projeto DividePass)');
  process.exit(1);
}
console.log('login da CLI alcança o projeto.\n');

/* 1. deploy */
for (const nome of FUNCOES) {
  process.stdout.write(`publicando ${nome}... `);
  const r = await rodar('supabase', [
    'functions',
    'deploy',
    nome,
    '--project-ref',
    REF,
  ]);
  if (r.code === 0) {
    console.log('OK');
  } else {
    console.log('ERRO');
    console.log(
      r.out
        .split('\n')
        .filter((l) => l.trim())
        .slice(-6)
        .map((l) => `      ${l}`)
        .join('\n')
    );
  }
}

/* 2. conferência: 404 = ainda ausente */
console.log('\nconferindo no ar:');
for (const nome of FUNCOES) {
  let status = 0;
  let body = '';
  try {
    const res = await fetch(`${URL_BASE}/functions/v1/${nome}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON },
      body: '{}',
    });
    status = res.status;
    body = (await res.text()).replace(/\s+/g, ' ').slice(0, 90);
  } catch (e) {
    body = 'erro: ' + e.message;
  }
  const noAr = status !== 404 && !/not found/i.test(body);
  console.log(
    `  ${noAr ? 'NO AR ' : 'AUSENTE'}  ${nome.padEnd(26)} HTTP ${status}  ${body}`
  );
}
console.log('\n404 = ainda nao publicada. 401 = no ar, mas exige sessao (normal).');
