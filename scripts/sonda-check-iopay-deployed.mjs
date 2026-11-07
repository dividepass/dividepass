/**
 * Sonda no `check-iopay-tx` IMPLANTADO.
 *
 * Com um transaction_id inexistente:
 *  - se o auth na IO Pay funciona, a funcao chega em "transacao nao encontrada"
 *    (ou status pendente) — prova que o deployed fala com o gateway;
 *  - se o auth falha, a resposta traz "Auth failed: ...".
 *
 *   node scripts/sonda-check-iopay-deployed.mjs
 */
import { getSessaoQa } from './lib/conta-qa.mjs';

const s = await getSessaoQa();

async function chamar(body, label) {
  const r = await fetch(`${s.url}/functions/v1/check-iopay-tx`, {
    method: 'POST',
    headers: {
      apikey: s.anon,
      Authorization: `Bearer ${s.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  console.log(`\n── ${label}\n   HTTP ${r.status}\n   ${t.slice(0, 900)}\n`);
  return { status: r.status, body: t };
}

// Grupo e usuario reais (conta QA) — a funcao usa service role por dentro.
const QA_USER_ID = '2fd57ac7-fd13-45dc-a496-9ed4db2a5a78';
const GRUPO = '8a4e94ca-0750-43bb-853a-bc2c6940ee66';

await chamar(
  {
    transaction_id: 'sonda-transacao-inexistente-000',
    group_id: GRUPO,
    user_id: QA_USER_ID,
    payment_type: 'subscription',
  },
  'check-iopay-tx com tx inexistente',
);

// Sem transaction_id: mostra o contrato de entrada.
await chamar(
  { group_id: GRUPO, user_id: QA_USER_ID, payment_type: 'subscription' },
  'check-iopay-tx SEM transaction_id',
);
