/**
 * Checagem de sintaxe de TODAS as edge functions do projeto.
 *
 * Por que este script existe
 * --------------------------
 * O `scripts/checa-sintaxe-functions.mjs` (do projeto) checa os PACOTES
 * empacotados em `.tmp-verify/painel/`, que ficam desatualizados enquanto o
 * código-fonte muda. Um arquivo pode estar quebrado no fonte e continuar
 * "OK" no pacote velho — foi exatamente o que aconteceu com o
 * `confirm-payment/index.ts`.
 *
 * Aqui o check roda direto no fonte, com o código de SAÍDA real do node
 * (sem pipeline no meio, que mascara o exit code).
 *
 *   node scripts/checa-sintaxe-funcoes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = path.join(ROOT, "supabase", "functions");

const arquivos = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith(".ts")) arquivos.push(p);
  }
}
walk(BASE);

let falhas = 0;
for (const arquivo of arquivos.sort()) {
  const rel = path.relative(ROOT, arquivo);
  try {
    execFileSync(process.execPath, ["--check", arquivo], { stdio: "pipe" });
    console.log(`OK    ${rel}`);
  } catch (e) {
    falhas++;
    const saida = (e.stderr || e.stdout || "").toString();
    console.log(`FALHA ${rel}`);
    console.log(
      saida
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, 4)
        .map((l) => "      " + l)
        .join("\n"),
    );
  }
}

console.log(
  `\n${falhas === 0 ? "Tudo OK" : `${falhas} arquivo(s) com erro de sintaxe`} (${arquivos.length} verificados)`,
);
process.exit(falhas === 0 ? 0 : 1);
