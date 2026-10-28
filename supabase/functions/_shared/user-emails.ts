/**
 * ENVIO DE E-MAIL PARA O CLIENTE — COM IDEMPOTÊNCIA
 *
 * Por que um módulo só
 * --------------------
 * O projeto já mandava e-mail por SMTP (`_shared/smtp.ts`), mas cada chamada
 * abria sua própria conexão e não tinha trava de duplicidade. Um job que roda
 * todo dia, um webhook que pode ser reentregue e um clique do usuário podem
 * disparar o MESMO e-mail. "Seu e-mail renova em breve" chegando três vezes
 * queima a confiança do cliente.
 *
 * A trava
 * --------
 * `email_logs.dedup_key` tem índice UNIQUE. O fluxo é:
 *
 *   1. INSERT com `dedup_key` e status 'sending'  → quem chegar primeiro
 *      reserva o evento; o segundo recebe erro 23505 e sai sem enviar.
 *   2. Envia o e-mail.
 *   3a. Deu certo → status 'sent'.
 *   3b. Falhou  → status 'failed' e `dedup_key` devolvido a NULL, para que a
 *      próxima execução tente de novo (uma falha de SMTP não pode queimar o
 *      evento para sempre).
 *
 * O e-mail que FALHOU continua registrado (auditoria), mas não bloqueia a
 * retentativa.
 */

import { sendMail } from "./smtp.ts";

export type EmailEventType =
  | "welcome"
  | "subscription_created"
  | "renewal_reminder"
  | "overdue_notice"
  | "payment_failed"
  | "subscription_cancelled";

export type SendUserEmailInput = {
  /** Tipo do evento — vira o `event_type` do log e o filtro do painel. */
  eventType: EmailEventType;
  /**
   * Chave única do evento lógico.
   * Exemplos:
   *   `welcome:<user_id>`
   *   `renewal_reminder:<subscription_id>:<due_at>`
   *   `overdue_notice:<subscription_id>:<due_at>`
   */
  dedupKey: string;
  /** Dono do e-mail (para a trilha e para apagar junto com a conta). */
  userId?: string | null;
  /** Destinatário. */
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Contexto gravado em `raw_event` — aparece no painel admin. */
  meta?: Record<string, unknown>;
  /** Caixa de saída: "noreply" (padrão) ou "support". */
  account?: "support" | "noreply";
};

export type SendUserEmailResult = {
  sent: boolean;
  /** 'sent' | 'duplicate' | 'no_recipient' | 'failed' */
  reason: "sent" | "duplicate" | "no_recipient" | "failed";
  error?: string;
};

/**
 * Envia um e-mail para o cliente, registrando tudo na trilha.
 *
 * NÃO lança: uma falha de e-mail nunca pode derrubar o fluxo que a originou
 * (confirmação de pagamento, cadastro, job de status). O erro volta no
 * resultado e fica registrado em `email_logs`.
 */
export async function sendUserEmail(
  supabaseAdmin: any,
  input: SendUserEmailInput,
): Promise<SendUserEmailResult> {
  const to = String(input.to || "").trim().toLowerCase();

  if (!to || !to.includes("@")) {
    console.log(
      `[user-emails] ${input.eventType}: destinatário inválido, envio ignorado`,
    );
    return { sent: false, reason: "no_recipient" };
  }

  // ── 1) Reserva do evento (trava de duplicidade) ─────────────────────────
  const reserved = await supabaseAdmin.from("email_logs").insert({
    event_type: input.eventType,
    user_id: input.userId || null,
    to,
    subject: input.subject,
    status: "sending",
    dedup_key: input.dedupKey,
    raw_event: input.meta || {},
  });

  if (reserved.error) {
    // 23505 = unique_violation → o evento JÁ foi processado.
    const code = reserved.error.code || "";
    if (code === "23505") {
      console.log(
        `[user-emails] ${input.eventType}: já enviado (dedup ${input.dedupKey})`,
      );
      return { sent: false, reason: "duplicate" };
    }

    // Falha ao reservar: registra a tentativa sem travar o envio.
    console.error(
      `[user-emails] ${input.eventType}: falha ao reservar no email_logs:`,
      reserved.error.message,
    );
  }

  const logId = reserved.data?.[0]?.id as string | undefined;

  // ── 2) Envio ────────────────────────────────────────────────────────────
  try {
    await sendMail(supabaseAdmin, {
      to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      account: input.account || "noreply",
    });
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error(
      `[user-emails] ${input.eventType}: envio falhou para ${to}:`,
      message,
    );

    // Marca como falho e LIBERA a chave para a próxima tentativa.
    const failed = await supabaseAdmin
      .from("email_logs")
      .update({ status: "failed", error: message, dedup_key: null })
      .eq("id", logId || "");

    if (failed.error) {
      console.error(
        "[user-emails] falha ao marcar o e-mail como falho:",
        failed.error.message,
      );
    }

    return { sent: false, reason: "failed", error: message };
  }

  // ── 3) Sucesso ──────────────────────────────────────────────────────────
  if (logId) {
    await supabaseAdmin
      .from("email_logs")
      .update({ status: "sent", error: null })
      .eq("id", logId);
  }

  console.log(
    `[user-emails] ${input.eventType} enviado para ${to} | ${input.subject}`,
  );

  return { sent: true, reason: "sent" };
}

/* ==========================================================================
   CONFIGURAÇÃO (app_settings)
   ========================================================================== */

export type EmailSettings = {
  welcome: boolean;
  subscription: boolean;
  renewalReminder: boolean;
  overdue: boolean;
  paymentFailed: boolean;
  cancelled: boolean;
  /** Dias de antecedência do lembrete de renovação. */
  reminderDays: number;
  /** Dias (dentro da carência) em que o aviso de atraso é repetido. */
  overdueRepeatDays: number;
};

/** 'false' | '0' | 'off' | '' = desligado. Qualquer outro valor = ligado. */
function toBool(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (["false", "0", "off", "no", "nao", "não"].includes(text)) return false;
  return true;
}

function toInt(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Lê a configuração da gestão de e-mail.
 *
 * Os padrões vêm do SQL (`add-email-management.sql`), então um app_settings
 * sem as chaves ainda funciona.
 */
export async function loadEmailSettings(
  supabaseAdmin: any,
): Promise<EmailSettings> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .like("key", "email_%");

  const map: Record<string, string> = {};
  (data || []).forEach((row: { key: string; value: string }) => {
    map[row.key] = row.value;
  });

  return {
    welcome: toBool(map.email_welcome_enabled, true),
    subscription: toBool(map.email_subscription_enabled, true),
    renewalReminder: toBool(map.email_renewal_reminder_enabled, true),
    overdue: toBool(map.email_overdue_enabled, true),
    paymentFailed: toBool(map.email_payment_failed_enabled, true),
    cancelled: toBool(map.email_cancelled_enabled, true),
    reminderDays: toInt(map.email_renewal_reminder_days, 3),
    overdueRepeatDays: toInt(map.email_overdue_repeat_days, 3),
  };
}

/** O evento está ligado? */
export function isEventEnabled(
  settings: EmailSettings,
  eventType: EmailEventType,
): boolean {
  switch (eventType) {
    case "welcome":
      return settings.welcome;
    case "subscription_created":
      return settings.subscription;
    case "renewal_reminder":
      return settings.renewalReminder;
    case "overdue_notice":
      return settings.overdue;
    case "payment_failed":
      return settings.paymentFailed;
    case "subscription_cancelled":
      return settings.cancelled;
    default:
      return false;
  }
}
