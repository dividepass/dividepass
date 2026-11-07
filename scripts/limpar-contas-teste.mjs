/**
 * Apaga as contas de teste do DividePass.
 *
 * ATENÇÃO (01/11/2026): as contas do pedido estão ÓRFÃS — o `auth.users` já
 * foi apagado, então o login falha ("Invalid login credentials") e o
 * self-delete por edge NÃO remove o perfil. A remoção de verdade é pelo
 * SQL Editor do Supabase (ver database/limpeza-contas-teste-2026-11-01.sql)
 * ou pelo painel /admin/users (seleção em lote).
 *
 * Este script é o INVENTÁRIO: mostra o que ainda existe e o que é lixo,
 * usando a conta QA ÚNICA (não cria usuário novo a cada rodada).
 *
 *   node scripts/limpar-contas-teste.mjs
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
  if (lp === localPart(QA_USER.email)) return false;
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
console.log(`contas de teste restantes: ${alvo.length}\n`);
for (const u of alvo) console.log(`   ${u.email}   id=${u.id} criado=${String(u.created_at).slice(0, 19)}`);

if (alvo.length > 0) {
  console.log('\nPara apagar tudo de uma vez:');
  console.log('  1) rode database/limpeza-contas-teste-2026-11-01.sql no SQL Editor do Supabase;');
  console.log('  2) ou use /admin/users no painel, marque as linhas e clique em "Excluir selecionados".');
}

fs.writeFileSync(
  path.join(ROOT, 'logs', 'contas-teste-alvo.json'),
  JSON.stringify({ gerado_em: new Date().toISOString(), prefixos: PREFIXOS, contas: alvo }, null, 2),
  'utf8'
);
console.log('\nlista salva em logs/contas-teste-alvo.json');
