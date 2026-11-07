/**
 * Diagnostico: quais edge functions estao no ar agora?
 *
 *   node scripts/diagnostico-functions.mjs
 *
 * 404 = nao publicada | 401 = no ar, mas exige JWT (normal para quem nao
 * manda sessao) | 500 = no ar e QUEBRADA (aqui sim e problema).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = {};
for (const nome of [".env.local", ".env"]) {
  try {
    for (const linha of fs.readFileSync(path.join(ROOT, nome), "utf8").split(/\r?\n/)) {
      const m = linha.match(/^\s*([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim();
    }
  } catch {
    /* ausente */
  }
}

const URL_BASE = (env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.VITE_SUPABASE_ANON_KEY || "";

// Funcoes que importam create-payment/confirm-payment (que quebram juntas)
// + as novas da Woovi.
const ALVOS = [
  "create-payment",
  "confirm-payment",
  "check-iopay-tx",
  "iopay-webhook",
  "process-recurring-billing",
  "reconcile-payments",
  "force-confirm-payment",
  "woovi-webhook",
  "check-woovi-tx",
];

console.log(`projeto: ${URL_BASE}\n`);

for (const nome of ALVOS) {
  let status = 0;
  let body = "";
  try {
    const res = await fetch(`${URL_BASE}/functions/v1/${nome}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON },
      body: "{}",
    });
    status = res.status;
    body = (await res.text()).replace(/\s+/g, " ").slice(0, 110);
  } catch (e) {
    body = "erro: " + e.message;
  }

  let situacao;
  if (status === 404) situacao = "AUSENTE";
  else if (status === 401) situacao = "NO AR  ";
  else if (status >= 500) situacao = "QUEBRADA";
  else situacao = "NO AR  ";

  console.log(`${situacao}  ${nome.padEnd(26)} HTTP ${status}  ${body}`);
}

console.log(
  "\nAUSENTE = ainda nao publicada | NO AR = viva | QUEBRADA = no ar e com erro (5xx).",
);
