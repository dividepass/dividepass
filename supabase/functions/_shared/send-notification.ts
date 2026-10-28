import webpush from "https://esm.sh/web-push@3.6.7";
import { sendMail } from "./smtp.ts";
import { sendWhatsAppMessage, loadWhatsAppConfig } from "./whatsapp.ts";

function asObject(value: any) {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Roda `worker` sobre `items` com no máximo `limit` tarefas ao mesmo tempo.
 * Enviar e-mail abre uma conexão TLS por mensagem: disparar para todos sem
 * limiteconnections derruba o servidor de e-mail (e some com a edge function).
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function getRecipients(supabaseAdmin: any, audience: any): Promise<string[]> {
  if (!audience?.type) return [];

  if (audience.type === 'group' && audience.group_id) {
    const { data } = await supabaseAdmin
      .from('group_members')
      .select('user_id')
      .eq('group_id', audience.group_id)
      .in('status', ['active', 'pending']);
    return uniq((data || []).map((row: any) => row.user_id));
  }

  if (audience.type === 'users' && Array.isArray(audience.user_ids)) {
    return uniq(audience.user_ids);
  }

  if (audience.type === 'role' && audience.role) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('role', audience.role);
    return uniq((data || []).map((row: any) => row.id));
  }

  if (audience.type === 'all') {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .neq('status', 'deleted');
    return uniq((data || []).map((row: any) => row.id));
  }

  return [];
}

/** E-mail e telefone de cada destinatário — o push só precisa do id. */
async function getContacts(supabaseAdmin: any, recipients: string[]) {
  if (recipients.length === 0) return [];
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, name, email, phone')
    .in('id', recipients);
  return (data || []) as { id: string; name: string | null; email: string | null; phone: string | null }[];
}

async function sendPushToRecipients(supabaseAdmin: any, recipients: string[], payload: any) {
  if (recipients.length === 0) return { attempted: 0, sent: 0 };

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, subscription, is_active')
    .in('user_id', recipients)
    .eq('is_active', true);

  if (!subs?.length) return { attempted: 0, sent: 0 };

  const body = JSON.stringify(payload);
  const attempted = subs.length;
  let sent = 0;

  await Promise.allSettled(subs.map(async (row: any) => {
    try {
      const subscription = asObject(row.subscription);
      await webpush.sendNotification(subscription, body);
      sent += 1;
    } catch (err: any) {
      const statusCode = err?.statusCode || err?.status;
      if (statusCode === 404 || statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', row.id);
      } else {
        await supabaseAdmin.from('push_subscriptions').update({ is_active: false, last_seen_at: new Date().toISOString() }).eq('id', row.id);
      }
    }
  }));

  return { attempted, sent };
}

/** Limite por chamada: acima disso a edge function estoura o tempo. */
const MAX_EMAILS_PER_CALL = 200;
const EMAIL_CONCURRENCY = 3;
const WHATSAPP_CONCURRENCY = 5;

function buildEmailContent(title: string, message: string, linkUrl: string) {
  const text = [title, "", message, "", linkUrl].join("\n");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:30px 15px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.4);">

        <tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:28px 32px;text-align:center;">
          <img src="https://www.dividepass.com/logo.png" alt="DividePass" width="48" height="48" style="border-radius:12px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">${escapeHtml(title)}</h1>
        </td></tr>

        <tr><td style="padding:28px 32px;">
          <p style="margin:0;color:#e2e8f0;font-size:15px;line-height:1.6;white-space:pre-line;">${escapeHtml(message)}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
            <tr><td align="center">
              <a href="${escapeHtml(linkUrl)}" style="display:inline-block;background:linear-gradient(90deg,#4F46E5,#EA580C);color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:10px;">Abrir no DividePass</a>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:20px 32px;border-top:1px solid #334155;text-align:center;">
          <p style="margin:0;color:#475569;font-size:12px;">Enviado pelo <strong style="color:#818cf8;">DividePass</strong> &mdash; dividepass.com</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { text, html };
}

/**
 * E-mail para cada destinatário que tem endereço cadastrado.
 * Uma falha individual não derruba o lote: ela é contada e o resto segue.
 */
async function sendEmailToRecipients(
  supabaseAdmin: any,
  contacts: { name: string | null; email: string | null }[],
  content: { subject: string; text: string; html: string },
) {
  const withEmail = contacts.filter((c) => !!c.email);
  const skippedNoEmail = contacts.length - withEmail.length;

  if (withEmail.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, skipped: skippedNoEmail, error: "nenhum destinatário tem e-mail cadastrado" };
  }

  const capped = withEmail.slice(0, MAX_EMAILS_PER_CALL);
  const skippedByLimit = withEmail.length - capped.length;

  let sent = 0;
  let failed = 0;
  let firstError = "";

  await runWithConcurrency(capped, EMAIL_CONCURRENCY, async (contact) => {
    try {
      await sendMail(supabaseAdmin, {
        to: contact.email as string,
        subject: content.subject,
        text: content.text,
        html: content.html,
        account: "noreply",
      });
      sent += 1;
    } catch (err: any) {
      failed += 1;
      if (!firstError) firstError = err?.message || "falha ao enviar";
      console.error("[send-notification] e-mail falhou:", contact.email, err?.message);
    }
  });

  return {
    attempted: capped.length,
    sent,
    failed,
    skipped: skippedNoEmail + skippedByLimit,
    error: failed > 0 ? firstError : "",
  };
}

/**
 * WhatsApp para cada destinatário que tem telefone. A Meta só aceita texto
 * livre dentro da janela de 24h — fora dela é preciso template aprovado.
 */
async function sendWhatsAppToRecipients(
  supabaseAdmin: any,
  contacts: { name: string | null; phone: string | null }[],
  message: string,
) {
  const config = await loadWhatsAppConfig(supabaseAdmin);
  if (!config) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: contacts.length,
      error: "WhatsApp não configurado (secret WHATSAPP_ACCESS_TOKEN + app_settings.whatsapp_phone_number_id)",
    };
  }

  const withPhone = contacts.filter((c) => !!c.phone);
  const skippedNoPhone = contacts.length - withPhone.length;

  if (withPhone.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, skipped: skippedNoPhone, error: "nenhum destinatário tem telefone cadastrado" };
  }

  let sent = 0;
  let failed = 0;
  let firstError = "";

  await runWithConcurrency(withPhone, WHATSAPP_CONCURRENCY, async (contact) => {
    const result = await sendWhatsAppMessage(supabaseAdmin, {
      to: contact.phone as string,
      body: message,
    });
    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      if (!firstError) firstError = result.error || "falha ao enviar";
    }
  });

  return {
    attempted: withPhone.length,
    sent,
    failed,
    skipped: skippedNoPhone,
    error: failed > 0 ? firstError : "",
  };
}

export async function dispatchNotification(supabaseAdmin: any, params: any) {
  const {
    title,
    message,
    event_type = 'info',
    metadata = {},
    audience,
    channels = ['in_app', 'push'],
    url = '/dashboard',
    created_by = null,
  } = params;

  const recipients = await getRecipients(supabaseAdmin, audience);
  if (!recipients.length) {
    return {
      recipients: 0,
      notifications: 0,
      push: { attempted: 0, sent: 0 },
      email: { attempted: 0, sent: 0 },
      whatsapp: { attempted: 0, sent: 0 },
    };
  }

  /* 'both' é o valor antigo (in_app + push) — mantido por compatibilidade. */
  const shouldInsert = channels.includes('in_app') || channels.includes('both');
  const shouldPush = channels.includes('push') || channels.includes('both');
  const shouldEmail = channels.includes('email');
  const shouldWhatsApp = channels.includes('whatsapp');

  let notificationsInserted = 0;
  if (shouldInsert) {
    const rows = recipients.map((user_id: string) => ({
      user_id,
      title,
      message,
      event_type,
      metadata: asObject(metadata),
      read: false,
      created_at: new Date().toISOString(),
    }));
    const { error } = await supabaseAdmin.from('notifications').insert(rows);
    if (error) throw error;
    notificationsInserted = rows.length;
  }

  let push = { attempted: 0, sent: 0 };
  if (shouldPush) {
    const vapidSubject = Deno.env.get('WEB_PUSH_SUBJECT') || 'mailto:support@dividepass.com';
    const vapidPublicKey = Deno.env.get('WEB_PUSH_PUBLIC_KEY') || '';
    const vapidPrivateKey = Deno.env.get('WEB_PUSH_PRIVATE_KEY') || '';

    if (!vapidPublicKey || !vapidPrivateKey) {
      throw new Error('Push keys not configured');
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    push = await sendPushToRecipients(supabaseAdmin, recipients, {
      title,
      body: message,
      message,
      event_type,
      metadata: asObject(metadata),
      url,
    });
  }

  /* E-mail e WhatsApp precisam do contato de cada pessoa, então os dados
     dos destinatários são buscados uma vez e reaproveitados. */
  let email = { attempted: 0, sent: 0, failed: 0, skipped: 0, error: '' };
  let whatsapp = { attempted: 0, sent: 0, failed: 0, skipped: 0, error: '' };

  if (shouldEmail || shouldWhatsApp) {
    const contacts = await getContacts(supabaseAdmin, recipients);

    if (shouldEmail) {
      const appUrl = (Deno.env.get('SITE_URL') || Deno.env.get('APP_URL') || 'https://dividepass.com').replace(/\/$/, '');
      const linkUrl = `${appUrl}${url.startsWith('/') ? url : `/${url}`}`;
      const content = buildEmailContent(title, message, linkUrl);
      email = await sendEmailToRecipients(supabaseAdmin, contacts, {
        subject: title,
        text: content.text,
        html: content.html,
      });
    }

    if (shouldWhatsApp) {
      whatsapp = await sendWhatsAppToRecipients(supabaseAdmin, contacts, `${title}\n\n${message}`);
    }
  }

  if (created_by) {
    await supabaseAdmin.from('platform_events').insert({
      event_type,
      title,
      message,
      metadata: asObject(metadata),
      created_by,
    });
  }

  return {
    recipients: recipients.length,
    notifications: notificationsInserted,
    push,
    email,
    whatsapp,
  };
}
