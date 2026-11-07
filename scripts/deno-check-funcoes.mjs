/**
 * Baseline de type-check das edge functions, com atribuição por arquivo.
 *
 * O `deno check` segue os imports, então um erro em `coupon.ts` aparece em
 * qualquer arquivo que o importe. Aqui cada erro é atribuído ao arquivo onde
 * ele ESTÁ, para dar para comparar "antes x depois" sem ambiguidade.
 *
 *   node scripts/deno-check-funcoes.mjs [arquivo.ts ...]
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DENO = process.env.DENO_BIN || "deno";
const BASE = path.join(ROOT, "supabase", "functions");

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

const args = process.argv.slice(2);
const files = args.length
  ? args.map((a) => path.resolve(a))
  : walk(BASE).sort();

let total = 0;
for (const f of files) {
  let out = "";
  try {
    // No Windows o binário do Deno é um .cmd — o execFileSync precisa de
    // `shell: true` para rodá-lo (sem isso ele só quebra e a saída vem vazia).
    execFileSync(DENO, ["check", "--node-modules-dir=none", f], {
      stdio: "pipe",
      shell: true,
    });
    continue; // sem erro
  } catch (e) {
    out = (e.stderr || e.stdout || "").toString();
  }

  // O Deno colore a saída com ANSI; sem remover, o caminho do arquivo não
  // casa com a regex.
  out = out.replace(/\x1b\[[0-9;]*m/g, "");

  // Percorre linha a linha: guarda o código do erro e atribui ao arquivo
  // apontado na linha "at file:///" seguinte.
  const porArquivo = new Map();
  let codigoAtual = null;
  for (const linha of out.split(/\r?\n/)) {
    const mCod = linha.match(/^(TS\d+)\b/) || linha.match(/\b(SyntaxError|TypeError|ReferenceError)\b/);
    if (mCod) {
      codigoAtual = mCod[1] || mCod[2];
      continue;
    }
    const mLoc = linha.match(/at file:\/\/\/.*\/supabase\/functions\/(.+?):\d+:\d+/);
    if (mLoc && codigoAtual) {
      const chave = mLoc[1].replace(/\\/g, "/");
      if (!porArquivo.has(chave)) porArquivo.set(chave, new Set());
      porArquivo.get(chave).add(codigoAtual);
      codigoAtual = null;
    }
  }

  if (porArquivo.size === 0) {
    console.log(`ERRO  ${path.relative(ROOT, f)} (sem localizacao)`);
    total++;
    continue;
  }

  for (const [arquivo, codigos] of porArquivo) {
    const lista = [...codigos].sort().join(", ");
    const marcado = arquivo === path.relative(BASE, f).replace(/\\/g, "/") ? "  <- alvo" : "";
    console.log(`${arquivo.padEnd(46)} ${lista}${marcado}`);
    total++;
  }
}

console.log(`\n${total} arquivo(s) com erro de tipo`);
