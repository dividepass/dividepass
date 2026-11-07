// Links de contato usados no site (rodapé e CTAs públicos).
// Ficam aqui para não duplicar URL em vários componentes.

/**
 * Link do Grupo VIP — valor PADRÃO, usado só quando o admin ainda não
 * cadastrou um link no painel (Configurações) ou quando a leitura do banco
 * falha. O link que vale é o que está em `app_settings.whatsapp_vip_url`.
 *
 * Link de convite do WhatsApp expira quando o grupo fica sem atividade — por
 * isso ele é configurável no admin e não fica preso no bundle.
 */
export const WHATSAPP_VIP_FALLBACK = 'https://chat.whatsapp.com/Cp1mVj7dJuOEiDwYe2oEeR';

/** Chave da configuração no `app_settings`. */
export const WHATSAPP_VIP_SETTING_KEY = 'whatsapp_vip_url';

/** E-mail de suporte (mesmo usuário do SMTP de suporte). */
export const SUPORTE_EMAIL = 'suporte@dividepass.com';

/**
 * Aceita o link completo OU só o código do convite e devolve o link pronto
 * (ou string vazia se não der para montar). O admin pode colar as duas
 * coisas — o código é o final do link (`chat.whatsapp.com/XXXX`).
 */
export function normalizeWhatsappVipUrl(raw) {
  const value = (raw || '').trim();
  if (!value) return '';

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      // Link de convite sem código (ex.: chat.whatsapp.com/) não abre grupo.
      if (/chat\.whatsapp\.com/i.test(value) && !extractWhatsappInviteCode(value)) return '';
      return value;
    } catch {
      return '';
    }
  }

  // Só o código do convite (sem https e sem domínio).
  const code = value.split('/').filter(Boolean).pop() || '';
  if (/^[A-Za-z0-9_-]{8,64}$/.test(code)) {
    return `https://chat.whatsapp.com/${code}`;
  }
  return '';
}

/** Extrai o código do convite de um link já montado (para mostrar no admin). */
export function extractWhatsappInviteCode(url) {
  const value = (url || '').trim();
  if (!value) return '';
  const match = value.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : '';
}
