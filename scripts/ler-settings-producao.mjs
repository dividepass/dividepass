/**
 * Le as app_settings de PRODUCAO (inclusive as que o anon nao ve).
 *
 * A mesma tecnica de `scripts/apagar-contas-automacao.mjs`: varre o repo
 * (e pastas irmas) em busca de um JWT com `role = service_role` e testa se
 * ainda vale.
 *
 *   node scripts/ler-settings-producao.mjs [filtro]
 *
 * Com filtro, mostra so as chaves que casam. Sem filtro, mostra todas
 * (valores sensiveis mascarados).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = {};
for (const nome of [".env.local", ".env"]) {
  try {
    for (const l of fs.readFileSync(path.join(ROOT, nome), "utf8").split(/\r?\n/)) {
      const m = l.match(/^\s*([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim();
    }
  } catch {
    /* ausente */
  }
}
const URL_BASE = env.VITE_SUPABASE_URL;
if (!URL_BASE) {
  console.error("VITE_SUPABASE_URL nao encontrada");
  process.exit(1);
}

function serviceRoleCandidates() {
  const achados = new Set();
  const pastas = [ROOT, "C:\\Users\\GABRIEL\\Documents\\Bye", "C:\\Users\\GABRIEL\\Documents\\DotMidias"];
  for (const pasta of pastas) {
    let pilha;
    try {
      pilha = [pasta];
    } catch {
      continue;
    }
    while (pilha.length) {
      const dir = pilha.pop();
      let entradas;
      try {
        entradas = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entradas) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) pilha.push(p);
        else if (/\.(env|txt|json|mjs|cjs|js|mjs)$|^\.env/.test(e.name)) {
          let txt;
          try {
            txt = fs.readFileSync(p, "utf8");
          } catch {
            continue;
          }
          if (!txt.includes("service_role")) continue;
          for (const m of txt.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
            try {
              const payload = JSON.parse(Buffer.from(m[0].split(".")[1], "base64url").toString("utf8"));
              if (payload.role === "service_role") achados.add(m[0]);
            } catch {
              /* nao e JWT */
            }
          }
        }
      }
    }
  }
  return [...achados];
}

async function acharServiceRole() {
  for (const jwt of serviceRoleCandidates()) {
    const res = await fetch(`${URL_BASE}/auth/v1/users?limit=1`, {
      headers: { apikey: jwt, Authorization: `Bearer ${jwt}` },
    });
    if (res.ok) return jwt;
  }
  return null;
}

const filtro = process.argv[2] || "";
const jwt = await acharServiceRole();

if (!jwt) {
  console.log("Nenhuma service_role valida encontrada no ambiente.");
  console.log("As app_settings de producao nao podem ser lidas por aqui.");
  process.exit(0);
}

console.log("service_role valida encontrada.\n");

const res = await fetch(`${URL_BASE}/rest/v1/app_settings?select=key,value&order=key`, {
  headers: { apikey: jwt, Authorization: `Bearer ${jwt}` },
});
const linhas = await res.json();

if (!Array.isArray(linhas)) {
  console.log("resposta:", JSON.stringify(linhas).slice(0, 300));
  process.exit(1);
}

const selecionadas = linhas.filter((l) => !filtro || l.key.toLowerCase().includes(filtro.toLowerCase()));
console.log(`total de settings: ${linhas.length} | exibindo: ${selecionadas.length}\n`);

for (const l of selecionadas) {
  const v = String(l.value ?? "");
  const sensivel = /secret|key|app_id|password|token/i.test(l.key);
  const mostrado = sensivel ? (v ? `${v.slice(0, 5)}…${v.slice(-3)} (${v.length} chars)` : "(vazio)") : v;
  console.log(`  ${l.key.padEnd(38)} = ${mostrado}`);
}

