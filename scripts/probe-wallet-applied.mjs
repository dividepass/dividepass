// Confere se a migration de repasse foi aplicada no banco de producao.
// Sonda via anon key: o PostgREST valida coluna/RPC antes do RLS.
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const get = (k) => (env.split(/\r?\n/).find(l => l.startsWith(k + '=')) || '').split('=').slice(1).join('=').trim();
const URL_ = get('VITE_SUPABASE_URL');
const KEY = get('VITE_SUPABASE_ANON_KEY');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(path, opts = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await res.text();
  return { status: res.status, text };
}

console.log('=== COLUNAS NOVAS em wallet_withdrawals ===');
for (const c of ['pix_key', 'pix_type', 'bank_name', 'bank_agency', 'bank_account', 'bank_holder', 'created_at', 'group_id']) {
  const r = await rest(`wallet_withdrawals?select=${c}&limit=1`);
  console.log(`  ${c}: ${r.status === 200 ? 'EXISTE' : 'AUSENTE (' + r.status + ')'}`);
}

console.log('\n=== COLUNAS NOVAS em payments ===');
for (const c of ['wallet_credited_at', 'wallet_credit_note']) {
  const r = await rest(`payments?select=${c}&limit=1`);
  console.log(`  ${c}: ${r.status === 200 ? 'EXISTE' : 'AUSENTE (' + r.status + ')'}`);
}

console.log('\n=== RPCs NOVAS (42501 = existe; PGRST202 = nao existe) ===');
for (const [nome, body] of [
  ['request_withdrawal', { p_amount: 1 }],
  ['process_withdrawal', { p_withdrawal_id: '00000000-0000-0000-0000-000000000000', p_action: 'probe' }],
]) {
  const r = await rest(`rpc/${nome}`, { method: 'POST', body: JSON.stringify(body) });
  const existe = !r.text.includes('PGRST202');
  console.log(`  ${nome}: ${existe ? 'EXISTE' : 'NAO EXISTE'} -> HTTP ${r.status} ${r.text.slice(0, 120)}`);
}

console.log('\n=== credit_wallet ainda existe? (42501 = existe) ===');
{
  const r = await rest('rpc/credit_wallet', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: '00000000-0000-0000-0000-000000000000', p_amount: 0, p_description: 'x' }),
  });
  console.log(`  HTTP ${r.status} -> ${r.text.slice(0, 160)}`);
}
