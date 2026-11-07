/**
 * Estado real dos vínculos de membro (RLS deixa ler group_members).
 * Foco: quem está com `status` fora de 'active' e como isso bate com a
 * assinatura (payment_status / subscription_deadline).
 *
 *   node scripts/verifica-membros-inativos.mjs
 */
import { getSessaoQa } from './lib/conta-qa.mjs';

const s = await getSessaoQa();
const H = { apikey: s.anon, Authorization: `Bearer ${s.token}` };

async function get(tabela, query = '') {
  const res = await fetch(`${s.url}/rest/v1/${tabela}${query}`, { headers: H });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const gm = await get(
  'group_members',
  '?select=id,group_id,user_id,status,payment_status,joined_at,left_at,subscription_deadline,entrance_paid_at,entrance_payment_id,gateway,gateway_payment_id,created_at,updated_at&order=joined_at.desc&limit=1000',
);

if (gm.status !== 200 || !Array.isArray(gm.body)) {
  console.log('HTTP', gm.status, JSON.stringify(gm.body).slice(0, 300));
  process.exit(1);
}

const membros = gm.body;
console.log(`Total de vínculos visíveis: ${membros.length}\n`);

const contagem = {};
for (const m of membros) {
  const k = `${m.status}/${m.payment_status}`;
  contagem[k] = (contagem[k] || 0) + 1;
}
console.log('status/payment_status:');
for (const [k, v] of Object.entries(contagem).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${k.padEnd(28)} ${v}`);
}

// Nomes e grupos
const ids = [...new Set(membros.map((m) => m.user_id))];
const nomes = new Map();
for (const id of ids) {
  const u = await get('users', `?select=id,email,name&id=eq.${id}`);
  const row = Array.isArray(u.body) ? u.body[0] : null;
  if (row) nomes.set(id, `${row.name} <${row.email}>`);
}
const grupos = new Map();
for (const gid of [...new Set(membros.map((m) => m.group_id))]) {
  const g = await get('groups', `?select=id,name&id=eq.${gid}`);
  const row = Array.isArray(g.body) ? g.body[0] : null;
  if (row) grupos.set(gid, row.name);
}

console.log('\n=== VÍNCULOS FORA DE "active" (o que o painel mostra como Cancelado) ===\n');
const fora = membros.filter((m) => m.status !== 'active');
for (const m of fora) {
  console.log(
    `${(nomes.get(m.user_id) || m.user_id).padEnd(42)} | ${String(grupos.get(m.group_id) || m.group_id).slice(0, 28).padEnd(28)} | ` +
    `status=${String(m.status).padEnd(10)} pag=${String(m.payment_status).padEnd(20)} ` +
    `prazo=${String(m.subscription_deadline).slice(0, 10).padEnd(10)} entrou=${String(m.joined_at).slice(0, 10)} ` +
    `saiu=${String(m.left_at).slice(0, 10)} upd=${String(m.updated_at).slice(0, 19)}`,
  );
}
console.log(`\nTotal fora de 'active': ${fora.length}`);

console.log('\n=== MEMBROS "active" SEM prazo de assinatura (podem não ter assinatura) ===\n');
const semPrazo = membros.filter((m) => m.status === 'active' && !m.subscription_deadline && m.payment_status === 'active');
for (const m of semPrazo.slice(0, 40)) {
  console.log(
    `${(nomes.get(m.user_id) || m.user_id).padEnd(42)} | ${String(grupos.get(m.group_id) || m.group_id).slice(0, 30).padEnd(30)} | pag=${m.payment_status} entrou=${String(m.joined_at).slice(0, 10)}`,
  );
}
console.log(`Total active sem prazo: ${semPrazo.length}`);
