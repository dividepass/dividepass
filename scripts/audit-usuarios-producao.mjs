/**
 * Lista os usuários de produção do DividePass e separa os que foram criados
 * pelos scripts de teste da IA (as "contas junk").
 *
 * Fluxo: cria uma sessão temporária -> lê public.users -> se auto-deleta
 * pela edge function delete-account (que usa o service_role do servidor).
 * Nada é alterado além da conta temporária, que é removida no final.
 */
import fs from "node:fs";
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
if (!URL_BASE || !ANON) {
  console.error("Faltou VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

const stamp = Date.now();
const TMP_EMAIL = `auditoria-mavis-${stamp}@divteste.com`;
const TMP_PASS = "AuditoriaMavis!2026";

/** Padrões de e-mail/nome usados por scripts e agentes de teste (IA). */
const JUNK_PATTERNS = [
  /^test-bot-\d+@test\.com$/i,
  /^test\d+@t\.com$/i,
  /^dbg\d+@t\.com$/i,
  /^dash\d+@t\.com$/i,
  /^cols\d+@t\.com$/i,
  /^debug-\d+@test\.com$/i,
  /^verify-p0-\d+@divteste\.com$/i,
  /^verify-advisor-\d+@divteste\.com$/i,
  /^rendercheck-\d+@divteste\.com$/i,
  /^fadecheck-\d+@divteste\.com$/i,
  /^teste\.email\.code\.\d+@gmail\.com$/i,
  /^visual\.check\.\d+@gmail\.com$/i,
  /^tags\.check\.\d+@gmail\.com$/i,
  /^wizard\.probe\.\d+@gmail\.com$/i,
  /^nocol\.\d+@gmail\.com$/i,
  /^hunt[a-z0-9]+@maxxspace\.com$/i,
  /^novo_\d+@/i,
  /@divteste\.com$/i,
  /^test@test\.com$/i,
  /^[A-Za-z0-9._%+-]+@\d+@t\.com$/i,
];

const isJunk = (email) => JUNK_PATTERNS.some((re) => re.test(String(email || "")));

async function auth(pathname, { method = "POST", body, token } = {}) {
  const res = await fetch(`${URL_BASE}/auth/v1${pathname}`, {
    method,
    headers: {
      apikey: ANON,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

// 1) Sessão temporária
let signUp = await auth("/signup", {
  body: { email: TMP_EMAIL, password: TMP_PASS, email_confirm: true, data: { name: "Auditoria Mavis" } },
});
if (!signUp.data?.access_token) {
  const signIn = await auth("/token?grant_type=password", {
    body: { email: TMP_EMAIL, password: TMP_PASS },
  });
  signUp = signIn;
}
const token = signUp.data?.access_token;
if (!token) {
  console.error("Não consegui obter sessão:", JSON.stringify(signUp.data).slice(0, 300));
  process.exit(1);
}
const myId = signUp.data?.user?.id || "";
console.log(`sessão temporária: ${TMP_EMAIL} (${myId})`);
console.log("");

// 2) Lista de usuários
// Só colunas com GRANT (o resto foi REVOKEd no fix-p0-security.sql).
const cols = [
  "id", "name", "email", "phone", "nickname", "role", "status", "email_verified",
  "onboarding_completed_at", "onboarding_step", "last_login_at", "created_at", "updated_at",
].join(",");
const res = await fetch(`${URL_BASE}/rest/v1/users?select=${cols}&limit=1000`, {
  headers: { apikey: ANON, Authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`GET /rest/v1/users -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const users = await res.json();

const junk = users.filter((u) => isJunk(u.email) && u.id !== myId);
const reais = users.filter((u) => !isJunk(u.email) && u.id !== myId);

// Vínculos visíveis com a chave anon (RLS pode esconder linhas de terceiros)
const vinculos = {};
for (const alvo of [
  { tabela: "group_members", coluna: "user_id" },
  { tabela: "payments", coluna: "user_id" },
  { tabela: "user_wallets", coluna: "user_id" },
]) {
  const ids = junk.map((u) => u.id);
  if (!ids.length) break;
  const q = ids.map((id) => `"${id}"`).join(",");
  const r = await fetch(`${URL_BASE}/rest/v1/${alvo.tabela}?select=${alvo.coluna}&${alvo.coluna}=in.(${q})`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    vinculos[alvo.tabela] = { erro: `HTTP ${r.status}` };
    continue;
  }
  const rows = await r.json();
  const contagem = {};
  for (const row of rows) contagem[row[alvo.coluna]] = (contagem[row[alvo.coluna]] || 0) + 1;
  vinculos[alvo.tabela] = { contagem };
}
const vinculoDe = (id) => {
  const partes = [];
  for (const [tabela, info] of Object.entries(vinculos)) {
    if (info.erro) continue;
    const n = info.contagem[id] || 0;
    if (n) partes.push(`${tabela}=${n}`);
  }
  return partes.length ? partes.join(" ") : "sem vínculo visível";
};

// CSV com a lista completa (entregável)
const csvPath = path.join(ROOT, "logs", "usuarios-producao.csv");
try {
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = ["id,nome,email,role,status,email_verified,criado_em,ultimo_login,classificacao,vinculos_visiveis"];
  for (const u of users) {
    if (/^(auditoria|limpeza)-mavis-/.test(String(u.email || ""))) continue;
    linhas.push([
      u.id, u.name, u.email, u.role, u.status, u.email_verified,
      u.created_at, u.last_login_at, isJunk(u.email) ? "script-ia (junk)" : "real",
      isJunk(u.email) ? vinculoDe(u.id) : "",
    ].map(esc).join(","));
  }
  fs.writeFileSync(csvPath, `${linhas.join("\n")}\n`, "utf8");
  console.log(`CSV gravado em: ${csvPath}`);
} catch (error) {
  console.error("falha ao gravar CSV:", error.message);
}
console.log(`vínculos (visíveis pela anon): ${JSON.stringify(vinculos).slice(0, 400)}`);

const fmt = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().replace("T", " ").slice(0, 16).replace("Z", " UTC");
};

console.log(`TOTAL de linhas em public.users: ${users.length}  (sessão temporária incluída)`);
console.log(`contas criadas por scripts da IA (junk): ${junk.length}`);
console.log(`contas reais: ${reais.length}`);
console.log("");
console.log("=== CONTAS CRIADAS PELOS SCRIPTS DA IA (junk) ===");
for (const u of junk.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
  console.log(`- ${u.email}`);
  console.log(`   id=${u.id} | nome="${u.name ?? ""}" | role=${u.role} | status=${u.status} | email_verified=${u.email_verified}`);
  console.log(`   criado em ${fmt(u.created_at)} | último login ${fmt(u.last_login_at)} | ${vinculoDe(u.id)}`);
}
console.log("");
console.log("=== CONTAS REAIS ===");
for (const u of reais.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
  console.log(`- ${u.email}`);
  console.log(`   id=${u.id} | nome="${u.name ?? ""}" | role=${u.role} | status=${u.status} | email_verified=${u.email_verified}`);
  console.log(`   criado em ${fmt(u.created_at)} | último login ${fmt(u.last_login_at)} | lead_source=${u.lead_source ?? "—"}`);
}

// 3) Auto-limpeza: remove a sessão temporária e qualquer auditoria anterior
const leftovers = users.filter((u) => String(u.email || "").startsWith("auditoria-mavis-"));
for (const u of leftovers) {
  if (u.id === myId) {
    const del = await fetch(`${URL_BASE}/functions/v1/delete-account`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const delText = await del.text();
  console.log("");
  console.log(`limpeza da conta temporária ${u.email}: HTTP ${del.status} ${delText.slice(0, 160)}`);
  continue;
  }
  const si = await auth("/token?grant_type=password", { body: { email: u.email, password: TMP_PASS } });
  if (!si.data?.access_token) {
    console.log(`limpeza: não consegui reabrir ${u.email} (HTTP ${si.status})`);
    continue;
  }
  const del = await fetch(`${URL_BASE}/functions/v1/delete-account`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${si.data.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const delText = await del.text();
  console.log("");
  console.log(`limpeza da conta temporária ${u.email}: HTTP ${del.status} ${delText.slice(0, 160)}`);
}

const check = await fetch(`${URL_BASE}/rest/v1/users?select=id,email&email=like.auditoria-mavis-*`, {
  headers: { apikey: ANON, Authorization: `Bearer ${token}` },
});
const restantes = await check.json().catch(() => []);
console.log(`conferência: linhas restantes com e-mail temporário = ${Array.isArray(restantes) ? restantes.length : "?"}`);
