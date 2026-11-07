/**
 * Dois testes decisivos na API de produção:
 *
 *  T1 — `.limit(1).maybeSingle()` realmente aborta quando a consulta casa mais
 *       de uma linha? (PostgREST pode aplicar maybeSingle ANTES do limit.)
 *       Se abortar, as functions que ainda usam maybeSingle em
 *       user_subscriptions (check-iopay-tx, force-confirm-payment) quebram
 *       para quem tem mais de uma assinatura no mesmo grupo.
 *
 *  T2 — `user_subscriptions` tem UNIQUE(user_id, group_id) em produção?
 *       Testa inserindo DUAS linhas do MESMO par na conta QA.
 *
 *   node scripts/testa-maybe-single-e-unique.mjs
 */
import { getSessaoQa } from './lib/conta-qa.mjs';

const s = await getSessaoQa();
const H = { apikey: s.anon, Authorization: `Bearer ${s.token}` };
const OBJ = { ...H, Accept: 'application/vnd.pgrst.object+json' }; // o que maybeSingle usa

console.log('=== T1: limit(1) + maybeSingle ===\n');

async function t(nome, url, headers) {
  const r = await fetch(url, { headers });
  const b = await r.text();
  console.log(`${nome}\n   HTTP ${r.status} -> ${b.slice(0, 220)}\n`);
  return { status: r.status, body: b };
}

// users.role = 'user' casa com varias linhas de verdade
const base = `${s.url}/rest/v1/users?select=id,email&role=eq.user`;
await t('users role=user  SEM limit (maybeSingle)', base, OBJ);
await t('users role=user  COM limit=1 (maybeSingle)', `${base}&limit=1`, OBJ);
await t('users role=user  COM limit=1 (sem maybeSingle)', `${base}&limit=1`, H);

console.log('=== T2: UNIQUE(user_id, group_id) em user_subscriptions ===\n');

const eu = await fetch(`${s.url}/rest/v1/users?select=id&limit=1`, { headers: H });
const euBody = await eu.json().catch(() => []);
const meuId = euBody?.[0]?.id;
console.log('QA user id:', meuId);

const grupo = '3aef8423-a4d3-4b1f-9a51-000000000001';
const svc = '11111111-1111-1111-1111-111111111111';

function linha(n) {
  return {
    user_id: meuId,
    group_id: grupo,
    service_id: svc,
    status: 'pending',
    billing_cycle: 'monthly',
    amount: 9.9,
    gateway: 'iopay',
    external_reference: `teste-unique-${n}`,
  };
}

for (const n of [1, 2]) {
  const r = await fetch(`${s.url}/rest/v1/user_subscriptions`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(linha(n)),
  });
  const b = await r.text();
  console.log(`insert #${n} -> HTTP ${r.status} ${b.slice(0, 300)}`);
}
