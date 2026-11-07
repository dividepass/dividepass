/**
 * Membros do grupo "Netflix C/ Anuncio" (8a4e94ca) — comparar quem entrou
 * automaticamente (via gateway) vs. manualmente, e ver o formato dos dados.
 *
 *   node scripts/verifica-membros-grupo.mjs
 */
import { getSessaoQa } from './lib/conta-qa.mjs';

const s = await getSessaoQa();
const H = { apikey: s.anon, Authorization: `Bearer ${s.token}` };
const GRUPO = '8a4e94ca-0750-43bb-853a-bc2c6940ee66';

async function get(tabela, query = '') {
  const res = await fetch(`${s.url}/rest/v1/${tabela}${query}`, { headers: H });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const gm = await get(
  'group_members',
  `?select=id,user_id,profile_name,status,payment_status,joined_at,left_at,gateway,gateway_payment_id,subscription_deadline,entrance_paid_at,entrance_payment_id,subscription_mp_id,created_at,updated_at&group_id=eq.${GRUPO}&order=joined_at.desc`
);
console.log('MEMBROS do grupo:', gm.status, '\n');
for (const m of gm.body || []) {
  console.log(
    `user=${m.user_id.slice(0, 8)} status=${String(m.status).padEnd(10)} pag=${String(m.payment_status).padEnd(20)} ` +
    `entrou=${String(m.joined_at).slice(0, 19)} gateway=${String(m.gateway).padEnd(8)} ` +
    `tx=${String(m.gateway_payment_id || m.entrance_payment_id || '-').slice(0, 28)} ` +
    `prazo=${String(m.subscription_deadline).slice(0, 10)} updated=${String(m.updated_at).slice(0, 19)}`
  );
}

// Nomes dos membros
const ids = [...new Set((gm.body || []).map((m) => m.user_id))];
const nomes = {};
for (const id of ids) {
  const u = await get('users', `?select=id,email,name&id=eq.${id}`);
  const row = Array.isArray(u.body) ? u.body[0] : null;
  if (row) nomes[id] = `${row.name} <${row.email}>`;
}
console.log('\nNOMES:');
for (const id of ids) console.log(' ', id.slice(0, 8), nomes[id] || '(ilegivel)');

// Assinaturas: tenta ler pelo par (user_id, group_id)
console.log('\nASSINATURAS dos membros (tentativa por user_id):');
for (const id of ids) {
  const us = await get('user_subscriptions', `?select=id,user_id,group_id,status,billing_cycle,renewal_due_at,next_charge_at,gateway,gateway_subscription_id,gateway_status,created_at,updated_at&user_id=eq.${id}`);
  const linhas = Array.isArray(us.body) ? us.body : [];
  console.log(` ${id.slice(0, 8)} -> HTTP ${us.status} ${linhas.length} linha(s)`);
  for (const l of linhas) console.log('    ', JSON.stringify(l));
}
