/**
 * TEMPLATES DE E-MAIL DO USUÁRIO
 *
 * Until agora cada edge function montava o próprio HTML (o aviso de pagamento
 * para o admin, a redefinição de senha, a notificação genérica...). O resultado
 * era o mesmo card escuro reescrito quatro vezes, com quatrojezinhos de
 * divergência.
 *
 * Aqui mora UM layout (`emailShell`) e os templates do funil do cliente. Todo
 * e-mail de automação passa por aqui, então mudar o visual é uma edição só.
 *
 * Convenções (iguais às do resto do projeto):
 *  - "não cite a tecnologia": o texto fala com o cliente, nunca sobre o banco.
 *  - E-mail = canal formal. Fecha com "Atenciosamente, equipe DividePass".
 *  - Todo e-mail tem um CTA (botão) e um link em texto puro no corpo plano
 *    (quem bloqueia HTML ainda consegue usar).
 */

/** URL pública da aplicação (o botão e os links do e-mail apontam para cá). */
export function appUrl(env: Record<string, string | undefined> = {}): string {
  const raw =
    env.SITE_URL ||
    env.APP_URL ||
    env.VITE_SITE_URL ||
    "https://www.dividepass.com";
  return raw.replace(/\/$/, "");
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** R$ 29,90 */
export function formatBRL(value: unknown): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value) || 0);
}

/** 24/10/2026 */
export function formatDateBR(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

/** 24/10/2026 às 18:32 */
export function formatDateTimeBR(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

/** Rótulo do ciclo de cobrança: 'monthly' -> 'Mensal'. */
export function cycleLabel(cycle: unknown): string {
  const map: Record<string, string> = {
    monthly: "Mensal",
    quarterly: "Trimestral",
    semiannual: "Semestral",
    yearly: "Anual",
    annual: "Anual",
    weekly: "Semanal",
    custom: "Personalizado",
  };
  return map[String(cycle ?? "").toLowerCase()] || "Mensal";
}

export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

/** Uma linha de dado (rótulo + valor) na tabela de detalhes do e-mail. */
function detailRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:12px 16px;background:#0f172a;border-radius:10px;">
        <span style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:4px;">${escapeHtml(label)}</span>
        <span style="color:#f1f5f9;font-size:15px;font-weight:600;">${escapeHtml(value)}</span>
      </td>
    </tr>`;
}

export type ShellInput = {
  title: string;
  subtitle?: string;
  /** Parágrafos do corpo. */
  paragraphs?: string[];
  /** Bloco de detalhes (rótulo/valor). */
  details?: { label: string; value: string }[];
  /** Botão principal. */
  cta?: { label: string; url: string };
  /** Aviso no rodapé do corpo (ex.: "se você não fez isso..."). */
  note?: string;
  /** Rodapé institucional. */
  footerNote?: string;
  /** Tom do cabeçalho: 'default' | 'warning' | 'danger' | 'success'. */
  tone?: "default" | "warning" | "danger" | "success";
};

const TONE_GRADIENTS: Record<string, string> = {
  default: "linear-gradient(135deg,#4F46E5,#7C3AED)",
  success: "linear-gradient(135deg,#059669,#10B981)",
  warning: "linear-gradient(135deg,#D97706,#F59E0B)",
  danger: "linear-gradient(135deg,#DC2626,#F97316)",
};

/**
 * Layout único do e-mail. Todos os templates usam este casco — muda o
 * conteúdo, nunca a estrutura.
 */
export function emailShell(input: ShellInput): { html: string; text: string } {
  const {
    title,
    subtitle,
    paragraphs = [],
    details = [],
    cta,
    note,
    footerNote,
    tone = "default",
  } = input;

  const gradient = TONE_GRADIENTS[tone] || TONE_GRADIENTS.default;

  const paragraphsHtml = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 14px;color:#e2e8f0;font-size:15px;line-height:1.7;">${escapeHtml(p)}</p>`,
    )
    .join("\n          ");

  const detailsHtml = details.length
    ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
            ${details
              .map(
                (d, i) =>
                  `${i > 0 ? '<tr><td style="height:8px;"></td></tr>' : ""}${detailRow(d.label, d.value)}`,
              )
              .join("\n            ")}
          </table>`
    : "";

  const ctaHtml = cta
    ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
            <tr><td align="center">
              <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:linear-gradient(90deg,#4F46E5,#EA580C);color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 28px;border-radius:10px;">${escapeHtml(cta.label)}</a>
            </td></tr>
          </table>`
    : "";

  const noteHtml = note
    ? `<p style="margin:18px 0 0;color:#94a3b8;font-size:13px;line-height:1.6;">${escapeHtml(note)}</p>`
    : "";

  const footer = footerNote
    ? `<p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">${escapeHtml(footerNote)}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:30px 15px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.4);">

        <tr><td style="background:${gradient};padding:28px 32px;text-align:center;">
          <img src="https://www.dividepass.com/logo.png" alt="DividePass" width="48" height="48" style="border-radius:12px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">${escapeHtml(title)}</h1>
          ${
            subtitle
              ? `<p style="margin:8px 0 0;color:#c7d2fe;font-size:14px;">${escapeHtml(subtitle)}</p>`
              : ""
          }
        </td></tr>

        <tr><td style="padding:28px 32px;">
          ${paragraphsHtml}
          ${detailsHtml}
          ${ctaHtml}
          ${noteHtml}
          ${footer ? `<div style="margin:20px 0;border-top:1px solid #334155;"></div>` : ""}
          ${footer}
        </td></tr>

        <tr><td style="padding:20px 32px;border-top:1px solid #334155;text-align:center;">
          <p style="margin:0;color:#475569;font-size:12px;">Enviado pelo <strong style="color:#818cf8;">DividePass</strong> &mdash; dividepass.com</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Versão texto puro: o mesmo conteúdo, sem marcação. Quem bloqueia HTML
  // ainda consegue ler e clicar.
  const text = [
    title,
    subtitle ? subtitle : "",
    "",
    ...paragraphs,
    ...details.map((d) => `${d.label}: ${d.value}`),
    "",
    cta ? `${cta.label}: ${cta.url}` : "",
    note || "",
    footerNote || "",
    "",
    "DividePass — dividepass.com",
  ]
    .filter((line) => line !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { html, text };
}

/* ==========================================================================
   TEMPLATES DO FUNIL DO CLIENTE
   ========================================================================== */

export type WelcomeData = {
  name: string;
  url: string;
};

/** Boas-vindas: enviada logo depois do cadastro. */
export function welcomeTemplate(data: WelcomeData): EmailContent {
  const { html, text } = emailShell({
    title: `Bem-vindo ao DividePass, ${data.name}!`,
    subtitle: "Sua conta está pronta",
    tone: "success",
    paragraphs: [
      `Olá, ${data.name}! Criamos sua conta no DividePass e ela já está pronta para usar.`,
      "Aqui você entra em grupos de Streaming e divide a mensalidade com outras pessoas — cada grupo tem um administrador, e você paga só a sua parte.",
      "O primeiro passo é escolher um grupo que te interesse e fazer a sua adesão.",
    ],
    cta: { label: "Explorar grupos", url: `${data.url}/groups` },
    footerNote:
      "Dúvida de qualquer coisa, é só responder este e-mail — a gente ajuda.",
  });

  return {
    subject: "Bem-vindo ao DividePass! Sua conta está pronta",
    text,
    html,
  };
}

export type SubscriptionCreatedData = {
  name: string;
  groupName: string;
  serviceName?: string | null;
  amount: number;
  cycle: string;
  renewalDate: string;
  url: string;
};

/** Assinatura criada/pagada: confirma o que foi contratado. */
export function subscriptionCreatedTemplate(
  data: SubscriptionCreatedData,
): EmailContent {
  const { html, text } = emailShell({
    title: "Assinatura confirmada",
    subtitle: data.groupName,
    tone: "success",
    paragraphs: [
      `Olá, ${data.name}!`,
      `Sua assinatura do ${data.groupName} foi confirmada e o pagamento já está registrado.`,
      "Daqui em diante a renovação é automática. Antes de cada vencimento você recebe um aviso por e-mail — nada de surpresa.",
    ],
    details: [
      { label: "Grupo", value: data.groupName },
      ...(data.serviceName
        ? [{ label: "Serviço", value: data.serviceName }]
        : []),
      { label: "Plano", value: `${cycleLabel(data.cycle)} — ${formatBRL(data.amount)}` },
      { label: "Próxima renovação", value: formatDateBR(data.renewalDate) },
    ],
    cta: { label: "Ver minha assinatura", url: `${data.url}/dashboard/subscriptions` },
    footerNote:
      "Se você não reconhece esta assinatura, responda este e-mail imediatamente.",
  });

  return {
    subject: `Assinatura confirmada — ${data.groupName}`,
    text,
    html,
  };
}

export type RenewalReminderData = {
  name: string;
  groupName: string;
  amount: number;
  renewalDate: string;
  daysLeft: number;
  url: string;
};

/** Lembrete: a assinatura vence em breve. */
export function renewalReminderTemplate(
  data: RenewalReminderData,
): EmailContent {
  const quando =
    data.daysLeft <= 0
      ? "hoje"
      : data.daysLeft === 1
      ? "amanhã"
      : `em ${data.daysLeft} dias`;

  const { html, text } = emailShell({
    title: "Sua assinatura renova em breve",
    subtitle: data.groupName,
    tone: "warning",
    paragraphs: [
      `Olá, ${data.name}!`,
      `Passa o cartão de novo para você: a assinatura do ${data.groupName} renova ${quando}, em ${formatDateBR(data.renewalDate)}.`,
      "Se o cartão estiver válido, a cobrança é automática e você não precisa fazer nada. Este aviso é só para você não ser pego de surpresa.",
    ],
    details: [
      { label: "Grupo", value: data.groupName },
      { label: "Valor da renovação", value: formatBRL(data.amount) },
      { label: "Data da renovação", value: formatDateBR(data.renewalDate) },
    ],
    cta: { label: "Renovar agora", url: `${data.url}/dashboard/subscriptions` },
    note: "Quer trocar a forma de pagamento ou cancelar? Dá para fazer pelo painel, em Minhas Assinaturas.",
  });

  return {
    subject: `Sua assinatura do ${data.groupName} renova ${quando}`,
    text,
    html,
  };
}

export type OverdueData = {
  name: string;
  groupName: string;
  amount: number;
  renewalDate: string;
  graceEndDate: string;
  daysLeft: number;
  url: string;
};

/** Atraso: a renovação passou e a carência ainda não acabou. */
export function overdueTemplate(data: OverdueData): EmailContent {
  const { html, text } = emailShell({
    title: "Sua assinatura está atrasada",
    subtitle: data.groupName,
    tone: "danger",
    paragraphs: [
      `Olá, ${data.name}!`,
      `A renovação do ${data.groupName} venceu em ${formatDateBR(data.renewalDate)} e ainda não foi paga.`,
      `Você ainda tem ${data.daysLeft} dia(s) para regularizar — até ${formatDateBR(data.graceEndDate)}. Depois disso, o acesso ao grupo e às credenciais é encerrado e a assinatura é cancelada.`,
    ],
    details: [
      { label: "Grupo", value: data.groupName },
      { label: "Valor em aberto", value: formatBRL(data.amount) },
      { label: "Regularize até", value: formatDateBR(data.graceEndDate) },
    ],
    cta: { label: "Regularizar assinatura", url: `${data.url}/dashboard/subscriptions` },
    note: "Se você já pagou e o status não atualizou, ignore — o sistema corrige sozinho em instantes.",
  });

  return {
    subject: `Assinatura atrasada — ${data.groupName}`,
    text,
    html,
  };
}

export type PaymentFailedData = {
  name: string;
  groupName: string;
  amount: number;
  retryDate: string;
  url: string;
};

/** Cobrança recusada — o cartão falhou e haverá nova tentativa. */
export function paymentFailedTemplate(data: PaymentFailedData): EmailContent {
  const { html, text } = emailShell({
    title: "Não conseguimos cobrar sua assinatura",
    subtitle: data.groupName,
    tone: "danger",
    paragraphs: [
      `Olá, ${data.name}!`,
      `A cobrança da sua assinatura do ${data.groupName} não foi aprovada. Isso costuma acontecer quando o cartão está sem saldo, expirado ou com os dados desatualizados.`,
      `Vamos tentar de novo em ${formatDateBR(data.retryDate)}. Se puder atualizar o cartão agora, a regularização fica garantida.`,
    ],
    details: [
      { label: "Grupo", value: data.groupName },
      { label: "Valor", value: formatBRL(data.amount) },
      { label: "Próxima tentativa", value: formatDateBR(data.retryDate) },
    ],
    cta: { label: "Atualizar cartão", url: `${data.url}/dashboard/subscriptions` },
    note: "Se quiser trocar a forma de pagamento (PIX, por exemplo), dá para fazer pelo mesmo painel.",
  });

  return {
    subject: `Falha na cobrança — ${data.groupName}`,
    text,
    html,
  };
}

export type CancelledData = {
  name: string;
  groupName: string;
  url: string;
};

/** Assinatura cancelada por falta de pagamento (fim da carência). */
export function cancelledTemplate(data: CancelledData): EmailContent {
  const { html, text } = emailShell({
    title: "Sua assinatura foi cancelada",
    subtitle: data.groupName,
    tone: "danger",
    paragraphs: [
      `Olá, ${data.name}!`,
      `Como a renovação do ${data.groupName} ficou vencida por mais de 7 dias, a assinatura foi cancelada e o seu acesso ao grupo foi encerrado.`,
      "Nada foi perdido de forma definitiva: se quiser voltar, é só assinar de novo — o grupo continua disponível.",
    ],
    cta: { label: "Ver grupos disponíveis", url: `${data.url}/groups` },
    footerNote: "Se você pagou e ainda assim recebeu este aviso, responda este e-mail que a gente corrige.",
  });

  return {
    subject: `Assinatura cancelada — ${data.groupName}`,
    text,
    html,
  };
}
