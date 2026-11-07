// Shared utility to get gateway credentials from app_settings

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let cachedSettings: Record<string, string> | null = null;
let cacheTime = 0;
const CACHE_TTL = 5_000; // 5 seconds

/**
 * Chaves que podem ser definidas por VARIÁVEL DE AMBIENTE, mesmo que não
 * existam na tabela `app_settings`.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O banco (`app_settings`) é a fonte de configuração de quem roda no
 * Supabase. Na VPS, o app vai rodar sem essa tabela (ou com outra): a
 * configuração vem do ambiente do processo.
 *
 * Com esta lista, as DUAS pontas leem a mesma chave — no banco ou no
 * ambiente — e o código não muda em nada. É o que permite ter a mesma
 * integração rodando em produção e em staging sem две versões do arquivo.
 *
 * A precedência é: BANCO primeiro, variável de ambiente como RESERVA. Assim
 * o painel do Admin continua mandando no app de produção, e a VPS (que não
 * tem essas linhas no banco) funciona só com env.
 */
const CHAVES_POR_AMBIENTE = [
  // Interruptor global de operação (produção x sandbox).
  "ambiente",
  // Gateway ativo.
  "active_gateway",
  // Woovi
  "woovi_app_id",
  // Woovi: AppID POR AMBIENTE (a conta de teste e a real são contas
  // diferentes na Woovi — o AppID de uma é recusado pela outra com 401).
  "woovi_app_id_sandbox",
  "woovi_app_id_production",
  "woovi_retry_policy",
  "woovi_day_due",
  "woovi_default_address_zipcode",
  "woovi_default_address_street",
  "woovi_default_address_number",
  "woovi_default_address_neighborhood",
  "woovi_default_address_city",
  "woovi_default_address_state",
  "woovi_default_address_country",
  // IO Pay
  "iopay_secret",
  "iopay_email",
  "iopay_seller_id",
  "iopay_env",
  // Asaas
  "asaas_api_key",
  "asaas_env",
  // Mercado Pago
  "mercadopago_public_key",
  "mercadopago_access_token",
  "mercadopago_client_id",
  "mercadopago_client_secret",
  // Stripe
  "stripe_secret_key",
  "stripe_webhook_secret",
  // Pagar.me
  "pagarme_secret_key",
  "pagarme_public_key",
];

/** Lê uma variável de ambiente tanto no Deno quanto no Node. */
function lerEnv(nome: string): string | null {
  try {
    const denoEnv = (globalThis as any).Deno?.env;
    if (denoEnv) {
      const v = denoEnv.get(nome);
      if (v) return v;
    }
  } catch {
    /* sem Deno */
  }
  try {
    const v = (globalThis as any).process?.env?.[nome];
    if (v) return v;
  } catch {
    /* sem process */
  }
  return null;
}

export async function getGatewaySettings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedSettings && (now - cacheTime) < CACHE_TTL) {
    return cachedSettings;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

  let map: Record<string, string> = {};

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      const { data } = await supabaseAdmin
        .from("app_settings")
        .select("key, value");

      (data || []).forEach((row: any) => {
        map[row.key] = row.value;
      });
    } catch (err) {
      console.error("Error loading gateway settings:", err);
    }
  }

  // Complementa com o ambiente — só o que o banco não tem.
  for (const chave of CHAVES_POR_AMBIENTE) {
    if (map[chave] !== undefined && map[chave] !== "") continue;
    const doEnv = lerEnv(chave.toUpperCase());
    if (doEnv) map[chave] = doEnv;
  }

  cachedSettings = map;
  cacheTime = now;
  return map;
}

export async function getGatewaySecret(gateway: string, key: string): Promise<string> {
  const settings = await getGatewaySettings();
  const settingKey = `${gateway}_${key}`;
  return settings[settingKey] || Deno.env.get(settingKey.toUpperCase()) || "";
}
