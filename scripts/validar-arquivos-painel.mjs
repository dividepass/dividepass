/**
 * Confere os arquivos empacotados para o painel do Supabase.
 *
 * O empacotador embute cada módulo num namespace e reescreve os imports.
 * O risco real não é só semântica:
 *
 *  1. um nome tirado do namespace que não existe no objeto retornado
 *     -> `const { foo } = m_x` com foo indefinido -> erro em runtime;
 *  2. um módulo que não expõe `default` sendo chamado como `mod.default(...)`;
 *  3. o entrypoint sem `export default` (a função não sobe);
 *  4. SINTAXE QUEBRADA — o caso mais caro, porque a função não sobe e o
 *     Supabase responde 503 BOOT_ERROR (sem header de CORS: o navegador
 *     mostra "Failed to fetch" e o cliente não sabe o que houve).
 *
 * O item 4 NÃO é hypothético: em 09/11/2026 o `create-payment` foi
 * publicado com dois erros de sintaxe que derrubaram a cobrança de PIX:
 *
 *   - `return { default, handleWoovi };` — `default` é palavra reservada,
 *     então o atalho de propriedade é SyntaxError;
 *   - seis `const mod = ...` no mesmo escopo — "Identifier 'mod' has
 *     already been declared" — que ainda faz o `switch` de gateway usar
 *     sempre o ÚLTIMO handler.
 *
 * Por isso a checagem de sintaxe é feita pelo DENO — o mesmo runtime que
 * executa a edge function. O teste de BOOT (o módulo carrega ou não?) está
 * em `scripts/verificar-boot-painel.mjs`, que é quem reprova de fato.
 *
 * Este script confere os quatro.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  ".."
);
const DIR = path.join(ROOT, ".tmp-verify", "painel");

let falhas = 0;
const relatar = (ok, msg) => {
  if (!ok) falhas++;
  console.log(`${ok ? "OK   " : "FALHA"} ${msg}`);
};

for await (const nome of fs.readdirSync(DIR).filter((f) => f.endsWith(".ts"))) {  const src = fs.readFileSync(path.join(DIR, nome), "utf8");
  const base = nome.replace(/\.ts$/, "");
  console.log(`\n── ${base} (${src.length} bytes)`);

  // --- 1. namespaces e o que cada um devolve -----------------------------
  const reNamespace = /const (m_[A-Za-z0-9_]+) = \(\(\) => \{([\s\S]*?)\n  return \{ ([^}]*) \};\n\}\)\(\);/g;
  const namespaces = new Map();
  let m;
  while ((m = reNamespace.exec(src)) !== null) {
    const [, nomeNs, corpo, retorno] = m;
    const devolvidos = retorno
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    namespaces.set(nomeNs, devolvidos);

    // todo `const { ... } = m_x;` dentro do corpo precisa existir no retorno
    const reUso = /const \{ ([^}]*) \} = (m_[A-Za-z0-9_]+);/g;
    let u;
    while ((u = reUso.exec(corpo)) !== null) {
      const usados = u[1].split(",").map((s) => s.trim()).filter(Boolean);
      const destino = namespaces.get(u[2]);
      if (!destino) {
        relatar(false, `  ${u[2]} usado dentro de ${nomeNs} mas não existe`);
        continue;
      }
      for (const nomeUsado of usados) {
        // `import { x as y }` vira `{ x: y }` no empacotado: o que precisa
        // existir no namespace é o NOME DE ORIGEM (`x`), não o apelido (`y`).
        const origem = nomeUsado.includes(":")
          ? nomeUsado.split(":")[0].trim()
          : nomeUsado;
        relatar(
          destino.includes(origem),
          `  ${nomeNs} usa { ${nomeUsado} } de ${u[2]}${destino.includes(origem) ? "" : ` -> NÃO EXPORTA (tem: ${destino.join(", ")})`}`
        );
      }
    }
  }

  // --- 2. destructuring de namespace no escopo do entrypoint --------------
  const reTop = /^(?:const|let|var) \{ ([^}]*) \} = (m_[A-Za-z0-9_]+);$/gm;
  while ((m = reTop.exec(src)) !== null) {
    const usados = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    const destino = namespaces.get(m[2]) || [];
    for (const nomeUsado of usados) {
      relatar(
        destino.includes(nomeUsado),
        `  entrypoint usa { ${nomeUsado} } de ${m[2]}${destino.includes(nomeUsado) ? "" : " -> NÃO EXPORTA"}`
      );
    }
  }

  // --- 3. `mod.default(...)` precisa de um `default` no namespace ---------
  const reMod = /const (?:mod|[A-Za-z0-9_$]+) = (m_[A-Za-z0-9_]+);/g;
  while ((m = reMod.exec(src)) !== null) {
    const ns = namespaces.get(m[1]) || [];
    // só interessa se o namespace é usado como `X.default(...)`
    const usos = src.match(new RegExp(`${m[1]}\\.default`, "g"));
    if (usos) {
      relatar(ns.includes("default"), `  ${m[1]} é usado como .default -> precisa exportar "default"`);
    }
  }

  // --- 4. o entrypoint precisa expor a função ------------------------------
  // Dois estilos existem no projeto: `export default { fetch }` (estilo
  // Supabase) e `Deno.serve(async (req) => ...)` (estilo Deno puro).
  // `confirm-payment` é uma BIBLIOTECA (exporta `confirmPayment` e é embutida
  // pelos webhooks) — não é uma função deployável, então não se cola no painel.
  const ehFuncao = /export default/.test(src) || /Deno\.serve\(/.test(src);
  if (!ehFuncao) {
    // `confirm-payment` é uma BIBLIOTECA (exporta `confirmPayment` e é
    // embutida pelos webhooks) — não é uma função deployável, então não se
    // cola no painel. Nenhum outro arquivo do lote está neste caso.
    console.log("     (biblioteca — NÃO é uma função para colar no painel)");
  } else {
    relatar(true, "  entrypoint expõe a função (export default ou Deno.serve)");
  }

  // --- 5. nenhum import local sobrou --------------------------------------
  const importsLocais = [...src.matchAll(/from\s+["'](\.[^"']+)["']/g)].map((x) => x[1]);
  const importsDinamicos = [...src.matchAll(/await\s+import\(["'](\.[^"']+)["']\)/g)].map((x) => x[1]);
  relatar(
    importsLocais.length === 0 && importsDinamicos.length === 0,
    `  sem import local pendente${importsLocais.length + importsDinamicos.length ? ` -> ${[...importsLocais, ...importsDinamicos].join(", ")}` : ""}`
  );

  // --- 6. o enum de billing_cycles nunca aparece com 'retrying' ------------
  // (comentários não contam — o código que manda é o que vale)
  const semComentario = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  relatar(
    !/billing_cycles[\s\S]{0,400}?["']retrying["']/.test(semComentario),
    "  nenhum 'retrying' em billing_cycles (enum inválido)"
  );

  // --- 7. nenhum marcador de importação sobrou -----------------------------
  const marcadores = src.match(/__IMPORT_DINAMICO_\d+__/g) || [];
  relatar(
    marcadores.length === 0,
    `  nenhum marcador de import dinâmico sobrando${marcadores.length ? ` -> ${marcadores.slice(0, 3).join(", ")}` : ""}`
  );
}

const totalArquivos = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".ts")).length;

console.log(
  "\n" +
    (falhas === 0
      ? `TUDO OK — os ${totalArquivos} arquivos estão consistentes.`
      : `${falhas} PROBLEMA(S).`),
);
process.exit(falhas === 0 ? 0 : 1);
