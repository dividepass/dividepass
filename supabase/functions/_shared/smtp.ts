/**
 * Envio de e-mail por SMTP (TLS direto, porta 465).
 *
 * O projeto usa SMTP próprio (mail.dividepass.com) e não tem provedor de
 * e-mail transacional. A classe SmtpClient vivia duplicada dentro de cada
 * edge function; aqui ela fica em um lugar só e qualquer função pode enviar
 * um e-mail com `sendMail`.
 *
 * A configuração vem da tabela `app_settings`:
 *   smtp_host, smtp_port, smtp_user_support, smtp_user_noreply,
 *   smtp_from_support, smtp_from_noreply
 * e a senha do secret `SMTP_PASS`.
 */

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  from: string;
  password: string;
};

export class SmtpClient {
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
    const authResp = await this.sendCommand(`AUTH LOGIN ${btoa(user)}`);
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

/** Lê a configuração de SMTP do `app_settings` + o secret `SMTP_PASS`. */
export async function loadSmtpConfig(
  supabaseAdmin: any,
  account: "support" | "noreply" = "noreply",
): Promise<SmtpConfig> {
  const { data: settings } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "smtp_host",
      "smtp_port",
      "smtp_user_support",
      "smtp_user_noreply",
      "smtp_from_support",
      "smtp_from_noreply",
    ]);

  const config: Record<string, string> = {};
  (settings || []).forEach((s: { key: string; value: string }) => {
    config[s.key] = s.value;
  });

  const password = Deno.env.get("SMTP_PASS") ?? "";

  return {
    host: config.smtp_host || "mail.dividepass.com",
    port: parseInt(config.smtp_port || "465"),
    user:
      account === "support"
        ? config.smtp_user_support || "suporte@dividepass.com"
        : config.smtp_user_noreply || "noreply@dividepass.com",
    from:
      account === "support"
        ? config.smtp_from_support || "DividePass Suporte <suporte@dividepass.com>"
        : config.smtp_from_noreply || "DividePass <noreply@dividepass.com>",
    password,
  };
}

/** Codifica um texto em base64 para uso em MIME (assume UTF-8). */
function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Subject em MIME com acentos: `=?UTF-8?B?...?=` quebrado em linhas de 74. */
export function encodeSubjectHeader(subject: string): string {
  const encoded = encodeBase64(subject);
  const chunks = encoded.match(/.{1,74}/g) || [encoded];
  return chunks
    .map((chunk, i) =>
      i === 0 ? `=?UTF-8?B?${chunk}?=` : ` =?UTF-8?B?${chunk}?=`
    )
    .join("");
}

export type SendMailOptions = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** "support" usa a caixa suporte@, "noreply" a noreply@. */
  account?: "support" | "noreply";
  replyTo?: string;
};

/**
 * Envia um e-mail. Lança em caso de erro — quem chama decide se falha
 * silenciosa (notificação interna) ou erro na resposta.
 */
export async function sendMail(
  supabaseAdmin: any,
  opts: SendMailOptions,
): Promise<void> {
  const config = await loadSmtpConfig(supabaseAdmin, opts.account ?? "noreply");

  if (!config.password) {
    throw new Error("Secret SMTP_PASS não configurado");
  }

  const boundary = `----=_Part_${Date.now()}`;
  const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2)}@${config.host}>`;

  const mimeHeaders = [
    `From: ${config.from}`,
    `To: ${opts.to}`,
    ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
    `Subject: ${encodeSubjectHeader(opts.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`,
    `X-Mailer: DividePass`,
  ].join("\r\n");

  const mimeBody = [
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    encodeBase64(opts.text),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    encodeBase64(opts.html),
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  console.log(`Connecting to SMTP: ${config.host}:${config.port} as ${config.user}`);
  const conn = await Promise.race([
    Deno.connectTls({ hostname: config.host, port: config.port }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Timeout ao conectar SMTP ${config.host}:${config.port}`,
            ),
          ),
        15000,
      )
    ),
  ]);

  const smtp = new SmtpClient(conn);
  try {
    await smtp.connect();
    await smtp.ehlo("dividepass.com");
    await smtp.auth(config.user, config.password);
    await smtp.mailFrom(config.user);
    await smtp.rcptTo(opts.to);
    await smtp.data();
    await smtp.sendBody(mimeHeaders, mimeBody);
    await smtp.quit();
  } finally {
    smtp.close();
  }

  console.log(`Email sent to ${opts.to} via ${config.user} | ${opts.subject}`);
}
