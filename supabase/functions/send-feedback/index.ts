/**
 * Feedback livre do usuário (CTA "Dar feedback" do dashboard).
 *
 * Duas saídas independentes, porque nenhuma pode derrubar a outra:
 *   1. `user_feedback` — arquiva no banco (service role). É a fonte da verdade
 *      para o admin acompanhar o que chegou.
 *   2. e-mail para a caixa da equipe via SMTP.
 *
 * Se a tabela ainda não existir (migration não aplicada) o feedback continua
 * indo por e-mail; se o SMTP falhar, o registro no banco segura a mensagem.
 * Só dá erro quando as duas falham.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMail } from "../_shared/smtp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MIN_LENGTH = 5;
const MAX_LENGTH = 2000;
const DEFAULT_FEEDBACK_EMAIL = "suporte@dividepass.com";

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

/** Caixa de destino: `feedback_email` > `admin_notification_email` > padrão. */
async function getFeedbackEmail(supabaseAdmin: any): Promise<string> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .in("key", ["feedback_email", "admin_notification_email"]);

  const settings: Record<string, string> = {};
  (data || []).forEach((s: { key: string; value: string }) => {
    settings[s.key] = s.value;
  });

  return (
    (settings.feedback_email || "").trim() ||
    (settings.admin_notification_email || "").trim() ||
    DEFAULT_FEEDBACK_EMAIL
  );
}

/** Grava o feedback no banco. Não lança: devolve false se não deu. */
async function saveFeedback(
  supabaseAdmin: any,
  payload: {
    userId: string;
    message: string;
    page: string | null;
  },
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("user_feedback").insert({
      user_id: payload.userId,
      message: payload.message,
      page: payload.page,
      status: "new",
    });

    if (error) {
      // Tabela ausente (migration não aplicada) é o caso mais comum.
      console.error("[send-feedback] insert em user_feedback falhou:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[send-feedback] erro ao salvar feedback:", error);
    return false;
  }
}

/** Envia o e-mail para a equipe. Não lança: devolve false se não deu. */
async function emailFeedback(
  supabaseAdmin: any,
  payload: {
    message: string;
    page: string | null;
    userName: string;
    userEmail: string;
  },
): Promise<boolean> {
  try {
    const recipient = await getFeedbackEmail(supabaseAdmin);
    const createdAt = formatDateTime(new Date());

    const textBody = [
      "DividePass — Novo feedback de usuário",
      "",
      `De: ${payload.userName} (${payload.userEmail})`,
      `Página: ${payload.page || "—"}`,
      `Recebido em: ${createdAt}`,
      "",
      payload.message,
      "",
      "---",
      "Enviado pelo CTA de feedback do dashboard do DividePass.",
    ].join("\n");

    const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:30px 15px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.4);">

        <tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:28px 32px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Novo feedback de usuário</h1>
          <p style="margin:8px 0 0;color:#c7d2fe;font-size:14px;">DividePass &mdash; caixa de feedback</p>
        </td></tr>

        <tr><td style="padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:12px 16px;background:#0f172a;border-radius:10px;">
                <span style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:4px;">Enviado por</span>
                <span style="color:#f1f5f9;font-size:15px;font-weight:600;">${escapeHtml(payload.userName)}</span>
                <span style="color:#64748b;font-size:13px;margin-left:8px;">${escapeHtml(payload.userEmail)}</span>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:12px 16px;background:#0f172a;border-radius:10px;">
                <span style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:4px;">Página</span>
                <span style="color:#f1f5f9;font-size:15px;font-weight:600;">${escapeHtml(payload.page || "—")}</span>
              </td>
            </tr>
          </table>

          <div style="margin:20px 0;border-top:1px solid #334155;"></div>

          <div style="padding:16px 20px;background:#0f172a;border-left:3px solid #4F46E5;border-radius:0 10px 10px 0;">
            <p style="margin:0;color:#e2e8f0;font-size:15px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(payload.message)}</p>
          </div>

          <p style="margin:20px 0 0;color:#64748b;font-size:12px;">
            Recebido em <span style="color:#94a3b8;">${escapeHtml(createdAt)}</span>
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
      to: recipient,
      subject: `Novo feedback de usuário — ${payload.userName}`,
      text: textBody,
      html: htmlBody,
      account: "noreply",
      replyTo: payload.userEmail,
    });

    console.log(
      `[send-feedback] e-mail enviado para ${recipient} | ${payload.userName}`,
    );
    return true;
  } catch (error) {
    console.error("[send-feedback] erro ao enviar e-mail:", error);
    return false;
  }
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const authHeader = req.headers.get("authorization") || "";
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Token não fornecido" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      let body: { message?: string; page?: string };
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: "Corpo da requisição inválido" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const message = String(body?.message || "").trim();
      const page = String(body?.page || "").trim().slice(0, 60) || null;

      if (!message) {
        return new Response(
          JSON.stringify({ error: "Escreva seu feedback antes de enviar." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (message.length < MIN_LENGTH) {
        return new Response(
          JSON.stringify({ error: `Conte um pouco mais (mínimo ${MIN_LENGTH} caracteres).` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (message.length > MAX_LENGTH) {
        return new Response(
          JSON.stringify({ error: `Feedback muito longo (máximo ${MAX_LENGTH} caracteres).` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: profile } = await supabaseAdmin
        .from("users")
        .select("name, email")
        .eq("id", caller.id)
        .maybeSingle();

      const userName = profile?.name || caller.email || "Usuário";
      const userEmail = profile?.email || caller.email || "";

      const saved = await saveFeedback(supabaseAdmin, {
        userId: caller.id,
        message,
        page,
      });

      const emailed = await emailFeedback(supabaseAdmin, {
        message,
        page,
        userName,
        userEmail,
      });

      if (!saved && !emailed) {
        return new Response(
          JSON.stringify({ error: "Não foi possível registrar seu feedback. Tente novamente." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return Response.json(
        { success: true, saved, emailed },
        { headers: corsHeaders },
      );
    } catch (error) {
      console.error("[send-feedback] FATAL:", error);
      return new Response(
        JSON.stringify({ error: error.message || "Erro interno ao enviar feedback" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  },
};
