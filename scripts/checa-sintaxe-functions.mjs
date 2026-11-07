/**
 * Checagem de SINTAXE dos pacotes de edge function (TypeScript).
 *
 * Usa o `node --check` (Node 24 remove os tipos nativamente), então não
 * depende de TypeScript/esbuild instalados no projeto.
 *
 *   node scripts/checa-sintaxe-functions.mjs [nome-da-function ...]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);
const DIR = path.join(ROOT, ".tmp-verify", "painel");

if (!fs.existsSync(DIR)) {
  console.error("Pasta de pacotes não encontrada: " + DIR);
  console.error("Rode antes: node scripts/empacotar-function-painel.mjs");
  process.exit(1);
}

const alvos = process.argv.slice(2);
const arquivos = alvos.length
  ? alvos.map((n) => path.join(DIR, `${n}.ts`)).filter((p) => fs.existsSync(p))
  : fs.readdirSync(DIR).filter((f) => f.endsWith(".ts")).map((f) => path.join(DIR, f));

let falhas = 0;
for (const arquivo of arquivos) {
  try {
    execFileSync(process.execPath, ["--check", arquivo], { stdio: "pipe" });
    console.log(`OK    ${path.basename(arquivo)}`);
  } catch (e) {
    falhas++;
    console.log(`FALHA ${path.basename(arquivo)}`);
    const saida = (e.stderr || e.stdout || "").toString();
    console.log(saida.split("\n").slice(0, 6).join("\n"));
  }
}

console.log(
  `\n${falhas === 0 ? "Tudo OK" : `${falhas} arquivo(s) com erro de sintaxe`} (${arquivos.length} verificados)`,
);
process.exit(falhas === 0 ? 0 : 1);
