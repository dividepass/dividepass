/**
 * Aviso por e-mail para o administrador a cada pagamento confirmado.
 *
 * Conteúdo pedido: nome do grupo, nome da pessoa, valor da transação, tipo de
 * pagamento e data/hora. Sem isso o admin só descobre a receita olhando o
 * painel.
 *
 * O gatilho é a confirmação do pagamento (check-iopay-tx / confirm-payment).
 * Como o poll pode rodar mais de uma vez, o envio é deduplicado pela
 * transação: `email_logs` guarda uma linha por aviso enviado.
 */

import { sendMail } from "./smtp.ts";

const DEFAULT_ADMIN_EMAIL = "gwmorata@gmail.com";

export type AdminPaymentNotice = {
  groupId: string;
  userId: string;
  amount: number;
  paymentType: string;
  gateway: string;
  transactionId: string;
  paymentMethod?: string | null;
  paidAt?: Date;
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  entrance: "Taxa de adesão",
  subscription: "Assinatura",
  combined: "Adesão + assinatura",
  invoice: "Fatura",
  custom: "Cobrança avulsa",
  refund: "Estorno",
};

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value) || 0);
}

function formatDateTime(value: Date): string {
  // pt-BR com timezone do Brasil: o admin lê "24/10/2026, 18:32".
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** E-mail de destino: chave no app_settings, com o fallback do dono. */
export async function getAdminNotificationEmail(
  supabaseAdmin: any,
): Promise<string> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "admin_notification_email")
    .maybeSingle();

  const configured = (data?.value || "").trim();
  return configured || DEFAULT_ADMIN_EMAIL;
}

/**
 * Envia o aviso de pagamento. Não lança: uma falha de e-mail não pode
 * derrubar a confirmação do pagamento. O erro fica no log.
 */
export async function notifyAdminPayment(
  supabaseAdmin: any,
  notice: AdminPaymentNotice,
): Promise<boolean> {
  try {
    // ── Deduplicação: uma linha de email_logs por transação avisada ────────
    const { data: alreadySent } = await supabaseAdmin
      .from("email_logs")
      .select("id")
      .eq("event_type", "admin_payment_notification")
      .contains("raw_event", { transaction_id: notice.transactionId })
      .maybeSingle();

    if (alreadySent) {
      console.log(
        `[admin-payment-email] aviso ja enviado para a transacao ${notice.transactionId}`,
      );
      return false;
    }

    // ── Quem pagou, em qual grupo ─────────────────────────────────────────
    const [userRes, groupRes] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("name, email")
        .eq("id", notice.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("groups")
        .select("name")
        .eq("id", notice.groupId)
        .maybeSingle(),
    ]);

    const userName = userRes?.data?.name || notice.userId;
    const userEmail = userRes?.data?.email || "";
    const groupName = groupRes?.data?.name || notice.groupId;
    const paidAt = notice.paidAt || new Date();
    const typeLabel =
      PAYMENT_TYPE_LABELS[notice.paymentType] || notice.paymentType;
    const methodLabel =
      notice.paymentMethod === "pix"
        ? "PIX"
        : notice.paymentMethod === "credit_card"
        ? "Cartão de crédito"
        : notice.paymentMethod || "—";

    const adminEmail = await getAdminNotificationEmail(supabaseAdmin);

    const textBody = [
      "DividePass — Pagamento confirmado",
      "",
      `Grupo: ${groupName}`,
      `Pessoa: ${userName}${userEmail ? ` (${userEmail})` : ""}`,
      `Valor: ${formatBRL(notice.amount)}`,
      `Tipo de pagamento: ${typeLabel}`,
      `Forma: ${methodLabel}`,
      `Data e hora: ${formatDateTime(paidAt)}`,
      "",
      `Transação: ${notice.transactionId}`,
      `Gateway: ${notice.gateway}`,
    ].join("\n");

    const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:30px 15px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.4);">

        <tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:28px 32px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Pagamento confirmado</h1>
          <p style="margin:8px 0 0;color:#c7d2fe;font-size:14px;">${escapeHtml(groupName)}</p>
        </td></tr>

        <tr><td style="padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:12px 16px;background:#0f172a;border-radius:10px;">
                <span style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:4px;">Valor</span>
                <span style="color:#f1f5f9;font-size:20px;font-weight:700;">${escapeHtml(formatBRL(notice.amount))}</span>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:12px 16px;background:#0f172a;border-radius:10px;">
                <span style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:4px;">Grupo</span>
                <span style="color:#f1f5f9;font-size:15px;font-weight:600;">${escapeHtml(groupName)}</span>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:12px 16px;background:#0f172a;border-radius:10px;">
                <span style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:4px;">Pessoa</span>
                <span style="color:#f1f5f9;font-size:15px;font-weight:600;">${escapeHtml(userName)}</span>
                ${userEmail ? `<span style="color:#64748b;font-size:13px;margin-left:8px;">${escapeHtml(userEmail)}</span>` : ""}
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:12px 16px;background:#0f172a;border-radius:10px;">
                <span style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:4px;">Tipo de pagamento</span>
                <span style="color:#f1f5f9;font-size:15px;font-weight:600;">${escapeHtml(typeLabel)}</span>
                <span style="color:#64748b;font-size:13px;margin-left:8px;">${escapeHtml(methodLabel)}</span>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:12px 16px;background:#0f172a;border-radius:10px;">
                <span style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:4px;">Data e hora</span>
                <span style="color:#f1f5f9;font-size:15px;font-weight:600;">${escapeHtml(formatDateTime(paidAt))}</span>
              </td>
            </tr>
          </table>

          <div style="margin:20px 0;border-top:1px solid #334155;"></div>
          <p style="margin:0;color:#64748b;font-size:12px;">
            Transação <span style="color:#94a3b8;">${escapeHtml(notice.transactionId)}</span>
            · gateway <span style="color:#94a3b8;">${escapeHtml(notice.gateway)}</span>
          </p>
        </td></tr>

        <tr><td style="padding:20px 32px;border-top:1px solid #334155;text-align:center;">
          <p style="margin:0;color:#475569;font-size:12px;">Enviado pelo <strong style="color:#818cf8;">DividePass</strong> &mdash; dividepass.com</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await sendMail(supabaseAdmin, {
      to: adminEmail,
      subject: `Pagamento confirmado — ${groupName} — ${formatBRL(notice.amount)}`,
      text: textBody,
      html: htmlBody,
      account: "noreply",
    });

    // ── Marca o aviso como enviado (também serve de auditoria) ────────────
    await supabaseAdmin.from("email_logs").insert({
      event_type: "admin_payment_notification",
      from: "DividePass <noreply@dividepass.com>",
      to: adminEmail,
      subject: `Pagamento confirmado — ${groupName} — ${formatBRL(notice.amount)}`,
      raw_event: {
        transaction_id: notice.transactionId,
        group_id: notice.groupId,
        group_name: groupName,
        user_id: notice.userId,
        user_name: userName,
        user_email: userEmail,
        amount: Number(notice.amount) || 0,
        payment_type: notice.paymentType,
        payment_method: notice.paymentMethod || null,
        gateway: notice.gateway,
        paid_at: paidAt.toISOString(),
      },
    });

    console.log(
      `[admin-payment-email] aviso enviado para ${adminEmail} | ${groupName} | ${userName} | ${formatBRL(notice.amount)}`,
    );
    return true;
  } catch (error) {
    console.error(
      "[admin-payment-email] falha ao enviar o aviso:",
      error,
    );
    return false;
  }
}
