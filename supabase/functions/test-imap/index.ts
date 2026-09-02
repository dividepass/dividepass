const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

class ImapClient {
  private conn: Deno.TlsConn;
  private tag = 0;
  private buffer = "";

  constructor(conn: Deno.TlsConn) { this.conn = conn; }
  private nextTag(): string { this.tag++; return `A${String(this.tag).padStart(3, "0")}`; }

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
    if (!greeting.startsWith("* OK")) throw new Error(`Greeting failed: ${greeting}`);
  }

  async login(user: string, password: string): Promise<void> {
    const tag = this.nextTag();
    await this.conn.write(new TextEncoder().encode(`${tag} LOGIN "${user}" "${password}"\r\n`));
    const response = await this.readUntil(tag);
    if (!response.includes(`${tag} OK`)) throw new Error(`LOGIN failed: ${response}`);
  }

  async selectInbox(): Promise<void> {
    const tag = this.nextTag();
    await this.conn.write(new TextEncoder().encode(`${tag} SELECT INBOX\r\n`));
    const response = await this.readUntil(tag);
    if (!response.includes(`${tag} OK`)) throw new Error(`SELECT failed: ${response}`);
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

  async searchSince(dateStr: string): Promise<number[]> {
    const tag = this.nextTag();
    await this.conn.write(new TextEncoder().encode(`${tag} SEARCH SINCE "${dateStr}"\r\n`));
    const response = await this.readUntil(tag);
    const searchLine = response.split("\r\n").find((l) => l.startsWith("* SEARCH"));
    if (!searchLine) return [];
    const nums = searchLine.replace("* SEARCH", "").trim();
    if (!nums) return [];
    return nums.split(/\s+/).map(Number);
  }

  async fetchHeaders(uid: number): Promise<string> {
    const tag = this.nextTag();
    await this.conn.write(new TextEncoder().encode(`${tag} FETCH ${uid} (BODY[HEADER.FIELDS (FROM SUBJECT DATE)])\r\n`));
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

  async fetchBody(uid: number): Promise<string> {
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
    return literalData || lines.join("\r\n");
  }

  close(): void { try { this.conn.close(); } catch {} }
}

const IMAP_SERVER = "mail.dividepass.com";
const IMAP_PORT = 993;
const IMAP_USER = "grupo2@dividepass.com";
const IMAP_PASS = "DianaDamGa8";

const ALLOWED_SENDERS = ["gwmorata@gmail.com", "info@account.netflix.com"];

function decodeBase64Safe(s: string): string {
  try {
    const cleaned = s.replace(/[\s\r\n]+/g, "");
    const bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch { return s; }
}

function decodeQPSafe(s: string): string {
  let r = s.replace(/=\r?\n/g, "");
  r = r.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return r;
}

function extractMimeDecode(raw: string): { plain: string; html: string } {
  let plain = "", html = "";
  const bMatch = raw.match(/Content-Type:[^]*?boundary="?([^";\r\n\s]+)"?/i);
  if (bMatch) {
    const b = bMatch[1];
    const parts = raw.split(new RegExp(`--${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?`));
    for (const part of parts) {
      const bodyIdx = part.indexOf("\r\n\r\n");
      const body = bodyIdx !== -1 ? part.substring(bodyIdx + 4).trim() : "";
      const enc = part.match(/Content-Transfer-Encoding:\s*(\S+)/i);
      const isBase64 = enc?.[1]?.toLowerCase() === "base64";
      const decoded = isBase64 ? decodeBase64Safe(body) : decodeQPSafe(body);
      if (/Content-Type:\s*text\/plain/i.test(part)) plain += decoded;
      else if (/Content-Type:\s*text\/html/i.test(part)) html += decoded;
    }
  } else {
    const bodyIdx = raw.indexOf("\r\n\r\n");
    const body = bodyIdx !== -1 ? raw.substring(bodyIdx + 4).trim() : raw;
    const enc = raw.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const isBase64 = enc?.[1]?.toLowerCase() === "base64";
    const decoded = isBase64 ? decodeBase64Safe(body) : decodeQPSafe(body);
    if (/Content-Type:\s*text\/html/i.test(raw)) html = decoded;
    else plain = decoded;
  }
  return { plain, html };
}

function stripHtmlTags(html: string): string {
  let t = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<\/div>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  t = t.replace(/&atilde;/g, "ã").replace(/&ccedil;/g, "ç").replace(/&oacute;/g, "ó").replace(/&eacute;/g, "é").replace(/&aacute;/g, "á");
  t = t.replace(/[ \t]+/g, " ");
  return t;
}

const logs: string[] = [];
function log(msg: string) { logs.push(msg); console.log(msg); }

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
      log(`Connecting to ${IMAP_SERVER}:${IMAP_PORT} as ${IMAP_USER}`);

      const conn = await Deno.connectTls({ hostname: IMAP_SERVER, port: IMAP_PORT });
      const client = new ImapClient(conn);

      await client.connect();
      log("Greeting OK");

      await client.login(IMAP_USER, IMAP_PASS);
      log("Login OK");

      await client.selectInbox();
      log("INBOX selected");

      const allUids = await client.searchAll();
      log(`Total emails in INBOX: ${allUids.length}`);

      if (allUids.length === 0) {
        client.close();
        return Response.json({ logs, result: "INBOX EMPTY" }, { headers: corsHeaders });
      }

      const last10 = allUids.slice(-10);
      log(`Last 10 UIDs: [${last10.join(", ")}]`);

      for (const uid of last10) {
        const headers = await client.fetchHeaders(uid);
        const fromMatch = headers.match(/From:\s*(.+)/i);
        const subMatch = headers.match(/Subject:\s*(.+)/i);
        const dateMatch = headers.match(/Date:\s*(.+)/i);
        const from = fromMatch?.[1]?.trim() || "N/A";
        const subject = subMatch?.[1]?.trim() || "N/A";
        const date = dateMatch?.[1]?.trim() || "N/A";

        const isAllowed = ALLOWED_SENDERS.some(s => from.toLowerCase().includes(s.toLowerCase()));
        log(`UID ${uid}: From="${from}" Subject="${subject}" Date="${date}" Allowed=${isAllowed}`);
      }

      const lastUid = allUids[allUids.length - 1];
      log(`\nFetching FULL body of UID ${lastUid}...`);
      const rawBody = await client.fetchBody(lastUid);
      log(`Raw body length: ${rawBody.length}`);

      const { plain, html } = extractMimeDecode(rawBody);
      log(`Decoded plain text length: ${plain.length}`);
      log(`Decoded html length: ${html.length}`);

      if (plain) {
        log(`\nDecoded plain text (first 800 chars):\n${plain.substring(0, 800)}`);
      }

      let htmlText = "";
      if (html) {
        htmlText = stripHtmlTags(html);
        log(`\nDecoded HTML stripped (first 800 chars):\n${htmlText.substring(0, 800)}`);
      }

      const CODE_PATTERNS = [
        /c[oó]digo\s+de\s+(?:verifica[çc][ãa]o|valida[çc][ãa]|acesso)[:\s]*(\d{4,8})/i,
        /verification\s+code[:\s]*(\d{4,8})/i,
        /your\s+(?:verification\s+)?code[:\s]*(\d{4,8})/i,
        /use\s+(?:this\s+)?code[:\s]*(\d{4,8})/i,
        /seu\s+c[oó]digo[:\s]*(\d{4,8})/i,
        /c[oó]digo[:\s]+(\d{4,8})/i,
        /pin[:\s]+(\d{4,8})/i,
        /(\d{6})\s+(?:is\s+your|for\s+your|é\s+seu|para\s+seu)/i,
        /enter\s+(\d{4,8})/i,
        /digite\s+(\d{4,8})/i,
        /insira\s+(\d{4,8})/i,
      ];

      const searchText = plain + (htmlText ? "\n" + htmlText : "");
      log(`\nSearching for codes in combined text (${searchText.length} chars)...`);

      let codeFound = false;
      for (const regex of CODE_PATTERNS) {
        const match = searchText.match(regex);
        if (match) {
          log(`CODE MATCHED: "${match[1]}" with pattern: ${regex.source}`);
          codeFound = true;
        }
      }
      if (!codeFound) {
        log("NO CODE MATCHED");
        const allNumbers = searchText.match(/\b(\d{4,8})\b/g);
        if (allNumbers) {
          log(`All 4-8 digit numbers found: [${allNumbers.slice(0, 20).join(", ")}]`);
        } else {
          log("No 4-8 digit numbers found at all");
        }
      }

      client.close();
      return Response.json({ logs, result: codeFound ? "CODE FOUND" : "NO CODE" }, { headers: corsHeaders });
    } catch (error) {
      log(`ERROR: ${error.message}`);
      return Response.json({ logs, error: error.message }, { status: 500, headers: corsHeaders });
    }
  },
};
