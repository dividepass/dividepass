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

console.log(`\n${passou} passou | ${falhou} falhou`);
if (falhou > 0) process.exit(1);
