import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    return resp;
  }

  async connect(): Promise<void> {
    let line = await this.readLine();
    while (line.startsWith("220-")) line = await this.readLine();
    if (!line.startsWith("220")) throw new Error(`Greeting: ${line}`);
  }

  async ehlo(): Promise<void> {
    let resp = await this.send("EHLO dividepass.com");
    while (resp.startsWith("250-")) resp = await this.readLine();
    if (!resp.startsWith("250")) throw new Error(`EHLO: ${resp}`);
  }

  async auth(user: string, pass: string): Promise<void> {
    let resp = await this.send(`AUTH LOGIN ${btoa(user)}`);
    if (!resp.startsWith("334")) throw new Error(`AUTH: ${resp}`);
    resp = await this.send(btoa(pass));
    if (!resp.startsWith("235")) throw new Error(`AUTH pass: ${resp}`);
  }

  async sendEmail(to: string, from: string, subject: string, html: string, text: string): Promise<void> {
    let resp = await this.send(`MAIL FROM:<${from}>`);
    if (!resp.startsWith("250")) throw new Error(`MAIL FROM: ${resp}`);

    resp = await this.send(`RCPT TO:<${to}>`);
    if (!resp.startsWith("250")) throw new Error(`RCPT TO: ${resp}`);

    resp = await this.send("DATA");
    if (!resp.startsWith("354")) throw new Error(`DATA: ${resp}`);

    const boundary = `----=_Part_${Date.now()}`;
    const subjectBytes = new TextEncoder().encode(subject);
    const encSubject = btoa(String.fromCharCode.apply(null, subjectBytes as unknown as number[]));

    const headers = [
      `From: DividePass <${from}>`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${encSubject}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      `Date: ${new Date().toUTCString()}`,
    ].join("\r\n");

    const textBytes = new TextEncoder().encode(text);
    const encText = btoa(String.fromCharCode.apply(null, textBytes as unknown as number[]));

    const htmlBytes = new TextEncoder().encode(html);
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
    if (!resp.startsWith("250")) throw new Error(`Send: ${resp}`);
  }

  async quit(): Promise<void> {
    try { await this.send("QUIT"); } catch {}
  }

  close(): void {
    try { this.conn.close(); } catch {}
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const smtpPass = Deno.env.get("SMTP_PASS") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const { data: settings } = await supabaseAdmin
        .from("app_settings")
        .select("key, value")
        .in("key", ["smtp_host", "smtp_port", "smtp_user_noreply"]);

      const cfg: Record<string, string> = {};
      (settings || []).forEach((s: { key: string; value: string }) => { cfg[s.key] = s.value; });

      const host = cfg.smtp_host || "mail.dividepass.com";
      const port = parseInt(cfg.smtp_port || "465");
      const user = cfg.smtp_user_noreply || "noreply@dividepass.com";

      const body = await req.json();
      const { to } = body;

      if (!to) {
        return new Response(JSON.stringify({ error: "to é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const conn = await Deno.connectTls({ hostname: host, port });
      const smtp = new SmtpClient(conn);

      try {
        await smtp.connect();
        await smtp.ehlo();
        await smtp.auth(user, smtpPass);

        const subject = "Teste DividePass - Caracteres Especiais: ç ã é ü ñ";
        const text = "Este é um email de teste do DividePass com caracteres especiais: ç, ã, é, ü, ñ";
        const html = `<!DOCTYPE html>
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

        await smtp.sendEmail(to, user, subject, html, text);
        await smtp.quit();
      } finally {
        smtp.close();
      }

      return Response.json({ success: true, message: `Email enviado para ${to}` }, { headers: corsHeaders });
    } catch (error) {
      console.error("test-email error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
