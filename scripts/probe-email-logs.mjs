/**
 * Tenta ler email_logs e platform_events (RLS pode liberar com colunas
 * explícitas, como aconteceu com `users`).
 *
 *   node scripts/probe-email-logs.mjs
 */
import { getSessaoQa } from './lib/conta-qa.mjs';

const s = await getSessaoQa();
const H = { apikey: s.anon, Authorization: `Bearer ${s.token}` };

async function get(tabela, query = '') {
  const res = await fetch(`${s.url}/rest/v1/${tabela}${query}`, { headers: H });
  const body = await res.text();
  return { status: res.status, body };
}

console.log('=== email_logs (colunas explícitas) ===');
for (const q of [
  '?select=id,user_id,event_type,status,error,created_at&limit=5',
  '?select=id,user_id,event_type,status,created_at&limit=5',
  '?select=id&limit=5',
]) {
  const r = await get('email_logs', q);
  console.log(q, '->', r.status, r.body.slice(0, 400));
  console.log('---');
}

console.log('\n=== platform_events (colunas explícitas) ===');
for (const q of [
  '?select=id,event_type,title,message,metadata,created_at,created_by&order=created_at.desc&limit=8',
  '?select=id,event_type,title&limit=8',
]) {
  const r = await get('platform_events', q);
  console.log(q, '->', r.status, r.body.slice(0, 1200));
  console.log('---');
}

console.log('\n=== pagamentos (payments) ===');
for (const q of [
  '?select=id,user_id,group_id,amount,payment_type,gateway,status,transaction_code,notes,created_at&order=created_at.desc&limit=8',
]) {
  const r = await get('payments', q);
  console.log(q, '->', r.status, r.body.slice(0, 1200));
}
