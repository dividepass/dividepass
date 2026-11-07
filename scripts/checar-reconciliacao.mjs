/**
 * CHECA A RECONCILIAÇÃO DE PAGAMENTOS NA MÃO.
 *
 * O job `reconcile-payments` roda a cada 15 minutos e LIBERA o acesso de quem
 * já pagou e não entrou no grupo. Ele não cobra ninguém: pergunta à IO Pay o
 * status de transações antigas e libera as que estão aprovadas.
 *
 * Enquanto o agendamento está pausado (ver `database/pausar-reconcile-payments.sql`),
 * este script roda a mesma coisa na mão — é o que o botão "Verificar Agora" do
 * painel admin faz por baixo.
 *
 *   node scripts\checar-reconciliacao.mjs
 *
 * O que ele mostra:
 *   - quantas tentativas ainda estão pendentes;
 *   - quantas foram liberadas agora;
 *   - o que continua travado (com o motivo) — para a equipe resolver à mão.
 */
import { consultarSql } from "./supabase-sql.mjs";

const REF = "lasoouwboxspstqvjbsv";
const URL_BASE = `https://${REF}.supabase.co`;

// ── O segredo do job (fica no app_settings) ────────────────────────────────
const segRows = await consultarSql(
  "select value from public.app_settings where key = 'reconcile_payments_cron_secret'",
);
const secret = segRows?.[0]?.value;
if (!secret) {
  console.error("Falta 'reconcile_payments_cron_secret' no app_settings.");
  process.exit(1);
}

// ── Estado ANTES ───────────────────────────────────────────────────────────
const antes = await consultarSql(
  `select count(*)::int as n
     from public.payment_attempts
    where gateway = 'iopay'
      and status not like 'reconciled_%'
      and status not in ('webhook_rejected','polled_failed','created')`,
);
console.log(`\nTentativas pendentes antes: ${antes?.[0]?.n ?? 0}`);

// ── Roda o job ─────────────────────────────────────────────────────────────
const resposta = await fetch(`${URL_BASE}/functions/v1/reconcile-payments`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
  body: JSON.stringify({ manual: true }),
});

if (!resposta.ok) {
  console.error(`O job respondeu HTTP ${resposta.status}: ${await resposta.text()}`);
  process.exit(1);
}

const r = await resposta.json();

console.log(`\n── Resultado ────────────────────────────────`);
console.log(`  examinadas          : ${r.examinadas}`);
console.log(`  aprovadas no gateway: ${r.aprovadas_no_gateway}`);
console.log(`  LIBERADAS agora     : ${r.confirmadas}`);
console.log(`  recusadas           : ${r.recusadas}`);
console.log(`  falharam            : ${r.falharam}`);
console.log(`  orfãs ignoradas     : ${r.orfas_ignoradas ?? 0}`);
console.log(`  já aplicadas        : ${r.ja_aplicadas}`);

const comErro = (r.detalhes || []).filter((d) => d.erro);
if (comErro.length) {
  console.log(`\n── O que continua travado (precisa da equipe) ──`);
  for (const d of comErro) {
    console.log(`  • ${d.erro}`);
    console.log(`    user=${d.user_id} group=${d.group_id} tx=${d.transaction_id}`);
  }
} else {
  console.log("\n  Nenhum caso travado.");
}

// ── O que ainda está esperando o gateway ───────────────────────────────────
const esperando = await consultarSql(
  `select amount, gateway_transaction_id, created_at
     from public.payment_attempts
    where gateway = 'iopay' and status = 'polled_pending'
    order by created_at desc
    limit 10`,
);

if (esperando?.length) {
  console.log(`\n── Pendentes no gateway (a IO Pay ainda não aprovou) ──`);
  for (const t of esperando) {
    console.log(
      `  R$ ${Number(t.amount).toFixed(2)}  tx=${t.gateway_transaction_id}  ${String(t.created_at).slice(0, 10)}`,
    );
  }
}

console.log();
