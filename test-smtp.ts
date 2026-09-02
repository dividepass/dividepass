const SMTP_HOST = "mail.dividepass.com";
const SMTP_PORT = 465;
const SMTP_USER = "noreply@dividepass.com";
const SMTP_PASS = "DianaDamGa8";
const TO = "gwmorata@gmail.com";

class SmtpClient {
  private conn: Deno.TlsConn;
  private buffer = "";

  constructor(conn: Deno.TlsConn) {
    this.conn = conn;
  }

  private async readLine(): Promise<string> {
    while (true) {
      const nlIndex = this.buffer.indexOf("\r\n");
      if (nlIndex !== -1) {
        const line = this.buffer.substring(0, nlIndex);
        this.buffer = this.buffer.substring(nlIndex + 2);
        return line;
      }
      const chunk = new Uint8Array(4096);
      const n = await this.conn.read(chunk);
      if (n === null) throw new Error("Connection closed");
      this.buffer += new TextDecoder().decode(chunk.subarray(0, n));
    }
  }

  private async send(cmd: string): Promise<string> {
    await this.conn.write(new TextEncoder().encode(cmd + "\r\n"));
    const resp = await this.readLine();
    console.log(`> ${cmd.substring(0, 60)}`);
    console.log(`< ${resp}`);
    return resp;
  }

  async connect(): Promise<void> {
    let line = await this.readLine();
    while (line.startsWith("220-")) line = await this.readLine();
    if (!line.startsWith("220")) throw new Error(`Greeting failed: ${line}`);
    console.log("Connected OK");
  }

  async ehlo(): Promise<void> {
    let resp = await this.send(`EHLO dividepass.com`);
    while (resp.startsWith("250-")) resp = await this.readLine();
    if (!resp.startsWith("250")) throw new Error(`EHLO failed: ${resp}`);
  }

  async auth(): Promise<void> {
    let resp = await this.send(`AUTH LOGIN ${btoa(SMTP_USER)}`);
    if (!resp.startsWith("334")) throw new Error(`AUTH failed: ${resp}`);
    resp = await this.send(btoa(SMTP_PASS));
    if (!resp.startsWith("235")) throw new Error(`AUTH pass failed: ${resp}`);
    console.log("Auth OK");
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    let resp = await this.send(`MAIL FROM:<${SMTP_USER}>`);
    if (!resp.startsWith("250")) throw new Error(`MAIL FROM: ${resp}`);

    resp = await this.send(`RCPT TO:<${to}>`);
    if (!resp.startsWith("250")) throw new Error(`RCPT TO: ${resp}`);

    resp = await this.send("DATA");
    if (!resp.startsWith("354")) throw new Error(`DATA: ${resp}`);

    const boundary = `----=_Part_${Date.now()}`;
    const subjectBytes = new TextEncoder().encode(subject);
    const encSubject = btoa(String.fromCharCode.apply(null, subjectBytes as unknown as number[]));

    const headers = [
      `From: DividePass <${SMTP_USER}>`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${encSubject}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      `Date: ${new Date().toUTCString()}`,
    ].join("\r\n");

    const textPlain = "Este é um email de teste do DividePass com caracteres especiais: ç, ã, é, ü, ñ";

    const textHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:30px 15px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:16px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:28px 32px;text-align:center;">
<img src="https://www.dividepass.com/logo.png" alt="DividePass" width="48" height="48" style="border-radius:12px;margin-bottom:12px;" />
<h1 style="margin:0;color:#fff;font-size:22px;">Email de Teste</h1>
</td></tr>
<tr><td style="padding:28px 32px;">
<p style="color:#e2e8f0;font-size:15px;line-height:1.7;">
Este é um email de teste do <strong style="color:#818cf8;">DividePass</strong> com caracteres especiais:<br/>
<strong>ç</strong> <strong>ã</strong> <strong>é</strong> <strong>ü</strong> <strong>ñ</strong><br/><br/>
Se você está lendo isso com a acentuação correta, o encoding está funcionando!
</p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #334155;text-align:center;">
<p style="margin:0;color:#475569;font-size:12px;">DividePass &mdash; dividepass.com</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

    const textBytes = new TextEncoder().encode(textPlain);
    const encText = btoa(String.fromCharCode.apply(null, textBytes as unknown as number[]));

    const htmlBytes = new TextEncoder().encode(textHtml);
    const encHtml = btoa(String.fromCharCode.apply(null, htmlBytes as unknown as number[]));

    const body = [
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      encText,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      encHtml,
      ``,
      `--${boundary}--`,
    ].join("\r\n");

    await this.conn.write(new TextEncoder().encode(headers + "\r\n\r\n" + body + "\r\n.\r\n"));
    resp = await this.readLine();
    console.log(`< ${resp}`);
    if (!resp.startsWith("250")) throw new Error(`Send failed: ${resp}`);

    console.log("Email sent!");
  }

  async quit(): Promise<void> {
    try { await this.send("QUIT"); } catch {}
  }

  close(): void {
    try { this.conn.close(); } catch {}
  }
}

async function main() {
  console.log(`Connecting to ${SMTP_HOST}:${SMTP_PORT}...`);
  const conn = await Deno.connectTls({ hostname: SMTP_HOST, port: SMTP_PORT });
  const smtp = new SmtpClient(conn);

  try {
    await smtp.connect();
    await smtp.ehlo();
    await smtp.auth();
    await smtp.sendEmail(
      TO,
      "Teste DividePass - Caracteres Especiais: ç ã é ü ñ",
      "html"
    );
    await smtp.quit();
  } finally {
    smtp.close();
  }
}

main().catch(console.error);
