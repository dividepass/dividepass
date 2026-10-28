/**
 * Sonda de colunas no Supabase usando a anon key.
 *
 * O PostgREST valida as colunas ANTES de aplicar o RLS: coluna ausente
 * responde 400 (42703) e coluna presente responde 200 (mesmo que a lista
 * venha vazia). Isso permite auditar o schema sem `service_role` e sem
 * sessão de admin.
 *
 *   node scripts/probe-evolution-columns.mjs
 */

import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
}

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

/** Colunas que a tela /admin/evolution lê de cada tabela. */
const ESPERADO = {
  users: ['id', 'created_at', 'role'],
  user_subscriptions: ['id', 'user_id', 'created_at', 'status', 'amount'],
  payments: ['id', 'amount', 'status', 'created_at', 'transaction_code'],
  payment_attempts: ['id', 'amount', 'status', 'created_at', 'gateway_transaction_id', 'external_reference'],
  groups: ['id', 'name', 'created_at'],
  master_accounts: ['id', 'cost', 'status', 'created_at', 'updated_at'],
  expenses: [
    'id', 'amount', 'is_recurring', 'recurrence_day', 'start_date', 'due_date',
    'recurrence_end_date', 'recurrence_count', 'skipped_months', 'status',
  ],
};

let problemas = 0;

for (const [tabela, colunas] of Object.entries(ESPERADO)) {
  const cols = colunas.join(',');
  const res = await fetch(`${url}/rest/v1/${tabela}?select=${cols}&limit=1`, { headers });

  if (res.ok) {
    console.log(`OK    ${tabela} (${colunas.length} colunas)`);
    continue;
  }

  const body = await res.json().catch(() => ({}));
  console.log(`FALHA ${tabela} -> HTTP ${res.status} ${body.code || ''} ${body.message || ''}`);

  // Descobre qual coluna quebrou: testa uma a uma.
  for (const coluna of colunas) {
    const probe = await fetch(`${url}/rest/v1/${tabela}?select=${coluna}&limit=1`, { headers });
    if (!probe.ok) {
      const detalhe = await probe.json().catch(() => ({}));
      console.log(`        coluna ausente: ${coluna} (${detalhe.code || probe.status})`);
      problemas++;
    }
  }
}

console.log(problemas === 0 ? '\nNenhuma coluna ausente.' : `\n${problemas} coluna(s) ausente(s).`);
process.exit(problemas === 0 ? 0 : 1);
