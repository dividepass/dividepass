import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renewalDueAt, OVERDUE_GRACE_DAYS } from "../_shared/subscription-dates.ts";
import {
  sendUserEmail,
  loadEmailSettings,
  isEventEnabled,
} from "../_shared/user-emails.ts";
import {
  welcomeTemplate,
  renewalReminderTemplate,
  overdueTemplate,
  appUrl,
} from "../_shared/email-templates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * JOB DIÁRIO — E-MAILS DE CICLO DE VIDA
 *
 * Este é o job que faz o "lembrete de vencimento" sair sozinho, sem alguém
 * entrando no painel. Ele roda todo dia (pg_cron) e cuida de três eventos:
 *
 *   1) BOAS-VINDAS (rede de segurança)
 *      O e-mail de boas-vindas é disparado na hora pelo front, no momento do
 *      cadastro. Aqui ele volta para pegar quem ficou de fora: cadastro feito
 *      com o front antigo, chamada que falhou no meio do caminho, e-mail que o
 *      SMTP recusou. O dedup garante que ninguém receba duas vezes.
 *
 *   2) LEMBRETE DE RENOVAÇÃO
 *      A assinatura vence em N dias (N vem de `email_renewal_reminder_days`,
 *      padrão 3). Avisa antes, com o botão de renovar.
 *
 *   3) AVISO DE ATRASO
 *      A renovação passou e a carência de 7 dias ainda não acabou. Avisa no
 *      primeiro dia e repete uma vez (em `email_overdue_repeat_days`), porque
 *      é a última janela em que a pessoa ainda consegue recuperar o acesso.
 *
 * A trava de duplicidade é o `dedup_key` do `email_logs` (índice UNIQUE):
 * cada evento tem uma chave lógica e o banco recusa a segunda tentativa.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ---------------------------------------------------------------------------
  // AUTORIZAÇÃO
  //
  // A função roda com `verify_jwt = false` (o cron manda um segredo, não um
  // JWT). Sem esta checagem ela viraria um endpoint PÚBLICO que dispara
  // e-mail em nome de qualquer pessoa.
  //
  // Aceita: SERVICE_ROLE_KEY, o segredo em `app_settings` ou o
  // BILLING_CRON_SECRET do ambiente — o mesmo padrão do job de status.
  // ---------------------------------------------------------------------------
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || "";
  const authHeader = (req.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  let authorized = authHeader === serviceRoleKey && serviceRoleKey !== "";

  if (!authorized && authHeader) {
    const { data: secretRows } = await createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceRoleKey,
    )
      .from("app_settings")
      .select("value")
      .in("key", [
        "recurring_billing_cron_secret",
        "billing_cron_secret",
        "subscription_status_cron_secret",
        "email_cron_secret",
      ]);

    const accepted = [
      Deno.env.get("BILLING_CRON_SECRET") || "",
      ...(secretRows || []).map((r: any) => r.value || ""),
    ].filter(Boolean);

    authorized = accepted.includes(authHeader);
  }

  if (!authorized) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceRoleKey,
    );

    const now = new Date();
    const settings = await loadEmailSettings(supabaseAdmin);
    const url = appUrl({
      SITE_URL: Deno.env.get("SITE_URL"),
      APP_URL: Deno.env.get("APP_URL"),
    });

    const summary = {
      welcome: { sent: 0, skipped: 0 },
      renewal_reminder: { sent: 0, skipped: 0 },
      overdue_notice: { sent: 0, skipped: 0 },
    };

    /* ======================================================================
       1) BOAS-VINDAS — rede de segurança
       ====================================================================== */
    if (settings.welcome) {
      const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS);

      const { data: recentUsers } = await supabaseAdmin
        .from("users")
        .select("id, name, email, email_verified, created_at")
        .gte("created_at", fourteenDaysAgo.toISOString())
        .neq("status", "deleted")
        .not("email", "is", null);

      // Quem já recebeu o e-mail de boas-vindas.
      const { data: welcomeLogs } = await supabaseAdmin
        .from("email_logs")
        .select("user_id")
        .eq("event_type", "welcome");

      const alreadyWelcomed = new Set(
        (welcomeLogs || [])
          .map((row: any) => row.user_id)
          .filter(Boolean),
      );

      for (const user of recentUsers || []) {
        if (alreadyWelcomed.has(user.id)) continue;

        const content = welcomeTemplate({
          name: user.name || "cliente",
          url,
        });

        const result = await sendUserEmail(supabaseAdmin, {
          eventType: "welcome",
          dedupKey: `welcome:${user.id}`,
          userId: user.id,
          to: user.email,
          subject: content.subject,
          text: content.text,
          html: content.html,
          meta: {
            user_name: user.name || null,
            user_email: user.email,
            source: "lifecycle_cron",
            email_verified: user.email_verified,
          },
        });

        if (result.sent) summary.welcome.sent++;
        else summary.welcome.skipped++;
      }
    }

    /* ======================================================================
       2) + 3) LEMBRETE DE RENOVAÇÃO e AVISO DE ATRASO
       ====================================================================== */
    const reminderHorizon = new Date(
      now.getTime() + settings.reminderDays * DAY_MS,
    );
    const graceStart = new Date(now.getTime() - OVERDUE_GRACE_DAYS * DAY_MS);

    // Traz as assinaturas candidatas em DUAS consultas, em vez de uma com
    // `.or()`: filtro composto com timestamp no PostgREST é frágil (o `+` do
    // fuso atravessa o encoding), e aqui é mais seguro e mais claro.
    //
    //   1) as que já têm `renewal_due_at` (coluna nova) na janela
    //   2) as legadas (coluna vazia), filtradas aqui em JS pela data resolvida
    //
    // A regra de vencimento mora em `renewalDueAt()` — a mesma do resto do
    // sistema, então o e-mail e o status nunca discordam.
    const SUBSCRIPTION_FIELDS =
      "id, user_id, group_id, service_id, status, amount, billing_cycle, renewal_due_at, next_charge_at, expires_at";

    const [withDueAt, legacy] = await Promise.all([
      supabaseAdmin
        .from("user_subscriptions")
        .select(SUBSCRIPTION_FIELDS)
        .in("status", ["active", "expired"])
        .gte("renewal_due_at", graceStart.toISOString())
        .lte("renewal_due_at", reminderHorizon.toISOString()),
      supabaseAdmin
        .from("user_subscriptions")
        .select(SUBSCRIPTION_FIELDS)
        .in("status", ["active", "expired"])
        .is("renewal_due_at", null),
    ]);

    if (withDueAt.error) throw withDueAt.error;
    if (legacy.error) throw legacy.error;

    // A query do legado devolve todas as assinaturas sem `renewal_due_at`.
    // O filtro de data é aplicado aqui para não puxar volume à toa.
    const legacyInWindow = (legacy.data || []).filter((sub: any) => {
      const due = renewalDueAt(sub);
      if (!due) return false;
      const t = due.getTime();
      return t > graceStart.getTime() && t <= reminderHorizon.getTime();
    });

    const candidateList = [...(withDueAt.data || []), ...legacyInWindow];

    // Resolve nome do grupo, do serviço e do dono em lote (sem N+1).
    const candidateList = candidates || [];
    const userIds = Array.from(
      new Set(candidateList.map((s: any) => s.user_id).filter(Boolean)),
    );
    const groupIds = Array.from(
      new Set(candidateList.map((s: any) => s.group_id).filter(Boolean)),
    );
    const serviceIds = Array.from(
      new Set(candidateList.map((s: any) => s.service_id).filter(Boolean)),
    );

    const [usersRes, groupsRes, servicesRes] = await Promise.all([
      userIds.length
        ? supabaseAdmin
            .from("users")
            .select("id, name, email")
            .in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
      groupIds.length
        ? supabaseAdmin.from("groups").select("id, name").in("id", groupIds)
        : Promise.resolve({ data: [] as any[] }),
      serviceIds.length
        ? supabaseAdmin
            .from("streaming_services")
            .select("id, name, full_name")
            .in("id", serviceIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const userMap = new Map(
      (usersRes.data || []).map((u: any) => [u.id, u]),
    );
    const groupMap = new Map(
      (groupsRes.data || []).map((g: any) => [g.id, g]),
    );
    const serviceMap = new Map(
      (servicesRes.data || []).map((s: any) => [s.id, s]),
    );

    for (const sub of candidateList) {
      const user = userMap.get(sub.user_id);
      if (!user?.email) continue;

      const group = groupMap.get(sub.group_id);
      const service = serviceMap.get(sub.service_id);
      const groupName = group?.name || "seu grupo";
      const serviceName = service?.full_name || service?.name || null;
      const due = renewalDueAt(sub);
      if (!due) continue;

      const dueMs = due.getTime();

      // ── LEMBRETE: vence em breve e ainda não venceu ──────────────────────
      if (
        settings.renewalReminder &&
        isEventEnabled(settings, "renewal_reminder") &&
        dueMs >= now.getTime() &&
        dueMs <= reminderHorizon.getTime()
      ) {
        const daysLeft = Math.max(
          0,
          Math.ceil((dueMs - now.getTime()) / DAY_MS),
        );

        const content = renewalReminderTemplate({
          name: user.name || "cliente",
          groupName,
          amount: sub.amount,
          renewalDate: due.toISOString(),
          daysLeft,
          url,
        });

        const result = await sendUserEmail(supabaseAdmin, {
          eventType: "renewal_reminder",
          // A chave carrega a data de vencimento: quando o ciclo avança, a
          // chave muda e o próximo ciclo pode gerar um novo aviso.
          dedupKey: `renewal_reminder:${sub.id}:${due.toISOString()}`,
          userId: sub.user_id,
          to: user.email,
          subject: content.subject,
          text: content.text,
          html: content.html,
          meta: {
            subscription_id: sub.id,
            group_id: sub.group_id,
            group_name: groupName,
            service_name: serviceName,
            amount: Number(sub.amount) || 0,
            renewal_due_at: due.toISOString(),
            days_left: daysLeft,
          },
        });

        if (result.sent) summary.renewal_reminder.sent++;
        else summary.renewal_reminder.skipped++;
        continue;
      }

      // ── ATRASO: já venceu e ainda está dentro da carência ───────────────
      if (
        settings.overdue &&
        isEventEnabled(settings, "overdue_notice") &&
        dueMs < now.getTime() &&
        dueMs > graceStart.getTime()
      ) {
        const daysSinceDue = Math.floor(
          (now.getTime() - dueMs) / DAY_MS,
        );

        // Só dois momentos: no primeiro dia e, se configurado, uma repetição
        // no meio da carência.
        let round = 0;
        if (daysSinceDue === 0) round = 1;
        else if (
          settings.overdueRepeatDays > 0 &&
          daysSinceDue === settings.overdueRepeatDays
        ) {
          round = 2;
        }
        if (round === 0) continue;

        const graceEnd = new Date(dueMs + OVERDUE_GRACE_DAYS * DAY_MS);
        const daysLeft = Math.max(
          0,
          Math.ceil((graceEnd.getTime() - now.getTime()) / DAY_MS),
        );

        const content = overdueTemplate({
          name: user.name || "cliente",
          groupName,
          amount: sub.amount,
          renewalDate: due.toISOString(),
          graceEndDate: graceEnd.toISOString(),
          daysLeft,
          url,
        });

        const result = await sendUserEmail(supabaseAdmin, {
          eventType: "overdue_notice",
          dedupKey: `overdue_notice:${sub.id}:${due.toISOString()}:${round}`,
          userId: sub.user_id,
          to: user.email,
          subject: content.subject,
          text: content.text,
          html: content.html,
          meta: {
            subscription_id: sub.id,
            group_id: sub.group_id,
            group_name: groupName,
            amount: Number(sub.amount) || 0,
            renewal_due_at: due.toISOString(),
            grace_end_at: graceEnd.toISOString(),
            days_left: daysLeft,
            round,
          },
        });

        if (result.sent) summary.overdue_notice.sent++;
        else summary.overdue_notice.skipped++;
      }
    }

    console.log(
      `[send-lifecycle-emails] ${now.toISOString()} | boas-vindas: ${summary.welcome.sent} | renovação: ${summary.renewal_reminder.sent} | atraso: ${summary.overdue_notice.sent}`,
    );

    return new Response(
      JSON.stringify({ success: true, ...summary, timestamp: now.toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("send-lifecycle-emails error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
