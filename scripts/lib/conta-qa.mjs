/**
 * Conta ÚNICA de QA (sondagem).
 *
 * Objetivo: não criar mais um usuário a cada teste — o banco de produção
 * fica poluído e as métricas "pessoa real x IA" ficam impossíveis de ler.
 *
 * A SENHA NÃO fica neste arquivo (o repositório é público). Ela vem do
 * `.env` local (ignorado pelo git) ou da variável de ambiente:
 *
 *   QA_EMAIL=qa.mavis@divteste.com
 *   QA_PASSWORD=...
 *
 * Regras:
 *  - Este é o ÚNICO usuário de teste que deve existir em produção.
 *  - Qualquer script de sondagem usa `getSessaoQa()` (faixa login).
 *  - Se a conta for apagada, rode `node scripts/criar-conta-qa.mjs` de novo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export function lerEnv() {
  const env = {};
  for (const nome of ['.env.local', '.env']) {
    try {
      const conteudo = fs.readFileSync(path.join(ROOT, nome), 'utf8');
      for (const linha of conteudo.split(/\r?\n/)) {
        const m = linha.match(/^\s*([^#=]+)=(.*)$/);
        if (m) env[m[1].trim()] = m[2].trim();
      }
    } catch {
      /* arquivo ausente */
    }
  }
  return env;
}

/**
 * A senha da conta QA vem do ambiente. Nunca é gravada no repositório —
 * quem lê o repo não pode logar como admin de produção.
 */
function senhaQa() {
  const env = lerEnv();
  const senha = process.env.QA_PASSWORD || env.QA_PASSWORD || '';
  if (!senha) {
    throw new Error(
      'Falta a senha da conta QA. Defina QA_PASSWORD no .env local ' +
        '(veja .env.example) ou na variavel de ambiente.'
    );
  }
  return senha;
}

export const QA_USER = {
  email: process.env.QA_EMAIL || 'qa.mavis@divteste.com',
  nome: 'QA Mavis',
  get password() {
    return senhaQa();
  },
};

/** Sessão da conta QA (cria a conta se ainda não existir). */
export async function getSessaoQa() {
  const env = lerEnv();
  const URL_BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const ANON = env.VITE_SUPABASE_ANON_KEY || '';
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };

  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: QA_USER.email, password: QA_USER.password }),
  });
  const data = await login.json().catch(() => ({}));
  if (data?.access_token) {
    return { token: data.access_token, url: URL_BASE, anon: ANON, env };
  }

  const signup = await fetch(`${URL_BASE}/auth/v1/signup`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: QA_USER.email,
      password: QA_USER.password,
      email_confirm: true,
      data: { name: QA_USER.nome },
    }),
  });
  const s = await signup.json().catch(() => ({}));
  if (s?.access_token) {
    return { token: s.access_token, url: URL_BASE, anon: ANON, env };
  }

  throw new Error(`Nao foi possivel obter a sessao da conta QA: ${s?.msg || s?.error_description || login.status}`);
}

/** GET no PostgREST com o token da conta QA. */
export async function qaGet(tabela, query = '') {
  const sessao = await getSessaoQa();
  const res = await fetch(`${sessao.url}/rest/v1/${tabela}${query}`, {
    headers: { apikey: sessao.anon, Authorization: `Bearer ${sessao.token}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GET ${tabela} -> HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}
