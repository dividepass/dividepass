/**
 * Envio de WhatsApp pela Cloud API da Meta.
 *
 * O projeto não tem provedor transacional de WhatsApp configurado — o
 * "WhatsApp" aqui é a API oficial (graph.facebook.com). Para ligar:
 *
 *   1. Criar um app em developers.facebook.com → produto "WhatsApp".
 *   2. Guardar o token permanente como secret `WHATSAPP_ACCESS_TOKEN`.
 *   3. Gravar o Phone Number ID em `app_settings.whatsapp_phone_number_id`
 *      (a migration `database/add-whatsapp-settings.sql` cria a chave).
 *
 * Regras da Meta que valem aqui:
 *   - Fora da janela de 24h, a mensagem só sai com TEMPLATE aprovado.
 *     A Cloud API rejeita texto livre para números que não conversaram
 *     com a empresa nos últimos 24 horas.
 *   - A janela de 24h é aberta pela PRIMEIRA mensagem do usuário para a
 *     empresa. Ou seja: para um disparo em massa, é preciso template.
 *
 * Sem token configurado, `sendWhatsAppMessage` devolve um erro explicando
 * isso — nunca "envia" e finge que deu certo.
 */

export type WhatsAppConfig = {
  phoneNumberId: string;
  apiVersion: string;
  accessToken: string;
};

export type WhatsAppResult = {
  ok: boolean;
  error?: string;
};

const DEFAULT_API_VERSION = "v21.0";

/** Só dígitos. */
function onlyDigits(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

/**
 * Número internacional (com DDI). O app grava o telefone como o usuário
 * digitou (DDD + 8/9 dígitos, sem o 55), então o 55 precisa ser acrescentado.
 *
 * O TAMANHO separa os dois casos — `startsWith('55')` não serve: DDD 55
 * (55123456789) começa com "55" e é número nacional.
 */
export function toInternationalPhone(value: string): string {
  const digits = onlyDigits(value);
  if (!digits) return "";
  // 12 ou 13 dígitos: já vem com DDI (55 + DDD + 8/9).
  if (digits.length >= 12) return digits;
  return `55${digits}`;
}

/** Lê a configuração do WhatsApp. `null` quando falta token ou Phone ID. */
export async function loadWhatsAppConfig(
  supabaseAdmin: any,
): Promise<WhatsAppConfig | null> {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
  if (!accessToken.trim()) return null;

  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .in("key", ["whatsapp_phone_number_id", "whatsapp_api_version"]);

  const settings: Record<string, string> = {};
  (data || []).forEach((s: { key: string; value: string }) => {
    settings[s.key] = s.value;
  });

  const phoneNumberId = (settings.whatsapp_phone_number_id || "").trim();
  if (!phoneNumberId) return null;

  return {
    phoneNumberId,
    apiVersion: (settings.whatsapp_api_version || "").trim() || DEFAULT_API_VERSION,
    accessToken: accessToken.trim(),
  };
}

/**
 * Envia uma mensagem de texto. Não lança: quem chama decide como tratar a
 * falha (uma falha no WhatsApp não pode derrubar os outros canais).
 */
export async function sendWhatsAppMessage(
  supabaseAdmin: any,
  opts: { to: string; body: string },
): Promise<WhatsAppResult> {
  const to = toInternationalPhone(opts.to);
  if (!to) return { ok: false, error: "telefone ausente ou inválido" };

  const config = await loadWhatsAppConfig(supabaseAdmin);
  if (!config) {
    return {
      ok: false,
      error: "WhatsApp não configurado (secret WHATSAPP_ACCESS_TOKEN + app_settings.whatsapp_phone_number_id)",
    };
  }

  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: opts.body },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(`[whatsapp] erro ${response.status} para ${to}: ${detail.slice(0, 300)}`);
      return {
        ok: false,
        error: `API recusou a mensagem (HTTP ${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      };
    }

    console.log(`[whatsapp] mensagem enviada para ${to}`);
    return { ok: true };
  } catch (error: any) {
    console.error("[whatsapp] falha no envio:", error);
    return { ok: false, error: error?.message || "falha de rede" };
  }
}
