import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const timer = setTimeout(() => controller.abort(), 12000);
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

      const body = await req.json();
      const { group_id } = body;

      if (!group_id) {
        return new Response(JSON.stringify({ error: "group_id é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (callerId) {
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

      const { data: group, error: groupError } = await supabaseAdmin
        .from("groups")
        .select(`
          email_code_enabled, email_imap_server, email_imap_port,
          email_imap_user, email_imap_password, email_allowed_senders,
          email_code_patterns, email_body_keywords, email_subject_includes,
          email_ai_enabled, service_id
        `)
        .eq("id", group_id)
        .single();

      if (groupError || !group) {
        return new Response(JSON.stringify({ error: "Grupo não encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!group.email_code_enabled) {
        return new Response(JSON.stringify({ error: "Busca de códigos não habilitada para este grupo" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!group.email_imap_server || !group.email_imap_user || !group.email_imap_password) {
        return new Response(JSON.stringify({ error: "Configuração de e-mail incompleta para este grupo" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const imapPort = group.email_imap_port || 993;
      const allowedSenders = group.email_allowed_senders || [];
      const subjectIncludes = group.email_subject_includes || [];

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

      const groupConfig: GroupConfig = {
        email_code_patterns: group.email_code_patterns || [],
        email_body_keywords: group.email_body_keywords || [],
        email_subject_includes: subjectIncludes,
        email_ai_enabled: group.email_ai_enabled === true && !!groqApiKey,
        email_allowed_senders: allowedSenders,
      };

      const conn = await Deno.connectTls({
        hostname: group.email_imap_server,
        port: imapPort,
      });

      const client = new ImapClient(conn);
      try {
        await client.connect();
        await client.login(group.email_imap_user, group.email_imap_password);
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

        const emailBodies: { body: string; html: string; sender: string; subject: string; date: string }[] = [];

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

          const { text: bodyText, html: bodyHtml } = await client.fetchBody(uid);
          console.log(`[fetch-email-code] UID ${uid} body length: ${bodyText.length}, preview: ${bodyText.substring(0, 200)}`);

          emailBodies.push({ body: bodyText, html: bodyHtml, sender, subject, date: emailDate });
        }

        emailBodies.sort((a, b) => {
          const da = a.date ? new Date(a.date).getTime() : 0;
          const db = b.date ? new Date(b.date).getTime() : 0;
          return db - da;
        });

        if (groupConfig.email_ai_enabled && groqApiKey && emailBodies.length > 0) {
          const aiEmails = emailBodies.slice(0, 3);
          console.log(`[fetch-email-code] IA habilitada, processando ${aiEmails.length} emails mais recentes com Groq...`);
          for (const email of aiEmails) {
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
                break;
              }
            }
          }
        }

        if (!resultCode) {
          console.log(`[fetch-email-code] ${groupConfig.email_ai_enabled ? 'IA não encontrou, fallback para regex' : 'Usando regex'}`);
          for (const email of emailBodies) {
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
              break;
            }
          }
        }

        if (!resultCode) {
          console.log(`[fetch-email-code] Nenhum código no corpo dos e-mails. Tentando seguir links/botões...`);
          linkLoop:
          for (const email of emailBodies.slice(0, 5)) {
            const links = extractCandidateLinks(email.html || "", email.body || "");
            if (links.length === 0) continue;
            console.log(`[fetch-email-code] ${links.length} links candidatos no email de ${email.sender}`);

            for (const link of links) {
              console.log(`[fetch-email-code] Acessando: ${link}`);
              const pageText = await fetchPageText(link);
              if (!pageText) continue;

              let result: CodeResult | null = null;
              if (groupConfig.email_ai_enabled && groqApiKey) {
                const aiResult = await extractCodeWithAI(pageText, groqApiKey, serviceName, true);
                if (aiResult?.code) result = aiResult;
              }
              if (!result) {
                const regexResult = extractCode(pageText, groupConfig);
                if (regexResult.code) result = regexResult;
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
                break linkLoop;
              }
            }
          }
        }

        if (!resultCode) {
          return Response.json(
            { code: null, message: "Nenhum código de verificação encontrado nos e-mails recentes (corpo ou links)." },
            { headers: corsHeaders },
          );
        }

        if (sensitive) {
          return Response.json({
            code: null,
            sensitive: true,
            sensitiveType,
            sensitiveMessage,
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
