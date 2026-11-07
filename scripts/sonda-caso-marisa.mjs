/**
 * Sonda do caso Marisa (d2ccd4d5-d811-4f04-8d65-4f64bbefb456).
 * Transacao: d73c9d40a7464a3db981a80137918e67
 *
 * Objetivo: confirmar qual grupo e a referencia da transacao aponta,
 * se existe vinculo em group_members e o que o banco mostra.
 */
import { qaGet } from './lib/conta-qa.mjs';

const USER = 'd2ccd4d5-d811-4f04-8d65-4f64bbefb456';
const REF_GROUP = '11111111-1111-1111-1111-111111111111';
const TX = 'd73c9d40a7464a3db981a80137918e67';

async function tenta(rotulo, tabela, query) {
  try {
    const dados = await qaGet(tabela, query);
    console.log(`\n=== ${rotulo} (${tabela}) ===`);
    console.log(JSON.stringify(dados, null, 2));
    return dados;
  } catch (e) {
    console.log(`\n=== ${rotulo} (${tabela}) ===\nBLOQUEADO/ERRO: ${e.message}`);
    return null;
  }
}

await tenta('Usuario', 'users', `?id=eq.${USER}&select=id,name,email,avatar_url`);

await tenta('Grupo da referencia (11111111-...)', 'groups', `?id=eq.${REF_GROUP}&select=id,name,status,slug,monthly_price,service_id`);

await tenta('Servico com id 11111111-...', 'streaming_services', `?id=eq.${REF_GROUP}&select=id,name,slug`);

await tenta('Vinculos da Marisa', 'group_members', `?user_id=eq.${USER}&select=id,group_id,user_id,status,payment_status,subscription_deadline,left_at,created_at,updated_at`);

await tenta('Membros do grupo da referencia', 'group_members', `?group_id=eq.${REF_GROUP}&select=id,user_id,status,payment_status,subscription_deadline,left_at&limit=20`);

await tenta('Todos os grupos (visiveis p/ QA)', 'groups', '?select=id,name,status,service_id&order=name');

await tenta('Assinaturas da Marisa', 'user_subscriptions', `?user_id=eq.${USER}&select=id,user_id,group_id,status,billing_status,amount,next_charge_at,started_at,gateway_subscription_id,external_reference`);

await tenta('Tentativa da transacao', 'payment_attempts', `?gateway_transaction_id=eq.${TX}&select=id,user_id,group_id,status,payment_type,amount,gateway_transaction_id,external_reference,created_at,updated_at`);

await tenta('Pagamento da transacao', 'payments', `?transaction_code=eq.${TX}&select=*`);
