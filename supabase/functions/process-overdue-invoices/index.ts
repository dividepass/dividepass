import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/send-notification.ts";

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
    const expectedSecret = Deno.env.get("OVERDUE_CRON_SECRET") ?? "";
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

    // Aceita: OVERDUE_CRON_SECRET, SERVICE_ROLE_KEY, ou JWT válido
    const isCronSecret = authHeader === `Bearer ${expectedSecret}`;
    const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;
    const hasValidAuth = authHeader.startsWith("Bearer ") && (isCronSecret || isServiceRole);

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

      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      const cutoff = fiveDaysAgo.toISOString().split("T")[0];

      // Busca faturas pendentes vencidas há mais de 5 dias
      const { data: overdueInvoices, error: invoiceError } = await supabaseAdmin
        .from("invoices")
        .select("*, subscription:user_subscriptions!inner(id, status, group_id, user_id)")
        .eq("status", "pending")
        .lt("due_date", cutoff);

      if (invoiceError) {
        throw invoiceError;
      }

      const processed: string[] = [];

      for (const invoice of overdueInvoices || []) {
        const subscriptionId = invoice.subscription?.id;
        const userId = invoice.user_id;
        const groupId = invoice.group_id || invoice.subscription?.group_id;

        if (!userId || !groupId) continue;

        // 1. Marca fatura como falha/inadimplente
        await supabaseAdmin
          .from("invoices")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", invoice.id);

        // 2. Cancela/expira a assinatura
        if (subscriptionId) {
          await supabaseAdmin
            .from("user_subscriptions")
            .update({ status: "expired", updated_at: new Date().toISOString() })
            .eq("id", subscriptionId);
        }

        // 3. Remove o membro do grupo
        await supabaseAdmin
          .from("group_members")
          .update({ status: "inactive", left_at: new Date().toISOString() })
          .eq("group_id", groupId)
          .eq("user_id", userId);

        // 4. Reseta a senha da credencial do grupo para invalidar acesso
        const newPassword = generatePassword();
        await supabaseAdmin
          .from("group_credentials")
          .update({ login_password: newPassword, updated_at: new Date().toISOString() })
          .eq("group_id", groupId);

        const { data: group } = await supabaseAdmin
          .from("groups")
          .select("name, owner_id")
          .eq("id", groupId)
          .maybeSingle();

        // 5. Log de atividade
        await supabaseAdmin.from("activity_logs").insert({
          user_id: userId,
          action: "update",
          entity_type: "subscription",
          entity_id: subscriptionId,
          description: `Membro removido por inadimplência. Fatura ${invoice.id} vencida há mais de 5 dias. Senha da credencial alterada.`,
        });

        // 6. Notifica os outros membros ativos do grupo sobre a remoção
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
            title: "Atualização de segurança no grupo",
            message: "Um membro foi removido por inadimplência e a senha da conta foi alterada. Verifique suas credenciais.",
            event_type: "overdue_member_removed",
            metadata: { user_id: userId, group_id: groupId, group_name: group?.name || groupId },
            audience: { type: "users", user_ids: Array.from(new Set(audienceIds)) },
            channels: ["in_app", "push"],
            url: `/dashboard/groups/${groupId}`,
          }).catch((e) => console.error("push notification error (overdue):", e));
        }

        processed.push(invoice.id);
      }

      return Response.json(
        { processed: processed.length, invoices: processed },
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
