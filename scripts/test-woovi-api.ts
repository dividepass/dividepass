/**
 * TESTE DE INTEGRAÇÃO REAL com a API da Woovi (sandbox).
 *
 *   $env:WOOVI_APP_ID = "<seu AppID>"
 *   $env:WOOVI_ENV = "sandbox"
 *   node scripts/test-woovi-api.mjs
 *
 * POR QUE ESTE TESTE EXISTE
 * -----------------------
 * Este script chama as MESMAS funções que a edge function chama
 * (`supabase/functions/_shared/woovi-api.ts`). Ele não é uma simulação: é
 * a API real. Foi ele que descobriu as três armadilhas que nenhuma
 * documentação avisa:
 *
 *   1. O AppID é case-sensitive no `clientId` (`Client_Id_` sim, `Client_id_`
 *      não) — uma letra de diferença e a API responde 401 "appID inválido".
 *   2. `POST /api/v1/charge` NÃO aceita `type` — `PIX_CREDIT` aciona o
 *      "Woovi Parcelado" e é recusado.
 *   3. `POST /api/v1/subscriptions` valida `dayGenerateCharge`: tem que ser
 *      HOJE na Jornada 3 e ≥ 3 dias no futuro na Jornada 2.
 *
 * O que este teste FAZ no sandbox: cria um cliente e um mandate de teste,
 * cria uma cobrança de R$ 1,00 e um Pix Automático de R$ 10,00. Tudo em
 * sandbox — nenhum dinheiro real é movimentado. Ele NÃO paga nada (quem
 * paga é o pagador, no app do banco).
 */
import {
  getWooviConfig,
  normalizarAppId,
  toCents,
  fromCents,
  nextChargeDate,
  chargeDayOfMonth,
} from "../supabase/functions/_shared/woovi.ts";
import {
  createCustomer,
  getCustomer,
  findCustomerByTaxID,
  createCharge,
  createPixAutomatic,
  getSubscription,
  listInstallments,
} from "../supabase/functions/_shared/woovi-api.ts";

let passou = 0;
let falhou = 0;

function check(nome: string, cond: boolean, detalhe = "") {
  if (cond) {
    passou++;
    console.log(`ok    ${nome}`);
  } else {
    falhou++;
    console.log(`FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

function assertEquals(actual: unknown, expected: unknown, nome: string) {
  check(nome, JSON.stringify(actual) === JSON.stringify(expected), `esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`);
}

const appIdBruto = process.env.WOOVI_APP_ID;
if (!appIdBruto) {
  console.error(
    "\nFalta WOOVI_APP_ID.\n" +
      "  $env:WOOVI_APP_ID = '...'\n" +
      "  $env:WOOVI_ENV = 'sandbox'\n",
  );
  process.exit(1);
}

const settings = { woovi_app_id: appIdBruto, ambiente: process.env.WOOVI_ENV || "sandbox" };
const cfg = getWooviConfig(settings);

console.log(`AppID:    ${cfg.appId.slice(0, 8)}...${cfg.appId.slice(-4)} (normalizado: ${cfg.appId !== appIdBruto ? "SIM" : "já estava certo"})`);
console.log(`Ambiente: ${cfg.env} (${cfg.baseUrl})\n`);

// ────────────────────────────────────────────────────────────────────────────
// 0. O AppID é aceito?
// ────────────────────────────────────────────────────────────────────────────
try {
  const clientes = await (async () => {
    const res = await fetch(`${cfg.baseUrl}/api/v1/customer?limit=1`, {
      headers: { Authorization: cfg.appId, Accept: "application/json" },
    });
    return { status: res.status, txt: (await res.text()).slice(0, 120) };
  })();
  check(
    "AppID aceito pela API",
    clientes.status === 200,
    `HTTP ${clientes.status}: ${clientes.txt}`,
  );
} catch (e) {
  check("AppID aceito pela API", false, e.message);
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Cliente
// ────────────────────────────────────────────────────────────────────────────
const CLIENTE = {
  name: "Teste Integracao DividePass",
  email: "teste@dividepass.local",
  taxID: "31324227036",
  correlationID: `dp-user-teste-${Date.now()}`,
  address: {
    zipcode: "01310-100",
    street: "Av. Paulista",
    number: "1000",
    neighborhood: "Bela Vista",
    city: "Sao Paulo",
    state: "SP",
    country: "BR",
  },
};

let clienteCriado = null;
try {
  // A criação de cliente NAO é idempotente: duplicar devolve 400. O
  // handler trata esse 400 como "ja existe" e localiza pelo CPF — o teste
  // faz exatamente o mesmo.
  try {
    clienteCriado = await createCustomer(cfg, CLIENTE);
    check("cliente criado", !!clienteCriado?.correlationID, JSON.stringify(clienteCriado).slice(0, 150));
  } catch (e: any) {
    const duplicado = String(e?.message || e).toLowerCase().includes("outro cliente");
    check("cliente duplicado é recusado pela API (comportamento esperado)", duplicado, e.message);
    const achado = await findCustomerByTaxID(cfg, CLIENTE.taxID);
    check("cliente existente reencontrado pelo CPF", !!achado?.correlationID, achado?.correlationID);
    clienteCriado = achado;
  }

  assertEquals(clienteCriado?.taxID?.taxID ?? clienteCriado?.taxID, "31324227036", "taxID do cliente");

  const buscado = await getCustomer(cfg, clienteCriado?.correlationID);
  check("cliente reencontrado pelo correlationID", !!buscado?.correlationID, "GET /customer/{correlationID}");
} catch (e) {
  check("cliente criado", false, e.message);
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Cobrança Pix avulsa (sem `type`!)
// ────────────────────────────────────────────────────────────────────────────
try {
  const charge = await createCharge(cfg, {
    valueCents: toCents(1),
    correlationId: `dp-teste-charge-${Date.now()}`,
    comment: "Teste integracao",
    customer: {
      name: CLIENTE.name,
      correlationID: CLIENTE.correlationID,
      email: CLIENTE.email,
      taxID: CLIENTE.taxID,
      address: CLIENTE.address,
    },
  });

  check("charge criado", !!charge.identifier, charge.identifier);
  check("charge tem brCode (copia e cola)", !!charge.brCode && charge.brCode.startsWith("000201"));
  check("charge tem qrCodeImage (URL da imagem)", !!charge.qrCodeImage && charge.qrCodeImage.startsWith("http"));
  check("charge tem paymentLinkUrl", !!charge.paymentLinkUrl);
  assertEquals(fromCents(charge.value), 1, "valor do charge em reais");
  console.log(`      identifier=${charge.identifier}`);
  console.log(`      qr=${String(charge.qrCodeImage).slice(0, 80)}`);
} catch (e) {
  check("charge criado", false, e.message);
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Pix Automático — Jornada 3 (PAYMENT_ON_APPROVAL)
//    dayGenerateCharge tem que ser HOJE.
// ────────────────────────────────────────────────────────────────────────────
try {
  const diaHoje = chargeDayOfMonth(new Date());
  const mandate = await createPixAutomatic(cfg, {
    valueCents: toCents(10),
    correlationId: `dp-teste-rec3-${Date.now()}`,
    comment: "Teste integracao",
    customer: {
      name: CLIENTE.name,
      correlationID: CLIENTE.correlationID,
      email: CLIENTE.email,
      taxID: CLIENTE.taxID,
      address: CLIENTE.address,
    },
    frequency: "MONTHLY",
    dayGenerateCharge: diaHoje,
    dayDue: 3,
    journey: "PAYMENT_ON_APPROVAL",
    retryPolicy: "THREE_RETRIES_7_DAYS",
  });

  check("mandate (Jornada 3) criado", !!mandate.globalID, mandate.globalID);
  check("mandate tem recurrencyId", !!mandate.recurrencyId, mandate.recurrencyId);
  check("mandate tem emv", !!mandate.emv, String(mandate.emv).slice(0, 60));
  assertEquals(mandate.journey, "PAYMENT_ON_APPROVAL", "jornada do mandate");
  assertEquals(mandate.status, "CREATED", "status inicial do mandate (aguardando autorizacao)");
  console.log(`      globalID=${mandate.globalID}`);
  console.log(`      recurrencyId=${mandate.recurrencyId}`);

  // ── 4. Consulta: a assinatura existe e a API ecoa o dia do mês ─────────
  const sub = await getSubscription(cfg, mandate.globalID);
  check("assinatura consultavel", !!sub?.globalID);
  assertEquals(sub?.dayGenerateCharge, diaHoje, "dayGenerateCharge ecoado pela API");
  assertEquals(sub?.frequency, "MONTHLY", "frequencia da assinatura");
  assertEquals(sub?.type, "PIX_RECURRING", "tipo da assinatura");

  const parcelas = await listInstallments(cfg, mandate.globalID);
  check("installments listaveis", Array.isArray(parcelas), `total=${parcelas?.length}`);
} catch (e) {
  check("mandate (Jornada 3) criado", false, e.message);
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Pix Automático — Jornada 2 (ONLY_RECURRENCY)
//    dayGenerateCharge tem que estar ≥ 3 dias no futuro.
// ────────────────────────────────────────────────────────────────────────────
try {
  const proximo = nextChargeDate("monthly");
  const mandate2 = await createPixAutomatic(cfg, {
    valueCents: toCents(10),
    correlationId: `dp-teste-rec2-${Date.now()}`,
    comment: "Teste integracao",
    customer: {
      name: CLIENTE.name,
      correlationID: CLIENTE.correlationID,
      email: CLIENTE.email,
      taxID: CLIENTE.taxID,
      address: CLIENTE.address,
    },
    frequency: "MONTHLY",
    dayGenerateCharge: proximo.toISOString(),
    dayDue: 3,
    journey: "ONLY_RECURRENCY",
    retryPolicy: "THREE_RETRIES_7_DAYS",
  });

  check("mandate (Jornada 2) criado", !!mandate2.globalID, mandate2.globalID);
  assertEquals(mandate2.journey, "ONLY_RECURRENCY", "jornada do mandate 2");

  const sub2 = await getSubscription(cfg, mandate2.globalID);
  assertEquals(
    sub2?.dayGenerateCharge,
    chargeDayOfMonth(proximo),
    "dayGenerateCharge ecoado (ISO vira dia do mes)",
  );
  console.log(`      globalID=${mandate2.globalID}`);
} catch (e) {
  check("mandate (Jornada 2) criado", false, e.message);
}

console.log(`\n${passou} passou | ${falhou} falhou`);
if (falhou > 0) process.exit(1);
