/**
 * Smoke test das edge functions de pagamento IMPLANTADAS.
 *
 * Por que funciona como diagnóstico:
 *  - Se a função implantada tem import quebrado (ex.: `../_shared/...` que o
 *    editor do painel não empacotou), o Deno falha ANTES do handler -> HTTP 500
 *    com "Module not found". Isso é o cenário de drift repo->painel.
 *  - Se o módulo carrega, o handler responde: 401 (sem JWT, no
 *    check-iopay-tx) ou 200 (no iopay-webhook, que não exige JWT).
 *
 *   node scripts/sonda-functions-pagamento.mjs
 */
const URL_BASE = "https://lasoouwboxspstqvjbsv.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTc1MDAwMDAwMCwiZXhwIjo5OTk5OTk5OTl9.placeholder";

async function sondar(nome, path, body, headers = {}) {
  const url = `${URL_BASE}/functions/v1/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const texto = await res.text();
  console.log(`\n── ${nome}  (${path})`);
  console.log(`   HTTP ${res.status}`);
  console.log(`   body: ${texto.slice(0, 700).replace(/\s+/g, " ")}`);
  return { status: res.status, body: texto };
}

console.log("Alvo:", URL_BASE);

// 1. iopay-webhook: sem transacao real -> deve responder 200 "received".
await sondar("iopay-webhook (vazio)", "iopay-webhook", {});

// 2. iopay-webhook: com payload tipico de evento IO Pay (id + reference_id).
await sondar("iopay-webhook (evento)", "iopay-webhook", {
  id: "sonda-id-inexistente-000",
  type: "transaction_paid",
  status: "paid",
  reference_id: "sonda:sonda:subscription",
});

// 3. check-iopay-tx: sem Authorization -> deve responder 401 "Nao autenticado".
await sondar("check-iopay-tx (sem JWT)", "check-iopay-tx", { transaction_id: "sonda" });

// 4. confirm-payment nao e entrypoint (so exporta) — nao chamar.

// 5. force-confirm-payment: sem JWT -> 401 (prova que o modulo carregou).
await sondar("force-confirm-payment (sem JWT)", "force-confirm-payment", {});
