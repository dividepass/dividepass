/**
 * QA DA INTEGRAÇÃO PULSE CODING (produção)
 * =========================================
 *
 * Confere, de ponta a ponta, se a revenda está de pé:
 *
 *   1. a função `pulse-admin` responde;
 *   2. a chave da Pulse é aceita (ping) e o saldo aparece;
 *   3. o catálogo local está populado;
 *   4. a sincronização em DRY RUN diz o que ela criaria (sem gravar nada).
 *
 * COMO USA
 * --------
 *   node scripts/qa-pulse-sync.mjs          # só o relatório
 *   node scripts/qa-pulse-sync.mjs --real   # sincroniza de verdade
 *
 * PERMISSOES
 * ----------
 * A ação `sync` é de ADMIN. O script usa a conta QA (`scripts/lib/conta-qa.mjs`)
 * — que hoje NÃO é admin — e avisa se for o caso, em vez de falhar calado.
 * Para rodar a sincronização de verdade, logue com uma conta admin.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSessaoQa } from "./lib/conta-qa.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const real = process.argv.includes("--real");

const C = {
  ok: "\x1b[32m", fail: "\x1b[31m", warn: "\x1b[33m",
  dim: "\x1b[90m", bold: "\x1b[1m", fim: "\x1b[0m",
};

function linha(rotulo, valor, cor = "") {
  console.log(`  ${rotulo.padEnd(24)} ${cor}${valor}${C.fim}`);
}

async function acionar(sessao, action, extra = {}) {
  const r = await fetch(`${sessao.url}/functions/v1/pulse-admin`, {
    method: "POST",
    headers: {
      apikey: sessao.anon,
      Authorization: `Bearer ${sessao.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...extra }),
  });
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
}

async function main() {
  console.log(`\n${C.bold}QA — INTEGRAÇÃO PULSE CODING${C.fim}\n`);

  const sessao = await getSessaoQa();

  // A sessão é de admin? (o sync exige)
  let ehAdmin = false;
  try {
    const token = fs.readFileSync(path.join(ROOT, ".supabase_token"), "utf8").trim();
    const r = await fetch("https://api.supabase.com/v1/projects/lasoouwboxspstqvjbsv/database/query", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `select role from public.users where id = (select id from auth.users where email = '${sessao.email}')`,
      }),
    });
    const j = await r.json().catch(() => []);
    ehAdmin = j?.[0]?.role === "admin";
  } catch {
    /* sem PAT: segue sem conferir */
  }

  const ping = await acionar(sessao, "ping");
  if (ping.status === 403) {
    linha("sessão", "sem permissão de admin", C.warn);
    console.log(
      `\n  ${C.dim}A conta QA não é admin — por isso as ações de painel são recusadas.\n` +
      `  Isso é o comportamento correto (só admin sincroniza o catálogo).\n` +
      `  Para o relatório completo, rode logado com uma conta admin.${C.fim}\n`,
    );
    process.exit(1);
  }
  linha("função pulse-admin", `${ping.status} ${ping.corpo?.ok ? "respondeu" : "falhou"}`, ping.corpo?.ok ? C.ok : C.fail);

  if (ping.corpo?.resultado?.ok) {
    linha("ping na Pulse", `ok (API ${ping.corpo.resultado.api_version})`, C.ok);
    linha("conta revenda", ping.corpo.resultado.reseller_email || "—");
  }

  const saldo = await acionar(sessao, "balance");
  const disponivel = Number(saldo.corpo?.saldo?.available_for_orders ?? 0);
  linha("saldo disponível", `R$ ${disponivel.toFixed(2)}`, disponivel > 0 ? C.ok : C.warn);
  if (disponivel <= 0) {
    console.log(`  ${C.warn}Sem saldo: nenhum pedido real sai até recarregar na Pulse.${C.fim}`);
  }

  const cat = await acionar(sessao, "packages");
  const linhas = cat.corpo?.pacotes?.length ?? 0;
  const visiveis = (cat.corpo?.pacotes || []).filter((p) => p.visible).length;
  linha("catálogo no painel", `${linhas} pacotes (${visiveis} na vitrine)`, linhas ? C.ok : C.warn);

  if (!ehAdmin) {
    console.log(`\n  ${C.dim}Sem permissão de admin: o sync (dry_run e real) não foi exercitado.${C.fim}\n`);
    return;
  }

  const sim = await acionar(sessao, "sync", { dry_run: true });
  const rel = sim.corpo?.relatorio || {};
  console.log(`\n${C.bold}Sincronização (dry run)${C.fim}`);
  linha("total na Pulse", rel.total ?? "—");
  linha("na vitrine", rel.criados ?? "—", C.ok);
  linha("indisponíveis", rel.indisponiveis ?? "—", C.warn);
  linha("ignorados (Serviços)", rel.ignorados ?? "—");
  linha("erros", rel.erros ?? "—", rel.erros ? C.fail : C.ok);
  linha("plataformas novas", rel.plataformas_criadas ?? "—");
  linha("sem margem", rel.sem_margem ?? "—", rel.sem_margem ? C.warn : C.ok);

  for (const e of (rel.detalhes || []).filter((d) => d.acao === "erro").slice(0, 8)) {
    console.log(`  ${C.fail}ERRO${C.fim} ${e.title} — ${e.motivo}`);
  }

  if (real) {
    const r2 = await acionar(sessao, "sync", {});
    const rel2 = r2.corpo?.relatorio || {};
    console.log(`\n${C.bold}Sincronização (real)${C.fim}`);
    linha("criados", rel2.criados ?? "—", C.ok);
    linha("atualizados", rel2.atualizados ?? "—");
    linha("indisponíveis", rel2.indisponiveis ?? "—");
    linha("ignorados", rel2.ignorados ?? "—");
    linha("erros", rel2.erros ?? "—", rel2.erros ? C.fail : C.ok);
    for (const e of (rel2.detalhes || []).filter((d) => d.acao === "erro").slice(0, 8)) {
      console.log(`  ${C.fail}ERRO${C.fim} ${e.title} — ${e.motivo}`);
    }
  } else {
    console.log(`\n  ${C.dim}Rodar com --real para sincronizar de verdade.${C.fim}`);
  }
  console.log("");
}

main().catch((e) => {
  console.error(`\n${C.fail}${e.message}${C.fim}\n`);
  process.exit(1);
});
