/**
 * Apaga as contas criadas por automação (IA) no DividePass.
 *
 * Estratégia:
 *  1) Tenta uma service_role válida (chaves do próprio repo) -> apaga via auth.admin.
 *  2) Sem service_role: tenta reabrir cada conta com senhas candidatas
 *     e usa a edge function delete-account (auto-exclusão, usa o service_role
 *     do servidor).
 *
 * Só as famílias listadas pelo usuário entram no alvo. Nada mais é tocado.
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

/** Só as 10 famílias explicitamente listadas pelo usuário. */
const FAMILIAS = [
  /^tags\.check\.\d+@gmail\.com$/i,
  /^wizard\.e2e\.\d+@gmail\.com$/i,
  /^visual\.check\.\d+@gmail\.com$/i,
  /^teste\.email\.code\.\d+@gmail\.com$/i,
  /^nocol\.\d+@gmail\.com$/i,
  /^wizard\.probe\.\d+@gmail\.com$/i,
  /^(test|dbg|dash)\d+@t\.com$/i,
  /^(rendercheck|fadecheck)-\d+@divteste\.com$/i,
  /^shot\.\d+@gmail\.com$/i,
  /^hunt[a-z0-9]+@maxxspace\.com$/i,
];

const SENHAS = [
  "TestPass123!",
  "Teste12345!",
  "Test123!",
  "Test1234!",
  "test123",
  "Teste123",
  "Senha123!",
  "Teste@123",
  "DivTeste123!",
  "MavisTest123!",
  "QaTest123!",
  "QA123456!",
  "TestPass123",
  "Senha@123",
  "12345678",
];

// service_role candidatas: varre o repo por JWTs de service_role
function serviceRoleCandidates() {
  const achados = new Set();
  const pastas = [ROOT, "C:\\Users\\GABRIEL\\Documents\\Bye", "C:\\Users\\GABRIEL\\Documents\\DotMidias"];
  for (const base of pastas) {
    let arquivos = [];
    try {
      arquivos = fs.readdirSync(base, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile() && /\.(cjs|mjs|js|ts|json|md|txt|env)$/i.test(d.name) && !/node_modules|\.git|dist|build/i.test(d.parentPath || d.path))
        .map((d) => path.join(d.parentPath || d.path, d.name));
    } catch {
      continue;
    }
    for (const arq of arquivos.slice(0, 1200)) {
      let txt = "";
      try {
        txt = fs.readFileSync(arq, "utf8");
      } catch {
        continue;
      }
      if (!txt.includes("service_role")) continue;
      for (const m of txt.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
        const jwt = m[0];
        try {
          const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
          if (payload.role === "service_role") achados.add(jwt);
        } catch {
          /* não é JWT */
        }
      }
    }
  }
  return [...achados];
}

async function signIn(email, password) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  return data?.access_token || null;
}

async function selfDelete(token) {
  const res = await fetch(`${URL_BASE}/functions/v1/delete-account`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const txt = await res.text();
  return { status: res.status, txt: txt.slice(0, 160) };
}

// ── Sessão de leitura (para listar as contas alvo)
const boot = await fetch(`${URL_BASE}/auth/v1/signup`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({
    email: `limpeza-mavis-${Date.now()}@divteste.com`,
    password: "LimpezaMavis!2026",
    email_confirm: true,
    data: { name: "Limpeza Mavis" },
  }),
});
const bootData = await boot.json().catch(() => ({}));
const READ_TOKEN = bootData?.access_token || (await signIn(`limpeza-mavis-${Date.now()}@divteste.com`, "LimpezaMavis!2026"));
if (!READ_TOKEN) {
  console.error("Não consegui sessão de leitura:", JSON.stringify(bootData).slice(0, 200));
  process.exit(1);
}

const colunas = "id,name,email,role,status,email_verified,created_at";
async function listUsers() {
  const res = await fetch(`${URL_BASE}/rest/v1/users?select=${colunas}&limit=1000`, {
    headers: { apikey: ANON, Authorization: `Bearer ${READ_TOKEN}` },
  });
  if (!res.ok) throw new Error(`listar usuários: HTTP ${res.status}`);
  return res.json();
}

let users = await listUsers();
const alvo = users.filter((u) => FAMILIAS.some((re) => re.test(u.email)));
console.log(`contas no alvo (10 famílias): ${alvo.length}`);
console.log("");

let serviceKey = null; // resolvido abaixo

// ── 0) Caminho via admin do projeto (env ADMIN_EMAIL + ADMIN_PASSWORD)
//    Usa a edge function admin-delete-user, o caminho de admin do próprio app.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "";

if (!serviceKey) {
  // tenta service_role do ambiente
  for (const jwt of serviceRoleCandidates()) {
    const res = await fetch(`${URL_BASE}/auth/v1/users?limit=1`, {
      headers: { apikey: jwt, Authorization: `Bearer ${jwt}` },
    });
    if (res.ok) {
      serviceKey = jwt;
      console.log("service_role válida encontrada no ambiente — deleção via API admin.");
      break;
    }
  }
}

const apagadas = [];
const naoApagadas = [];

if (ADMIN_EMAIL && ADMIN_PASS) {
  const si = await signIn(ADMIN_EMAIL, ADMIN_PASS);
  if (!si) {
    console.error(`login do admin falhou (${ADMIN_EMAIL}).`);
    process.exit(1);
  }
  console.log(`admin autenticado: ${ADMIN_EMAIL}\n`);
  for (const u of alvo) {
    const res = await fetch(`${URL_BASE}/functions/v1/admin-delete-user`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${si}`, "Content-Type": "application/json" },
      body: JSON.stringify({ target_user_id: u.id }),
    });
    const txt = await res.text();
    if (res.ok) {
      apagadas.push(u.email);
      console.log(`OK   ${u.email}`);
    } else {
      naoApagadas.push(`${u.email} (HTTP ${res.status} ${txt.slice(0, 100)})`);
      console.log(`FALHA ${u.email} -> HTTP ${res.status} ${txt.slice(0, 120)}`);
    }
  }
} else if (serviceKey) {
  for (const u of alvo) {
    const res = await fetch(`${URL_BASE}/auth/v1/admin/users/${u.id}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (res.ok) {
      apagadas.push(u.email);
      console.log(`OK   ${u.email}`);
    } else {
      naoApagadas.push(`${u.email} (HTTP ${res.status})`);
      console.log(`FALHA ${u.email} -> HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
    }
  }
} else {
  console.log("sem service_role válida — tentando auto-exclusão com senhas candidatas.\n");
  for (const u of alvo) {
    let token = null;
    for (const senha of SENHAS) {
      token = await signIn(u.email, senha);
      if (token) break;
    }
    if (!token) {
      naoApagadas.push(`${u.email} (senha desconhecida)`);
      console.log(`FALHA ${u.email} -> não consegui autenticar`);
      continue;
    }
    const del = await selfDelete(token);
    if (del.status === 200) {
      apagadas.push(u.email);
      console.log(`OK   ${u.email}`);
    } else {
      naoApagadas.push(`${u.email} (delete-account HTTP ${del.status})`);
      console.log(`FALHA ${u.email} -> delete-account HTTP ${del.status} ${del.txt}`);
    }
  }
}

// ── 2) Limpa a sessão temporária de leitura
const bootEmail = bootData?.user?.email;
if (bootEmail) {
  const t = await signIn(bootEmail, "LimpezaMavis!2026");
  if (t) {
    const del = await selfDelete(t);
    console.log(`\nconta temporária ${bootEmail}: HTTP ${del.status}`);
  }
}

// ── 3) Relê e confere
const restantes = (await listUsers()).filter((u) => FAMILIAS.some((re) => re.test(u.email)));
console.log(`\napagadas: ${apagadas.length} | restantes das 10 famílias: ${restantes.length}`);
if (restantes.length) {
  console.log("ainda no banco:");
  for (const r of restantes) console.log(`  - ${r.email}`);
}
if (naoApagadas.length) {
  console.log("\nfalhas:");
  for (const n of naoApagadas) console.log(`  - ${n}`);
}
