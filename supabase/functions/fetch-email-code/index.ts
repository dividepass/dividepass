import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  plataformaDoServico,
  classificarEmailParaPlataforma,
  detectarPlataformaDoEmail,
  detectarMarcaNoTexto,
  type PlatformInfo,
  type ClassificacaoEmail,
} from "../_shared/plataforma-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CODE_PATTERNS = [
  /c[oó]digo\s+de\s+(?:verifica[çc][ãa]o|valida[çc][ãa]|acesso)[:\s]*(\d{4,8})/i,
  /verification\s+code[:\s]*(\d{4,8})/i,
  /your\s+(?:verification\s+)?code[:\s]*(\d{4,8})/i,
  /use\s+(?:this\s+)?code[:\s]*(\d{4,8})/i,
  /seu\s+c[oó]digo[:\s]*(\d{4,8})/i,
  /c[oó]digo[:\s]+(\d{4,8})/i,
  /pin[:\s]+(\d{4,8})/i,
  /(\d{4,8})\s+(?:is\s+your|for\s+your|é\s+seu|para\s+seu)/i,
  /enter\s+(\d{4,8})/i,
  /digite\s+(\d{4,8})/i,
  /insira\s+(\d{4,8})/i,
  /(?:your|seu|o\s+seu)\s+(?:code|c[oó]digo)\s+(?:is|é|e)[:\s]*(\d{4,8})/i,
  /(?:access|invite)\s+(?:code|link)[:\s]*(\d{4,8})/i,
  /(?:c[oó]digo|code)\s*(?:de|for)\s*(?:convite|invite|entry)[:\s]*(\d{4,8})/i,
];

const SENSITIVE_PATTERNS: { pattern: RegExp; type: string; message: string }[] = [
  {
    pattern: /(?:redefini[çc][ãa]o|recupera[çc][ãa]o)\s+de\s+senha|password\s+(?:reset|change|update)/i,
    type: "password_change",
    message: "Este código é de redefinição/alteração de senha. Por segurança, não é possível exibi-lo.",
  },
  {
    pattern: /(?:altera[çc][ãa]o|troca)\s+(?:de\s+)?e[- ]?mail|email\s+(?:change|update)/i,
    type: "email_change",
    message: "Este código é de alteração de e-mail. Por segurança, não é possível exibi-lo.",
  },
  {
    pattern: /conta\s+bloqueada|account\s+locked|suspended|suspensa/i,
    type: "account_lock",
    message: "Este código está relacionado a uma restrição na conta. Verifique com o administrador.",
  },
];

interface GroupConfig {
  email_code_patterns: string[];
  email_body_keywords: string[];
  email_subject_includes: string[];
  email_ai_enabled: boolean;
  email_allowed_senders: string[];
}

function decodeBase64(s: string): string {
  try {
    const cleaned = s.replace(/[\s\r\n]+/g, "");
    const bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return s;
  }
}

function decodeQuotedPrintable(s: string): string {
  let result = s.replace(/=\r?\n/g, "");
  result = result.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  return result;
}

function extractMimeParts(raw: string): { plain: string; html: string } {
  let plain = "";
  let html = "";
  const bMatch = raw.match(/Content-Type:[\s\S]*?boundary="?([^";\r\n\s]+)"?/i);
  if (bMatch) {
    const b = bMatch[1];
    const parts = raw.split(new RegExp(`--${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?`));
    for (const part of parts) {
      const bodyIdx = part.indexOf("\r\n\r\n");
      const body = bodyIdx !== -1 ? part.substring(bodyIdx + 4).trim() : "";
      if (!body) continue;
      const enc = part.match(/Content-Transfer-Encoding:\s*(\S+)/i);
      const isBase64 = enc?.[1]?.toLowerCase() === "base64";
      const decoded = isBase64 ? decodeBase64(body) : decodeQuotedPrintable(body);
      if (/Content-Type:\s*text\/plain/i.test(part)) plain += decoded;
      else if (/Content-Type:\s*text\/html/i.test(part)) html += decoded;
    }
  } else {
    const bodyIdx = raw.indexOf("\r\n\r\n");
    const body = bodyIdx !== -1 ? raw.substring(bodyIdx + 4).trim() : raw;
    const enc = raw.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const isBase64 = enc?.[1]?.toLowerCase() === "base64";
    const decoded = isBase64 ? decodeBase64(body) : decodeQuotedPrintable(body);
    if (/Content-Type:\s*text\/html/i.test(raw)) html = decoded;
    else plain = decoded;
  }
  return { plain, html };
}

function stripHtml(html: string): string {
  let t = html.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/p>/gi, "\n");
  t = t.replace(/<\/div>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/&nbsp;/g, " ");
  t = t.replace(/&amp;/g, "&");
  t = t.replace(/&lt;/g, "<");
  t = t.replace(/&gt;/g, ">");
  t = t.replace(/&quot;/g, '"');
  t = t.replace(/&#39;/g, "'");
  t = t.replace(/&#x27;/g, "'");
  t = t.replace(/&atilde;/g, "ã");
  t = t.replace(/&ccedil;/g, "ç");
  t = t.replace(/&oacute;/g, "ó");
  t = t.replace(/&eacute;/g, "é");
  t = t.replace(/&aacute;/g, "á");
  t = t.replace(/&iacute;/g, "í");
  t = t.replace(/&uacute;/g, "ú");
  t = t.replace(/[ \t]+/g, " ");
  return t;
}

function stripMime(raw: string): string {
  const { plain, html } = extractMimeParts(raw);
  if (plain) return plain;
  if (html) return stripHtml(html);
  return raw;
}
void stripMime;

interface CodeResult {
  code: string | null;
  sensitive?: boolean;
  sensitiveType?: string;
  sensitiveMessage?: string;
  reason?: string;
}

function buildPatternsFromConfig(groupPatterns: string[]): RegExp[] {
  const patterns: RegExp[] = [];
  for (const p of groupPatterns) {
    try {
      patterns.push(new RegExp(p, "i"));
    } catch {
      console.log(`[fetch-email-code] Padrão inválido ignorado: ${p}`);
    }
  }
  return patterns;
}

function checkSensitive(body: string): { isSensitive: boolean; type: string; message: string } {
  for (const sp of SENSITIVE_PATTERNS) {
    if (sp.pattern.test(body)) {
      return { isSensitive: true, type: sp.type, message: sp.message };
    }
  }
  return { isSensitive: false, type: "", message: "" };
}

function extractCode(body: string, groupConfig?: GroupConfig): CodeResult {
  const sensitiveCheck = checkSensitive(body);

  const groupPatterns = groupConfig?.email_code_patterns || [];
  const groupKeywords = groupConfig?.email_body_keywords || [];

  let patternsToUse = CODE_PATTERNS;
  if (groupPatterns.length > 0) {
    const customPatterns = buildPatternsFromConfig(groupPatterns);
    if (customPatterns.length > 0) {
      patternsToUse = [...customPatterns, ...CODE_PATTERNS];
    }
  }

  for (const regex of patternsToUse) {
    const match = body.match(regex);
    if (match && match[1]) {
      if (sensitiveCheck.isSensitive) {
        return {
          code: match[1],
          sensitive: true,
          sensitiveType: sensitiveCheck.type,
          sensitiveMessage: sensitiveCheck.message,
        };
      }
      return { code: match[1] };
    }
  }

  if (groupKeywords.length > 0) {
    const bodyLower = (body || "").toLowerCase();
    const hasKeyword = groupKeywords.some((kw) => bodyLower.includes(kw.toLowerCase()));
    if (hasKeyword) {
      const digitMatch = body.match(/(\d{4,8})/);
      if (digitMatch) {
        if (sensitiveCheck.isSensitive) {
          return {
            code: digitMatch[1],
            sensitive: true,
            sensitiveType: sensitiveCheck.type,
            sensitiveMessage: sensitiveCheck.message,
          };
        }
        return { code: digitMatch[1] };
      }
    }
  }

  const hasVerificationContext = /(?:code|c[oó]digo|verify|verifica[çc][ãa]o|access|acesso|enter|digite|insira|use|utilize)/i.test(body);
  if (hasVerificationContext) {
    const standaloneMatch = body.match(/^\s*(\d{4,8})\s*$/m);
    if (standaloneMatch) {
      if (sensitiveCheck.isSensitive) {
        return {
          code: standaloneMatch[1],
          sensitive: true,
          sensitiveType: sensitiveCheck.type,
          sensitiveMessage: sensitiveCheck.message,
        };
      }
      return { code: standaloneMatch[1] };
    }
  }

  return { code: null, reason: "Nenhum código de verificação encontrado." };
}

function isSenderAllowed(sender: string, allowedSenders: string[]): boolean {
  if (!allowedSenders || allowedSenders.length === 0) return true;
  const lowerSender = (sender || "").toLowerCase();
  return allowedSenders.some((s) => lowerSender.includes(s.toLowerCase()));
}

function isSubjectAllowed(subject: string, subjectIncludes: string[]): boolean {
  if (!subjectIncludes || subjectIncludes.length === 0) return true;
  const lowerSubject = (subject || "").toLowerCase();
  return subjectIncludes.some((s) => lowerSubject.includes(s.toLowerCase()));
}

const LINK_KEYWORDS = /(code|c[oó]digo|verify|verifica|confirm|signin|sign-?_?in|login|token|otp|pin|auth|acesso|entrar|access|tv)/i;
const LINK_BLOCKLIST = /(unsubscribe|opt[-_]?out|descadast|cancel(ar|e)?|remov|preferences|settings|privacy|privacidade|terms|termos|legal|help|ajuda|support|suporte|blog|jobs|careers|giftcard|pagamento|billing|invoice)/i;

// Limites da etapa de "seguir links". A edge function e encerrada pelo gateway
// se passar do tempo maximo e devolve corpo vazio, o que quebrava o front.
const PAGE_FETCH_TIMEOUT_MS = 7000;
const LINK_STAGE_BUDGET_MS = 45000;
const MAX_LINKS_PER_EMAIL = 3;

// --- E-mails de CONFIRMAÇÃO (não contêm código; exigem clique do usuário) ---
// Ex.: "Você pediu para atualizar sua residência Netflix?" com botão "Sim, fui eu".
// O link é de uso único e expira em ~15min: NÃO pode ser acessado pelo servidor,
// senão o clique do usuário passa a falhar.

// Botões de APROVAÇÃO (o que libera o acesso).
// Botões de APROVAÇÃO (o que libera o acesso).
const CONFIRM_CTA_TEXT = /(sim,?\s*fui\s*eu|yes,?\s*(it|that)\s+was\s*me|fui\s+eu|foi\s*eu|confirmar|confirme|aprovar|aprovo|ativar|ative|continuar|yes,?\s*i\s+did|receber\s+c[oó]digo|receba\s+o\s+c[oó]digo|obter\s+c[oó]digo|obtain\s+(your\s+)?(code|passcode))/i;
// Botões de NEGAÇÃO. Precisam ser DESCARTADOS: "NÃO FUI EU" troca a senha
// da conta em vez de liberar o acesso — e, por conter "FUI EU" como
// substring, cairia no padrão de aprovação acima se não fosse filtrado.
const DENY_CTA_TEXT = /(n[aã]o\s*fui\s*eu|n[aã]o\s*foi\s*eu|not\s+me|didn'?t\s+do\s+it|it\s+wasn'?t\s*me|was\s+not\s*me)/i;
// URLs de NEGAÇÃO (o "não fui eu" do Crunchyroll): nunca podem ser o link de ação.
const DENY_URL_HINTS = /(deny|reject|declin|not-?me|wasn-?t|deauthoriz|unauthor)/i;
const CONFIRM_URL_HINTS = /(household|residence|updatehousehold|verifyhousehold|confirm|approve|activate|deviceupdate|update-?device|manage-?devices|update-primary-location|primary-location|operation=update|approve-?login|login-?approval|verify-?login|new-?login|temporary|temporary-?access|access-?code|passcode|verify-?device|device-?verify|travel)/i;
const CONFIRM_SUBJECT = /(resid[eê]ncia|atualizar\s+(a\s+|sua\s+)?(resid[eê]ncia|conta|acesso)|update\s+your\s+(household|residence)|household)/i;
// Aprovação de LOGIN/dispositivo. No Crunchyroll o assunto é "Notamos um novo
// login" e o corpo pede "confirme sua atividade de login".
const LOGIN_APPROVAL_SUBJECT = /(novo\s+login|novo\s+acesso|novo\s+dispositivo|login\s+suspeito|acesso\s+suspeito|new\s+sign-?in|new\s+login|unusual\s+(sign-?in|login|activity)|approve\s+(the\s+)?login)/i;
const LOGIN_APPROVAL_BODY = /(notamos?\s+(um\s+|o\s+)?(novo\s+|nov\s+)?login|login\s+suspeito|confirme\s+sua\s+atividade\s+de\s+login|aprovar\s+(o\s+)?login|aprovar\s+o\s+acesso)/i;
// CÓDIGO DE ACESSO TEMPORÁRIO (Netflix).
//
// A Netflix trocou o código em texto por um BOTÃO no e-mail — e o TEXTO do
// botão muda o tempo todo ("Sim, fui eu", "Receber código", ...). Por isso a
// detecção é pelo ASSUNTO e pelo CORPO ("código de acesso temporário"), e
// nunca pelo texto do botão.
const ACCESS_CODE_SUBJECT = /(seu\s+c[oó]digo\s+de\s+acesso\s+tempor[aá]rio|c[oó]digo\s+de\s+acesso\s+tempor[aá]rio|temporary\s+access\s+code)/i;
const ACCESS_CODE_BODY = /(solicita[çc][ãa]o\s+de\s+c[oó]digo\s+de\s+acesso\s+tempor[aá]rio|recebemos\s+uma\s+solicita[çc][ãa]o\s+de\s+c[oó]digo|c[oó]digo\s+de\s+acesso\s+tempor[aá]rio)/i;
// Contexto de "acesso" — evita que um e-mail de marketing com a palavra
// "confirmar" seja tratado como pedido de confirmação de acesso.
const ACCESS_CONTEXT = /(resid[eê]ncia|household|\bacesso\b|\blogin\b|entrar|entrada|dispositivo|device|perfil|\blocal\b)/i;
// E-mails de "depois" da ação: o pedido já foi aprovado/concluído, então não há
// nada para o usuário confirmar. Ex.: "Confirmação: sua residência Netflix foi confirmada".
const CONFIRM_ALREADY_DONE = /(foi\s+confirmad[ao]|confirmad[ao]\s+(com\s+sucesso|o\s+seu)|já\s+(foi|confirmad|atualiz)|foi\s+atualizad[ao]|residence\s+(has\s+been|was)\s+(updated|confirmed)|your\s+household\s+(has\s+been|was)\s+(updated|confirmed))/i;
const PLATFORM_SENDER = /(netflix|disney\+|disneyplus|max\.com|hbo|primevideo|amazon|spotify|globoplay|paramount|crunchyroll|mubi)/i;

/** Tipo de confirmação que o e-mail está pedindo. */
type ConfirmacaoTipo = "household" | "login" | "access_code" | "generic";

/**
 * Diz se o e-mail é um pedido de confirmação (aprovação) que o USUÁRIO
 * precisa fazer com um clique.
 *
 * A checagem de plataforma NÃO acontece aqui: quem chama já filtrou os
 * e-mails que não são da plataforma pedida.
 */
function looksLikeConfirmationEmail(subject: string, body: string): ConfirmacaoTipo | null {
  if (CONFIRM_ALREADY_DONE.test(subject)) return null;
  // O "código de acesso temporário" (Netflix) vem primeiro: o texto do botão
  // muda o tempo todo, então a detecção se apoia no assunto e no corpo.
  if (ACCESS_CODE_SUBJECT.test(subject) || ACCESS_CODE_BODY.test(body)) return "access_code";
  if (LOGIN_APPROVAL_SUBJECT.test(subject) || LOGIN_APPROVAL_BODY.test(body)) return "login";
  if (CONFIRM_SUBJECT.test(subject)) return "household";
  const temCta = CONFIRM_CTA_TEXT.test(subject) || CONFIRM_CTA_TEXT.test(body);
  if (temCta && ACCESS_CONTEXT.test(`${subject} ${body}`)) return "generic";
  return null;
}
// Detalhe do pedido mostrado no cartão do front, ex.:
// "Solicitado por Cintia em um aparelho Sony PlayStation 5 em 4 de outubro, 23:39"
// Esse texto fica apenas na parte HTML do e-mail (o texto plano omite).
// Na aprovação de LOGIN (Crunchyroll) o e-mail traz data/hora e local:
// "2026-11-18 15:22 UTC" e "Próximo Salvador, Bahia, Brazil".
interface DetalheConfirmacao {
  requester: string;
  device: string;
  when: string;
  location: string;
}

/** "2026-11-18 15:22 UTC" → "18/11/2026 15:22 UTC". */
function formatarDataIso(valor: string): string {
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}:\d{2})\s*(UTC)?/i);
  if (!m) return valor.trim();
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}${m[5] ? " UTC" : ""}`;
}

function extractRequestDetails(html: string, plain: string): DetalheConfirmacao | null {
  const bruto = `${html ? stripHtml(html) : ""}\n${plain || ""}`;
  const source = bruto.replace(/\s+/g, " ");

  // PT-BR: a data tem formato previsível, então dá para ancorar com segurança.
  // As classes de caractere evitam [a-z] puro porque meses e cidades carregam
  // acento (ex.: "outubro", "Brasília").
  //
  // A Netflix usa DOIS formatos no mesmo e-mail:
  //   "Solicitado por Cintia em um aparelho Sony PlayStation 5 em 21 de novembro, 21:10 ..."
  //   "Solicitado por Cintia do aparelho Apple iPhone 14 às 21 de novembro, 20:52 ..."
  const pt = source.match(
    /Solicitado\s+por\s+(.+?)\s+(?:em\s+um\s+(?:aparelho|dispositivo)|do\s+(?:aparelho|dispositivo))\s+(.+?)\s+(?:em|[aà]s)\s+(\d{1,2}\s+de\s+[^\s,.]+,?\s*\d{1,2}:\d{2}\s*hor[áa]rio\s+de\s+[^\s,.]{2,})/i,
  );
  if (pt) {
    return {
      requester: pt[1].trim().replace(/\s*\.\s*$/, ""),
      device: pt[2].trim().replace(/\s*\.\s*$/, ""),
      when: pt[3].trim(),
      location: "",
    };
  }

  // Fallback: sem a data, ainda vale mostrar quem e em qual aparelho pediu.
  const loose = source.match(/(?:Solicitado\s+por|Requested\s+by)\s+(.+?)\s+(?:em\s+um\s+(?:aparelho|dispositivo)|do\s+(?:aparelho|dispositivo))\s+(.+?)(?:\s+(?:em|[aà]s)\s+\d{1,2}\s+de|\s{2,}|\s*$)/i)
    || source.match(/Requested\s+by\s+(.+?)\s+on\s+(?:a\s+)?(.+?)\s+device(?:\s+on\s+(.+?))?(?:\s{2,}|\s*$)/i);
  if (loose) {
    return {
      requester: loose[1].trim(),
      device: loose[2].trim(),
      when: (loose[3] || "").trim(),
      location: "",
    };
  }

  // Aprovação de LOGIN (Crunchyroll): data/hora e local aproximado.
  const dataLogin = bruto.match(/(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?:\s+UTC)?)/i);
  const localLogin = bruto.match(/Pr[oó]ximo\s+([^\n\r]{3,80})/i);
  if (dataLogin || localLogin) {
    let location = "";
    if (localLogin) {
      location = localLogin[1]
        // Corta o que vem depois do local (botões e avisos do e-mail).
        .split(/\s+(?=FUI|N[AÃ]O\s+FUI|Este\s)/i)[0]
        .replace(/\s*\.\s*$/, "")
        .trim();
    }
    return {
      requester: "",
      device: "",
      when: dataLogin ? formatarDataIso(dataLogin[1]) : "",
      location,
    };
  }

  return null;
}
function normalizeUrl(raw: string): string | null {
  let url = (raw || "").replace(/=3D/gi, "=").replace(/&amp;/g, "&").trim();
  url = url.replace(/[)\].,;'"]+$/, "");
  if (!/^https?:\/\//i.test(url)) return null;
  if (LINK_BLOCKLIST.test(url)) return null;
  return url;
}

/**
 * Limpa o texto do botão que veio do e-mail para virar rótulo do NOSSO
 * botão.
 *
 * POR QUE REAPROVEITAR O TEXTO DO E-MAIL
 * ---------------------------------------
 * A Netflix muda o texto do botão o tempo todo ("Sim, fui eu", "Receber
 * código", ...). Mostrar o mesmo texto no botão que entregamos ao usuário
 * mantém a tela coerente com o e-mail que ele acabou de receber. Texto
 * estranho (vazio, gigante ou cheio de URL) vira o rótulo padrão.
 */
function limparRotuloBotao(texto: string): string {
  const padrao = "Abrir e confirmar o acesso";
  const limpo = String(texto || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpo) return padrao;
  if (limpo.length > 40) return padrao;
  // Só número/símbolo não serve de rótulo.
  if (!/[^\W\d_]/.test(limpo)) return padrao;
  return limpo;
}

/**
 * Monta a resposta do CARTÃO DE AÇÃO MANUAL (o usuário precisa clicar).
 *
 * O rótulo do botão vem do e-mail (ver `limparRotuloBotao`) e as mensagens
 * são dinâmicas por plataforma e por tipo de pedido — nada de "Netflix"
 * hardcoded, porque a mesma tela serve para qualquer plataforma do grupo.
 */
function montarRespostaAcaoManual(
  acao: { url: string; texto: string },
  tipo: ConfirmacaoTipo,
  plataforma: PlatformInfo,
  email: { sender: string; subject: string; date: string },
  details: DetalheConfirmacao | null,
  ignoradas: { label: string; quantidade: number }[],
): Record<string, unknown> {
  const rotulo = plataforma.label;
  const eLogin = tipo === "login";
  const eCodigo = tipo === "access_code";

  const mensagem = eLogin
    ? `${rotulo} enviou uma notificação de novo login em vez de um código. Confirme que foi você para liberar o acesso.`
    : eCodigo
      ? `${rotulo} enviou um pedido de código de acesso temporário em vez de um código. Clique no botão abaixo para gerar o código.`
      : `${rotulo} enviou uma confirmação de acesso em vez de um código. Clique no botão abaixo para aprovar e liberar o acesso.`;

  const nota = eLogin
    ? "Abra o link, confirme que o login foi seu e o acesso é liberado. O link expira em 15 minutos."
    : eCodigo
      ? "Clique no botão: o código temporário é gerado na página da plataforma para usar na TV. O link expira em 15 minutos."
      : "Clique no botão, aprove a solicitação e o acesso é liberado. O link expira em 15 minutos.";

  return {
    code: null,
    requires_manual_action: true,
    manual_action_type: eLogin
      ? "confirm_login"
      : eCodigo
        ? "confirm_access_code"
        : (tipo === "household" ? "confirm_household" : "confirm_action"),
    manual_action_url: acao.url,
    manual_action_label: limparRotuloBotao(acao.texto),
    manual_action_note: nota,
    manual_action_details: details,
    message: mensagem,
    platform_label: rotulo,
    skipped_platforms: ignoradas,
    sender: email.sender,
    subject: email.subject,
    received_at: email.date || new Date().toISOString(),
  };
}

// Extrai a URL do BOTÃO de ação, usando o TEXTO da âncora para pontuar.
// Falls back para <form action>, <button onclick> e URLs soltas no HTML.
//
// Devolve também o TEXTO do botão escolhido: a Netflix troca o texto do
// botão ("Sim, fui eu", "Receber código", ...) e o front precisa mostrar o
// mesmo texto no botão que ele entrega ao usuário.
function extractActionLink(html: string, plain: string): { url: string; texto: string } | null {
  const scored = new Map<string, { pontos: number; texto: string }>();

  const score = (url: string | null, points: number, texto = ""): void => {
    if (!url) return;
    const clean = normalizeUrl(url);
    if (!clean) return;
    // Link de NEGAÇÃO ("não fui eu"): nunca pode ser entregue ao usuário.
    if (DENY_URL_HINTS.test(clean)) return;
    const atual = scored.get(clean);
    if (!atual) {
      scored.set(clean, { pontos: points, texto });
      return;
    }
    atual.pontos += points;
    // Guarda o texto do botão (o que casou com o CTA), sem sobrescrever.
    if (texto && !atual.texto) atual.texto = texto;
  };

  const bump = (value: number, text: string, href: string): void => {
    // Botão de NEGAÇÃO ("NÃO FUI EU"): clicar nele troca a senha da conta
    // em vez de liberar o acesso. Precisa ser descartado aqui — e, como
    // "NÃO FUI EU" contém "FUI EU", ele casaria com o padrão de aprovação.
    if (DENY_CTA_TEXT.test(text)) return;
    if (CONFIRM_CTA_TEXT.test(text)) value += 4;
    if (CONFIRM_URL_HINTS.test(href)) value += 3;
    if (PLATFORM_SENDER.test(href)) value += 1;
    if (/(btn|button|cta)/i.test(text)) value += 1;
    score(href, value, text);
  };

  // 1) Âncoras com href + texto interno
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    bump(2, stripHtml(m[2]).replace(/\s+/g, " ").trim(), m[1]);
  }

  // 2) Formulários (botão submit)
  const formRe = /<form\b[^>]*action\s*=\s*["']([^"']+)["']/gi;
  while ((m = formRe.exec(html)) !== null) {
    score(m[1], 3);
  }

  // 3) <button onclick="window.location='...'">
  const onClickRe = /(?:onclick|location(?:\.href)?\s*=\s*)["'][^"']*?(https?:\/\/[^"']+)["']/gi;
  while ((m = onClickRe.exec(html)) !== null) {
    bump(2, "", m[1]);
  }

  // 4) URLs soltas no texto (tracking redirects do próprio e-mail)
  const bareRe = /https?:\/\/[^\s<>"')]+/g;
  while ((m = bareRe.exec(html + "\n" + plain)) !== null) {
    score(m[0], 1);
  }

  if (scored.size === 0) return null;
  const melhor = [...scored.entries()].sort((a, b) => b[1].pontos - a[1].pontos)[0];
  return { url: melhor[0], texto: melhor[1].texto };
}
function extractCandidateLinks(html: string, plain: string): string[] {
  const found = new Map<string, number>();
  const add = (rawUrl: string, baseScore: number) => {
    let url = rawUrl.replace(/=3D/gi, "=").replace(/&amp;/g, "&").trim();
    url = url.replace(/[)\].,;'"]+$/, "");
    if (!/^https?:\/\//i.test(url)) return;
    if (LINK_BLOCKLIST.test(url)) return;
    let score = baseScore;
    if (LINK_KEYWORDS.test(url)) score += 2;
    const existing = found.get(url);
    if (existing !== undefined && existing >= score) return;
    found.set(url, score);
  };
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) add(m[1], 1);
  const bareRe = /https?:\/\/[^\s<>"')]+/g;
  while ((m = bareRe.exec(plain)) !== null) add(m[0], 0);
  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([u]) => u);
}

async function fetchPageText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) {
      console.log(`[fetch-email-code] Link retornou HTTP ${res.status}: ${url}`);
      return null;
    }
    const ct = res.headers.get("content-type") || "";
    if (ct && !ct.includes("html") && !ct.includes("text")) return null;
    const finalUrl = res.url || url;
    if (LINK_BLOCKLIST.test(finalUrl)) return null;
    const rawPage = await res.text();
    return `${finalUrl}\n${stripHtml(rawPage.substring(0, 300000))}`;
  } catch (err) {
    console.log(`[fetch-email-code] Falha ao acessar link ${url}:`, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function extractCodeWithAI(content: string, apiKey: string, serviceName: string, isPage = false): Promise<CodeResult | null> {
  try {
    const sourceLabel = isPage ? "página web aberta a partir do link de um botão do email" : "email";
    const prompt = `Você é um extrator de códigos de verificação e acesso. Analise o conteúdo abaixo (${sourceLabel}).

CONTEXTO: Foi enviado para uma conta compartilhada da plataforma "${serviceName}".

Regras:
1. Este conteúdo é da plataforma ${serviceName}? Se NÃO for, retorne {"is_verification": false, "code": null, "is_sensitive": false, "reason": "conteúdo não é da plataforma ${serviceName}"}
2. Se É da ${serviceName} e contém um código de verificação ou acesso de 4 a 8 dígitos, retorne o código
3. Se É da ${serviceName} e é sobre redefinição de senha, alteração de senha ou alteração de e-mail, marque como sensível
4. Se É da ${serviceName} e é sobre bloqueio de conta, marque como sensível
5. Se não há código, retorne null para code
6. Não confunda números de pedido, ID de transação ou outros números com códigos de verificação
7. Em páginas web, o código costuma aparecer sozinho ou perto de textos como "digite este código", "enter this code", "seu código é"

Retorne APENAS JSON válido (sem markdown, sem texto extra):
{"is_verification": true/false, "code": "123456" ou null, "is_sensitive": true/false, "reason": "breve descrição"}

Conteúdo:
${content.substring(0, 3000)}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      console.log(`[fetch-email-code] Groq API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const aiContent = data.choices?.[0]?.message?.content?.trim();
    if (!aiContent) return null;

    const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.is_verification && parsed.code && !parsed.is_sensitive) {
      return { code: String(parsed.code).replace(/\D/g, "").substring(0, 8) };
    }

    if (parsed.is_verification && parsed.is_sensitive) {
      return {
        code: parsed.code ? String(parsed.code).replace(/\D/g, "").substring(0, 8) : null,
        sensitive: true,
        sensitiveType: "ai_detected_sensitive",
        sensitiveMessage: `Este código foi identificado como sensível pela IA: ${parsed.reason || "operação de segurança"}`,
      };
    }

    return null;
  } catch (err) {
    console.log(`[fetch-email-code] Groq AI error:`, err.message);
    return null;
  }
}

class ImapClient {
  private conn: Deno.TlsConn;
  private tag = 0;
  private buffer = "";

  constructor(conn: Deno.TlsConn) {
    this.conn = conn;
  }

  private nextTag(): string {
    this.tag++;
    return `A${String(this.tag).padStart(3, "0")}`;
  }

  private async readLine(): Promise<string> {
    while (true) {
      const nlIndex = this.buffer.indexOf("\r\n");
      if (nlIndex !== -1) {
        const line = this.buffer.substring(0, nlIndex);
        this.buffer = this.buffer.substring(nlIndex + 2);
        return line;
      }
      const chunk = new Uint8Array(65536);
      const n = await this.conn.read(chunk);
      if (n === null) throw new Error("Connection closed");
      this.buffer += new TextDecoder().decode(chunk.subarray(0, n));
    }
  }

  private async readUntil(tag: string): Promise<string> {
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine();
      lines.push(line);
      if (line.startsWith(tag + " ")) break;
    }
    return lines.join("\r\n");
  }

  private async readLiteral(size: number): Promise<string> {
    while (this.buffer.length < size) {
      const chunk = new Uint8Array(65536);
      const n = await this.conn.read(chunk);
      if (n === null) throw new Error("Connection closed during literal");
      this.buffer += new TextDecoder().decode(chunk.subarray(0, n));
    }
    const literal = this.buffer.substring(0, size);
    this.buffer = this.buffer.substring(size);
    if (this.buffer.startsWith("\r\n")) this.buffer = this.buffer.substring(2);
    return literal;
  }

  async connect(): Promise<void> {
    const greeting = await this.readLine();
    if (!greeting.startsWith("* OK")) throw new Error(`IMAP greeting failed: ${greeting}`);
  }

  async login(user: string, password: string): Promise<void> {
    const tag = this.nextTag();
    await this.conn.write(new TextEncoder().encode(`${tag} LOGIN "${user}" "${password}"\r\n`));
    const response = await this.readUntil(tag);
    if (!response.includes(`${tag} OK`)) throw new Error(`IMAP LOGIN failed: ${response}`);
  }

  async selectInbox(): Promise<void> {
    const tag = this.nextTag();
    await this.conn.write(new TextEncoder().encode(`${tag} SELECT INBOX\r\n`));
    const response = await this.readUntil(tag);
    if (!response.includes(`${tag} OK`)) throw new Error(`IMAP SELECT INBOX failed: ${response}`);
  }

  async searchAll(): Promise<number[]> {
    const tag = this.nextTag();
    await this.conn.write(new TextEncoder().encode(`${tag} SEARCH ALL\r\n`));
    const response = await this.readUntil(tag);
    const searchLine = response.split("\r\n").find((l) => l.startsWith("* SEARCH"));
    if (!searchLine) return [];
    const nums = searchLine.replace("* SEARCH", "").trim();
    if (!nums) return [];
    return nums.split(/\s+/).map(Number);
  }

  async fetchHeaders(uid: number): Promise<string> {
    const tag = this.nextTag();
    await this.conn.write(
      new TextEncoder().encode(`${tag} FETCH ${uid} (BODY[HEADER.FIELDS (FROM SUBJECT DATE)])\r\n`),
    );
    const lines: string[] = [];
    let literalData = "";
    while (true) {
      const line = await this.readLine();
      lines.push(line);
      const literalMatch = line.match(/\{(\d+)\}$/);
      if (literalMatch) {
        const size = parseInt(literalMatch[1]);
        literalData = await this.readLiteral(size);
        const closingLine = await this.readLine();
        lines.push(closingLine);
        if (closingLine.startsWith(tag + " ")) break;
      }
      if (line.startsWith(tag + " ")) break;
    }
    return literalData || lines.join("\r\n");
  }

  async fetchBody(uid: number): Promise<{ text: string; html: string }> {
    const tag = this.nextTag();
    await this.conn.write(new TextEncoder().encode(`${tag} FETCH ${uid} (RFC822)\r\n`));
    const lines: string[] = [];
    let literalData = "";
    while (true) {
      const line = await this.readLine();
      lines.push(line);
      const literalMatch = line.match(/\{(\d+)\}$/);
      if (literalMatch) {
        const size = parseInt(literalMatch[1]);
        literalData = await this.readLiteral(size);
        const closingLine = await this.readLine();
        lines.push(closingLine);
        if (closingLine.startsWith(tag + " ")) break;
      }
      if (line.startsWith(tag + " ")) break;
    }
    const raw = literalData || lines.join("\r\n");
    const { plain, html } = extractMimeParts(raw);
    return { text: plain ? plain : stripHtml(html), html };
  }

  close(): void {
    try { this.conn.close(); } catch {}
  }
}

function extractSender(headerBlock: string): string {
  const fromMatch = headerBlock.match(/From:\s*(.+)/i);
  if (fromMatch) return fromMatch[1].trim();
  return "";
}

function extractSubject(headerBlock: string): string {
  const subMatch = headerBlock.match(/Subject:\s*(.+)/i);
  if (subMatch) return subMatch[1].trim();
  return "";
}

function extractEmailDate(headerBlock: string): string {
  const dateMatch = headerBlock.match(/Date:\s*(.+)/i);
  if (dateMatch) return dateMatch[1].trim();
  return "";
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      let callerId = "";
      const authHeader = req.headers.get("authorization") || "";
      if (authHeader.startsWith("Bearer ")) {
        const jwt = authHeader.replace("Bearer ", "");
        const { data: { user: caller } } = await supabaseAdmin.auth.getUser(jwt);
        if (caller) callerId = caller.id;
      }

      // ---------------------------------------------------------------------
      // AUTENTICACAO OBRIGATORIA (S12 / B13)
      // ---------------------------------------------------------------------
      // Antes a checagem de membro ficava DENTRO de `if (callerId)`: sem JWT
      // nao havia checagem nenhuma e a funciao logava na IMAP do grupo e
      // devolvia o codigo de verificacao — a credencial da assinatura
      // compartilhada. Agora, sem chamador identificado, retorna 401.
      if (!callerId) {
        return new Response(JSON.stringify({ error: "Não autenticado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const { group_id } = body;

      if (!group_id) {
        return new Response(JSON.stringify({ error: "group_id é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: group, error: groupError } = await supabaseAdmin
        .from("groups")
        .select(`email_code_enabled, service_id, owner_id`)
        .eq("id", group_id)
        .single();

      if (groupError || !group) {
        return new Response(JSON.stringify({ error: "Grupo não encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Checagem de vinculo com o grupo — sempre, para todo chamador.
      //
      // Alem do membro ativo e do assinante, o DONO do grupo (o gestor que
      // administra o grupo na tela "Gerenciar Grupo") tambem pode buscar:
      // e ele quem configura a caixa IMAP em `group_mailboxes` e quem
      // precisa do codigo para conferir a entrega do acesso. O admin da
      // plataforma tambem pode — ele ja le a senha IMAP do grupo.
      {
        const isOwner = !!group.owner_id && group.owner_id === callerId;

        let isPlatformAdmin = false;
        if (!isOwner) {
          const { data: callerProfile } = await supabaseAdmin
            .from("users").select("role").eq("id", callerId).maybeSingle();
          isPlatformAdmin = callerProfile?.role === "admin";
        }

        if (!isOwner && !isPlatformAdmin) {
          const { data: member } = await supabaseAdmin
            .from("group_members").select("id")
            .eq("group_id", group_id).eq("user_id", callerId).eq("status", "active").maybeSingle();
          const { data: subscription } = await supabaseAdmin
            .from("user_subscriptions").select("id")
            .eq("group_id", group_id).eq("user_id", callerId).eq("status", "active").maybeSingle();
          if (!member && !subscription) {
            return new Response(JSON.stringify({ error: "Você não é membro deste grupo" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      }

      if (!group.email_code_enabled) {
        return new Response(JSON.stringify({ error: "Busca de códigos não habilitada para este grupo" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // A credencial IMAP foi movida para `group_mailboxes` (RLS por admin).
      // Ler direto de `groups` nao e mais possivel.
      const { data: mailbox, error: mailboxError } = await supabaseAdmin
        .from("group_mailboxes")
        .select(`
          email_imap_server, email_imap_port,
          email_imap_user, email_imap_password, email_allowed_senders,
          email_code_patterns, email_body_keywords, email_subject_includes,
          email_ai_enabled
        `)
        .eq("group_id", group_id)
        .maybeSingle();

      if (mailboxError || !mailbox) {
        return new Response(JSON.stringify({ error: "Configuração de e-mail incompleta para este grupo" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!mailbox.email_imap_server || !mailbox.email_imap_user || !mailbox.email_imap_password) {
        return new Response(JSON.stringify({ error: "Configuração de e-mail incompleta para este grupo" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const imapPort = mailbox.email_imap_port || 993;
      const allowedSenders = mailbox.email_allowed_senders || [];
      const subjectIncludes = mailbox.email_subject_includes || [];

      const { data: groqSetting } = await supabaseAdmin
        .from("app_settings")
        .select("value")
        .eq("key", "groq_api_key")
        .maybeSingle();
      const groqApiKey = groqSetting?.value || "";

      let serviceName = "streaming";
      if (group.service_id) {
        const { data: service } = await supabaseAdmin
          .from("streaming_services")
          .select("name")
          .eq("id", group.service_id)
          .maybeSingle();
        if (service?.name) serviceName = service.name;
      }

      // A PLATAFORMA do grupo é a fonte de verdade da checagem de e-mail.
      //
      // POR QUE VIR DO BANCO E NÃO DO FRONT
      // ----------------------------------
      // A caixa do grupo é compartilhada entre plataformas: o mesmo endereço
      // (ex.: grupo1@dividepass.com) recebe e-mail de várias contas ao
      // mesmo tempo. Sem esta checagem, o usuário na tela do Crunchyroll
      // recebia o código do Netflix — "certinho" para o regex, mas inútil
      // para ele. A plataforma vem do `service_id` do grupo (`streaming_services`),
      // resolvida AQUI no servidor: o front não manda o nome da plataforma
      // justamente para que ela não possa ser falsificada.
      const plataforma: PlatformInfo = plataformaDoServico(serviceName);
      console.log(`[fetch-email-code] Plataforma do grupo: ${plataforma.label} (${plataforma.key})`);

      const groupConfig: GroupConfig = {
        email_code_patterns: mailbox.email_code_patterns || [],
        email_body_keywords: mailbox.email_body_keywords || [],
        email_subject_includes: subjectIncludes,
        email_ai_enabled: mailbox.email_ai_enabled === true && !!groqApiKey,
        email_allowed_senders: allowedSenders,
      };

      const conn = await Deno.connectTls({
        hostname: mailbox.email_imap_server,
        port: imapPort,
      });

      const client = new ImapClient(conn);
      try {
        await client.connect();
        await client.login(mailbox.email_imap_user, mailbox.email_imap_password);
        await client.selectInbox();

        const allUids = await client.searchAll();

        if (allUids.length === 0) {
          return Response.json({ code: null, message: "Caixa de entrada vazia." }, { headers: corsHeaders });
        }

        const sortedUids = [...allUids].reverse();
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;

        let resultCode: string | null = null;
        let foundSender = "";
        let foundSubject = "";
        let foundDate = "";
        let foundSourceUrl = "";
        let sensitive = false;
        let sensitiveType = "";
        let sensitiveMessage = "";
        // Índice (na lista de e-mails, do mais novo para o mais antigo) do
        // e-mail de onde veio o código — usado para comparar com o botão.
        let indiceCodigo = -1;

        // E-mails candidatos. `plataforma` traz o resultado da checagem:
        // "match" (é da plataforma pedida) ou "unknown" (sem sinal claro —
        // entra como fallback para não quebrar serviços fora da tabela).
        const emailBodies: {
          body: string; html: string; sender: string; subject: string; date: string;
          plataforma: ClassificacaoEmail;
          temBotao?: boolean;
        }[] = [];

        // Quais outras plataformas apareceram na caixa e foram descartadas.
        const plataformasIgnoradas = new Map<string, number>();

        for (const uid of sortedUids.slice(0, 20)) {
          const headerBlock = await client.fetchHeaders(uid);
          const sender = extractSender(headerBlock);
          const subject = extractSubject(headerBlock);
          const emailDate = extractEmailDate(headerBlock);

          console.log(`[fetch-email-code] UID ${uid} | From: ${sender} | Subject: ${subject} | Date: ${emailDate}`);

          if (emailDate) {
            const parsed = new Date(emailDate);
            if (!isNaN(parsed.getTime()) && parsed.getTime() < twoHoursAgo) {
              console.log(`[fetch-email-code] SKIP UID ${uid}: email antigo (>2h)`);
              continue;
            }
          }

          if (!isSenderAllowed(sender, allowedSenders)) {
            console.log(`[fetch-email-code] SKIP UID ${uid}: remetente não permitido`);
            continue;
          }

          if (!isSubjectAllowed(subject, subjectIncludes)) {
            console.log(`[fetch-email-code] SKIP UID ${uid}: assunto não inclui termos permitidos`);
            continue;
          }

          // ETAPA 0 (PLATAFORMA): a caixa do grupo é COMPARTILHADA — o mesmo
          // endereço recebe e-mail de várias plataformas (Netflix, Crunchyroll,
          // ...). E-mail de outra plataforma NÃO pode virar código. Antes de
          // baixar o corpo, o remetente e o assunto já dizem de quem é.
          const preClass = classificarEmailParaPlataforma({ sender, subject, body: "" }, plataforma);
          if (preClass === "foreign") {
            const detectada = detectarPlataformaDoEmail({ sender, subject, body: "" });
            const nome = detectada?.label || "outra plataforma";
            plataformasIgnoradas.set(nome, (plataformasIgnoradas.get(nome) || 0) + 1);
            console.log(`[fetch-email-code] SKIP UID ${uid}: e-mail de outra plataforma (${nome}) — plataforma pedida: ${plataforma.label}`);
            continue;
          }

          const { text: bodyText, html: bodyHtml } = await client.fetchBody(uid);
          console.log(`[fetch-email-code] UID ${uid} body length: ${bodyText.length}, preview: ${bodyText.substring(0, 200)}`);

          // Reconfirma com o corpo: às vezes a marca da plataforma só aparece
          // no texto do e-mail (remetente e assunto genéricos).
          const classificacao = classificarEmailParaPlataforma({ sender, subject, body: bodyText }, plataforma);
          if (classificacao === "foreign") {
            const detectada = detectarPlataformaDoEmail({ sender, subject, body: bodyText })
              || detectarMarcaNoTexto(subject, bodyText);
            const nome = detectada?.label || "outra plataforma";
            plataformasIgnoradas.set(nome, (plataformasIgnoradas.get(nome) || 0) + 1);
            console.log(`[fetch-email-code] SKIP UID ${uid}: corpo de outra plataforma (${nome}) — plataforma pedida: ${plataforma.label}`);
            continue;
          }

          emailBodies.push({ body: bodyText, html: bodyHtml, sender, subject, date: emailDate, plataforma: classificacao });
        }

        emailBodies.sort((a, b) => {
          const da = a.date ? new Date(a.date).getTime() : 0;
          const db = b.date ? new Date(b.date).getTime() : 0;
          return db - da;
        });

        // Plataformas descartadas: o front avisa o usuário para que ele não
        // conclua que a caixa do grupo está vazia.
        const ignoradas = [...plataformasIgnoradas.entries()]
          .map(([label, quantidade]) => ({ label, quantidade }));

        // ETAPA 1 (prioridade máxima): e-mails de CONFIRMAÇÃO.
        // Ex.: "Importante: Como atualizar sua residência Netflix", botão "Sim, fui eu".
        // Ex.: Crunchyroll "Notamos um novo login", botões "FUI EU" / "NÃO FUI EU".
        // Esses e-mails NÃO têm código: o link é de uso único e expira em ~15min, então
        // nunca deve ser acessado pelo servidor. É preciso rodar ANTES da IA e do regex,
        // porque ambos podem devolver um código falso (o nftoken da URL tem vários
        // dígitos) ou um código antigo de um e-mail "seu código de acesso" anterior.
        //
        // EXCEÇÃO — E-MAIL DE BOTÃO (Netflix "código de acesso temporário"):
        // ele NÃO interrompe a busca aqui. A Netflix pode mandar o botão e o
        // código em texto; se houver código, ele tem que aparecer. O botão
        // fica GUARDADO e só é usado no fim, se não houver código (ou se o
        // botão for mais novo que o código encontrado).
        let acaoPendente: { url: string; texto: string; tipo: ConfirmacaoTipo } | null = null;
        let indiceAcaoPendente = -1;

        for (const [indice, email] of emailBodies.entries()) {
          // Só e-mail DA plataforma pedida chega aqui: um e-mail de outra
          // plataforma nunca vira cartão de confirmação.
          if (email.plataforma !== "match") continue;

          const tipoConfirmacao = looksLikeConfirmationEmail(email.subject, email.body);
          if (!tipoConfirmacao) continue;

          const acao = extractActionLink(email.html || "", email.body || "");
          if (!acao) {
            console.log(`[fetch-email-code] E-mail de confirmação sem link utilizável: ${email.subject}`);
            continue;
          }

          const details = extractRequestDetails(email.html || "", email.body || "");

          if (tipoConfirmacao === "access_code") {
            // Botão: a ação fica guardada (a busca de código continua).
            email.temBotao = true;
            acaoPendente = { url: acao.url, texto: acao.texto, tipo: tipoConfirmacao };
            indiceAcaoPendente = indice;
            console.log(`[fetch-email-code] E-mail de botão detectado — ação guardada: ${acao.url.slice(0, 90)}... (texto do botão: "${acao.texto}")`);
            continue;
          }

          console.log(`[fetch-email-code] Confirmação (${tipoConfirmacao}) detectada — link entregue ao usuário: ${acao.url.slice(0, 90)}...`);
          if (details) {
            console.log(`[fetch-email-code] Detalhe do pedido: ${details.requester} / ${details.device} / ${details.when} / ${details.location}`);
          }

          return Response.json(
            montarRespostaAcaoManual(acao, tipoConfirmacao, plataforma, email, details, ignoradas),
            { headers: corsHeaders },
          );
        }

        if (groupConfig.email_ai_enabled && groqApiKey && emailBodies.length > 0) {
          const aiEmails = emailBodies.slice(0, 3);
          console.log(`[fetch-email-code] IA habilitada, processando ${aiEmails.length} emails mais recentes com Groq...`);
          for (const [indice, email] of aiEmails.entries()) {
            // E-mail de BOTÃO: a IA pode "achar" um código nos dígitos do
            // token da URL do botão. O código (se a Netflix mandar em texto)
            // é lido pelo regex exato, que para esse e-mail é suficiente.
            if (email.temBotao) {
              const direto = extractCode(email.body, groupConfig);
              console.log(`[fetch-email-code] E-mail de botão — regex direto:`, JSON.stringify(direto));
              if (direto.code) {
                resultCode = direto.code;
                foundSender = email.sender;
                foundSubject = email.subject;
                foundDate = email.date;
                sensitive = direto.sensitive === true;
                sensitiveType = direto.sensitiveType || "";
                sensitiveMessage = direto.sensitiveMessage || "";
                indiceCodigo = indice;
                break;
              }
              continue;
            }

            const aiResult = await extractCodeWithAI(email.body, groqApiKey, serviceName);
            if (aiResult) {
              console.log(`[fetch-email-code] IA retornou:`, JSON.stringify(aiResult));
              if (aiResult.code) {
                resultCode = aiResult.code;
                foundSender = email.sender;
                foundSubject = email.subject;
                foundDate = email.date;
                sensitive = aiResult.sensitive === true;
                sensitiveType = aiResult.sensitiveType || "";
                sensitiveMessage = aiResult.sensitiveMessage || "";
                indiceCodigo = indice;
                break;
              }
            }
          }
        }

        if (!resultCode) {
          console.log(`[fetch-email-code] ${groupConfig.email_ai_enabled ? 'IA não encontrou, fallback para regex' : 'Usando regex'}`);
          for (const [indice, email] of emailBodies.entries()) {
            const result = extractCode(email.body, groupConfig);
            console.log(`[fetch-email-code] regex result:`, JSON.stringify(result));

            if (result.code) {
              resultCode = result.code;
              foundSender = email.sender;
              foundSubject = email.subject;
              foundDate = email.date;
              sensitive = result.sensitive === true;
              sensitiveType = result.sensitiveType || "";
              sensitiveMessage = result.sensitiveMessage || "";
              indiceCodigo = indice;
              break;
            }
          }
        }

        if (!resultCode) {
          console.log(`[fetch-email-code] Nenhum código no corpo dos e-mails. Tentando seguir links/botões...`);
          // Orçamento de tempo: a função é encerrada pelo gateway se demorar demais e
          // devolve corpo vazio (o front reportava "Unexpected end of JSON input").
          const linkStageDeadline = Date.now() + LINK_STAGE_BUDGET_MS;
          linkLoop:
          for (const [indice, email] of emailBodies.slice(0, 3).entries()) {
            // Link de confirmação/botão não pode ser acessado pelo servidor
            // (uso único): é o próprio botão que o usuário precisa clicar.
            if (looksLikeConfirmationEmail(email.subject, email.body)) continue;

            const links = extractCandidateLinks(email.html || "", email.body || "");
            if (links.length === 0) continue;
            console.log(`[fetch-email-code] ${links.length} links candidatos no email de ${email.sender}`);

            for (const link of links.slice(0, MAX_LINKS_PER_EMAIL)) {
              if (Date.now() > linkStageDeadline) {
                console.log(`[fetch-email-code] Orçamento de tempo esgotado, interrompendo busca em links`);
                break linkLoop;
              }

              console.log(`[fetch-email-code] Acessando: ${link}`);
              const pageText = await fetchPageText(link);
              if (!pageText) continue;

              // Regex primeiro (gratuito e instantâneo); IA só se o regex falhar.
              let result: CodeResult | null = extractCode(pageText, groupConfig);
              if (!result.code && groupConfig.email_ai_enabled && groqApiKey) {
                const aiResult = await extractCodeWithAI(pageText, groqApiKey, serviceName, true);
                if (aiResult?.code) result = aiResult;
              }

              if (result?.code) {
                console.log(`[fetch-email-code] Código encontrado via link: ${result.code}`);
                resultCode = result.code;
                foundSender = email.sender;
                foundSubject = email.subject;
                foundDate = email.date;
                foundSourceUrl = link;
                sensitive = result.sensitive === true;
                sensitiveType = result.sensitiveType || "";
                sensitiveMessage = result.sensitiveMessage || "";
                indiceCodigo = indice;
                break linkLoop;
              }
            }
          }
        }

        // BOTÃO x CÓDIGO: o botão só entra no lugar do código se for MAIS NOVO
        // que ele (a Netflix pode ter trocado o pedido) ou se não houver
        // código nenhum. Assim o extrator de código continua valendo — o botão
        // é a NOVA feature, não um substituto.
        if (acaoPendente && (indiceCodigo === -1 || indiceAcaoPendente < indiceCodigo)) {
          const emailBotao = emailBodies[indiceAcaoPendente];
          const details = extractRequestDetails(emailBotao.html || "", emailBotao.body || "");
          console.log(`[fetch-email-code] Botão entregue ao usuário (sem código): ${acaoPendente.url.slice(0, 90)}...`);
          return Response.json(
            montarRespostaAcaoManual(acaoPendente, acaoPendente.tipo, plataforma, emailBotao, details, ignoradas),
            { headers: corsHeaders },
          );
        }

        if (!resultCode) {
          // A mensagem NÃO repete as plataformas ignoradas: elas vão no campo
          // `skipped_platforms` e o front mostra um aviso próprio para isso.
          const mensagem = `Nenhum código de verificação da plataforma ${plataforma.label} foi encontrado nos e-mails recentes (corpo ou links).`;
          return Response.json(
            {
              code: null,
              message: mensagem,
              platform_label: plataforma.label,
              skipped_platforms: ignoradas,
            },
            { headers: corsHeaders },
          );
        }

        if (sensitive) {
          return Response.json({
            code: null,
            sensitive: true,
            sensitiveType,
            sensitiveMessage,
            platform_label: plataforma.label,
            skipped_platforms: ignoradas,
            sender: foundSender,
            subject: foundSubject,
            source_url: foundSourceUrl || null,
            received_at: foundDate || new Date().toISOString(),
          }, { headers: corsHeaders });
        }

        await supabaseAdmin.from("verification_pins").insert({
          group_id,
          code: resultCode,
          source_email: foundSender,
          used: false,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        }).then(() => {});

        return Response.json({
          code: resultCode,
          platform_label: plataforma.label,
          skipped_platforms: ignoradas,
          sender: foundSender,
          subject: foundSubject,
          source: foundSourceUrl ? "link" : "email_body",
          source_url: foundSourceUrl || null,
          received_at: foundDate || new Date().toISOString(),
          expires_in: 600,
        }, { headers: corsHeaders });
      } finally {
        client.close();
      }
    } catch (error) {
      console.error("fetch-email-code error:", error);
      const msg = error.message || "Erro interno ao buscar código";
      let hint = "";
      if (msg.includes("LOGIN failed")) hint = " Credenciais IMAP inválidas.";
      else if (msg.includes("Timeout") || msg.includes("timeout")) hint = " Servidor IMAP inacessível.";
      return new Response(JSON.stringify({ error: msg + hint }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
