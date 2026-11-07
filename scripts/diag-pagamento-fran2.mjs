/**
 * Diagnóstico do caso Fran (produção) — somente LEITURA.
 *
 *   node scripts/diag-pagamento-fran2.mjs
 */
import { getSessaoQa } from './lib/conta-qa.mjs';

const s = await getSessaoQa();
const H = { apikey: s.anon, Authorization: `Bearer ${s.token}` };

async function get(tabela, query = '') {
  const res = await fetch(`${s.url}/rest/v1/${tabela}${query}`, { headers: H });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const EMAIL = 'kellrodrigues92@gmail.com';

// 1) Usuário
const u = await get('users', `?select=id,email,name,role,created_at&email=eq.${encodeURIComponent(EMAIL)}`);
console.log('USUÁRIO Fran:', u.status, JSON.stringify(u.body, null, 1));

const uid = Array.isArray(u.body) ? u.body[0]?.id : null;
if (!uid) process.exit(0);

// 2) Grupos dela (como owner/membro) + o grupo alvo
const g = await get('groups', '?select=id,name,slug,price_per_slot,has_entrance_fee,entrance_fee,billing_cycle,cycle_discount,status,approval_status,is_official,plan_id,service_id,has_slot_limit,max_size,reference_code&limit=200');
const grupos = Array.isArray(g.body) ? g.body : [];
console.log('\nGRUPOS visíveis:', g.status, grupos.length);
const alvo = grupos.filter((x) => (x.name || '').toLowerCase().includes('netflix'));
console.log('Alvo(s) Netflix:', JSON.stringify(alvo, null, 1));

// 3) Membros: a Fran tem group_members visível?
const gm = await get('group_members', `?select=id,group_id,user_id,profile_name,status,payment_status,joined_at,left_at,gateway,gateway_payment_id,subscription_deadline,entrance_paid_at&user_id=eq.${uid}`);
console.log('\nGROUP_MEMBERS da Fran:', gm.status, JSON.stringify(gm.body, null, 1));

// 4) Assinaturas dela
const us = await get('user_subscriptions', `?select=*&user_id=eq.${uid}`);
console.log('\nUSER_SUBSCRIPTIONS da Fran:', us.status, JSON.stringify(us.body, null, 1));

// 5) Tentativas de pagamento dela (colunas explícitas)
const pa = await get('payment_attempts', `?select=id,user_id,group_id,gateway,gateway_transaction_id,amount,status,payment_type,created_at,updated_at,error_message&user_id=eq.${uid}`);
console.log('\nPAYMENT_ATTEMPTS da Fran:', pa.status, JSON.stringify(pa.body, null, 1));

const pay = await get('payments', `?select=id,user_id,group_id,amount,method,payment_type,gateway,status,transaction_code,created_at,paid_at&user_id=eq.${uid}`);
console.log('\nPAYMENTS da Fran:', pay.status, JSON.stringify(pay.body, null, 1));
