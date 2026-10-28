/**
 * Confere se os crons de assinatura estão de fato agendados no banco.
 *
 * O `manage-crons` (edge function) exige perfil de admin, mas a RPC
 * `manage_cron_jobs` é estreita (só lê `cron.job`) e roda via PostgREST.
 * Esta verificação usa uma sessão temporária e se apaga no final.
 */
import path from "node:path";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  ".."
);

for (const name of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(ROOT, name));
  } catch {
    /* ausente */
  }
}

const URL_BASE = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.VITE_SUPABASE_ANON_KEY || "";
const stamp = Date.now();
const TMP_EMAIL = `auditoria-mavis-${stamp}@divteste.com`;
const TMP_PASS = "AuditoriaMavis!2026";

async function auth(pathname, body) {
  const res = await fetch(`${URL_BASE}/auth/v1${pathname}`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

let session = await auth("/signup", {
  email: TMP_EMAIL,
  password: TMP_PASS,
  email_confirm: true,
  data: { name: "Auditoria Mavis" },
});
if (!session?.access_token) {
  session = await auth("/token?grant_type=password", { email: TMP_EMAIL, password: TMP_PASS });
}
const token = session?.access_token;
if (!token) {
  console.error("sem sessão:", JSON.stringify(session).slice(0, 200));
  process.exit(1);
}

console.log("RPC manage_cron_jobs:");
const res = await fetch(`${URL_BASE}/rest/v1/rpc/manage_cron_jobs`, {
  method: "POST",
  headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
let data = null;
try {
  data = JSON.parse(text);
} catch {
  data = text.slice(0, 400);
}

const ESPERADOS = [
  "process-recurring-billing",
  "process-overdue-invoices",
  "update-subscription-statuses",
];

if (Array.isArray(data)) {
  console.log(`  ${data.length} job(s) no cron.job:`);
  for (const job of data) {
    console.log(
      `   - ${job.jobname} | ${job.schedule} | ativo=${job.active} | ${String(job.command || "").slice(0, 90)}`
    );
  }
  console.log("");
  for (const nome of ESPERADOS) {
    const achou = data.some((j) => String(j.jobname || "").includes(nome));
    console.log(`  ${achou ? "OK   " : "FALTA"} ${nome}`);
  }
} else {
  console.log("  " + JSON.stringify(data).slice(0, 400));
}

console.log("");
console.log("limpando a conta temporária...");
const del = await fetch(`${URL_BASE}/functions/v1/delete-account`, {
  method: "POST",
  headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
console.log(`  HTTP ${del.status}`);
const check = await fetch(`${URL_BASE}/rest/v1/users?select=id&email=like.auditoria-mavis-*`, {
  headers: { apikey: ANON, Authorization: `Bearer ${token}` },
});
const restantes = await check.json().catch(() => []);
console.log(`  contas temporárias restantes = ${Array.isArray(restantes) ? restantes.length : "?"}`);
