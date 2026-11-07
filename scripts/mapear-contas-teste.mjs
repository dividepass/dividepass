/**
 * Mapeia as contas de teste do DividePass (SÓ LEITURA).
 *
 * Usa a conta QA ÚNICA (scripts/lib/conta-qa.mjs) — não cria usuário novo,
 * para não poluir o banco de produção.
 *
 *   node scripts/mapear-contas-teste.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { QA_USER, getSessaoQa } from './lib/conta-qa.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

/** Prefixos das contas de teste (início da parte local do e-mail). */
const PREFIXOS = [
  'onb.', 'dp.teste.', 'dp.prod.', 'dp.voto.', 'regrinhas.',
  'qa.', 'sonda.orfao.', 'visual.check',
];

const localPart = (email) => String(email || '').split('@')[0].toLowerCase();
const casa = (email) => {
  const lp = localPart(email);
  if (lp === localPart(QA_USER.email)) return false; // a conta QA oficial é mantida
  return PREFIXOS.some((p) => lp.startsWith(p)) || String(email || '').toLowerCase().endsWith('@divteste.com');
};

const sessao = await getSessaoQa();

const cols = 'id,name,email,role,status,created_at';
const res = await fetch(`${sessao.url}/rest/v1/users?select=${cols}&limit=2000`, {
  headers: { apikey: sessao.anon, Authorization: `Bearer ${sessao.token}` },
});
if (!res.ok) throw new Error(`GET users -> HTTP ${res.status}`);
const users = await res.json();

const alvo = users.filter((u) => casa(u.email)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

console.log(`sessao: ${QA_USER.email}`);
console.log(`total em public.users: ${users.length}`);
console.log(`contas de teste: ${alvo.length}\n`);

for (const u of alvo) {
  console.log(`   ${u.email}   id=${u.id} criado=${String(u.created_at).slice(0, 19)}`);
}

fs.writeFileSync(
  path.join(ROOT, 'logs', 'contas-teste-alvo.json'),
  JSON.stringify({ gerado_em: new Date().toISOString(), prefixos: PREFIXOS, contas: alvo }, null, 2),
  'utf8'
);
console.log('\nlista salva em logs/contas-teste-alvo.json');
console.log('Para apagar: database/limpeza-contas-teste-2026-11-01.sql (SQL Editor) ou /admin/users no painel.');
