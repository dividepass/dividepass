#!/usr/bin/env node
/**
 * cPanel (UAPI) na linha de comando — cria e confere as caixas de e-mail dos
 * grupos.
 *
 * A edge function `provision-group-mailbox` faz isso sozinha quando o dono
 * liga a opcao "e-mail gerenciado com IA". Este script existe para:
 *   - conferir se o token e o usuario do cPanel estao certos;
 *   - criar uma caixa na mao (quando a automacao ainda nao esta no ar);
 *   - criar uma caixa de teste antes de mexer em producao.
 *
 * COMO USAR
 *
 *   # configuracao (uma vez)
 *   $env:CPANEL_HOST   = 'cpanel.dividepass.com'
 *   $env:CPANEL_USER   = 'SEU_USUARIO'
 *   $env:CPANEL_DOMAIN = 'dividepass.com'
 *   $env:CPANEL_TOKEN  = 'SEU_TOKEN'
 *
 *   # o que existe
 *   node scripts/cpanel-email.mjs list-domains
 *   node scripts/cpanel-email.mjs list-pops
 *
 *   # criar uma caixa
 *   node scripts/cpanel-email.mjs create --email grupo-teste@dividepass.com
 *
 *   # remover uma caixa
 *   node scripts/cpanel-email.mjs delete --email grupo-teste@dividepass.com
 *
 * A configuracao tambem pode vir de um arquivo `.cpanel.json` na raiz do repo
 * (ele esta no .gitignore):
 *
 *   { "host": "...", "user": "...", "domain": "...", "token": "..." }
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* --------------------------------------------------------------- config */

function lerConfig() {
  const arquivo = path.join(ROOT, '.cpanel.json');
  let doArquivo = {};
  if (fs.existsSync(arquivo)) {
    try {
      doArquivo = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    } catch (e) {
      console.error(`ERRO: .cpanel.json invalido (${e.message})`);
      process.exit(1);
    }
  }

  const cfg = {
    host: process.env.CPANEL_HOST || doArquivo.host || 'cpanel.dividepass.com',
    user: process.env.CPANEL_USER || doArquivo.user || '',
    domain: process.env.CPANEL_DOMAIN || doArquivo.domain || 'dividepass.com',
    token: process.env.CPANEL_TOKEN || doArquivo.token || '',
    skipUpdateDb: process.env.CPANEL_SKIP_UPDATE_DB || doArquivo.skipUpdateDb || '1',
  };

  if (!cfg.user || !cfg.token) {
    console.error('ERRO: faltam CPANEL_USER e/ou CPANEL_TOKEN.');
    console.error('      Use variaveis de ambiente ou um .cpanel.json na raiz do repo.');
    process.exit(1);
  }
  return cfg;
}

/* ---------------------------------------------------------------- args */

function lerArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item.startsWith('--')) {
      const chave = item.slice(2);
      const proximo = argv[i + 1];
      if (proximo && !proximo.startsWith('--')) {
        args[chave] = proximo;
        i += 1;
      } else {
        args[chave] = true;
      }
    } else {
      args._.push(item);
    }
  }
  return args;
}

/* ------------------------------------------------------------- cPanel API */

async function cpanelCall(cfg, modulo, funcao, params = {}) {
  const url = `https://${cfg.host}:2083/json-api/${cfg.user}/${modulo}/${funcao}`;
  const body = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null)),
  ).toString();

  const resposta = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `cpanel ${cfg.user}:${cfg.token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const texto = await resposta.text();
  let bruto = null;
  try {
    bruto = JSON.parse(texto);
  } catch {
    bruto = null;
  }

  const result = bruto?.result ?? bruto?.data ?? bruto ?? {};
  const status = typeof result.status === 'number' ? result.status : (resposta.ok ? 1 : 0);
  const errors = result.errors ?? bruto?.errors ?? [];
  const messages = result.messages ?? bruto?.messages ?? [];

  return {
    ok: resposta.ok && status === 1,
    status,
    errors: Array.isArray(errors) ? errors : [String(errors)],
    messages: Array.isArray(messages) ? messages : [],
    data: result.data ?? bruto?.data ?? null,
    bruto: texto.slice(0, 600),
  };
}

/* -------------------------------------------------------------- comandos */

function senhaAleatoria(tamanho = 20) {
  const minus = 'abcdefghijkmnopqrstuvwxyz';
  const maius = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const nums = '23456789';
  const simb = '!@#%_-';
  const todos = minus + maius + nums + simb;
  const bytes = new Uint8Array(tamanho);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => todos[b % todos.length]).join('');
}

async function main() {
  const args = lerArgs(process.argv.slice(2));
  const comando = args._[0];
  const cfg = lerConfig();

  console.log(`cPanel: ${cfg.host} | usuario: ${cfg.user} | dominio: ${cfg.domain}\n`);

  if (!comando || comando === 'ajuda' || args.help) {
    console.log(`Uso:
  node scripts/cpanel-email.mjs list-domains
  node scripts/cpanel-email.mjs list-pops
  node scripts/cpanel-email.mjs create --email grupo-teste@dividepass.com [--senha xxx] [--sem-update-db 0|1]
  node scripts/cpanel-email.mjs delete --email grupo-teste@dividepass.com`);
    return;
  }

  if (comando === 'list-domains') {
    const r = await cpanelCall(cfg, 'Email', 'list_pops');
    // A UAPI nao tem "list domains" em todos os cPanel; Email::list_pops ja
    // mostra as contas e, com elas, os dominios usados.
    if (!r.ok) {
      console.error('FALHOU:', r.errors.join(' | ') || r.bruto);
      process.exitCode = 1;
      return;
    }
    const dominios = new Set(
      (r.data || []).map((c) => String(c.domain || '').toLowerCase()).filter(Boolean),
    );
    console.log('Dominios com caixa de e-mail:', [...dominios].join(', ') || '(nenhum)');
    return;
  }

  if (comando === 'list-pops') {
    const r = await cpanelCall(cfg, 'Email', 'list_pops');
    if (!r.ok) {
      console.error('FALHOU:', r.errors.join(' | ') || r.bruto);
      process.exitCode = 1;
      return;
    }
    const contas = r.data || [];
    console.log(`Caixas existentes (${contas.length}):`);
    contas.forEach((c) => {
      console.log(`  ${c.email} | dominio: ${c.domain || '-'} | usuario: ${c.user || '-'}`);
    });
    return;
  }

  if (comando === 'create') {
    const email = args.email;
    if (!email) {
      console.error('ERRO: informe --email (ex.: grupo-teste@dividepass.com)');
      process.exitCode = 1;
      return;
    }
    const senha = args.senha || senhaAleatoria();
    const domain = args.domain || email.split('@')[1] || cfg.domain;
    const skip = args['sem-update-db'] ?? cfg.skipUpdateDb;

    const r = await cpanelCall(cfg, 'Email', 'add_pop', {
      email,
      password: senha,
      quota: '0',
      domain,
      skip_update_db: String(skip),
    });

    if (!r.ok) {
      console.error('FALHOU:', r.errors.join(' | ') || r.bruto);
      process.exitCode = 1;
      return;
    }

    console.log(`OK: ${email} criado.`);
    console.log(`Senha: ${senha}`);
    console.log('Guarde a senha no grupo_mailboxes (email_imap_password) e no secret CPANEL_TOKEN do servidor.');
    return;
  }

  if (comando === 'delete') {
    const email = args.email;
    if (!email) {
      console.error('ERRO: informe --email');
      process.exitCode = 1;
      return;
    }
    const r = await cpanelCall(cfg, 'Email', 'delete_pop', { email, domain: email.split('@')[1] });
    if (!r.ok) {
      console.error('FALHOU:', r.errors.join(' | ') || r.bruto);
      process.exitCode = 1;
      return;
    }
    console.log(`OK: ${email} removido.`);
    return;
  }

  console.error(`Comando desconhecido: ${comando}`);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error('ERRO:', e?.message || e);
  process.exit(1);
});
