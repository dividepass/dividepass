import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/send-notification.ts";
import { applySubscriptionLifecycle } from "../_shared/subscriptionLifecycle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generatePassword(length = 16) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const authHeader = req.headers.get("authorization") || "";
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

    let hasValidAuth = authHeader === `Bearer ${serviceRoleKey}`;

    if (!hasValidAuth) {
      // O cron envia o segredo de app_settings, que não é JWT e por isso é
      // barrado no gateway. A validação real acontece aqui dentro.
      const { data: secretRows } = await createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        serviceRoleKey,
      ).from("app_settings").select("value").in("key", [
        "overdue_cron_secret",
        "recurring_billing_cron_secret",
      ]);

      const accepted = [
        Deno.env.get("OVERDUE_CRON_SECRET") ?? "",
        ...(secretRows || []).map((r: any) => r.value || ""),
      ].filter(Boolean);

      const provided = authHeader.replace(/^Bearer\s+/i, "").trim();
      hasValidAuth = !!provided && accepted.includes(provided);
    }

    if (!hasValidAuth) {
      return new Response(
        JSON.stringify({ error: "Não autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const now = new Date();

      // Faturas pendentes que JÁ VENCERAM.
      //
      // O filtro antigo pegava as vencidas há mais de 5 dias e cancelava a
      // assinatura ali mesmo. A regra oficial é outra: a assinatura fica
      // ATRASADA por 7 dias (o grupo continua visível, com card de renovação)
      // e só depois é cancelada e o usuário é desvinculado. Aqui a fatura
      // vencida é marcada como failed — o cancelamento é do job de status
      // (`applySubscriptionLifecycle`, chamado no fim deste job).
      //
      // O embed `subscription:user_subscriptions!inner(...)` foi removido: a
      // tabela `invoices` NAO tem coluna `subscription_id` nem FK para
      // `user_subscriptions`, entao o PostgREST rejeitava o SELECT inteiro
      // e o job morria com 500 antes de processar qualquer fatura.
      const { data: overdueInvoices, error: invoiceError } = await supabaseAdmin
        .from("invoices")
        .select("id, user_id, group_id, amount, due_date, status")
        .eq("status", "pending")
        .lt("due_date", now.toISOString().slice(0, 10));

      if (invoiceError) {
        throw invoiceError;
      }

      const processed: string[] = [];

      for (const invoice of overdueInvoices || []) {
        const userId = invoice.user_id;
        const groupId = invoice.group_id;

        if (!userId || !groupId) continue;

        // 1. Marca fatura como falha/inadimplente
        await supabaseAdmin
          .from("invoices")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", invoice.id);

        // 2. O membro fica inadimplente (grupo visível, credencial bloqueada).
        await supabaseAdmin
          .from("group_members")
          .update({ payment_status: "overdue", updated_at: new Date().toISOString() })
          .eq("group_id", groupId)
          .eq("user_id", userId);

        // 3. Reseta a senha DA CREDENCIAL DESTE MEMBRO.
        //
        //    O codigo antigo fazia `.eq("group_id", groupId)` sem filtro de
        //    `assigned_to`: isso trocava a senha de TODAS as credenciais do
        //    grupo e derrubava o acesso de quem estava em dia. Agora so a
        //    credencial atribuida a este membro e invalidada.
        const newPassword = generatePassword();
        await supabaseAdmin
          .from("group_credentials")
          .update({ login_password: newPassword, updated_at: new Date().toISOString() })
          .eq("group_id", groupId)
          .eq("assigned_to", userId);

        const { data: group } = await supabaseAdmin
          .from("groups")
          .select("name, owner_id")
          .eq("id", groupId)
          .maybeSingle();

        // 4. Log de atividade
        await supabaseAdmin.from("activity_logs").insert({
          user_id: userId,
          action: "update",
          entity_type: "invoice",
          entity_id: invoice.id,
          description: `Fatura vencida. A assinatura fica atrasada por 7 dias antes de ser cancelada.`,
        });

        // 5. Notifica o membro (e o dono do grupo) sobre a renovação
        const { data: activeMembers } = await supabaseAdmin
          .from("group_members")
          .select("user_id")
          .eq("group_id", groupId)
          .eq("status", "active");

        const audienceIds = [
          userId,
          group?.owner_id,
          ...(activeMembers || []).filter((m) => m.user_id !== userId).map((m) => m.user_id),
        ].filter(Boolean);

        if (audienceIds.length > 0) {
          await dispatchNotification(supabaseAdmin, {
            title: "Renovação em atraso",
            message: `A renovação do grupo "${group?.name || "grupo"}" está atrasada. Regularize em até 7 dias para não perder o acesso.`,
            event_type: "overdue_member_removed",
            metadata: { user_id: userId, group_id: groupId, group_name: group?.name || groupId },
            audience: { type: "users", user_ids: Array.from(new Set(audienceIds)) },
            channels: ["in_app", "push"],
            url: `/dashboard/groups/${groupId}`,
          }).catch((e) => console.error("push notification error (overdue):", e));
        }

        processed.push(invoice.id);
      }

      // 6. Regra de status (ATRASADA / CANCELADA após 7 dias).
      //
      //    Rodar aqui é uma rede de seguranca: se o job de status estiver
      //    atrasado, a regra oficial ainda e aplicada.
      const lifecycle = await applySubscriptionLifecycle(supabaseAdmin, now);

      return Response.json(
        {
          processed: processed.length,
          invoices: processed,
          overdue: lifecycle.overdue,
          cancelled: lifecycle.cancelled,
          cancelledIds: lifecycle.cancelledIds,
        },
        { headers: corsHeaders }
      );
    } catch (error) {
      console.error("Overdue invoices error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
