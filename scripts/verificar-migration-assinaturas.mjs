/**
 * Confere no banco se a migração das regras de status foi aplicada.
 *
 * A coluna `renewal_due_at` é a fonte da verdade da regra. Se ela não
 * existir, o PostgREST devolve 42703 ("column does not exist") — é esse
 * erro que quebra as telas de assinatura quando o front sobe antes do SQL.
 *
 * O script cria uma sessão temporária, sonda a coluna, conta as assinaturas
 * visíveis e SE APAGA no final (mesmo caminho do audit-usuarios-producao).
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
if (!URL_BASE || !ANON) {
  console.error("Faltou VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

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

async function rest(pathname, token) {
  const res = await fetch(`${URL_BASE}/rest/v1/${pathname}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 300);
  }
  return { status: res.status, data };
}

const GRACE_DAYS = 7;

console.log("1) criando sessão temporária...");
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
  console.error("não consegui obter sessão:", JSON.stringify(session).slice(0, 300));
  process.exit(1);
}
const myId = session?.user?.id || "";
console.log(`   ok (${TMP_EMAIL})`);
console.log("");

// 2) A coluna existe?
console.log("2) sondando a coluna `renewal_due_at`...");
const probe = await rest(
  "user_subscriptions?select=id,status,renewal_due_at,next_charge_at,expires_at&limit=200",
  token
);

if (probe.status === 400 && /column|42703/i.test(JSON.stringify(probe.data))) {
  console.error("   FALHOU: a coluna `renewal_due_at` NÃO existe (42703).");
  console.error("   Rode `database/subscription-status-rules.sql` ANTES de subir o front.");
} else if (!probe.status || probe.status >= 400) {
  console.error(`   HTTP ${probe.status}: ${JSON.stringify(probe.data).slice(0, 300)}`);
} else {
  console.log("   OK: a coluna existe (sem 42703).");
  console.log("");

  const rows = Array.isArray(probe.data) ? probe.data : [];
  console.log(`3) assinaturas visíveis por esta sessão: ${rows.length}`);
  if (rows.length) {
    const agora = Date.now();
    const dia = 86400000;
    const prazo = (r) => {
      const raw = r.renewal_due_at || r.next_charge_at || r.expires_at;
      if (!raw) return null;
      const t = new Date(raw).getTime();
      return Number.isNaN(t) ? null : t;
    };
    const grupos = { ativas: 0, atrasadas: 0, canceladas: 0, pendentes: 0, sem_data: 0 };
    for (const r of rows) {
      if (r.status === "cancelled" || r.status === "inactive") { grupos.canceladas++; continue; }
      if (r.status === "pending") { grupos.pendentes++; continue; }
      const p = prazo(r);
      if (p === null) { grupos.sem_data++; continue; }
      if (p + GRACE_DAYS * dia < agora) grupos.canceladas++;
      else if (p < agora) grupos.atrasadas++;
      else grupos.ativas++;
    }
    console.log(`   ativas=${grupos.ativas} atrasadas=${grupos.atrasadas} canceladas=${grupos.canceladas} pendentes=${grupos.pendentes} sem_data=${grupos.sem_data}`);
    console.log("   (RLS pode mostrar só as linhas desta conta temporária)");
  }
  console.log("");
}

// 3) Índice da migração?
console.log("4) conferindo os índices criados...");
for (const idx of [
  "idx_user_subscriptions_renewal_due",
  "idx_user_subscriptions_active_next_charge",
  "idx_group_members_user_status",
  "idx_billing_cycles_subscription_status",
]) {
  console.log(`   ${idx}`);
}
console.log("   (confira no SQL Editor: SELECT indexname FROM pg_indexes WHERE tablename IN ('user_subscriptions','group_members','billing_cycles'))");
console.log("");

// 4) Auto-limpeza
console.log("5) removendo a conta temporária...");
const del = await fetch(`${URL_BASE}/functions/v1/delete-account`, {
  method: "POST",
  headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
const delText = await del.text();
console.log(`   HTTP ${del.status} ${delText.slice(0, 160)}`);

const check = await rest("users?select=id,email&email=like.auditoria-mavis-*", token);
const restantes = Array.isArray(check.data) ? check.data.length : "?";
console.log(`   conferência: contas temporárias restantes = ${restantes}`);
if (myId) console.log(`   (id desta sessão: ${myId})`);
