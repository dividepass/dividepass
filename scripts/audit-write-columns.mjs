/**
 * Auditoria de colunas usadas nas escritas das Edge Functions.
 *
 * O PostgREST valida as colunas do payload: escrever uma coluna que não existe
 * na tabela devolve 400 (PGRST204) e a gravacao inteira e perdida. Este script
 * extrai as chaves de todo insert/upsert/update feito pelas functions e compara
 * com o schema real do Postgres.
 *
 * Uso: node scripts/audit-write-columns.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const FUNCS_DIR = 'supabase/functions';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (['.ts', '.js', '.tsx', '.jsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

/**
 * Remove comentarios do codigo, preservando literais de string.
 *
 * Sem isso, o texto depois de `//` vira "chave" do payload (ex.:
 * `amount: x, // IMPORTANTE: ...` produz a chave `IMPORTANTE`).
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const len = src.length;
  while (i < len) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < len) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        j++;
      }
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < len && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < len && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Extrai as chaves de topo do objeto literal que começa em `start`. */
function topLevelKeys(src, start) {
  const keys = [];
  let depth = 0;
  let i = start;
  const len = src.length;
  let keyStart = -1;
  let inStr = null;
  let sawKey = false;

  for (; i < len; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{' || c === '[' || c === '(') {
      depth++;
      if (depth === 1) { sawKey = false; keyStart = i + 1; }
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (depth === 1 && c === ':') {
      const raw = src.slice(keyStart, i);
      // Ternario dentro do valor (`x: cond ? a : b`) nao e chave: o "a"/"b"
      // depois do segundo ":" nao e coluna nenhuma.
      if (!raw.includes('?')) {
        const m = raw.match(/([A-Za-z_$][\w$]*)\s*$/);
        if (m) keys.push(m[1]);
      }
      sawKey = true;
      continue;
    }
    if (depth === 1 && (c === ',' || c === '\n')) {
      if (!sawKey) {
        const raw = src.slice(keyStart, i);
        const m = raw.match(/^\s*([A-Za-z_$][\w$]*)\s*$/);
        if (m) keys.push(m[1]);
      }
      keyStart = i + 1;
      sawKey = false;
    }
  }
  return keys;
}

const files = walk(FUNCS_DIR);
const usage = new Map(); // table -> Map(column -> Set(files))

const fromRe = /\.from\(\s*['"`]([a-z_]+)['"`]\s*\)/g;

for (const file of files) {
  const src = stripComments(readFileSync(file, 'utf8'));
  let m;
  fromRe.lastIndex = 0;
  while ((m = fromRe.exec(src)) !== null) {
    const table = m[1];
    // A escrita precisa estar ENCADEADA no .from(): entre o fim do from() e o
    // insert/upsert/update so pode existir espacos e pontos. Sem isso, um
    // .from('x').select(...) seria associado ao payload da proxima tabela.
    const after = src.slice(m.index + m[0].length);
    const chained = after.match(/^[\s.]*?\.(insert|upsert|update)\s*\(/);
    if (!chained) continue;
    const callStart = m.index + m[0].length + chained.index + chained[0].length;
    // O payload precisa ser um literal de objeto: `update(updates)` nao
    // permite saber as colunas por leitura (e o objeto literal mais proximo
    // seria de outra chamada, gerando falso positivo).
    const payloadStart = src.slice(callStart).match(/^\s*/)[0].length + callStart;
    if (src[payloadStart] !== '{') continue;
    const braceStart = payloadStart;
    if (braceStart - callStart > 200) continue;
    const keys = topLevelKeys(src, braceStart);
    if (!usage.has(table)) usage.set(table, new Map());
    const colMap = usage.get(table);
    for (const k of keys) {
      if (!colMap.has(k)) colMap.set(k, new Set());
      colMap.get(k).add(file);
    }
  }
}

// Schema real
const schemaRes = await fetch(process.env.SUPABASE_MGMT_URL, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json; charset=utf-8',
  },
  body: JSON.stringify({
    query: `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  }),
});
const schemaJson = await schemaRes.json();
const real = new Map();
for (const row of schemaJson) {
  if (!real.has(row.table_name)) real.set(row.table_name, new Set());
  real.get(row.table_name).add(row.column_name);
}

let problems = 0;
for (const [table, colMap] of [...usage.entries()].sort()) {
  const known = real.get(table);
  if (!known) {
    console.log(`\n[?] tabela "${table}" nao encontrada no schema public (ignorada)`);
    continue;
  }
  const missing = [...colMap.entries()].filter(([col]) => !known.has(col));
  if (!missing.length) continue;
  problems += missing.length;
  console.log(`\n[x] ${table}: ${missing.length} coluna(s) inexistente(s) usada(s) em escrita`);
  for (const [col, filesSet] of missing) {
    console.log(`      - ${col}  <-  ${[...filesSet].join(', ')}`);
  }
}

console.log(`\n=== ${problems} problema(s) encontrado(s) ===`);
