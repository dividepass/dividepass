/**
 * Confere, uma a uma, TODAS as colunas que os caminhos de confirmação de
 * pagamento usam. PostgREST responde 400 com "column does not exist" quando a
 * coluna não existe no banco — é o jeito mais direto de achar coluna faltando
 * sem acesso ao SQL Editor.
 *
 *   node scripts/verifica-colunas-pagamento.mjs
 */
import { getSessaoQa } from './lib/conta-qa.mjs';

const s = await getSessaoQa();

async function existe(tabela, coluna) {
  const res = await fetch(`${s.url}/rest/v1/${tabela}?select=${coluna}&limit=1`, {
    headers: { apikey: s.anon, Authorization: `Bearer ${s.token}` },
  });
  if (res.ok) return { ok: true, status: res.status };
  const b = await res.text();
  const missing = /does not exist|column .* not found/i.test(b);
  return { ok: false, status: res.status, missing, body: b.slice(0, 160) };
}

const esperado = {
  user_subscriptions: [
    'id', 'user_id', 'group_id', 'service_id', 'status', 'billing_cycle', 'payment_method',
    'started_at', 'expires_at', 'amount', 'gateway', 'gateway_subscription_id', 'gateway_status',
    'custom_cycle_months', 'custom_cycle_days', 'next_charge_at', 'renewal_due_at', 'retry_count',
    'last_charge_at', 'card_id', 'card_last4', 'card_brand', 'billing_status', 'coupon_id',
    'discount_amount', 'original_amount', 'created_at', 'updated_at', 'plan_id', 'external_reference',
  ],
  group_members: [
    'id', 'group_id', 'user_id', 'profile_name', 'status', 'joined_at', 'left_at', 'created_at',
    'updated_at', 'payment_status', 'entrance_paid_at', 'entrance_payment_id', 'subscription_deadline',
    'entrance_refunded', 'subscription_mp_id', 'gateway_payment_id', 'gateway',
  ],
  payments: [
    'id', 'user_id', 'subscription_id', 'group_id', 'amount', 'method', 'payment_type', 'gateway',
    'status', 'transaction_code', 'notes', 'due_date', 'paid_at', 'created_at', 'updated_at',
  ],
  platform_events: [
    'id', 'event_type', 'title', 'description', 'user_id', 'group_id', 'metadata', 'created_at',
    'created_by', 'severity', 'source',
  ],
  payment_attempts: [
    'id', 'user_id', 'group_id', 'gateway', 'gateway_transaction_id', 'amount', 'status',
    'payment_type', 'external_reference', 'created_at', 'updated_at', 'error_message',
  ],
  billing_cycles: ['id', 'subscription_id', 'cycle_start', 'cycle_end', 'status', 'amount'],
};

let faltando = 0;
for (const [tabela, colunas] of Object.entries(esperado)) {
  const ruins = [];
  for (const c of colunas) {
    const r = await existe(tabela, c);
    if (!r.ok) { ruins.push(`${c} [HTTP ${r.status}${r.missing ? ' AUSENTE' : ''}] ${r.body}`); faltando++; }
  }
  console.log(`\n=== ${tabela}: ${colunas.length - ruins.length}/${colunas.length} ok`);
  for (const r of ruins) console.log('   !! ' + r);
}
console.log(`\nTOTAL de colunas ausentes: ${faltando}`);
