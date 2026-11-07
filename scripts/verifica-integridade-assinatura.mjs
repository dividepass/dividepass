/**
 * Confere a integridade referencial que o caminho de confirmação depende:
 * user_subscriptions.service_id -> streaming_services(id)
 * group_members -> users/groups
 *
 *   node scripts/verifica-integridade-assinatura.mjs
 */
import { getSessaoQa } from './lib/conta-qa.mjs';

const s = await getSessaoQa();
const H = { apikey: s.anon, Authorization: `Bearer ${s.token}` };

async function get(tabela, query = '') {
  const res = await fetch(`${s.url}/rest/v1/${tabela}${query}`, { headers: H });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const alvos = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
];

console.log('=== streaming_services (amostra) ===');
const ss = await get('streaming_services', '?select=id,name,status&limit=50');
if (ss.status === 200 && Array.isArray(ss.body)) {
  console.log(`HTTP 200, ${ss.body.length} linhas visíveis:`);
  for (const x of ss.body) console.log('  ', x.id, '|', x.name, '|', x.status);
} else {
  console.log('HTTP', ss.status, JSON.stringify(ss.body).slice(0, 300));
}

console.log('\n=== os service_id usados pelos grupos existem? ===');
for (const id of alvos) {
  const r = await get('streaming_services', `?select=id,name&id=eq.${id}`);
  const existe = Array.isArray(r.body) && r.body.length > 0;
  console.log(`${id} -> ${existe ? 'EXISTE (' + r.body[0].name + ')' : '*** NAO EXISTE ***'} (HTTP ${r.status})`);
}

console.log('\n=== service_id distintos usados pelos grupos visíveis ===');
const g = await get('groups', '?select=id,name,service_id&limit=300');
const counts = new Map();
for (const x of (g.body || [])) counts.set(x.service_id, (counts.get(x.service_id) || 0) + 1);
for (const [sid, n] of counts) {
  const r = await get('streaming_services', `?select=id,name&id=eq.${sid}`);
  const existe = Array.isArray(r.body) && r.body.length > 0;
  console.log(`${sid} (${n} grupos) -> ${existe ? 'EXISTE (' + r.body[0].name + ')' : '*** NAO EXISTE ***'}`);
}
