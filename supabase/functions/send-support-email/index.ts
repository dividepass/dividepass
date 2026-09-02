import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DIVIDEPASS_SUPPORT_EMAIL = "suporte@dividepass.com";

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
      if (n === null) throw new Error("SMTP connection closed");
      this.buffer += new TextDecoder().decode(chunk.subarray(0, n));
    }
  }

  private async sendCommand(cmd: string): Promise<string> {
    await this.conn.write(new TextEncoder().encode(cmd + "\r\n"));
    const response = await this.readLine();
    console.log(`SMTP C: ${cmd.substring(0, 80)}`);
    console.log(`SMTP S: ${response}`);
    return response;
  }

  async connect(): Promise<void> {
    let line = await this.readLine();
    console.log(`SMTP S: ${line}`);
    while (line.startsWith("220-")) {
      line = await this.readLine();
      console.log(`SMTP S: ${line}`);
    }
    if (!line.startsWith("220")) {
      throw new Error(`SMTP greeting failed: ${line}`);
    }
  }

  async ehlo(hostname: string): Promise<void> {
    let resp = await this.sendCommand(`EHLO ${hostname}`);
    while (resp.startsWith("250-")) {
      resp = await this.readLine();
      console.log(`SMTP S: ${resp}`);
    }
    if (!resp.startsWith("250")) {
      throw new Error(`SMTP EHLO failed: ${resp}`);
    }
  }

  async auth(user: string, pass: string): Promise<void> {
    const authResp = await this.sendCommand(
      `AUTH LOGIN ${btoa(user)}`,
    );
    if (!authResp.startsWith("334")) {
      throw new Error(`SMTP AUTH LOGIN failed: ${authResp}`);
    }

    const passResp = await this.sendCommand(btoa(pass));
    if (!passResp.startsWith("235")) {
      throw new Error(`SMTP AUTH password failed: ${passResp}`);
    }
  }

  async mailFrom(from: string): Promise<void> {
    const resp = await this.sendCommand(`MAIL FROM:<${from}>`);
    if (!resp.startsWith("250")) {
      throw new Error(`SMTP MAIL FROM failed: ${resp}`);
    }
  }

  async rcptTo(to: string): Promise<void> {
    const resp = await this.sendCommand(`RCPT TO:<${to}>`);
    if (!resp.startsWith("250")) {
      throw new Error(`SMTP RCPT TO failed: ${resp}`);
    }
  }

  async data(): Promise<void> {
    const resp = await this.sendCommand("DATA");
    if (!resp.startsWith("354")) {
      throw new Error(`SMTP DATA failed: ${resp}`);
    }
  }

  async sendBody(headers: string, body: string): Promise<void> {
    const fullMessage = headers + "\r\n\r\n" + body + "\r\n.\r\n";
    await this.conn.write(new TextEncoder().encode(fullMessage));
    console.log("SMTP: message body sent");

    const resp = await this.readLine();
    console.log(`SMTP S: ${resp}`);
    if (!resp.startsWith("250")) {
      throw new Error(`SMTP message send failed: ${resp}`);
    }
  }

  async quit(): Promise<void> {
    try {
      await this.sendCommand("QUIT");
    } catch {
      // ignore
    }
  }

  close(): void {
    try {
      this.conn.close();
    } catch {
      // ignore
    }
  }
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const smtpPass = Deno.env.get("SMTP_PASS") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const authHeader = req.headers.get("authorization") || "";
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Token não fornecido" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const jwt = authHeader.replace("Bearer ", "");
      const {
        data: { user: caller },
        error: callerError,
      } = await supabaseAdmin.auth.getUser(jwt);

      if (callerError || !caller) {
        return new Response(
          JSON.stringify({ error: "Token inválido" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const body = await req.json();
      const { group_id, subject, message } = body;

      if (!group_id || !subject || !message) {
        return new Response(
          JSON.stringify({ error: "group_id, subject e message são obrigatórios" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (message.length > 1000) {
        return new Response(
          JSON.stringify({ error: "Mensagem muito longa (máx. 1000 caracteres)" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data: settings } = await supabaseAdmin
        .from("app_settings")
        .select("key, value")
        .in("key", [
          "smtp_host", "smtp_port",
          "smtp_user_support", "smtp_user_noreply",
          "smtp_from_support", "smtp_from_noreply",
        ]);

      const smtpConfig: Record<string, string> = {};
      (settings || []).forEach((s: { key: string; value: string }) => {
        smtpConfig[s.key] = s.value;
      });

      const smtpHost = smtpConfig.smtp_host || "mail.dividepass.com";
      const smtpPort = parseInt(smtpConfig.smtp_port || "465");
      const smtpUserSupport = smtpConfig.smtp_user_support || "suporte@dividepass.com";
      const smtpUserNoreply = smtpConfig.smtp_user_noreply || "noreply@dividepass.com";
      const smtpFromSupport = smtpConfig.smtp_from_support || "DividePass Suporte <suporte@dividepass.com>";
      const smtpFromNoreply = smtpConfig.smtp_from_noreply || "DividePass <noreply@dividepass.com>";

      const { data: callerProfile } = await supabaseAdmin
        .from("users")
        .select("name, email")
        .eq("id", caller.id)
        .maybeSingle();

      const { data: group, error: groupError } = await supabaseAdmin
        .from("groups")
        .select("id, name, is_official, owner_id, owner:owner_id (id, name, email)")
        .eq("id", group_id)
        .single();

      if (groupError || !group) {
        return new Response(
          JSON.stringify({ error: "Grupo não encontrado" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      let recipientEmail = "";
      let recipientName = "";

      if (group.is_official) {
        recipientEmail = DIVIDEPASS_SUPPORT_EMAIL;
        recipientName = "Suporte DividePass";
      } else {
        const owner = group.owner as unknown as { email?: string; name?: string };
        if (owner?.email) {
          recipientEmail = owner.email;
          recipientName = owner.name || "Administrador do Grupo";
        } else {
          recipientEmail = DIVIDEPASS_SUPPORT_EMAIL;
          recipientName = "Suporte DividePass";
        }
      }

      const smtpUser = smtpUserNoreply;
      const smtpFrom = smtpFromNoreply;

      const userName = callerProfile?.name || caller.email || "Usuário";
      const userEmail = caller.email || "";

      const replyTo = group.is_official ? DIVIDEPASS_SUPPORT_EMAIL : recipientEmail;

      const textBody = `DividePass - Mensagem de Suporte

Grupo: ${group.name}
De: ${userName} (${userEmail})

${message}

---
Esta mensagem foi enviada via formulário de suporte do DividePass.`;

      const boundary = `----=_Part_${Date.now()}`;
      const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2)}@${smtpHost}>`;

      const rawSubject = `[Suporte - ${group.name}] ${subject}`;
      const subjectBytes = new TextEncoder().encode(rawSubject);
      const encodedSubject = btoa(String.fromCharCode.apply(null, subjectBytes as unknown as number[]));
      const subjectChunks = encodedSubject.match(/.{1,74}/g) || [encodedSubject];
      const encodedSubjectHeader = subjectChunks.map((chunk, i) =>
        i === 0 ? `=?UTF-8?B?${chunk}?=` : ` =?UTF-8?B?${chunk}?=`
      ).join('');

      const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:30px 15px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.4);">

        <tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:28px 32px;text-align:center;">
          <img src="https://www.dividepass.com/logo.png" alt="DividePass" width="48" height="48" style="border-radius:12px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Mensagem de Suporte</h1>
        </td></tr>

        <tr><td style="padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:12px 16px;background:#0f172a;border-radius:10px;margin-bottom:8px;">
                <span style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:4px;">Grupo</span>
                <span style="color:#f1f5f9;font-size:15px;font-weight:600;">${group.name}</span>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:12px 16px;background:#0f172a;border-radius:10px;">
                <span style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:4px;">Enviado por</span>
                <span style="color:#f1f5f9;font-size:15px;font-weight:600;">${userName}</span>
                <span style="color:#64748b;font-size:13px;margin-left:8px;">${userEmail}</span>
              </td>
            </tr>
          </table>

          <div style="margin:20px 0;border-top:1px solid #334155;"></div>

          <div style="padding:16px 20px;background:#0f172a;border-left:3px solid #4F46E5;border-radius:0 10px 10px 0;">
            <p style="margin:0;color:#e2e8f0;font-size:15px;line-height:1.7;white-space:pre-wrap;">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
          </div>
        </td></tr>

        <tr><td style="padding:20px 32px;border-top:1px solid #334155;text-align:center;">
          <p style="margin:0;color:#475569;font-size:12px;">Mensagem enviada via <strong style="color:#818cf8;">DividePass</strong> &mdash; dividepass.com</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

      const mimeHeaders = [
        `From: ${smtpFrom}`,
        `To: ${recipientEmail}`,
        `Reply-To: ${replyTo}`,
        `Subject: ${encodedSubjectHeader}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        `Message-ID: ${messageId}`,
        `Date: ${new Date().toUTCString()}`,
        `X-Mailer: DividePass Support`,
      ].join("\r\n");

      const textBytes = new TextEncoder().encode(textBody);
      const encodedText = btoa(String.fromCharCode.apply(null, textBytes as unknown as number[]));

      const htmlBytes = new TextEncoder().encode(htmlBody);
      const encodedHtml = btoa(String.fromCharCode.apply(null, htmlBytes as unknown as number[]));

      const mimeBody = [
        `--${boundary}`,
        `Content-Type: text/plain; charset=UTF-8`,
        `Content-Transfer-Encoding: base64`,
        ``,
        encodedText,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=UTF-8`,
        `Content-Transfer-Encoding: base64`,
        ``,
        encodedHtml,
        ``,
        `--${boundary}--`,
      ].join("\r\n");

      console.log(`Connecting to SMTP: ${smtpHost}:${smtpPort} as ${smtpUser}`);
      const conn = await Promise.race([
        Deno.connectTls({
          hostname: smtpHost,
          port: smtpPort,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout ao conectar SMTP ${smtpHost}:${smtpPort}`)), 15000)
        ),
      ]);

      const smtp = new SmtpClient(conn);

      try {
        await smtp.connect();
        await smtp.ehlo("dividepass.com");
        await smtp.auth(smtpUser, smtpPass);
        await smtp.mailFrom(smtpUser);
        await smtp.rcptTo(recipientEmail);
        await smtp.data();
        await smtp.sendBody(mimeHeaders, mimeBody);
        await smtp.quit();
      } finally {
        smtp.close();
      }

      console.log(`Support email sent: ${userEmail} → ${recipientEmail} via ${smtpUser} | Group: ${group.name}`);

      return Response.json(
        {
          success: true,
          message: `Mensagem enviada para ${recipientName}`,
          recipient: recipientName,
        },
        { headers: corsHeaders },
      );
    } catch (error) {
      console.error("send-support-email error:", error);
      return new Response(
        JSON.stringify({ error: error.message || "Erro interno ao enviar mensagem" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  },
};
