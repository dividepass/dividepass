/**
 * DividePass — verificacao pos-P0
 *
 * Roda depois de aplicar `database/fix-p0-security.sql` no SQL Editor.
 * Testa cada vulnerabilidade encontrada e imprime PASS/FAIL.
 *
 *   node scripts/verify-p0.mjs
 *
 * O script:
 *   1. le a chave anon de .env
 *   2. cria uma conta de teste descartavel
 *   3. roda as verificacoes
 *   4. remove a conta de teste
 *
 * Nao escreve nada em tabelas de negocio. A unica escrita e o registro da
 * conta de teste (e a remocao no final).
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const results = [];
function check(id, title, ok, detail = "") {
  results.push({ id, title, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${title}${detail ? `  — ${detail}` : ""}`);
}

async function rest(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data, text };
}

async function fn(name, body = {}, method = "POST", extraHeaders = {}) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...extraHeaders },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, text };
}

// ---------------------------------------------------------------------------
// Sessao de teste
// ---------------------------------------------------------------------------
const anon = createClient(SUPABASE_URL, KEY);
const email = `verify-p0-${Date.now()}@divteste.com`;
const password = "Teste12345!";

const { data: signUp, error: signUpErr } = await anon.auth.signUp({ email, password });
if (signUpErr) {
  console.error("Falha ao criar conta de teste:", signUpErr.message);
  process.exit(1);
}
const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
const userToken = signIn.session.access_token;
const userId = signIn.user.id;
const userHeaders = { apikey: KEY, Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" };

async function restAuth(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...userHeaders, ...(opts.headers || {}) },
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data, text };
}

console.log(`\nDividePass — verificacao P0  (${new Date().toISOString()})\n`);
console.log(`conta de teste: ${email}\n`);

// ---------------------------------------------------------------------------
// S1 — user_wallets: saldo fabricavel
// ---------------------------------------------------------------------------
{
  const ins = await restAuth("user_wallets", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, balance: 999999, total_earned: 999999 }),
  });
  check("S1", "user_wallets: INSERT por autenticado comum bloqueado",
    ins.status >= 400, `HTTP ${ins.status}`);

  const upd = await restAuth(`user_wallets?user_id=eq.${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ balance: 5000000 }),
  });
  check("S1", "user_wallets: UPDATE de saldo bloqueado",
    upd.status >= 400, `HTTP ${upd.status}`);
}

// ---------------------------------------------------------------------------
// S2 — password_resets: tokens legiveis por anonimo
// ---------------------------------------------------------------------------
{
  const r = await rest("password_resets?select=token,email&limit=1");
  const vazio = Array.isArray(r.data) && r.data.length === 0;
  check("S2", "password_resets: anonimo nao le tokens",
    vazio || r.status >= 400, `HTTP ${r.status} linhas=${Array.isArray(r.data) ? r.data.length : "-"}`);

  const ins = await rest("password_resets", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, email: "probe@invalid.local", token: "probe-token-verify", expires_at: "2030-01-01T00:00:00Z" }),
  });
  check("S2", "password_resets: INSERT anonimo bloqueado", ins.status >= 400, `HTTP ${ins.status}`);
}

// ---------------------------------------------------------------------------
// S3 — groups: dono se auto-aprova / vira oficial
// ---------------------------------------------------------------------------
{
  const svc = await rest("streaming_services?select=id&slug=eq.chatgpt&limit=1");
  const serviceId = svc.data?.[0]?.id;

  const created = await restAuth("groups", {
    method: "POST",
    headers: { ...userHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      service_id: serviceId, name: "VERIFY-P0", slug: `VP0${Date.now().toString(36).toUpperCase().slice(-4)}`,
      price_per_slot: 9.9, max_size: 3, status: "open", owner_id: userId,
    }),
  });
  const gid = created.data?.[0]?.id;

  if (!gid) {
    check("S3", "groups: auto-aprovacao bloqueada", false, `nao criou grupo (HTTP ${created.status})`);
  } else {
    const patch = await restAuth(`groups?id=eq.${gid}`, {
      method: "PATCH",
      body: JSON.stringify({ verified: true, is_official: true, approval_status: "approved" }),
    });
    check("S3", "groups: PATCH verified/is_official/approval_status bloqueado",
      patch.status >= 400, `HTTP ${patch.status}`);

    const state = await restAuth(`groups?id=eq.${gid}&select=verified,is_official,approval_status`, { headers: { ...userHeaders, Prefer: "return=representation" } });
    const row = Array.isArray(state.data) ? state.data[0] : null;
    check("S3", "groups: grupo continua NAO aprovado",
      !row || (row.verified === false && row.is_official === false && row.approval_status !== "approved"),
      JSON.stringify(row));

    await restAuth(`groups?id=eq.${gid}`, { method: "DELETE" });
  }
}

// ---------------------------------------------------------------------------
// S4 — senha IMAP dos grupos
// ---------------------------------------------------------------------------
{
  const g = await rest("groups?select=email_imap_password&limit=1");
  const semColuna = g.status === 400 && /does not exist|column/i.test(g.text);
  const semDados = Array.isArray(g.data) && g.data.length === 0;
  check("S4", "groups: coluna email_imap_password removida (ou inacessivel)",
    semColuna || semDados, `HTTP ${g.status}`);

  const mb = await rest("group_mailboxes?select=*&limit=1");
  const bloqueado = mb.status >= 400 || (Array.isArray(mb.data) && mb.data.length === 0);
  check("S4", "group_mailboxes: anonimo nao le a credencial IMAP", bloqueado, `HTTP ${mb.status}`);
}

// ---------------------------------------------------------------------------
// S6 / S7 / S9 — exposures anonimas
// ---------------------------------------------------------------------------
for (const [id, table, nota] of [
  ["S7", "payment_attempts", "leitura anonima"],
  ["S9", "coupons", "leitura anonima"],
  ["S9", "group_profiles", "leitura anonima"],
  ["S9", "support_messages", "leitura anonima"],
]) {
  const r = await rest(`${table}?select=*&limit=1`);
  const ok = r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0);
  check(id, `${table}: ${nota} bloqueada`, ok, `HTTP ${r.status}`);
}

{
  const r = await rest("custom_charges?select=created_by&limit=1");
  const ok = r.status >= 400 || (Array.isArray(r.data) && (r.data.length === 0 || r.data[0].created_by === undefined));
  check("S6", "custom_charges: created_by inacessivel ao anonimo", ok, `HTTP ${r.status}`);
}

// ---------------------------------------------------------------------------
// S8 — users: colunas sensiveis
// ---------------------------------------------------------------------------
{
  const r = await restAuth("users?select=id,email,cpf,customer_id_iopay&limit=1");
  const texto = JSON.stringify(r.data ?? r.text);
  const ok = r.status >= 400 || (!texto.includes("cpf") && !texto.includes("customer_id_iopay"));
  check("S8", "users: cpf e customer_id_* nao sao lidos por autenticado comum", ok, `HTTP ${r.status}`);

  const general = await restAuth("users?select=id,email,name&limit=5");
  check("S8", "users: colunas publicas continuam legiveis",
    general.status === 200 && Array.isArray(general.data), `HTTP ${general.status}`);
}

// ---------------------------------------------------------------------------
// S12 — edge functions sem autenticacao
// ---------------------------------------------------------------------------
{
  const semAuth = [
    "create-payment", "register-customers", "check-iopay-tx", "fetch-email-code",
    "create-custom-charge",
    "mercado-pago-create-subscription", "mercado-pago-verify-payment",
    "manage-survey", "resend-webhook",
  ];
  for (const name of semAuth) {
    const r = await fn(name, {});
    const barrado = r.status === 401 || r.status === 403;
    check("S12", `${name}: exige autenticacao`, barrado, `HTTP ${r.status} ${r.text.slice(0, 60)}`);
  }

  // Gateways que ASSINAM o webhook (Stripe/Asaas/Pagar.me): assinatura
  // invalida precisa ser rejeitada na hora.
  for (const name of ["asaas-webhook", "pagarme-webhook", "stripe-webhook"]) {
    const r = await fn(name, { reference_id: "forged:00000000-0000-0000-0000-000000000000:x" });
    const barrado = r.status === 400 || r.status === 401 || r.status === 403;
    check("S11", `${name}: webhook forjado rejeitado`, barrado, `HTTP ${r.status} ${r.text.slice(0, 60)}`);
  }

  // O IO Pay NAO assina webhook. A legitimidade vem de (a) a transacao
  // existir no proprio gateway e (b) ela ter sido criada por nos, o que so
  // se comprova com a linha em `payment_attempts` (service_role-only).
  // Por isso o assert correto nao e o status HTTP — a function responde 200
  // para nao provocar retry do gateway — e sim: NENHUM pagamento foi criado.
  {
    const antes = await restAuth(`payments?select=id&user_id=eq.${userId}`);
    const nAntes = Array.isArray(antes.data) ? antes.data.length : 0;

    await fn("iopay-webhook", {
      id: "forged-transaction-id-0000",
      type: "transaction_status",
      status: "succeeded",
      reference_id: `00000000-0000-0000-0000-000000000000:${userId}:subscription`,
    });

    const depois = await restAuth(`payments?select=id&user_id=eq.${userId}`);
    const nDepois = Array.isArray(depois.data) ? depois.data.length : 0;

    check("S11", "iopay-webhook: webhook forjado nao cria pagamento",
      nDepois === nAntes, `pagamentos do usuario ${nAntes} -> ${nDepois}`);
  }
}

// ---------------------------------------------------------------------------
// S12 — funcoes publicas por design (o reference_code E a autorizacao)
// ---------------------------------------------------------------------------
// `check-custom-charge` e `pay-custom-charge` atendem o checkout publico por
// link: a autorizacao e o proprio reference_code (token secreto gerado pelo
// admin), nao um JWT de usuario — exigir login a quem abriu o link de
// pagamento quebraria o checkout. O que precisa valer e:
//   1. o valor cobrado vem do banco (nunca do body);
//   2. um reference_code invalido nao revela nem cria nada.
{
  const r = await fn("check-custom-charge", { reference_code: `inexistente-p0-${Date.now()}` });
  const semDados = r.status >= 400 || !/"amount"\s*:\s*[0-9]/.test(r.text);
  check("S12", "check-custom-charge: reference_code invalido nao revela dados",
    semDados, `HTTP ${r.status} ${r.text.slice(0, 60)}`);

  const p = await fn("pay-custom-charge", { reference_code: `inexistente-p0-${Date.now()}`, payment_method: "pix" });
  check("S12", "pay-custom-charge: reference_code invalido nao cria cobranca",
    p.status >= 400, `HTTP ${p.status} ${p.text.slice(0, 60)}`);
}

// ---------------------------------------------------------------------------
// Limpeza
// ---------------------------------------------------------------------------
{
  const r = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  console.log(`\nlimpeza da conta de teste: HTTP ${r.status}`);
}

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n${"=".repeat(70)}`);
console.log(`RESULTADO: ${results.length - failed.length}/${results.length} PASS, ${failed.length} FAIL`);
if (failed.length) {
  console.log(`\nAinda falhando:`);
  failed.forEach((f) => console.log(`  - ${f.id} ${f.title} (${f.detail})`));
}
console.log("=".repeat(70));
process.exit(failed.length ? 1 : 0);
