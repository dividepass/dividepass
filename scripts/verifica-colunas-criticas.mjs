/**
 * Testa se as colunas usadas pelo caminho de confirmação existem em produção.
 * PostgREST -> 400 "column does not exist" quando a coluna nao existe.
 *
 *   node scripts/verifica-colunas-criticas.mjs
 */
import { getSessaoQa } from './lib/conta-qa.mjs';

const s = await getSessaoQa();

async function teste(tabela, coluna) {
  const res = await fetch(`${s.url}/rest/v1/${tabela}?select=${coluna}&limit=1`, {
    headers: { apikey: s.anon, Authorization: `Bearer ${s.token}` },
  });
  const b = await res.text();
  if (res.ok) return { ok: true, status: res.status };
  return { ok: false, status: res.status, body: b.slice(0, 200) };
}

const checagens = [
  ['payments', 'official_price'],
  ['payments', 'paid_amount'],
  ['payments', 'subscription_id'],
  ['payments', 'official_total'],
  ['groups', 'official_price'],
  ['groups', 'price_per_slot'],
  ['groups', 'cycle_discount'],
  ['groups', 'custom_cycle_months'],
  ['groups', 'custom_cycle_days'],
  ['groups', 'billing_cycle'],
  ['groups', 'service_id'],
  ['platform_events', 'message'],
  ['platform_events', 'metadata'],
  ['platform_events', 'created_by'],
  ['platform_events', 'event_type'],
  ['platform_events', 'title'],
  ['billing_cycles', 'charge_date'],
  ['billing_cycles', 'attempt_number'],
  ['billing_cycles', 'user_id'],
  ['billing_cycles', 'group_id'],
  ['payment_attempts', 'gateway_response'],
  ['payment_attempts', 'payment_method'],
  ['payment_attempts', 'reference_id'],
  ['payment_attempts', 'external_reference'],
  ['payment_attempts', 'metadata'],
  ['payment_attempts', 'error_message'],
  ['payment_attempts', 'raw_response'],
];

let faltando = 0;
for (const [t, c] of checagens) {
  const r = await teste(t, c);
  if (!r.ok) { faltando++; console.log(`FALTANDO  ${t}.${c}  -> HTTP ${r.status} ${r.body}`); }
  else console.log(`ok        ${t}.${c}`);
}
console.log(`\nAusentes: ${faltando}`);
