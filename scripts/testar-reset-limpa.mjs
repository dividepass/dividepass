/**
 * Testa o caminho de auto-exclusão via reset de senha:
 *   send-password-reset -> lê o token em password_resets -> confirm-password-reset
 *   -> sign in -> delete-account.
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
const ALVO = process.argv[2] || "tags.check.1793115331455@gmail.com";

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

// sessão de leitura
const boot = await auth("/signup", {
  body: {
    email: `reset-teste-${Date.now()}@divteste.com`,
    password: "ResetTeste!2026",
    email_confirm: true,
    data: { name: "Reset Teste" },
  },
});
const token = boot.data?.access_token;
console.log(`sessao de leitura: ${boot.status} | token=${token ? "sim" : "nao"}`);

// 1) Tenta ler password_resets
async function lerTokens(email) {
  const res = await fetch(
    `${URL_BASE}/rest/v1/password_resets?select=id,user_id,email,token,used,expires_at&email=eq.${encodeURIComponent(email)}&used=eq.false`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  );
  const txt = await res.text();
  if (!res.ok) return { erro: `HTTP ${res.status} ${txt.slice(0, 200)}` };
  return { linhas: JSON.parse(txt) };
}

console.log("1) ler password_resets antes:", JSON.stringify(await lerTokens(ALVO)).slice(0, 300));

// 2) dispara o reset
const reset = await auth("/functions/v1/send-password-reset", { body: { email: ALVO }, token });
console.log(`2) send-password-reset: HTTP ${reset.status} ${JSON.stringify(reset.data).slice(0, 200)}`);

// 3) relê o token
const depois = await lerTokens(ALVO);
console.log("3) ler password_resets depois:", JSON.stringify(depois).slice(0, 500));

// 4) se tiver token: troca a senha e apaga
if (depois.linhas?.length) {
  const tok = depois.linhas[0].token;
  const nova = "MavisLimpeza!2026";
  const conf = await auth("/functions/v1/confirm-password-reset", { body: { token: tok, newPassword: nova } });
  console.log(`4) confirm-password-reset: HTTP ${conf.status} ${JSON.stringify(conf.data).slice(0, 200)}`);

  if (conf.status === 200) {
    const si = await auth("/token?grant_type=password", { body: { email: ALVO, password: nova } });
    console.log(`5) sign in com a nova senha: ${si.status ? "ok" : "falhou"}`);
    if (si.data?.access_token) {
      const del = await auth("/functions/v1/delete-account", { body: {}, token: si.data.access_token });
      console.log(`6) delete-account: HTTP ${del.status} ${JSON.stringify(del.data).slice(0, 160)}`);
    }
  }
}

// limpeza da sessão temporária
if (boot.data?.user?.email) {
  const t = await auth("/token?grant_type=password", { body: { email: boot.data.user.email, password: "ResetTeste!2026" } });
  if (t.data?.access_token) {
    const del = await auth("/functions/v1/delete-account", { body: {}, token: t.data.access_token });
    console.log(`\nlimpeza da sessao temporaria: HTTP ${del.status}`);
  }
}
