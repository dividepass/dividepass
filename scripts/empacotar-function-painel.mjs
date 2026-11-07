/**
 * Empacota uma edge function do DividePass em UM arquivo só, pronto para
 * colar no painel do Supabase (Edge Functions > Edit).
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O editor do painel do Supabase edita o entrypoint da função. Se a função
 * importa código de outra pasta (`../_shared/...`, `./handlers/...`), esse
 * código precisa viajar junto — e nem todo fluxo de deploy garante isso.
 * O empacotador resolve: embute cada módulo local dentro de uma função
 * (namespace) e reescreve as importações para apontar para o namespace.
 * O resultado é um arquivo único, sem dependência de pasta nenhuma.
 *
 * COMO USA
 * --------
 *   node scripts/empacotar-function-painel.mjs update-subscription-statuses
 *   node scripts/empacotar-function-painel.mjs --todas
 *
 * Saída em `.tmp-verify/painel/<nome-da-funcao>.ts` (pasta ignorada pelo git).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  ".."
);
const FN_DIR = path.join(ROOT, "supabase", "functions");
const OUT_DIR = path.join(ROOT, ".tmp-verify", "painel");

/** Funções que mudaram nesta rodada + as que embutem `confirm-payment`. */
const FUNCOES = [
  // Tier 0 — e-mail gerenciado do grupo com IA (rodada de 31/10/2026)
  "provision-group-mailbox",
  // Tier 0 — avisa a lista de espera quando abre vaga (rodada de 01/11/2026)
  "notify-service-watchers",
  // Tier 0 — gestão de e-mail (rodada de 27/10/2026, e-mail do cliente)
  "send-lifecycle-emails",
  "send-welcome-email",
  "manage-crons",
  // Tier 1 — a regra nova (ciclo de 7 dias, cancelar, desvincular)
  "update-subscription-statuses",
  "process-overdue-invoices",
  "process-recurring-billing",
  // Tier 2 — pagamento/renovação
  "check-iopay-tx",
  "confirm-payment",
  "force-confirm-payment",
  "create-payment",
  "mercado-pago-webhook",
  // Tier 2 — reconciliação: "paguei e não fui add ao grupo" (rodada de 01/11/2026)
  "reconcile-payments",
  // Tier 2 — exclusão de conta (a versão corrigida limpa platform_events e
  // group_interest antes do DELETE, senão o perfil fica órfão no banco)
  "delete-account",
  // Tier 3 — webhooks que embutem `confirm-payment/index.ts`
  "iopay-webhook",
  "asaas-webhook",
  "pagarme-webhook",
  "stripe-webhook",
];

/* ------------------------------------------------------------------ helpers */

const ler = (p) => fs.readFileSync(p, "utf8");

/** Nome do namespace de um módulo, a partir do caminho relativo a functions/. */
function slug(absPath) {
  const rel = path.relative(FN_DIR, absPath).replace(/\\/g, "/").replace(/\.ts$/, "");
  return "m_" + rel.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Resolve um import local ("./x.ts" ou "../_shared/x.ts"). */
function resolverLocal(fromFile, spec) {
  return path.resolve(path.dirname(fromFile), spec);
}

/**
 * Separa o arquivo em:
 *  - imports externos (URL) — ficam no topo do arquivo gerado
 *  - imports locais — viram namespace
 *  - corpo (sem os imports)
 *  - exports de valor / exports de tipo
 */
/**
 * Onde termina a declaração de um `type`/`interface` que começa em `inicio`.
 * (Precisa achar o fim porque o tipo pode ocupar várias linhas.)
 */
function fimDeclaracaoTipo(src, inicio) {
  let depth = 0;
  let sawBrace = false;
  for (let i = inicio; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      depth++;
      sawBrace = true;
    } else if (ch === "}") {
      depth--;
      if (depth <= 0 && sawBrace) {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        if (src[j] === ";") j++;
        return j;
      }
    } else if (ch === ";" && depth === 0) {
      return i + 1;
    }
  }
  return src.length;
}

function analisar(absPath) {
  const src = ler(absPath);
  const externos = [];
  const locais = [];
  const dinâmicos = [];
  const exportsValor = [];
  const exportsTipo = [];
  const tipos = [];
  let corpo = src;

  // ── Tipos (type/interface) ───────────────────────────────────────────────
  // No arquivo empacotado cada módulo vira uma IIFE. Um `export type X`
  // ficaria preso dentro dela e quem o importa (`import { type X }`) ficaria
  // com "Cannot find name 'X'" — ERRO DE TIPO no deploy. Por isso os tipos
  // são tirados do corpo e emitidos no TOPO do arquivo, onde todos os
  // módulos enxergam.
  const RE_TIPO = /^[ \t]*export\s+(type|interface)\s+([A-Za-z0-9_$]+)/gm;
  let t;
  while ((t = RE_TIPO.exec(corpo)) !== null) {
    const fim = fimDeclaracaoTipo(corpo, t.index);
    const texto = corpo.slice(t.index, fim).trim();
    corpo = corpo.slice(0, t.index) + corpo.slice(fim);
    tipos.push({ nome: t[2], texto: texto.replace(/^export\s+/, "") });
    exportsTipo.push(t[2]);
    RE_TIPO.lastIndex = t.index;
  }

  // O import estático pode ocupar VARIAS LINHAS (é o formato padrão do
  // TypeScript quando há mais de um símbolo):
  //
  //   import {
  //     sendUserEmail,
  //     loadEmailSettings,
  //   } from "./user-emails.ts";
  //
  // Por isso a varredura é feita sobre o texto inteiro, e não linha a linha —
  // um import multi-linha que escapa da varredura vira
  // `from "./x.ts"` pendente no arquivo empacotado (e o validador acusa).
  const RE_ESTATICO =
    /^[ \t]*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?[ \t]*$/gm;

  const RE_DINAMICO =
    /^[ \t]*(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z0-9_$]+)\s*=\s*await\s+import\(["']([^"']+)["']\);?[ \t]*$/gm;

  corpo = corpo.replace(RE_ESTATICO, (_achado, nomes, mod) => {
    const linha = `import ${nomes.replace(/\s+/g, " ").trim()} from "${mod}";`;
    if (/^https?:\/\//.test(mod)) {
      externos.push(linha);
    } else {
      locais.push({ nomes: nomes.trim(), mod, linha });
    }
    return "";
  });

  corpo = corpo.replace(RE_DINAMICO, (_achado, nomes, mod) => {
    const linha = `const ${nomes.replace(/\s+/g, " ").trim()} = await import("${mod}");`;
    if (/^https?:\/\//.test(mod)) {
      externos.push(linha);
    } else {
      dinâmicos.push({ nomes: nomes.trim(), mod, linha });
    }
    return "";
  });

  // exports
  corpo = corpo.replace(/^[ \t]*export\s+default\s+/gm, "__EXPORT_DEFAULT__ ");
  corpo = corpo.replace(/^[ \t]*export\s+(type|interface)\s+([A-Za-z0-9_$]+)/gm, (l, tipo, nome) => {
    exportsTipo.push(nome);
    return `${tipo} ${nome}`;
  });
  corpo = corpo.replace(
    /^[ \t]*export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z0-9_$]+)/gm,
    (l, kind, nome) => {
      exportsValor.push(nome);
      return `${kind} ${nome}`;
    }
  );
  corpo = corpo.replace(/__EXPORT_DEFAULT__\s+async\s+function\s+([A-Za-z0-9_$]+)/g, (l, nome) => {
    exportsValor.push("default");
    exportsValor.push(nome);
    return `async function ${nome}`;
  });
  corpo = corpo.replace(/__EXPORT_DEFAULT__\s+function\s+([A-Za-z0-9_$]+)/g, (l, nome) => {
    exportsValor.push("default");
    exportsValor.push(nome);
    return `function ${nome}`;
  });
  corpo = corpo.replace(/__EXPORT_DEFAULT__\s+/g, (l) => {
    // `export default { ... }` ou `export default async (req) => ...`
    exportsValor.push("default");
    return "const __default__ = ";
  });
  // `export default {` virou `const __default__ = {` — devolve como default export.
  const temDefault = exportsValor.includes("default");
  if (temDefault) {
    corpo = corpo.replace(/const __default__ = /g, "export default ");
  }

  return { src, externos, locais, dinâmicos, exportsValor, exportsTipo, tipos, corpo };
}

/**
 * Como o import local vira linha de código no arquivo empacotado.
 *  - `import { a, b } from "./x.ts"`  ->  `const { a, b } = m_x;`
 *  - `const mod = await import("./x.ts")` -> `const mod = m_x;`
 *  - `const { a } = await import("./x.ts")` -> `const { a } = m_x;`
 */
function linhaVinculo(d, indent = "", tiposAlvo = []) {
  const nomes = d.nomes.trim();
  if (nomes.startsWith("{")) {
    // `import { type Foo, bar } from "./x.ts"` — o modificador `type` é de
    // TIPOS e não existe em runtime. Se ele for carried para o destructuring
    // gerado (`const { type Foo } = m_x;`), o arquivo empacotado fica com
    // sintaxe inválida para JavaScript puro (só o stripper de tipos do Deno
    // perdoa). Aqui cada especificador é limpo individualmente.
    //
    // E tipos nem entram no destructuring: eles foram içados para o topo do
    // arquivo, onde já estão no escopo de todos os módulos.
    const dentro = nomes
      .replace(/[{}]/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^type\s+/, "").trim())
      .filter(Boolean)
      .filter((s) => !tiposAlvo.includes(s.split(/\s+as\s+/)[0].trim()))
      .join(", ");
    if (!dentro.trim()) return "";
    return `${indent}const { ${dentro} } = ${slug(d.abs)};`;
  }
  return `${indent}const ${nomes} = ${slug(d.abs)};`;
}

/* --------------------------------------------------------------- empacotador */

function empacotar(nomeFuncao) {
  const entryAbs = path.join(FN_DIR, nomeFuncao, "index.ts");
  if (!fs.existsSync(entryAbs)) throw new Error(`função não encontrada: ${nomeFuncao}`);

  const visitados = new Map(); // absPath -> {mod, deps}
  const ordem = [];
  const externosVistos = new Set();

  function visitar(absPath, stack = []) {
    if (visitados.has(absPath)) return;
    if (stack.includes(absPath)) throw new Error(`import circular: ${stack.join(" -> ")}`);
    const info = analisar(absPath);
    const deps = [];

    for (const imp of info.locais) {
      const depAbs = resolverLocal(absPath, imp.mod);
      if (!fs.existsSync(depAbs)) throw new Error(`import não encontrado: ${imp.mod} (em ${absPath})`);
      visitar(depAbs, [...stack, absPath]);
      deps.push({ ...imp, abs: depAbs });
    }
    for (const imp of info.dinâmicos) {
      const depAbs = resolverLocal(absPath, imp.mod);
      if (!fs.existsSync(depAbs)) throw new Error(`import dinâmico não encontrado: ${imp.mod} (em ${absPath})`);
      visitar(depAbs, [...stack, absPath]);
      deps.push({ ...imp, abs: depAbs, dinamico: true });
    }
    for (const ext of info.externos) externosVistos.add(ext);

    visitados.set(absPath, { info, deps });
    ordem.push(absPath);
  }

  visitar(entryAbs);

  // --- monta o arquivo final -------------------------------------------
  const partes = [];
  partes.push("// ============================================================================");
  partes.push("// ARQUIVO ÚNICO — pronto para colar no painel do Supabase (Edge Functions > Edit).");
  partes.push("// Gerado por scripts/empacotar-function-painel.mjs — NÃO edite à mão.");
  partes.push(`// Função: ${nomeFuncao}`);
  partes.push("//");
  partes.push("// Cada módulo local foi embutido num namespace (m_*). Assim o arquivo não");
  partes.push("// depende de nenhuma pasta — funciona mesmo se o editor do painel for");
  partes.push("// de arquivo único.");
  partes.push("// ============================================================================");
  partes.push("");

  if (externosVistos.size) {
    partes.push(...externosVistos);
    partes.push("");
  }

  // ── Tipos no topo do arquivo ─────────────────────────────────────────────
  // Escopo de arquivo: assim todo módulo (que é uma IIFE) enxerga os tipos
  // declarados nos outros módulos — inclusive os importados via
  // `import { type X }`.
  const tiposTopo = [];
  const nomesTipo = new Set();
  for (const absPath of ordem) {
    const { info } = visitados.get(absPath);
    for (const t of info.tipos || []) {
      if (nomesTipo.has(t.nome)) {
        console.warn(`  ! tipo duplicado "${t.nome}" em ${absPath} — mantido o primeiro`);
        continue;
      }
      nomesTipo.add(t.nome);
      tiposTopo.push(t.texto);
    }
  }
  if (tiposTopo.length) {
    partes.push("// ── tipos (escopo do arquivo inteiro) " + "─".repeat(30));
    for (const t of tiposTopo) partes.push(t);
    partes.push("");
  }

  for (const absPath of ordem) {
    const { info, deps } = visitados.get(absPath);
    if (absPath === entryAbs) continue; // o entrypoint fica no fim, no topo do escopo
    const rel = path.relative(FN_DIR, absPath).replace(/\\/g, "/");
    partes.push(`// ── módulo: ${rel} ${"─".repeat(Math.max(0, 58 - rel.length))}`);
    partes.push(`const ${slug(absPath)} = (() => {`);
    for (const d of deps) {
      if (!d.nomes || !d.nomes.trim()) continue;
      const tiposAlvo = visitados.get(d.abs)?.info?.exportsTipo || [];
      const linha = linhaVinculo(d, "  ", tiposAlvo);
      if (linha) partes.push(linha);
    }
    if (deps.length) partes.push("");
    partes.push(info.corpo.trim());
    partes.push("");
    partes.push(`  return { ${[...new Set(info.exportsValor)].join(", ")} };`);
    partes.push(`})();`);
    partes.push("");
  }

  // entrypoint
  const entry = visitados.get(entryAbs);
  partes.push(`// ── entrypoint: ${nomeFuncao}/index.ts ${"─".repeat(Math.max(0, 30 - nomeFuncao.length))}`);
  for (const d of entry.deps) {
    if (!d.nomes || !d.nomes.trim()) continue;
    partes.push(linhaVinculo(d, ""));
  }
  // imports dinâmicos viram referência ao namespace
  let corpoEntry = entry.info.corpo;
  for (const d of entry.deps) {
    if (!d.dinamico) continue;
    corpoEntry = corpoEntry.replace(d.linha, linhaVinculo(d, ""));
  }
  partes.push(corpoEntry.trim());
  partes.push("");

  const conteudo = partes.join("\n");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${nomeFuncao}.ts`);
  fs.writeFileSync(out, conteudo, "utf8");
  return { out, bytes: Buffer.byteLength(conteudo, "utf8"), modulos: ordem.length };
}

/* -------------------------------------------------------------------- main */

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--todas") {
  const lista = FUNCOES;
  for (const nome of lista) {
    try {
      const r = empacotar(nome);
      console.log(`OK   ${nome.padEnd(30)} ${String(r.bytes).padStart(7)} bytes  (${r.modulos} módulo(s))`);
    } catch (e) {
      console.log(`ERRO ${nome.padEnd(30)} ${e.message}`);
    }
  }
} else {
  for (const nome of args) {
    const r = empacotar(nome);
    console.log(`OK   ${nome} -> ${r.out} (${r.bytes} bytes)`);
  }
}
