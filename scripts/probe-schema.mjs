// Sondagem do schema REAL de producao via PostgREST.
// O PostgREST valida colunas/funcoes ANTES de aplicar RLS, entao a anon key
// revela o contrato do banco mesmo sem ler linhas.
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const get = (k) => (env.split(/\r?\n/).find(l => l.startsWith(k + '=')) || '').split('=').slice(1).join('=').trim();
const URL_ = get('VITE_SUPABASE_URL');
const KEY = get('VITE_SUPABASE_ANON_KEY');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(path, opts = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, text };
}

// ---------------------------------------------------------------
// 1) Colunas: existe ou nao? (PGRST204 = coluna inexistente)
// ---------------------------------------------------------------
const COLS = {
  user_wallets: ['user_id', 'balance', 'total_earned', 'updated_at', 'created_at'],
  wallet_transactions: ['id', 'user_id', 'type', 'amount', 'description', 'reference_type',
    'reference_id', 'group_id', 'status', 'created_at', 'wallet_id', 'admin_notes', 'paid_at'],
  wallet_withdrawals: ['id', 'user_id', 'amount', 'status', 'payment_method', 'payment_details',
    'processed_by', 'notes', 'requested_at', 'processed_at', 'created_at', 'pix_key', 'pix_type',
    'bank_name', 'bank_agency', 'bank_account', 'bank_holder', 'group_id'],
  payments: ['id', 'user_id', 'subscription_id', 'group_id', 'amount', 'method', 'payment_type',
    'gateway', 'status', 'transaction_code', 'notes', 'due_date', 'paid_at', 'created_at', 'updated_at'],
};

console.log('=== COLUNAS EXISTENTES EM PRODUCAO ===');
for (const [table, cols] of Object.entries(COLS)) {
  const ok = [];
  const missing = [];
  for (const c of cols) {
    const r = await rest(`${table}?select=${c}&limit=1`);
    if (r.status === 200) ok.push(c);
    else if (String(r.text).includes('PGRST204')) missing.push(c);
    else ok.push(`${c}(?${r.status})`);
  }
  console.log(`\n${table}\n  EXISTEM : ${ok.join(', ')}\n  AUSENTES: ${missing.join(', ') || '(nenhuma)'}`);
}

// ---------------------------------------------------------------
// 2) Assinaturas de credit_wallet (PGRST202 = funcao nao existe)
// ---------------------------------------------------------------
console.log('\n=== credit_wallet: assinaturas ===');
for (const [label, body] of [
  ['5 params', { p_user_id: '00000000-0000-0000-0000-000000000000', p_amount: 0, p_description: 'x', p_reference_type: 't', p_reference_id: '00000000-0000-0000-0000-000000000000' }],
  ['6 params', { p_user_id: '00000000-0000-0000-0000-000000000000', p_amount: 0, p_description: 'x', p_reference_type: 't', p_reference_id: '00000000-0000-0000-0000-000000000000', p_group_id: '00000000-0000-0000-0000-000000000000' }],
  ['4 params', { p_user_id: '00000000-0000-0000-0000-000000000000', p_amount: 0, p_description: 'x', p_reference_type: 't' }],
]) {
  const r = await rest('rpc/credit_wallet', { method: 'POST', body: JSON.stringify(body) });
  console.log(`\n${label}: HTTP ${r.status} -> ${r.text.slice(0, 400)}`);
}

// ---------------------------------------------------------------
// 3) Politicas visiveis via probe de erro (nao da, mas tentamos listar)
// ---------------------------------------------------------------
console.log('\n=== outras funcoes de wallet (existencia) ===');
for (const fn of ['debit_wallet', 'withdraw_wallet', 'process_withdrawal', 'approve_withdrawal', 'ensure_wallet']) {
  const r = await rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify({}) });
  const exists = !String(r.text).includes('PGRST202');
  console.log(`${fn}: HTTP ${r.status} -> ${exists ? 'EXISTE' : 'NAO EXISTE'} :: ${r.text.slice(0, 160)}`);
}

// ---------------------------------------------------------------
// 4) Grants: tabela permite SELECT para anon? (401 = sem grant)
// ---------------------------------------------------------------
console.log('\n=== grants de tabela (anon) ===');
for (const t of ['user_wallets', 'wallet_transactions', 'wallet_withdrawals', 'payments', 'groups', 'users', 'platform_events', 'app_settings']) {
  const r = await rest(`${t}?select=*&limit=1`);
  const denied = r.status === 401;
  let n = 0;
  if (Array.isArray(r.data)) n = r.data.length;
  console.log(`${t}: HTTP ${r.status} ${denied ? '(sem SELECT para anon)' : `(SELECT ok, ${n} linha(s) anon)`}`);
}
