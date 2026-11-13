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
  // A integração da Woovi (Pix Automático) é o gateway de PIX recorrente:
  // a webhook confirma o pagamento do ciclo e o polling é a rede de
  // segurança. As DUAS precisam entrar na esteira de validação/publicação
  // — fora dela, elas ficavam com o código antigo no ar (foi assim que o
  // cliente pagou e o sistema não confirmou).
  "check-woovi-tx",
  "woovi-webhook",
  "confirm-payment",
  "force-confirm-payment",
  "create-payment",
  "mercado-pago-webhook",
  // Tier 2 — prazo de 12h da entrada (rodada de 09/11/2026: não estorna nem
  // cancela quem tem assinatura paga e vigente)
  "check-entrance-deadline",
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
  // Tier 3 — gateway legado ainda no ar (rodada de 09/11/2026: o cancelamento
  // no gateway não encerra o acesso de quem tem período pago pela frente)
  "mercado-pago-webhook",
  "mercado-pago-create-subscription",
  // Tier 3 — revenda Pulse Coding (rodada de 06/11/2026)
  "pulse-admin",
  "pulse-entrega",
  "pulse-webhook",
  "pulse-poll",
  // Rodada de 13/11/2026: sincronização de STATUS dos grupos com a Pulse
  // (cron de 5 em 5 horas — "Na vitrine" libera, "Indisponível" desativa).
  "pulse-status",
  // Suporte (rodada de 10/11/2026): admin entra na conta do cliente sem a
  // senha dele. A função não tem import local — o empacotador só a embrulha
  // para que ela entre na mesma esteira de validação e publicação.
  "admin-impersonate",
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
        // A UNION pode continuar na linha seguinte:
        //   export type CouponResult =
        //     | { ok: true; ... }
        //     | { ok: false; error: string };
        // Se o declaration termina no primeiro `}`, o resto fica no corpo e
        // o bundle sai sintaticamente quebrado ("Expected ',', got ';'").
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        if (src[j] === "|" || src[j] === "&") {
          // União/intersecção continua: segue varrendo sem fechar aqui.
          sawBrace = false;
          continue;
        }
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

  // ── Import DINÂMICO ────────────────────────────────────────────────────
  //
  // `const mod = await import("./handlers/woovi.ts")` vira, no arquivo
  // empacotado, `const mod = m_create_payment_handlers_woovi;`.
  //
  // ONDE ESSA LINHA FICA
  // --------------------
  // No LUGAR original — dentro do bloco onde o import estava — e NÃO no topo
  // do arquivo.
  //
  // Por que isso importa: no `create-payment` os seis handlers são importados
  // dinamicamente, cada um dentro do seu `case` do `switch`:
  //
  //     switch (gateway) {
  //       case "stripe": { const mod = await import("./handlers/stripe.ts"); ... }
  //       case "woovi":   { const mod = await import("./handlers/woovi.ts");   ... }
  //     }
  //
  // Içando os seis para o topo do arquivo produzia `const mod` repetido no
  // MESMO escopo — "Cannot redeclare block-scoped variable 'mod'" (SyntaxError
  // de verdade em JS) — e, pior, o `switch` passaria a usar sempre o ÚLTIMO
  // handler: o pagamento de PIX cairia no handler do Mercado Pago.
  //
  // Cada `case` tem o seu próprio bloco, então mantê-los no lugar original
  // dá um escopo por handler — que é exatamente o que o fonte tem.
  //
  // A troca é feita em duas etapas porque o nome do namespace (`m_*`) só é
  // conhecido depois: aqui a linha vira um MARCADOR, e o empacotador troca
  // o marcador pela linha final.
  corpo = corpo.replace(RE_DINAMICO, (_achado, nomes, mod) => {
    const linha = `const ${nomes.replace(/\s+/g, " ").trim()} = await import("${mod}");`;
    if (/^https?:\/\//.test(mod)) {
      externos.push(linha);
      return "";
    }
    const marcador = `__IMPORT_DINAMICO_${dinâmicos.length}__`;
    dinâmicos.push({ nomes: nomes.trim(), mod, linha, marcador });
    return marcador;
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
  // ── `export default async function X()` / `export default function X()` ──
  //
  // O nome exportado é o PRÓPRIO nome da função. Como o namespace do módulo
  // vira um objeto, o export precisa ser `default: nomeDaFuncao` — e NÃO o
  // atalho `{ default }`.
  //
  // POR QUE O ATALHO QUEBRA O DEPLOY
  // ---------------------------------
  // `default` é palavra reservada em JavaScript. O atalho de propriedade
  // `{ default }` é um SyntaxError ("Unexpected token 'default'"), então o
  // arquivo empacotado NÃO COMPILA — a edge function morre no BOOT e o
  // Supabase responde 503 BOOT_ERROR.
  //
  // E o 503 NÃO vem com header de CORS: o navegador bloqueia a resposta e o
  // front mostra "Failed to fetch" (sem mensagem de gateway nenhuma).
  //
  // Foi exatamente o que aconteceu com `create-payment` em 09/11/2026: o
  // empacotador gerava `return { default, handleWoovi };` nos seis handlers
  // de gateway, a função não subia, e o PIX do cliente parou de funcionar.
  //
  // Antes, o nome ficava em `exportsValor` como `default` E o nome da
  // função — mas o `default` solto é justamente o atalho inválido.
  corpo = corpo.replace(/__EXPORT_DEFAULT__\s+async\s+function\s+([A-Za-z0-9_$]+)/g, (l, nome) => {
    exportsValor.push(`default: ${nome}`);
    exportsValor.push(nome);
    return `async function ${nome}`;
  });
  corpo = corpo.replace(/__EXPORT_DEFAULT__\s+function\s+([A-Za-z0-9_$]+)/g, (l, nome) => {
    exportsValor.push(`default: ${nome}`);
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

  // ── `export { A, B }` (reexport de valor) ────────────────────────────────
  //
  // O empacotado vira uma IIFE por módulo: um `export` NO CORPO do módulo é
  // inválido ("'import', and 'export' cannot be used outside of module
  // code") e o deploy caía com HTTP 400.
  //
  // Exemplo real que quebrou o deploy de 09/11/2026:
  //   `export { DAY_MS };` no fim de `_shared/subscription-dates.ts`
  //
  // A forma é removida do corpo e os nomes entram na lista de exports de
  // valor do módulo (é assim que quem importa `{ DAY_MS }` continua
  // recebendo o valor).
  corpo = corpo.replace(
    /^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$/gm,
    (l, lista) => {
      for (const bruto of lista.split(",")) {
        const nome = bruto.trim();
        if (!nome) continue;
        // `export { A as B }` — o nome EXPORTADO é B, o local é A.
        const partes = nome.split(/\s+as\s+/);
        const local = partes[0].trim();
        const exportado = (partes[1] || partes[0]).trim();
        if (!exportado) continue;
        if (exportado.startsWith("type ")) {
          exportsTipo.push(exportado.slice(5).trim());
        } else {
          exportsValor.push(exportado === local ? exportado : `${exportado}: ${local}`);
        }
      }
      return "";
    },
  );

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

  // `import type { Foo } from "./x.ts"` — import só de TIPOS.
  //
  // O tipo não existe em runtime: o `type` já foi içado para o topo do
  // arquivo empacotado (ver `analisar`), então aqui não deve nascer NENHUM
  // vínculo. Sem esta guarda o empacotado saía com
  // `const type { Foo } = m_x;` — sintaxe inválida e o deploy caía com
  // "Expected a semicolon".
  if (/^type\s/.test(nomes)) return "";

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
      // `import { createCharge as apiCreateCharge }` — o "as" é sintaxe de
      // IMPORT do TypeScript. No destructuring gerado o apelido é com ":".
      // Sem esta troca o bundle saía com `const { x as y } = m_mod;` e o
      // deploy caía com "Expected ',', got 'as'".
      .map((s) => s.replace(/\s+as\s+/, ": "))
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
      // Import dinâmico fica no LUGAR original (dentro do módulo), para não
      // repetir `const <mesmo nome>` no escopo do módulo. Ver `analisar()`.
      if (d.dinamico) continue;
      const tiposAlvo = visitados.get(d.abs)?.info?.exportsTipo || [];
      const linha = linhaVinculo(d, "  ", tiposAlvo);
      if (linha) partes.push(linha);
    }
    if (deps.length) partes.push("");
    // imports dinâmicos: marcador -> referência ao namespace, no lugar
    let corpoModulo = info.corpo;
    for (const d of deps) {
      if (!d.dinamico) continue;
      corpoModulo = corpoModulo.replace(d.marcador, linhaVinculo(d, "  "));
    }
    partes.push(corpoModulo.trim());
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
    // Import DINÂMICO não vira linha no topo: ele é trocado no lugar onde
    // estava (dentro do bloco do `case`), para cada `const mod` ficar no
    // escopo do seu handler. Ver a nota em `analisar()`.
    if (d.dinamico) continue;
    partes.push(linhaVinculo(d, ""));
  }
  // imports dinâmicos viram referência ao namespace, NO LUGAR ORIGINAL
  let corpoEntry = entry.info.corpo;
  for (const d of entry.deps) {
    if (!d.dinamico) continue;
    corpoEntry = corpoEntry.replace(d.marcador, linhaVinculo(d, ""));
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
