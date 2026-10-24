/**
 * scripts/verify-advisor.mjs
 *
 * Verificacao da correcao do Security Advisor do Supabase (2026-10-24).
 *
 * Contexto:
 *   - 8 views do schema public rodavam como SECURITY DEFINER (owner postgres)
 *     e burlavam o RLS. Medido em producao com a chave anon: a view
 *     `v_user_active_services` devolvia login_email + login_password das
 *     contas compartilhadas dos grupos.
 *   - `credit_wallet` tinha DUAS overloads (5 e 6 params). O PostgREST
 *     respondia PGRST203 (ambiguidade) no "marcar saque como pago" do painel
 *     admin, e a overload antiga permitia que `anon` creditasse saldo em
 *     qualquer wallet via /rest/v1/rpc/credit_wallet.
 *
 * Uso:
 *   node scripts/verify-advisor.mjs
 *
 * Cria uma conta de teste descartavel e remove no final (mesmo padrao do
 * verify-p0.mjs). Nao deixa residuo.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;
const anonHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const results = [];
function check(id, title, ok, detail = "") {
  results.push({ id, title, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${title}${detail ? `  — ${detail}` : ""}`);
}

async function rest(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: anonHeaders });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data, text };
}

async function restAuth(path, opts = {}, token) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data, text };
}

// As 8 views acusadas pelo advisor (lint 0010 security_definer_view).
const VIEWS = [
  "v_group_spots",
  "v_admin_financial_summary",
  "v_user_active_services",
  "survey_stats",
  "survey_platform_options",
  "v_billing_today",
  "v_billing_calendar",
  "v_billing_failures",
];

// ---------------------------------------------------------------------------
// Sessao de teste
// ---------------------------------------------------------------------------
const anon = createClient(SUPABASE_URL, KEY);
const email = `verify-advisor-${Date.now()}@divteste.com`;
const password = "Teste12345!";

const { data: signUp, error: signUpErr } = await anon.auth.signUp({ email, password });
if (signUpErr) {
  console.error("Falha ao criar conta de teste:", signUpErr.message);
  process.exit(1);
}
const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
const userToken = signIn.session.access_token;
const userId = signIn.user.id;

console.log(`\nDividePass — verificacao do Advisor  (${new Date().toISOString()})\n`);
console.log(`conta de teste: ${email}\n`);

// ---------------------------------------------------------------------------
// A1-A8 — views: anonimo nao pode ler
// ---------------------------------------------------------------------------
for (const v of VIEWS) {
  const r = await rest(`${v}?select=*&limit=1`);
  check("A1", `view ${v}: anonimo bloqueado`, r.status === 401 || r.status === 403, `HTTP ${r.status}`);
}

// ---------------------------------------------------------------------------
// B1 — credit_wallet via RPC como anonimo: bloqueado E sem PGRST203
// ---------------------------------------------------------------------------
{
  const r = await rest("rpc/credit_wallet", {
    method: "POST",
    body: JSON.stringify({
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_amount: 999999,
      p_description: "tentativa anon",
      p_reference_type: "teste",
      p_reference_id: "00000000-0000-0000-0000-000000000000",
    }),
  });
  const semPgrst203 = !r.text.includes("PGRST203");
  const bloqueado = r.status >= 400;
  check("B1", "credit_wallet: anonimo bloqueado e sem ambiguidade (PGRST203)",
    bloqueado && semPgrst203, `HTTP ${r.status} ${r.text.slice(0, 90)}`);
}

// ---------------------------------------------------------------------------
// B2/B3 — credit_wallet como autenticado NAO-admin: a funcao e alcancavel
// (prova que a overload ambigua foi removida) mas o corpo barra o chamador.
// ---------------------------------------------------------------------------
for (const [id, payload] of [
  ["B2", {
    p_user_id: userId,
    p_amount: 1,
    p_description: "teste advisor 5 params",
    p_reference_type: "teste",
    p_reference_id: "00000000-0000-0000-0000-000000000000",
  }],
  ["B3", {
    p_user_id: userId,
    p_amount: 1,
    p_description: "teste advisor 6 params",
    p_reference_type: "teste",
    p_reference_id: "00000000-0000-0000-0000-000000000000",
    p_group_id: null,
  }],
]) {
  const r = await restAuth("rpc/credit_wallet", { method: "POST", body: JSON.stringify(payload) }, userToken);
  const semPgrst203 = !r.text.includes("PGRST203");
  const barrado = /somente service_role ou admin/i.test(r.text);
  check(id, `credit_wallet (${Object.keys(payload).length} params): nao-admin barrado e sem PGRST203`,
    semPgrst203 && barrado, `HTTP ${r.status} ${r.text.slice(0, 110)}`);
}

// ---------------------------------------------------------------------------
// C1 — ensure_my_referral_code continua funcionando para o usuario logado
// ---------------------------------------------------------------------------
{
  const r = await restAuth("rpc/ensure_my_referral_code", { method: "POST", body: "{}" }, userToken);
  check("C1", "ensure_my_referral_code: autenticado continua funcionando",
    r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 60)}`);
}

// ---------------------------------------------------------------------------
// D1 — admin_get_user_private: barrado para quem nao e admin
// ---------------------------------------------------------------------------
{
  const r = await restAuth("rpc/admin_get_user_private", {
    method: "POST", body: JSON.stringify({ p_user_id: userId }),
  }, userToken);
  const vazio = r.status === 200 && (r.data === null || (Array.isArray(r.data) && r.data.length === 0));
  check("D1", "admin_get_user_private: nao-admin nao ve dados privados",
    r.status >= 400 || vazio, `HTTP ${r.status} ${r.text.slice(0, 90)}`);
}

// ---------------------------------------------------------------------------
// E1 — create_testimonial: nao aceita p_user_id de terceiro
// ---------------------------------------------------------------------------
{
  const r = await restAuth("rpc/create_testimonial", {
    method: "POST",
    body: JSON.stringify({
      p_user_id: "11111111-1111-1111-1111-111111111111",
      p_user_name: "Fulano",
      p_user_role: "user",
      p_text: "teste indevido",
      p_rating: 5,
    }),
  }, userToken);
  check("E1", "create_testimonial: recusa p_user_id de terceiro",
    r.status >= 400 && /forbidden|not authenticated/i.test(r.text), `HTTP ${r.status} ${r.text.slice(0, 90)}`);
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
