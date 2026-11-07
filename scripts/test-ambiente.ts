/**
 * Testes do INTERRUPTOR DE AMBIENTE (produção x sandbox).
 *
 *   node scripts/test-ambiente.ts
 *   deno run scripts/test-ambiente.ts
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O toggle decide para onde as cobranças são enviadas. Um erro aqui significa
 * cobrar em produção o que o admin achava que era teste — ou o contrário, e
 * ninguém percebe porque nada quebra.
 *
 * A regra é: o que não for reconhecidamente sandbox é PRODUÇÃO. Errar para
 * produção é perigoso; errar para sandbox só custa um retrabalho.
 */
import {
  normalizarAmbiente,
  getAmbiente,
  ehSandbox,
  ambienteLabel,
  AMBIENTE_KEY,
  AMBIENTE_DEFAULT,
} from "../supabase/functions/_shared/ambiente.ts";
import {
  appIdDoAmbiente,
  getWooviConfig,
  normalizarAppId,
  erroAppIdAusente,
  WOOVI_PROD,
  WOOVI_SANDBOX,
  WOOVI_APP_ID_SANDBOX_KEY,
  WOOVI_APP_ID_PRODUCTION_KEY,
} from "../supabase/functions/_shared/woovi.ts";

let passou = 0;
let falhou = 0;

function test(nome: string, fn: () => void) {
  try {
    fn();
    passou++;
    console.log(`ok    ${nome}`);
  } catch (e: any) {
    falhou++;
    console.log(`FALHA ${nome}\n      ${(e?.message || e).toString().split("\n").join("\n      ")}`);
  }
}

function assertEquals(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n   esperado: ${e}\n   obtido:   ${a}`);
}

function assertTrue(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

test("alias de sandbox sao reconhecidos", () => {
  for (const v of ["sandbox", "SANDBOX", " Sandbox ", "test", "staging", "homolog", "dev"]) {
    assertEquals(normalizarAmbiente(v), "sandbox", `valor: ${v}`);
  }
});

test("tudo que nao e sandbox cai em producao", () => {
  for (const v of ["production", "PROD", "producao", "qualquer-coisa", "", null, undefined, "0"]) {
    assertEquals(normalizarAmbiente(v), "production", `valor: ${v}`);
  }
});

test("vazio herda o padrao (producao)", () => {
  assertEquals(AMBIENTE_DEFAULT, "production", "padrao");
  assertEquals(normalizarAmbiente(undefined), AMBIENTE_DEFAULT, "herda o padrao");
});

test("getAmbiente le o toggle do banco", () => {
  assertEquals(getAmbiente({ [AMBIENTE_KEY]: "sandbox" }), "sandbox", "toggle sandbox");
  assertEquals(getAmbiente({ [AMBIENTE_KEY]: "production" }), "production", "toggle producao");
});

test("getAmbiente sem configuracao assume producao", () => {
  assertEquals(getAmbiente({}), "production", "sem nada");
  assertEquals(getAmbiente(null), "production", "null");
  assertEquals(getAmbiente(undefined), "production", "undefined");
});

test("ehSandbox e o atalho booleano", () => {
  assertTrue(ehSandbox({ [AMBIENTE_KEY]: "sandbox" }), "deveria ser sandbox");
  assertTrue(!ehSandbox({ [AMBIENTE_KEY]: "production" }), "deveria ser producao");
  assertTrue(!ehSandbox({}), "vazio = producao");
});

test("rotulo para a tela do admin", () => {
  assertEquals(ambienteLabel("sandbox"), "Sandbox (teste)", "rotulo sandbox");
  assertEquals(ambienteLabel("production"), "Produção", "rotulo producao");
});

/* ────────────────────────────────────────────────────────────────────────────
   APPID POR AMBIENTE

   A Woovi tem duas contas: a de teste e a real. O AppID de uma é recusado
   pela outra com 401 "appID inválido" — e esse erro não diz qual dos dois
   estava errado. Aqui mora a regra que impede a confusão.
   ──────────────────────────────────────────────────────────────────────────── */

const APPID_SANDBOX = "Q2xpZW50X0lkX3NhbmRib3h";
const APPID_PRODUCTION = "Q2xpZW50X0lkX3Byb2R1Y3Rpb24=";

test("sandbox usa o AppID do sandbox", () => {
  assertEquals(
    appIdDoAmbiente({ [WOOVI_APP_ID_SANDBOX_KEY]: APPID_SANDBOX }, "sandbox"),
    APPID_SANDBOX,
    "AppID do sandbox",
  );
});

test("sandbox cai na chave legada quando a nova está vazia", () => {
  // `woovi_app_id` guardava historicamente o AppID de TESTE.
  assertEquals(
    appIdDoAmbiente({ woovi_app_id: APPID_SANDBOX }, "sandbox"),
    APPID_SANDBOX,
    "reserva na chave legada",
  );
});

test("produção usa SÓ o AppID de produção (sem reserva)", () => {
  assertEquals(
    appIdDoAmbiente({ [WOOVI_APP_ID_PRODUCTION_KEY]: APPID_PRODUCTION }, "production"),
    APPID_PRODUCTION,
    "AppID de produção",
  );
  // O AppID do sandbox NÃO pode vazar para a produção: é o que causava o
  // 401 "appID inválido" (e, pior, poderia cobrar na conta errada).
  assertEquals(
    appIdDoAmbiente({ woovi_app_id: APPID_SANDBOX }, "production"),
    "",
    "a legada (sandbox) NÃO vale em produção",
  );
  assertEquals(
    appIdDoAmbiente(
      { [WOOVI_APP_ID_SANDBOX_KEY]: APPID_SANDBOX, woovi_app_id: APPID_SANDBOX },
      "production",
    ),
    "",
    "o AppID do sandbox NÃO vale em produção",
  );
});

test("a URL segue o ambiente, nunca o AppID", () => {
  const sandbox = getWooviConfig({
    [AMBIENTE_KEY]: "sandbox",
    [WOOVI_APP_ID_SANDBOX_KEY]: APPID_SANDBOX,
    [WOOVI_APP_ID_PRODUCTION_KEY]: APPID_PRODUCTION,
  });
  assertEquals(sandbox.baseUrl, WOOVI_SANDBOX, "URL do sandbox");
  assertEquals(sandbox.appId, APPID_SANDBOX, "AppID do sandbox");
  assertEquals(sandbox.env, "sandbox", "ambiente");

  const producao = getWooviConfig({
    [AMBIENTE_KEY]: "production",
    [WOOVI_APP_ID_SANDBOX_KEY]: APPID_SANDBOX,
    [WOOVI_APP_ID_PRODUCTION_KEY]: APPID_PRODUCTION,
  });
  assertEquals(producao.baseUrl, WOOVI_PROD, "URL de produção");
  assertEquals(producao.appId, APPID_PRODUCTION, "AppID de produção");
  assertEquals(producao.env, "production", "ambiente");
});

test("sem AppID do ambiente, a config sai vazia (o chamador mostra o erro)", () => {
  const cfg = getWooviConfig({ [AMBIENTE_KEY]: "production" });
  assertEquals(cfg.appId, "", "AppID vazio");
  assertTrue(cfg.baseUrl === WOOVI_PROD, "a URL ainda é a de produção");
});

test("a mensagem de erro diz o ambiente e onde resolver", () => {
  const prod = erroAppIdAusente("production");
  assertTrue(/produção/i.test(prod), `deve citar produção: ${prod}`);
  assertTrue(/AppID de Produção/i.test(prod), `deve citar o campo: ${prod}`);
  assertTrue(/Admin/.test(prod), `deve dizer onde resolver: ${prod}`);

  const sandbox = erroAppIdAusente("sandbox");
  assertTrue(/sandbox/i.test(sandbox), `deve citar sandbox: ${sandbox}`);
  assertTrue(/AppID do Sandbox/i.test(sandbox), `deve citar o campo: ${sandbox}`);
});

test("normalizarAppId arruma o 'Client_id_' minusculo", () => {
  // Base64 de "Client_id_abc:segredo" -> precisa virar "Client_Id_abc:segredo".
  const errado = Buffer.from("Client_id_abc:segredo", "utf8").toString("base64");
  const certo = Buffer.from("Client_Id_abc:segredo", "utf8").toString("base64");
  assertEquals(normalizarAppId(errado), certo, "Client_id_ -> Client_Id_");
  // Uma credencial que já vem certa passa intocada.
  assertEquals(normalizarAppId(certo), certo, "já correta");
  // O que não é base64 volta como veio (não quebra a chamada).
  assertEquals(normalizarAppId("nao-e-base64"), "nao-e-base64", "texto solto");
  assertEquals(normalizarAppId(""), "", "vazio");
});

console.log(`\n${passou} passou | ${falhou} falhou`);
if (falhou > 0) process.exit(1);
