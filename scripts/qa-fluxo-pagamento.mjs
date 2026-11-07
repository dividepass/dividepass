/**
 * QA DO FLUXO DE PAGAMENTO — "paguei e não fui add ao grupo"
 * ==========================================================
 *
 * Roda depois de publicar as functions no painel do Supabase.
 *
 *   node scripts/qa-fluxo-pagamento.mjs
 *
 * O que ele verifica
 * ------------------
 *  [estático] Os pacotes gerados usam a confirmação COMPARTILHADA
 *             (confirmPayment) — o polling e a confirmação manual não podem
 *             ter cópia própria da regra.
 *  [estático] A confirmação compartilhada dispara os DOIS e-mails do cliente.
 *  [estático] O polling decide "já confirmei" pelo pagamento aplicado
 *             (`payments`), e não pelo estado do vínculo — que é o que
 *             causava "confirmed: true" sem liberar nada.
 *  [ao vivo]  O `check-iopay-tx` implantado NÃO responde `confirmed: true`
 *             para uma transação que não existe. É o teste de regressão do
 *             caso real (a Fran pagou, o gateway aprovou, e o polling
 *             responderam "confirmado" sem liberar o grupo).
 *  [ao vivo]  O `reconcile-payments` implantado recusa quem não tem o
 *             segredo — não pode ser um endpoint público que libera grupo.
 */

import fs from "node:fs";
import path from "node:path";
import { getSessaoQa } from "./lib/conta-qa.mjs";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);
const PAINEL = path.join(ROOT, ".tmp-verify", "painel");

let passou = 0;
let falhou = 0;

function ok(nome, condicao, detalhe = "") {
  if (condicao) {
    passou++;
    console.log(`  OK    ${nome}${detalhe ? " — " + detalhe : ""}`);
  } else {
    falhou++;
    console.log(`  FALHA ${nome}${detalhe ? " — " + detalhe : ""}`);
  }
}

function lerPacote(nome) {
  const p = path.join(PAINEL, `${nome}.ts`);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

function lerFonte(relPath) {
  const p = path.join(ROOT, relPath);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

// ── 1. Estático ─────────────────────────────────────────────────────────────
console.log("\n=== ESTÁTICO (pacotes do painel) ===\n");

const check = lerPacote("check-iopay-tx");
const force = lerPacote("force-confirm-payment");
const confirm = lerPacote("confirm-payment");
const reconcile = lerPacote("reconcile-payments");

ok("pacote check-iopay-tx existe", !!check);
ok("pacote force-confirm-payment existe", !!force);
ok("pacote confirm-payment existe", !!confirm);
ok("pacote reconcile-payments existe", !!reconcile);

if (check) {
  const iAdaptador = check.indexOf("async function confirmIOPayment");
  const fimAdaptador = check.indexOf("\nDeno.serve", iAdaptador);
  const corpoAdaptador =
    iAdaptador >= 0
      ? check.slice(iAdaptador, fimAdaptador > iAdaptador ? fimAdaptador : iAdaptador + 4000)
      : "";

  ok(
    "check-iopay-tx delega para a confirmação compartilhada",
    /confirmPayment\s*\(/.test(corpoAdaptador),
    "o adaptador chama confirmPayment",
  );
  ok(
    "o adaptador do polling NÃO reescreve assinatura/vínculo (não tem cópia da regra)",
    corpoAdaptador.length > 0 &&
      !/from\("user_subscriptions"\)\.update\(/.test(corpoAdaptador) &&
      !/from\("group_members"\)\.update\(/.test(corpoAdaptador),
  );
  ok(
    "check-iopay-tx decide pelo pagamento aplicado (payments), não pelo estado do vínculo",
    /transaction_code[\s\S]{0,400}status[\s\S]{0,200}paid/.test(check),
  );
  ok(
    "check-iopay-tx NÃO usa mais o atalho 'alreadyConfirmedInDB'",
    !/alreadyConfirmedInDB/.test(check),
  );
}

if (force) {
  ok("force-confirm-payment usa a confirmação compartilhada", /confirmPayment\s*\(/.test(force));
  ok(
    "force-confirm-payment marca a confirmação manual (forced: true)",
    /forced:\s*true/.test(force),
  );
}

if (confirm) {
  ok(
    "confirm-payment dispara o e-mail 'recebemos seu pagamento'",
    /notifyPaymentReceived\s*\(/.test(confirm),
  );
  ok(
    "confirm-payment dispara o e-mail de entrada no grupo",
    /notifyMemberJoined\s*\(/.test(confirm),
  );
  ok(
    "confirm-payment registra o evento de liberação que falhou",
    /Pagamento aprovado sem libera/.test(confirm),
  );
  ok(
    "confirm-payment cria a linha de billing_cycles",
    /billing_cycles/.test(confirm),
  );
}

if (reconcile) {
  ok(
    "reconcile-payments exige autorização",
    /Unauthorized/.test(reconcile),
  );
  ok(
    "reconcile-payments usa a confirmação compartilhada",
    /confirmPayment\s*\(/.test(reconcile),
  );
}

const webhook = lerPacote("iopay-webhook");

if (webhook) {
  ok("pacote iopay-webhook existe", true);
  ok(
    "iopay-webhook usa a confirmação compartilhada (confirmPayment)",
    /confirmPayment\s*\(/.test(webhook),
  );
  // ── REGRA DE OURO ────────────────────────────────────────────────────────
  // 200 = "entrega feita, não reenvia". Pagamento aprovado sem liberação tem
  // que responder 5xx, senão o gateway desiste e o dinheiro fica preso.
  ok(
    "iopay-webhook devolve 503 quando a confirmação do pagamento aprovado falha",
    /status === "approved" && !confirmOk[\s\S]{0,600}status:\s*503/.test(webhook),
    "sem isso o gateway nunca reenvia e o pagamento morre no gateway",
  );
  ok(
    "iopay-webhook devolve 503 quando não consegue ler a transação no gateway",
    /gateway read failed[\s\S]{0,400}status:\s*503/.test(webhook),
  );
  ok(
    "iopay-webhook devolve 503 quando não acha a tentativa de pagamento",
    /attempt not found[\s\S]{0,400}status:\s*503/.test(webhook),
  );
  ok(
    "iopay-webhook devolve 503 quando a referência diverge",
    /reference mismatch[\s\S]{0,400}status:\s*503/.test(webhook),
  );
  ok(
    "iopay-webhook acha a tentativa pela referência externa se o id do gateway vier diferente",
    /\.eq\("external_reference", externalReference\)/.test(webhook),
  );
  ok(
    "iopay-webhook NÃO tem mais os retornos 200 silenciosos do caminho antigo",
    !/webhook ignorado/.test(webhook),
  );
}

// ── 1.1 FLUXO DE PAGAMENTO ÚNICO (adesão + 1ª mensalidade na mesma cobrança) ──
console.log("\n=== ESTÁTICO (fluxo de pagamento único) ===\n");

const checkout = lerFonte("src/pages/user/Checkout.jsx");
const iopayHandler = lerFonte("supabase/functions/create-payment/handlers/iopay.ts");
const confirmFonte = lerFonte("supabase/functions/confirm-payment/index.ts");

ok("Checkout.jsx existe", !!checkout);
ok("handler iopay do create-payment existe", !!iopayHandler);
ok("confirm-payment (fonte) existe", !!confirmFonte);

if (checkout) {
  const listaCombined = (checkout.match(/const GATEWAYS_COMBINED = \[([^\]]+)\]/) || [])[1] || "";
  const gatewaysCombined = listaCombined
    .split(",")
    .map((s) => s.trim().replace(/['"]/g, ""))
    .filter(Boolean);
  ok(
    "Checkout só usa o pagamento combinado nos gateways que suportam",
    gatewaysCombined.includes("iopay") &&
      gatewaysCombined.includes("mercadopago") &&
      !["asaas", "pagarme", "stripe"].some((g) => gatewaysCombined.includes(g)),
    "asaas/pagarme/stripe ficam no fluxo antigo de 2 pagamentos",
  );
  ok(
    "o gateway woovi (se estiver na lista) tem handler com suporte a 'combined'",
    !gatewaysCombined.includes("woovi") ||
      /payment_type === "combined"|type === "combined"/.test(lerFonte("supabase/functions/create-payment/handlers/woovi.ts") || ""),
  );
  ok(
    "Passo 1 da adesão é SÓ a explicação (nenhuma cobrança)",
    /if \(pagamentoUnico && !introAdesao\)/.test(checkout) &&
      /Entender a adesão/.test(checkout) &&
      /Continuar para o pagamento/.test(checkout),
  );
  ok(
    "a etapa 2 mostra o subtotal (adesão + mensalidade)",
    /const totalUnico = entranceAmount \+ finalSubscriptionAmount/.test(checkout),
  );
  ok(
    "a etapa 2 cobra o total no handler combinado",
    /const iniciarPagamento = pagamentoUnico \? handleCombinedPayment : handleSubscriptionPayment/.test(checkout),
  );
  ok(
    "o fluxo antigo de 2 pagamentos continua para os gateways sem 'combined'",
    /hasEntranceFee && !entrancePaid && !entranceExpired && !pagamentoUnico/.test(checkout),
  );
  ok(
    "os valores do polling usam o valor do CICLO (não o preço mensal)",
    /subscriptionAmount : subscriptionAmount/.test(checkout),
  );
}

if (iopayHandler) {
  ok(
    "no combinado, a cobrança é adesão + mensalidade (cupom na mensalidade)",
    /entranceAmount \+ combinedSubscriptionAmount/.test(iopayHandler),
  );
  ok(
    "no combinado, a assinatura nasce com o valor do CICLO (sem a taxa)",
    /amount: combinedStoredAmount/.test(iopayHandler),
  );
  ok(
    "a tentativa registra o total com cupom (adesão + mensalidade)",
    /finalAmt = entranceAmount \+ sub\.amount/.test(iopayHandler),
  );
  ok(
    "no combinado, o vínculo NÃO nasce antes do pagamento",
    /if \(!isPix && !isCombined\)/.test(iopayHandler),
    "senão o front acha que a adesão já foi paga com o pagamento recusado",
  );
  ok(
    "no cartão, o vínculo NÃO é gravado como 'active' antes da confirmação",
    /payment_status: renewalMode/.test(iopayHandler),
    "era esse estado mentiroso que fazia o polling dizer 'já confirmei' e liberar nada",
  );
}

if (confirmFonte) {
  ok(
    "a confirmação separa o que foi pago da taxa de adesão",
    /paidSubscriptionPart = Math\.max\(0, chargedTotal - entranceAmount\)/.test(confirmFonte),
  );
  ok(
    "a recorrência grava o valor do ciclo, nunca a taxa",
    /amount: storedSubscriptionAmount/.test(confirmFonte),
  );
  // ── A armadilha que travava a Cristiana (02/11) ────────────────────────────
  ok(
    "a confirmação SÓ ignora o replay quando a LIBERAÇÃO terminou",
    /liberacaoConcluida/.test(confirmFonte),
    "pago não é liberado: senão o replay pula a liberação e a assinatura fica pendente para sempre",
  );
  ok(
    "a confirmação não duplica a linha de payments",
    /registrarPagamento/.test(confirmFonte),
  );
}

const pagarmeHandler = lerFonte("supabase/functions/create-payment/handlers/pagarme.ts");
if (pagarmeHandler) {
  ok(
    "pagarme NÃO marca o vínculo como 'active' antes do pagamento",
    !/group_members"\)\s*\.update\(\{ status: "active", payment_status: "active" \}/.test(pagarmeHandler),
    "esse estado mentiroso fazia o polling responder 'já confirmei' sem liberar o grupo",
  );
}

// ── 2. Ao vivo ──────────────────────────────────────────────────────────────
console.log("\n=== AO VIVO (produção) ===\n");

const s = await getSessaoQa();

async function chamarFuncao(nome, body, headers = {}) {
  const res = await fetch(`${s.url}/functions/v1/${nome}`, {
    method: "POST",
    headers: {
      apikey: s.anon,
      Authorization: `Bearer ${s.token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* texto cru */ }
  return { status: res.status, json, texto };
}

// A conta QA é membra ativa de um grupo com assinatura ativa — exatamente o
// cenário que fazia o polling antigo responder "confirmed: true" para
// qualquer transação. Se a versão nova estiver no ar, a resposta tem que ser
// `confirmed: false` (a transação não existe, logo nada foi aplicado).
const QA_USER_ID = "2fd57ac7-fd13-45dc-a496-9ed4db2a5a78";
const GRUPO = "8a4e94ca-0750-43bb-853a-bc2c6940ee66";

const poll = await chamarFuncao("check-iopay-tx", {
  transaction_id: "qa-transacao-que-nao-existe-000",
  group_id: GRUPO,
  user_id: QA_USER_ID,
  payment_type: "subscription",
});

ok("check-iopay-tx respondeu", poll.status === 200, `HTTP ${poll.status} ${poll.texto.slice(0, 160)}`);
ok(
  "REGRESSÃO: transação inexistente NÃO pode vir como 'confirmed: true'",
  poll.json?.confirmed !== true,
  poll.json?.confirmed === true
    ? "ATENÇÃO: a function antiga ainda está no ar — publique a nova check-iopay-tx"
    : `confirmed=${poll.json?.confirmed} status=${poll.json?.status}`,
);

// A reconciliação não pode ser um endpoint público.
const rec = await chamarFuncao("reconcile-payments", {}, { Authorization: "Bearer invalido" });
if (rec.status === 404) {
  console.log(
    "  AVISO reconcile-payments ainda não foi publicada (404) — publique antes de agendar o cron",
  );
  falhou++;
} else {
  ok(
    "reconcile-payments recusa credencial inválida",
    rec.status === 401,
    `HTTP ${rec.status}`,
  );
}

console.log(`\n=== RESULTADO: ${passou} OK / ${falhou} FALHA ===\n`);
process.exit(falhou === 0 ? 0 : 1);
