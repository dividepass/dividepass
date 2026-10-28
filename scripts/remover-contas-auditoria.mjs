/**
 * Remove as contas temporárias de auditoria (auditoria-mavis-*@divteste.com)
 * criadas pela própria auditoria, usando a edge function delete-account.
 */
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
for (const name of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(ROOT, name));
  } catch {
    /* ausente */
  }
}

const URL_BASE = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.VITE_SUPABASE_ANON_KEY || "";
const PASS = "AuditoriaMavis!2026";

const emails = [
  "auditoria-mavis-1793115494468@divteste.com",
  "auditoria-mavis-1793115519153@divteste.com",
  "auditoria-mavis-1793115571090@divteste.com",
  "auditoria-mavis-1793115622466@divteste.com",
];

for (const email of emails) {
  const si = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const siData = await si.json().catch(() => ({}));
  if (!siData?.access_token) {
    console.log(`${email}: sem sessão (HTTP ${si.status}) — já removida ou senha diferente`);
    continue;
  }
  const token = siData.access_token;
  const del = await fetch(`${URL_BASE}/functions/v1/delete-account`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const delText = await del.text();
  console.log(`${email}: delete-account HTTP ${del.status} ${delText.slice(0, 200)}`);
}

// verificação
const si = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: emails[emails.length - 1], password: PASS }),
});
const siData = await si.json().catch(() => ({}));
if (siData?.access_token) {
  const check = await fetch(`${URL_BASE}/rest/v1/users?select=id,email&email=like.auditoria-mavis-*`, {
    headers: { apikey: ANON, Authorization: `Bearer ${siData.access_token}` },
  });
  const rows = await check.json().catch(() => null);
  console.log(`\nlinhas restantes com auditoria-mavis-*: ${Array.isArray(rows) ? rows.length : "?"}`);
  if (Array.isArray(rows)) for (const r of rows) console.log(`  - ${r.email} (${r.id})`);
} else {
  console.log("\nconta de verificação já não autentica (remoção concluída).");
}
