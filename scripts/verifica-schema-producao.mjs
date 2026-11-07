/**
 * Verifica o schema REAL de produção via OpenAPI do PostgREST (read-only).
 * Confere se as colunas usadas pelas edge functions existem.
 *
 *   node scripts/verifica-schema-producao.mjs
 */
import { getSessaoQa } from './lib/conta-qa.mjs';

const s = await getSessaoQa();
const res = await fetch(`${s.url}/rest/v1/`, {
  headers: { apikey: s.anon, Authorization: `Bearer ${s.token}`, Accept: 'application/openapi+json' },
});
console.log('HTTP', res.status);
const spec = await res.json();

const tabelasAlvo = ['user_subscriptions', 'group_members', 'payment_attempts', 'payments', 'platform_events'];
for (const t of tabelasAlvo) {
  const def = spec.definitions?.[t];
  if (!def) { console.log(`\n${t}: AUSENTE no schema`); continue; }
  const props = Object.keys(def.properties || {});
  console.log(`\n=== ${t} (${props.length} colunas)`);
  console.log(props.join(', '));
}

// Checagens pontuais: o que as functions de pagamento usam
const checagens = [
  ['user_subscriptions', 'renewal_due_at'],
  ['user_subscriptions', 'next_charge_at'],
  ['user_subscriptions', 'billing_status'],
  ['user_subscriptions', 'payment_method'],
  ['user_subscriptions', 'updated_at'],
  ['group_members', 'subscription_deadline'],
  ['group_members', 'gateway_payment_id'],
  ['group_members', 'updated_at'],
  ['group_members', 'profile_name'],
  ['payment_attempts', 'gateway_transaction_id'],
  ['payment_attempts', 'external_reference'],
  ['payment_attempts', 'status'],
  ['payments', 'payment_type'],
  ['payments', 'transaction_code'],
];
console.log('\n\n=== CHECAGENS ===');
for (const [t, c] of checagens) {
  const def = spec.definitions?.[t];
  const ok = !!def?.properties?.[c];
  console.log(`${ok ? 'OK      ' : 'FALTANDO'} ${t}.${c}`);
}

// Teste real: pedir a coluna direto (400 se nao existir no banco)
console.log('\n=== TESTE DIRETO (PostgREST) ===');
for (const [t, c] of [['user_subscriptions', 'renewal_due_at'], ['group_members', 'subscription_deadline']]) {
  const r = await fetch(`${s.url}/rest/v1/${t}?select=${c}&limit=1`, {
    headers: { apikey: s.anon, Authorization: `Bearer ${s.token}` },
  });
  const b = await r.text();
  console.log(`${t}.${c} -> HTTP ${r.status} ${b.slice(0, 200)}`);
}
