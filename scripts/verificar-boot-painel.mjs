/**
 * Confere se um arquivo empacotado SOBE — o mesmo teste que o runtime do
 * Supabase faz ao iniciar a edge function.
 *
 * POR QUE UM SCRIPT À PARTE (e não dentro do validador)
 * ------------------------------------------------------
 * O teste de carga precisa rodar o DENO como processo separado (o
 * `import()` do arquivo empacotado é o que o runtime faz). Rodar isso
 * dentro do validador tornaria a validação lenta e frágil.
 *
 * O QUE ELE COMPARA
 * -----------------
 * Carregar o módulo e importar são coisas diferentes:
 *
 *   - IMPORTAR → SyntaxError (ou "Identifier already declared") quando o
 *     arquivo não compila. A função NÃO sobe → Supabase responde
 *     503 BOOT_ERROR → o navegador mostra "Failed to fetch" (o 503 não vem
 *     com header de CORS) e o cliente não descobre o que houve.
 *
 *   - CARREGAR → erro de TIPO. O runtime ignora (o tipo é apagado), então a
 *     função sobe normalmente. Erro de tipo NÃO derruba a cobrança.
 *
 * Por isso este script separa os dois e só reprova no primeiro caso.
 *
 * USO
 * ---
 *   node scripts/verificar-boot-painel.mjs               (todos)
 *   node scripts/verificar-boot-painel.mjs create-payment (um só)
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const exec = promisify(execFile);

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIR = path.join(ROOT, ".tmp-verify", "painel");
const RUNNER = path.join(ROOT, ".tmp-verify", "runner-boot-painel.mjs");

const args = process.argv.slice(2);
const alvos = args.length
  ? args
  : fs.readdirSync(DIR).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""));

fs.mkdirSync(path.dirname(RUNNER), { recursive: true });

function escreverRunner(arquivo) {
  const runner = `
const alvo = ${JSON.stringify(pathToFileURL(path.resolve(arquivo)).href)};
try {
  const mod = await import(alvo);
  const temDefault = typeof mod.default !== "undefined" && mod.default !== null;
  console.log("__RESULTADO__OK" + (temDefault ? ":com-default" : ":sem-default"));
} catch (e) {
  console.log("__RESULTADO__ERRO:" + e.name + ": " + e.message);
}
`;
  fs.writeFileSync(RUNNER, runner, "utf8");
}

let falhas = 0;
const relatar = (ok, msg) => {
  if (!ok) falhas++;
  console.log(`${ok ? "OK   " : "FALHA"} ${msg}`);
};

for (const nome of alvos) {
  const arquivo = path.join(DIR, `${nome}.ts`);
  if (!fs.existsSync(arquivo)) {
    console.log(`FALHA ${nome}: pacote ausente`);
    falhas++;
    continue;
  }
  escreverRunner(arquivo);
  try {
    const { stdout, stderr } = await exec(
      "npx",
      ["-y", "deno", "run", "--allow-net", "--allow-env", "--allow-read", RUNNER],
      { maxBuffer: 16 * 1024 * 1024, timeout: 240000, shell: true },
    );
    const m = `${stdout}\n${stderr}`.match(/__RESULTADO__([^\n]*)/);
    if (!m) {
      relatar(false, `${nome}: sem resultado do teste de boot`);
      continue;
    }
    const resultado = m[1];
    if (resultado.startsWith("OK")) {
      const comDefault = resultado.endsWith(":com-default");
      relatar(
        comDefault,
        `${nome}: sobe${comDefault ? " e exporta default" : " (sem export default)"}`
      );
    } else {
      relatar(false, `${nome}: NAO SOBE -> ${resultado.slice(4).trim()}`);
    }
  } catch (e) {
    relatar(false, `${nome}: falha ao rodar o teste -> ${String(e.message).slice(0, 200)}`);
  }
}

console.log(
  falhas === 0
    ? `\nTODOS OS ${alvos.length} PACOTES SOBEM.`
    : `\n${falhas} PACOTE(S) COM PROBLEMA.`,
);
process.exit(falhas === 0 ? 0 : 1);
