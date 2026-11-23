import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  plataformaDoServico,
  classificarEmailParaPlataforma,
  detectarPlataformaDoEmail,
  detectarMarcaNoTexto,
  type PlatformInfo,
  type ClassificacaoEmail,
} from "../_shared/plataforma-email.ts";
import {
  textoVisivel,
  limparHtml,
  stripHtml,
  classificarRestricao,
  extrairCodigo,
  codigoPresenteNoTexto,
  codigoPlausivel,
  type Restricao,
} from "../_shared/email-classificacao.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** E-mail candidato já baixado da caixa do grupo. */
interface EmailCandidato {
  body: string;
  html: string;
  sender: string;
  subject: string;
  date: string;
  plataforma: ClassificacaoEmail;
}

interface GroupConfig {
  email_code_patterns: string[];
  email_body_keywords: string[];
  email_subject_includes: string[];
  email_ai_enabled: boolean;
  email_allowed_senders: string[];
}

/**
 * BYTES → TEXTO (com o charset do e-mail).
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O decodificador antigo transformava CADA BYTE num caractere
 * (`String.fromCharCode`), ou seja, lia UTF-8 como Latin-1. O e-mail da
 * Netflix chegava escrito "cÃ³digo" em vez de "código" — e toda regex que
 * tem `[óo]` (botão de código, restrição, extrator de código) simplesmente
 * não casava. O e-mail era lido, nada era reconhecido, e a tela caía no
 * aviso genérico.
 *
 * A ordem de tentativa é de propósito: UTF-8 estrito primeiro (um texto
 * Latin-1 acentuado quase nunca forma UTF-8 válido, então ele falha aqui e
 * cai no charset declarado), depois o charset que o e-mail declarou, por
 * fim a versão com tolerância.
 */
function decodificarBytes(bytes: Uint8Array, charset: string): string {
  const cs = (charset || "utf-8").trim().toLowerCase().replace(/["']/g, "");
  const declarado =
    cs === "us-ascii" || cs === "us_ascii" ? "utf-8"
      : cs === "latin-1" || cs === "iso-8859-1" || cs === "iso8859-1" ? "windows-1252"
        : cs;

  const tentar = (label: string, fatal: boolean): string | null => {
    try {
      return new TextDecoder(label, { fatal }).decode(bytes);
    } catch {
      return null;
    }
  };

  return (
    tentar("utf-8", true) ??
    tentar(declarado, true) ??
    tentar(declarado, false) ??
    tentar("utf-8", false) ??
    ""
  );
}

function charsetDoBloco(bloco: string): string {
  // Ancorado no INÍCIO DA LINHA: um e-mail assinado por DKIM tem a linha
  // "h=From:To:Subject:...:Content-Transfer-Encoding:..." no cabeçalho, e
  // sem âncora a busca pegava essa lista em vez do cabeçalho verdadeiro —
  // o corpo ficava sem decodificar ("c=C3=B3digo" cru).
  const m = bloco.match(/(?:^|\r?\n)\s*Content-Type:[^\r\n]*?charset\s*=\s*"?([^"\r\n;]+)"?/i);
  return m?.[1]?.trim() || "utf-8";
}

function codificacaoDoBloco(bloco: string): string {
  const m = bloco.match(/(?:^|\r?\n)\s*Content-Transfer-Encoding:\s*([^\s;\r\n]+)/i);
  return (m?.[1] || "").toLowerCase();
}

function decodeBase64(s: string, charset = "utf-8"): string {
  try {
    const cleaned = s.replace(/[\s\r\n]+/g, "");
    const bin = atob(cleaned);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return decodificarBytes(bytes, charset);
  } catch {
    return s;
  }
}

function decodeQuotedPrintable(s: string, charset = "utf-8"): string {
  // "=C3=B3" é UM byte (0xC3) seguido de outro (0xB3) — juntos, em UTF-8,
  // são o "ó". Por isso o resultado monta BYTES e só depois vira texto.
  const semKebra = s.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < semKebra.length; i++) {
    const ch = semKebra[i];
    if (ch === "=" && /^[0-9A-Fa-f]{2}/.test(semKebra.slice(i + 1, i + 3))) {
      bytes.push(parseInt(semKebra.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(semKebra.charCodeAt(i) & 0xff);
    }
  }
  return decodificarBytes(Uint8Array.from(bytes), charset);
}

/**
 * Assunto/remetente chegam codificados (RFC 2047):
 * `=?UTF-8?Q?Seu_c=C3=B3digo_de_acesso_tempor=C3=A1rio?=`.
 * Sem decodificar, NENHUMA regra de assunto casava — nem "código de acesso
 * temporário", nem as regras de restrição.
 */
function decodeRfc2047(valor: string): string {
  const bruto = valor || "";
  const decodificado = bruto.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_todo: string, charset: string, enc: string, texto: string) => {
      if (enc.toLowerCase() === "b") return decodeBase64(texto, charset);
      return decodeQuotedPrintable(texto.replace(/_/g, " "), charset);
    },
  );
  // Junta as partes ("=?UTF-8?Q?A?= =?UTF-8?Q?B?=") e desfaz a dobra do cabeçalho.
  return decodificado.replace(/\r?\n[ \t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function extractMimeParts(raw: string): { plain: string; html: string } {
  let plain = "";
  let html = "";
  const parteDecodificada = (part: string): string => {
    const bodyIdx = part.indexOf("\r\n\r\n");
    const body = bodyIdx !== -1 ? part.substring(bodyIdx + 4).trim() : "";
    if (!body) return "";
    const modo = codificacaoDoBloco(part);
    const charset = charsetDoBloco(part);
    if (modo === "base64") return decodeBase64(body, charset);
    if (modo === "quoted-printable") return decodeQuotedPrintable(body, charset);
    return body;
  };

  const bMatch = raw.match(/Content-Type:[\s\S]*?boundary="?([^";\r\n\s]+)"?/i);
  if (bMatch) {
    const b = bMatch[1];
    const parts = raw.split(new RegExp(`--${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?`));
    for (const part of parts) {
      const decoded = parteDecodificada(part);
      if (!decoded) continue;
      if (/Content-Type:\s*text\/plain/i.test(part)) plain += decoded;
      else if (/Content-Type:\s*text\/html/i.test(part)) html += decoded;
    }
  } else {
    const bodyIdx = raw.indexOf("\r\n\r\n");
    const cabecalhos = bodyIdx !== -1 ? raw.substring(0, bodyIdx) : "";
    const corpo = bodyIdx !== -1 ? raw.substring(bodyIdx + 4).trim() : raw;
    const decoded = parteDecodificada(`${cabecalhos}\r\n\r\n${corpo}`);
    if (/Content-Type:\s*text\/html/i.test(raw)) html = decoded;
    else plain = decoded;
  }
  return { plain, html };
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
  botao?: string | null;
  reason?: string;
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
// Endereços que aparecem no HTML mas não são link de nada: DOCTYPE, schema,
// namespace XML. Sem esse filtro, o "botão" do e-mail virava
// http://www.w3.org/TR/html4/loose.dtd.
const LINK_SEM_SENTIDO = /(w3\.org|schema\.org|xmlsoap\.org|purl\.org|www\.w3\.org|loose\.dtd|\/TR\/html)/i;

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
  if (LINK_SEM_SENTIDO.test(url)) return null;
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

  // Textos CURTOS de propósito: no mobile o cartão ficava com muitas linhas
  // e a rolagem da tela ficava enorme. A plataforma aparece no selo ao lado
  // do título, então as frases não precisam repetir o nome dela.
  const mensagem = eLogin
    ? "Novo login detectado. Confirme que foi você para liberar o acesso."
    : eCodigo
      ? "Foi pedido um código de acesso temporário. Toque no botão para gerá-lo."
      : "Esta solicitação precisa ser aprovada. Toque no botão para liberar o acesso.";

  const nota = eLogin
    ? "Confirme que foi você. O link expira em 15 min."
    : eCodigo
      ? "O código é gerado na página da plataforma. O link expira em 15 min."
      : "Aprove a solicitação. O link expira em 15 min.";

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
//
// E devolve a PONTUAÇÃO. Ela é o filtro do "botão de verdade": um e-mail que
// não é pedido de confirmação só entrega botão quando o link tem cara de
// AÇÃO (texto tipo CTA + URL de verificação), senão um botão de marketing
// ("Assistir agora") tomaria o lugar do código.
function extractActionLink(html: string, plain: string): { url: string; texto: string; pontos: number; acao: boolean } | null {
  const scored = new Map<string, { pontos: number; texto: string; acao: boolean }>();

  const score = (url: string | null, points: number, texto = "", ehAcao = false): void => {
    if (!url) return;
    const clean = normalizeUrl(url);
    if (!clean) return;
    // Link de NEGAÇÃO ("não fui eu"): nunca pode ser entregue ao usuário.
    if (DENY_URL_HINTS.test(clean)) return;
    const atual = scored.get(clean);
    if (!atual) {
      scored.set(clean, { pontos: points, texto, acao: ehAcao });
      return;
    }
    atual.pontos += points;
    atual.acao = atual.acao || ehAcao;
    // Guarda o texto do botão (o que casou com o CTA), sem sobrescrever.
    if (texto && !atual.texto) atual.texto = texto;
  };

  const bump = (value: number, text: string, href: string): void => {
    // Botão de NEGAÇÃO ("NÃO FUI EU"): clicar nele troca a senha da conta
    // em vez de liberar o acesso. Precisa ser descartado aqui — e, como
    // "NÃO FUI EU" contém "FUI EU", ele casaria com o padrão de aprovação.
    if (DENY_CTA_TEXT.test(text)) return;
    const textoEhCta = CONFIRM_CTA_TEXT.test(text);
    const urlEhAcao = CONFIRM_URL_HINTS.test(href);
    if (textoEhCta) value += 4;
    if (urlEhAcao) value += 3;
    if (PLATFORM_SENDER.test(href)) value += 1;
    if (/(btn|button|cta)/i.test(text)) value += 1;
    score(href, value, text, textoEhCta || urlEhAcao);
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
    score(m[1], 3, "", true);
  }

  // 3) <button onclick="window.location='...'">
  const onClickRe = /(?:onclick|location(?:\.href)?\s*=\s*)["'][^"']*?(https?:\/\/[^"']+)["']/gi;
  while ((m = onClickRe.exec(html)) !== null) {
    bump(2, "", m[1]);
  }

  // 4) URLs soltas no texto (tracking redirects do próprio e-mail)
  const bareRe = /https?:\/\/[^\s<>"')]+/g;
  while ((m = bareRe.exec(html + "\n" + plain)) !== null) {
    score(m[0], 1, "", CONFIRM_URL_HINTS.test(m[0]));
  }

  if (scored.size === 0) return null;
  const melhor = [...scored.entries()].sort((a, b) => b[1].pontos - a[1].pontos)[0];
  return { url: melhor[0], texto: melhor[1].texto, pontos: melhor[1].pontos, acao: melhor[1].acao };
}

// Nota mínima para um e-mail que NÃO é pedido de confirmação entregar o botão:
// 2 (âncora) + 4 (texto de CTA) ou 2 + 3 (URL de verificação) já passam;
// botão de marketing (2 + 1 do domínio) fica de fora.
const PONTOS_MIN_BOTAO_GENERICO = 6;
function extractCandidateLinks(html: string, plain: string): string[] {
  const found = new Map<string, number>();
  const add = (rawUrl: string, baseScore: number) => {
    let url = rawUrl.replace(/=3D/gi, "=").replace(/&amp;/g, "&").trim();
    url = url.replace(/[)\].,;'"]+$/, "");
    if (!/^https?:\/\//i.test(url)) return;
    if (LINK_BLOCKLIST.test(url)) return;
    if (LINK_SEM_SENTIDO.test(url)) return;
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
    // textoVisivel (e não stripHtml puro): sem isso o CSS da página entra na
    // varredura e "#e00000" virava o "código 0000" — código falso entregue ao
    // usuário no lugar de um "nenhum código encontrado".
    return `${finalUrl}\n${textoVisivel(rawPage.substring(0, 300000), "")}`;
  } catch (err) {
    console.log(`[fetch-email-code] Falha ao acessar link ${url}:`, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Modelos da Groq, do melhor para o mais barato. A lista existe porque a
// Groq aposenta modelos sem aviso: com um nome só (o antigo
// "llama-3.3-70b-versatile") a API respondia 404, a IA virava nula e a
// análise ficava só no regex.
const GROQ_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

async function extractCodeWithAI(content: string, apiKey: string, serviceName: string, isPage = false): Promise<CodeResult | null> {
  const prompt = `Você é um extrator de códigos de verificação e acesso. Analise o conteúdo abaixo (${isPage ? "página web aberta a partir do link de um botão do email" : "email"}).

CONTEXTO: Foi enviado para uma conta compartilhada da plataforma "${serviceName}".

Regras:
1. Este conteúdo é da plataforma ${serviceName}? Se NÃO for, retorne {"is_verification": false, "code": null, "is_sensitive": false, "reason": "conteúdo não é da plataforma ${serviceName}"}
2. Se contém um CÓDIGO de verificação/acesso (4 a 8 dígitos) escrito no texto, retorne o código.
3. NUNCA retorne: data, horário, ano, número de pedido, ID de transação ou os caracteres de um token que está dentro de uma URL.
4. Se o e-mail PEDE para trocar senha, trocar e-mail da conta, atualizar cartão/forma de pagamento, ou avisa conta bloqueada/suspensa, marque is_sensitive true.
   IMPORTANTE: uma DICA de segurança no rodapé ("se você não reconheceu, altere sua senha") NÃO é um pedido de troca de senha — nesse caso is_sensitive é false.
5. Se não há código no texto, mas existe um botão/link para o usuário clicar (ex.: "Receber código", "Sim, fui eu"), retorne code null e button_label com o texto do botão.
6. Se não há nada disso, retorne code null.

Retorne APENAS JSON válido (sem markdown, sem texto extra):
{"is_verification": true/false, "code": "123456" ou null, "is_sensitive": true/false, "button_label": "texto do botão" ou null, "reason": "breve descrição"}

Conteúdo:
${content.substring(0, 3000)}`;

  for (const model of GROQ_MODELS) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 250,
        }),
      });

      if (!response.ok) {
        console.log(`[fetch-email-code] Groq API error (${model}): ${response.status}`);
        continue;
      }

      const data = await response.json();
      const aiContent = data.choices?.[0]?.message?.content?.trim();
      if (!aiContent) continue;

      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = JSON.parse(jsonMatch[0]);
      const codigo = parsed.code ? String(parsed.code).replace(/\D/g, "").substring(0, 8) : null;

      return {
        code: parsed.is_verification ? codigo : null,
        sensitive: parsed.is_verification === true && parsed.is_sensitive === true,
        sensitiveType: "ai_detected_sensitive",
        sensitiveMessage: parsed.reason || "operação de segurança",
        botao: parsed.button_label ? String(parsed.button_label).substring(0, 60) : null,
        reason: parsed.reason || "",
      };
    } catch (err) {
      console.log(`[fetch-email-code] Groq AI error (${model}):`, err.message);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// DECISÃO DO QUE MOSTRAR AO GRUPO: RESTRIÇÃO → CÓDIGO → BOTÃO
//
// Recebe os e-mails já filtrados (plataforma, remetente, janela de 2h) e
// devolve a resposta que o aplicativo mostra. Não fala com IMAP nem com o
// banco: assim dá para rodar a mesma decisão contra e-mails reais em teste.
// ─────────────────────────────────────────────────────────────────────────
async function analisarEmails(opcoes: {
emailBodies: EmailCandidato[];
plataforma: PlatformInfo;
serviceName: string;
groupConfig: GroupConfig;
groqApiKey: string;
ignoradas: { label: string; quantidade: number }[];
registrarPin?: (code: string, sender: string) => Promise<void>;
}): Promise<Response> {
const { emailBodies, plataforma, serviceName, groupConfig, groqApiKey, ignoradas, registrarPin } = opcoes;

let resultCode: string | null = null;
let foundSender = "";
let foundSubject = "";
let foundDate = "";
let foundSourceUrl = "";

  // ─────────────────────────────────────────────────────────────────────
  // ETAPA 1 — ANÁLISE DO E-MAIL (do mais novo para o mais antigo).
  //
  // A ordem é a regra do produto e vale para QUALQUER plataforma:
  //   1. LER O E-MAIL. Ele está PEDINDO troca de senha, troca de e-mail,
  //      cartão de crédito/forma de pagamento, ou avisando conta
  //      bloqueada/suspensa? → RESTRIÇÃO: nada desse e-mail é mostrado.
  //   2. Não é restrição e o e-mail traz um CÓDIGO/TOKEN no texto?
  //      → o código é mostrado ao grupo.
  //   3. Não traz código, mas traz um BOTÃO que direciona para a
  //      plataforma? → o botão é mostrado no aplicativo.
  //
  // QUEM DECIDE A RESTRIÇÃO É O E-MAIL, NÃO A IA. A IA só ajuda a
  // encontrar código. Antes, o "sensível" da IA bastava para bloquear:
  // no e-mail do código de acesso temporário da Netflix ele marcava a
  // DICA de segurança do rodapé ("Você também pode alterar a senha") e
  // o botão ficava escondido atrás do aviso de PIN.
  //
  // A checagem roda sobre o TEXTO VISÍVEL (sem CSS): o CSS da Netflix
  // traz a classe "suspended", que casava com a regra de conta
  // bloqueada.
  // ─────────────────────────────────────────────────────────────────────
  let indiceRestrito = -1;
  let restricaoEmail: Restricao | null = null;
  // Botão de e-mail que NÃO é pedido de confirmação: guardado e usado só
  // se nenhum código aparecer em nenhum e-mail.
  let botaoGenerico: {
    acao: { url: string; texto: string };
    email: (typeof emailBodies)[number];
  } | null = null;

  for (const [indice, email] of emailBodies.entries()) {
    // Só e-mail DA plataforma pedida chega aqui: um e-mail de outra
    // plataforma nunca vira cartão de confirmação.
    if (email.plataforma !== "match") continue;

    const corpo = textoVisivel(email.html || "", email.body || "");
    const htmlLimpo = limparHtml(email.html || "");

    // 1) RESTRIÇÃO — pedido de troca de senha/e-mail, cartão de
    //    crédito/forma de pagamento ou conta bloqueada.
    const restricao = classificarRestricao(email.subject, corpo);
    if (restricao) {
      if (indiceRestrito === -1) {
        indiceRestrito = indice;
        restricaoEmail = restricao;
      }
      console.log(`[fetch-email-code] E-mail RESTRITO (${restricao.tipo}) — descartado: ${email.subject}`);
      continue;
    }

    // 2) BOTÃO — é a alternativa quando o e-mail não traz o código.
    const tipoConfirmacao = looksLikeConfirmationEmail(email.subject, corpo);
    const acao = extractActionLink(htmlLimpo, email.body || "");
    const botaoDeConfirmacao = !!(tipoConfirmacao && acao);
    if (tipoConfirmacao && !acao) {
      console.log(`[fetch-email-code] E-mail de confirmação sem link utilizável: ${email.subject}`);
    }
    if (!tipoConfirmacao && !botaoGenerico && acao && acao.acao && acao.pontos >= PONTOS_MIN_BOTAO_GENERICO) {
      botaoGenerico = { acao, email };
      console.log(`[fetch-email-code] Botão de ação guardado (e-mail não é confirmação): ${acao.url.slice(0, 90)}...`);
    }

    // 3) CÓDIGO — a IA entra só nos e-mails mais novos e NUNCA no e-mail
    //    de botão de confirmação (o token da URL engana a IA).
    let codigo: string | null = null;

    if (!botaoDeConfirmacao && groupConfig.email_ai_enabled && groqApiKey && indice < 3) {
      const aiResult = await extractCodeWithAI(corpo, groqApiKey, serviceName);
      if (aiResult) {
        console.log(`[fetch-email-code] IA retornou:`, JSON.stringify(aiResult));
        if (!aiResult.code) {
          // A IA não achou código: segue para o botão do e-mail.
        } else if (codigoPlausivel(aiResult.code) && codigoPresenteNoTexto(aiResult.code, corpo)) {
          codigo = aiResult.code;
        } else {
          // Barreira contra alucinação: horário "15:22", ano "2026",
          // número de pedido.
          console.log(`[fetch-email-code] Código da IA não confere com o texto do e-mail — descartado: ${aiResult.code}`);
        }
      }
    }

    if (!codigo) {
      codigo = extrairCodigo(corpo, {
        padroes: groupConfig.email_code_patterns,
        palavrasChave: groupConfig.email_body_keywords,
      });
    }

    if (codigo) {
      console.log(`[fetch-email-code] Código encontrado no e-mail: ${codigo} (${email.subject})`);
      resultCode = codigo;
      foundSender = email.sender;
      foundSubject = email.subject;
      foundDate = email.date;
      break;
    }

    // 4) Sem código em texto: o botão do pedido é entregue na hora (ele é
    //    mais novo que qualquer código antigo da caixa).
    if (botaoDeConfirmacao && tipoConfirmacao) {
      const details = extractRequestDetails(htmlLimpo, email.body || "");
      console.log(`[fetch-email-code] Botão entregue ao usuário (${tipoConfirmacao}): ${acao!.url.slice(0, 90)}...`);
      if (details) {
        console.log(`[fetch-email-code] Detalhe do pedido: ${details.requester} / ${details.device} / ${details.when} / ${details.location}`);
      }
      return Response.json(
        montarRespostaAcaoManual(acao!, tipoConfirmacao, plataforma, email, details, ignoradas),
        { headers: corsHeaders },
      );
    }
  }

  if (!resultCode && !restricaoEmail) {
    console.log(`[fetch-email-code] Nenhum código no corpo dos e-mails. Tentando seguir links/botões...`);
    // Orçamento de tempo: a função é encerrada pelo gateway se demorar demais e
    // devolve corpo vazio (o front reportava "Unexpected end of JSON input").
    const linkStageDeadline = Date.now() + LINK_STAGE_BUDGET_MS;
    linkLoop:
    for (const [indice, email] of emailBodies.slice(0, 3).entries()) {
      // Link de confirmação/botão não pode ser acessado pelo servidor
      // (uso único): é o próprio botão que o usuário precisa clicar.
      if (looksLikeConfirmationEmail(email.subject, textoVisivel(email.html || "", email.body || ""))) continue;
      // Link que também é o BOTÃO guardado: mesmo motivo, é de uso único.
      if (botaoGenerico && botaoGenerico.email === email) continue;
      // E-mail restrito também não entra: o código dele não pode ser
      // mostrado ao grupo.
      if (indiceRestrito !== -1 && indice >= indiceRestrito) continue;

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
        let codigoDaPagina = extrairCodigo(pageText, {
          padroes: groupConfig.email_code_patterns,
          palavrasChave: groupConfig.email_body_keywords,
        });
        if (!codigoDaPagina && groupConfig.email_ai_enabled && groqApiKey) {
          const aiResult = await extractCodeWithAI(pageText, groqApiKey, serviceName, true);
          if (aiResult?.code && codigoPlausivel(aiResult.code) && codigoPresenteNoTexto(aiResult.code, pageText)) {
            codigoDaPagina = aiResult.code;
          }
        }

        if (codigoDaPagina) {
          console.log(`[fetch-email-code] Código encontrado via link: ${codigoDaPagina}`);
          resultCode = codigoDaPagina;
          foundSender = email.sender;
          foundSubject = email.subject;
          foundDate = email.date;
          foundSourceUrl = link;
          break linkLoop;
        }
      }
    }
  }

  if (!resultCode && restricaoEmail) {
    // O e-mail mais recente era um pedido de troca de senha/e-mail,
    // cartão de crédito ou bloqueio de conta: nada dele pode ser
    // mostrado ao grupo — só o aviso.
    const emailRestrito = emailBodies[indiceRestrito];
    console.log(`[fetch-email-code] Aviso de restrição (${restricaoEmail.tipo}) — nenhum código será exibido.`);
    return Response.json({
      code: null,
      sensitive: true,
      sensitiveType: restricaoEmail.tipo,
      sensitiveMessage: restricaoEmail.mensagem,
      platform_label: plataforma.label,
      skipped_platforms: ignoradas,
      sender: emailRestrito?.sender || foundSender,
      subject: emailRestrito?.subject || foundSubject,
      source_url: null,
      received_at: emailRestrito?.date || foundDate || new Date().toISOString(),
    }, { headers: corsHeaders });
  }

  if (!resultCode && botaoGenerico) {
    // Nenhum e-mail trouxe código, mas um deles trouxe um BOTÃO que
    // direciona para a plataforma: o botão vai para o aplicativo.
    const emailBotao = botaoGenerico.email;
    const details = extractRequestDetails(
      limparHtml(emailBotao.html || ""),
      emailBotao.body || "",
    );
    console.log(`[fetch-email-code] Botão genérico entregue ao usuário: ${botaoGenerico.acao.url.slice(0, 90)}...`);
    return Response.json(
      montarRespostaAcaoManual(
        botaoGenerico.acao,
        "generic",
        plataforma,
        emailBotao,
        details,
        ignoradas,
      ),
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

if (resultCode) {
  if (registrarPin) await registrarPin(resultCode, foundSender);

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

/**
 * Lê um cabeçalho (FROM/SUBJECT/DATE) juntando as linhas dobradas e
 * decodificando o RFC 2047. O assunto codificado era o motivo de as regras
 * de assunto nunca casarem.
 */
function headerField(headerBlock: string, nome: string): string {
  const re = new RegExp(`^${nome}:([\\s\\S]*?)(?=\\r?\\n(?!\\s)|\\s*$)`, "im");
  const m = headerBlock.match(re);
  if (!m) return "";
  return decodeRfc2047(m[1].replace(/\r?\n/g, " "));
}

function extractSender(headerBlock: string): string {
  return headerField(headerBlock, "From");
}

function extractSubject(headerBlock: string): string {
  return headerField(headerBlock, "Subject");
}

function extractEmailDate(headerBlock: string): string {
  return headerField(headerBlock, "Date");
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

        // E-mails candidatos. `plataforma` traz o resultado da checagem:
        // "match" (é da plataforma pedida) ou "unknown" (sem sinal claro —
        // entra como fallback para não quebrar serviços fora da tabela).
        const emailBodies: EmailCandidato[] = [];

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

        // A decisão (restrição → código → botão) vive fora do handler para poder
        // ser testada com e-mails reais, sem IMAP e sem banco.
        return await analisarEmails({
          emailBodies,
          plataforma,
          serviceName,
          groupConfig,
          groqApiKey,
          ignoradas,
          registrarPin: async (code, sender) => {
            await supabaseAdmin.from("verification_pins").insert({
              group_id,
              code,
              source_email: sender,
              used: false,
              expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            });
          },
        });
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
