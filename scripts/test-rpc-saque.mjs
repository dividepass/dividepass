// Teste funcional das RPCs novas de saque com um usuario autenticado.
// Espera: saldo insuficiente (usuario recem-criado nao tem carteira).
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const get = (k) => (env.split(/\r?\n/).find(l => l.startsWith(k + '=')) || '').split('=').slice(1).join('=').trim();
const URL_ = get('VITE_SUPABASE_URL');
const KEY = get('VITE_SUPABASE_ANON_KEY');

const email = `saque-${Date.now()}@divteste.com`;
const senha = `Pr0be-${Date.now()}!y`;

const su = await fetch(`${URL_}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: senha }),
});
const sj = await su.json();
const token = sj.access_token;
if (!token) { console.log('signup falhou:', JSON.stringify(sj).slice(0, 200)); process.exit(1); }
console.log('conta criada:', email);

const H = { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// 1) Pedir saque sem saldo -> deve barrar com "saldo insuficiente"
const r1 = await fetch(`${URL_}/rest/v1/rpc/request_withdrawal`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ p_amount: 1, p_payment_method: 'pix', p_pix_key: 'teste@divteste.com' }),
});
console.log('request_withdrawal(1,00 sem saldo):', r1.status, (await r1.text()).slice(0, 220));

// 2) Admin negando um saque inexistente -> deve dar erro de negocio, nao PGRST202
const r2 = await fetch(`${URL_}/rest/v1/rpc/process_withdrawal`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ p_withdrawal_id: '00000000-0000-0000-0000-000000000000', p_action: 'paid' }),
});
console.log('process_withdrawal(sem permissao):', r2.status, (await r2.text()).slice(0, 220));

// 3) Limpeza
const d = await fetch(`${URL_}/functions/v1/delete-account`, {
  method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
});
console.log('cleanup:', d.status, (await d.text()).slice(0, 120));
