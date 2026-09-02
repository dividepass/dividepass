import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

      // Verificar se eh admin
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "No auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const jwt = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabaseAdmin.auth.getUser(jwt);
      if (!user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: profile } = await supabaseAdmin
        .from("users").select("role").eq("id", user.id).maybeSingle();
      if (profile?.role !== "admin") {
        return new Response(JSON.stringify({ error: "Not admin" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const body = await req.json().catch(() => ({}));
      const action = body.action || "list";

      if (action === "list") {
        const { data, error } = await supabaseAdmin.rpc("exec_sql", {
          query: `SELECT jobid, schedule, command, nodename, nodeport, database, username, active, jobname FROM cron.job ORDER BY jobid`
        });

        if (error) {
          // Fallback: tentar query direta
          const { data: directData, error: directError } = await supabaseAdmin
            .from("app_settings").select("key, value").eq("key", "recurring_billing_cron_secret");

          // Listar crons conhecidos hardcoded + do banco
          const knownCrons = [
            {
              jobid: 1,
              jobname: "process-recurring-billing",
              schedule: "0 14 * * *",
              command: "SELECT net.http_post(...)",
              active: true,
              description: "Cobranças recorrentes - todo dia às 11h BRT",
              next_run: getNextRun("0 14 * * *"),
              type: "billing"
            },
            {
              jobid: 2,
              jobname: "process-overdue-invoices",
              schedule: "0 6 * * *",
              command: "SELECT net.http_post(...)",
              active: true,
              description: "Faturas vencidas - todo dia às 03h BRT",
              next_run: getNextRun("0 6 * * *"),
              type: "overdue"
            },
            {
              jobid: 3,
              jobname: "update-subscription-statuses",
              schedule: "0 3 * * *",
              command: "SELECT net.http_post(...)",
              active: true,
              description: "Atualizar status de assinaturas",
              next_run: getNextRun("0 3 * * *"),
              type: "status"
            }
          ];

          return Response.json({ crons: knownCrons }, { headers: corsHeaders });
        }

        return Response.json({ crons: data || [] }, { headers: corsHeaders });
      }

      if (action === "toggle") {
        const { jobid, active } = body;
        if (!jobid) {
          return new Response(JSON.stringify({ error: "jobid required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { error } = await supabaseAdmin.rpc("exec_sql", {
          query: `SELECT cron.${active ? "schedule" : "unschedule"}(${jobid})`
        });

        if (error) {
          // Se nao conseguiu via rpc, informar que precisa configurar
          return Response.json({
            success: false,
            message: `Não foi possível alterar cron via RPC. Configure manualmente no Supabase Dashboard > SQL Editor: SELECT cron.${active ? "schedule" : "unschedule"}(${jobid})`,
            needsManual: true
          }, { headers: corsHeaders });
        }

        return Response.json({ success: true, jobid, active }, { headers: corsHeaders });
      }

      if (action === "run_now") {
        const { jobname } = body;
        if (!jobname) {
          return new Response(JSON.stringify({ error: "jobname required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const functionUrl = `${supabaseUrl}/functions/v1/${jobname}`;

        const resp = await fetch(functionUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ manual: true }),
        });

        const data = await resp.text();
        console.log(`Manual run ${jobname} [${resp.status}]:`, data.substring(0, 500));

        return Response.json({
          success: resp.ok,
          status: resp.status,
          response: data.substring(0, 2000),
        }, { headers: corsHeaders });
      }

      if (action === "user_crons") {
        const { user_id } = body;
        if (!user_id) {
          return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Buscar assinaturas do usuário (sempre retorna todas, independente de status)
        const { data: subscriptions, error: subsErr } = await supabaseAdmin
          .from("user_subscriptions")
          .select("*")
          .eq("user_id", user_id)
          .order("created_at", { ascending: false });

        if (subsErr) {
          console.error("user_crons subsErr:", subsErr);
          return Response.json({ error: subsErr.message }, { status: 500, headers: corsHeaders });
        }

        // Enriquecer assinaturas com nomes de grupo e serviço via queries separadas
        const enrichedSubs = await Promise.all((subscriptions || []).map(async (sub) => {
          let groupName = "—";
          let serviceName = "—";
          if (sub.group_id) {
            const { data: g } = await supabaseAdmin.from("groups").select("name").eq("id", sub.group_id).maybeSingle();
            groupName = g?.name || "—";
          }
          if (sub.service_id) {
            const { data: s } = await supabaseAdmin.from("streaming_services").select("name, full_name").eq("id", sub.service_id).maybeSingle();
            serviceName = s?.full_name || s?.name || "—";
          }
          return {
            ...sub,
            group_name: groupName,
            service_name: serviceName,
          };
        }));

        // Buscar billing_cycles do usuário (queries separadas sem join complexo)
        const { data: billingCycles, error: bcErr } = await supabaseAdmin
          .from("billing_cycles")
          .select("*")
          .eq("user_id", user_id)
          .order("charge_date", { ascending: false })
          .limit(50);

        if (bcErr) {
          console.error("user_crons bcErr:", bcErr);
        }

        // Enriquecer billing_cycles com nomes de grupo/serviço
        const enrichedCycles = await Promise.all((billingCycles || []).map(async (bc) => {
          let groupName = "—";
          let serviceName = "—";
          if (bc.group_id) {
            const { data: g } = await supabaseAdmin.from("groups").select("name").eq("id", bc.group_id).maybeSingle();
            groupName = g?.name || "—";
          }
          if (bc.subscription_id) {
            const { data: sub } = await supabaseAdmin.from("user_subscriptions").select("service_id").eq("id", bc.subscription_id).maybeSingle();
            if (sub?.service_id) {
              const { data: svc } = await supabaseAdmin.from("streaming_services").select("name, full_name").eq("id", sub.service_id).maybeSingle();
              serviceName = svc?.full_name || svc?.name || "—";
            }
          }
          return { ...bc, group_name: groupName, service_name: serviceName };
        }));

        // Buscar billing_logs do usuário
        const { data: billingLogs, error: blErr } = await supabaseAdmin
          .from("billing_logs")
          .select("*")
          .eq("user_id", user_id)
          .order("created_at", { ascending: false })
          .limit(30);

        if (blErr) {
          console.error("user_crons blErr:", blErr);
        }

        // Mapear crons globais que afetam este usuário
        const activeSubs = enrichedSubs.filter(s => s.status === "active");
        const globalCrons = [
          {
            id: "process-recurring-billing",
            name: "Cobranças Recorrentes",
            schedule: "0 14 * * *",
            description: "Cobra cartões dos usuários com cobranças agendadas",
            schedule_human: "Todo dia às 11:00 BRT",
            affected: activeSubs.length > 0 && activeSubs.some(s => s.card_id),
            type: "billing",
            active: true,
            detail: activeSubs.filter(s => s.card_id).map(s => ({
              subscription_id: s.id,
              group_name: s.group_name,
              service_name: s.service_name,
              next_charge_at: s.next_charge_at,
              amount: s.amount,
              retry_count: s.retry_count || 0,
              billing_status: s.billing_status,
              card_last4: s.card_last4,
            })),
          },
          {
            id: "process-overdue-invoices",
            name: "Faturas Vencidas",
            schedule: "0 6 * * *",
            description: "Processa faturas que passaram da data de vencimento",
            schedule_human: "Todo dia às 03:00 BRT",
            affected: enrichedSubs.some(s => s.status === "overdue" || s.status === "first_attempt"),
            type: "overdue",
            active: true,
          },
          {
            id: "update-subscription-statuses",
            name: "Atualizar Status",
            schedule: "0 3 * * *",
            description: "Atualiza status das assinaturas automaticamente",
            schedule_human: "Todo dia às 00:00 BRT",
            affected: enrichedSubs.some(s => ["pending", "first_attempt", "overdue"].includes(s.status)),
            type: "status",
            active: true,
          },
        ];

        return Response.json({
          subscriptions: enrichedSubs,
          billing_cycles: enrichedCycles,
          billing_logs: billingLogs || [],
          global_crons: globalCrons,
        }, { headers: corsHeaders });
      }

      if (action === "schedule_user_charge") {
        const { user_id, subscription_id, charge_date, amount, notes } = body;
        if (!user_id || !subscription_id) {
          return new Response(JSON.stringify({ error: "user_id and subscription_id required" }), { status: 400, headers: corsHeaders });
        }

        // Buscar dados da assinatura
        const { data: sub, error: subErr } = await supabaseAdmin
          .from("user_subscriptions")
          .select("*, group:group_id(id), service:service_id(id, name)")
          .eq("id", subscription_id)
          .eq("user_id", user_id)
          .maybeSingle();

        if (subErr || !sub) {
          return Response.json({ error: "Assinatura não encontrada" }, { status: 404, headers: corsHeaders });
        }

        const groupId = (sub.group as any)?.id || (sub as any).group_id;
        const scheduledDate = charge_date || new Date().toISOString().split("T")[0];

        const { data: cycle, error: cycleErr } = await supabaseAdmin
          .from("billing_cycles")
          .insert({
            subscription_id: subscription_id,
            user_id: user_id,
            group_id: groupId,
            amount: amount || sub.amount,
            charge_date: scheduledDate,
            gateway: sub.gateway || "iopay",
            status: "pending",
            attempt_number: 1,
            notes: notes || `Cobrança manual agendada por admin`,
          })
          .select()
          .maybeSingle();

        if (cycleErr) {
          return Response.json({ error: cycleErr.message }, { status: 500, headers: corsHeaders });
        }

        // Log da ação
        await supabaseAdmin.from("billing_logs").insert({
          subscription_id: subscription_id,
          user_id: user_id,
          group_id: groupId,
          action: "manual_schedule",
          details: {
            scheduled_date: scheduledDate,
            amount: amount || sub.amount,
            notes: notes || null,
          },
        });

        return Response.json({ success: true, cycle }, { headers: corsHeaders });
      }

      if (action === "cron_details") {
        const { jobname } = body;
        if (!jobname) {
          return new Response(JSON.stringify({ error: "jobname required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        let details: any = {
          jobname,
          description: "",
          schedule: "",
          next_run: "",
          type: "",
          affected_users: [],
          recent_executions: [],
          stats: {},
        };

        // Mapear cron para seus dados
        const cronMeta: Record<string, any> = {
          "process-recurring-billing": {
            description: "Cobranças recorrentes - cobra cartões dos usuários com cobranças agendadas",
            schedule: "0 14 * * *",
            type: "billing",
            fullDescription: "Executa todo dia às 11h BRT. Busca todas as assinaturas ativas com `next_charge_at` <= agora, cartão cadastrado, e `retry_count` < 3. Para cada uma, cria uma transação no gateway (IOPay) usando o cartão salvo. Se sucesso: avança `next_charge_at`, cria fatura, credita wallet. Se falha: incrementa `retry_count`, agenda retry (+1d/+2d), cancela após 3 tentativas.",
          },
          "process-overdue-invoices": {
            description: "Faturas vencidas - processa faturas que passaram da data",
            schedule: "0 6 * * *",
            type: "overdue",
            fullDescription: "Executa todo dia às 03h BRT. Busca faturas com status 'pending' cuja data de vencimento passou. Tenta cobrar novamente ou marca como overdue.",
          },
          "update-subscription-statuses": {
            description: "Atualizar status de assinaturas",
            schedule: "0 3 * * *",
            type: "status",
            fullDescription: "Executa todo dia às 00h BRT. Atualiza automaticamente o status das assinaturas baseado em regras: `first_attempt` → `overdue` após 3 dias sem pagamento, `overdue` → `cancelled` após mais dias.",
          },
        };

        const meta = cronMeta[jobname] || {};
        details.description = meta.fullDescription || meta.description || "";
        details.type = meta.type || "custom";
        details.schedule = meta.schedule || "";

        if (details.schedule) {
          details.next_run = getNextRun(details.schedule);
        }

        // Buscar logs de billing relevantes a este cron
        if (jobname === "process-recurring-billing") {
          // Assinaturas que seriam afetadas (próximas cobranças)
          const { data: upcomingSubs } = await supabaseAdmin
            .from("user_subscriptions")
            .select("id, user_id, next_charge_at, amount, retry_count, billing_status, card_id")
            .eq("status", "active")
            .not("card_id", "is", null)
            .eq("billing_status", "active")
            .lte("next_charge_at", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
            .order("next_charge_at", { ascending: true });

          // Assinaturas com retry (falharam, tentando novamente)
          const { data: retrySubs } = await supabaseAdmin
            .from("user_subscriptions")
            .select("id, user_id, next_charge_at, amount, retry_count, billing_status")
            .eq("status", "active")
            .eq("billing_status", "retrying")
            .order("retry_count", { ascending: false });

          // Total de assinaturas ativas com cartão
          const { count: totalWithCard } = await supabaseAdmin
            .from("user_subscriptions")
            .select("id", { count: "exact", head: true })
            .eq("status", "active")
            .not("card_id", "is", null);

          // Total sem cartão (não podem ser cobradas)
          const { count: totalWithoutCard } = await supabaseAdmin
            .from("user_subscriptions")
            .select("id", { count: "exact", head: true })
            .eq("status", "active")
            .is("card_id", null);

          // Últimas execuções do billing
          const { data: recentLogs } = await supabaseAdmin
            .from("billing_logs")
            .select("id, action, details, created_at")
            .in("action", ["charge_attempt", "charge_success", "charge_failed"])
            .order("created_at", { ascending: false })
            .limit(20);

          // Enriquecer assinaturas com dados de usuário e grupo
          const upcoming = await Promise.all((upcomingSubs || []).slice(0, 10).map(async (s) => {
            const [{ data: user }, { data: group }, { data: service }] = await Promise.all([
              supabaseAdmin.from("users").select("name, email").eq("id", s.user_id).maybeSingle(),
              supabaseAdmin.from("groups").select("name").eq("id", (s as any).group_id).maybeSingle(),
              supabaseAdmin.from("streaming_services").select("name").eq("id", (s as any).service_id).maybeSingle(),
            ]);
            return { ...s, user_name: user?.name, user_email: user?.email, group_name: group?.name, service_name: service?.name };
          }));

          const retries = await Promise.all((retrySubs || []).map(async (s) => {
            const [{ data: user }, { data: group }, { data: service }] = await Promise.all([
              supabaseAdmin.from("users").select("name, email").eq("id", s.user_id).maybeSingle(),
              supabaseAdmin.from("groups").select("name").eq("id", (s as any).group_id).maybeSingle(),
              supabaseAdmin.from("streaming_services").select("name").eq("id", (s as any).service_id).maybeSingle(),
            ]);
            return { ...s, user_name: user?.name, user_email: user?.email, group_name: group?.name, service_name: service?.name };
          }));

          details.stats = {
            total_with_card: totalWithCard || 0,
            total_without_card: totalWithoutCard || 0,
            upcoming_charges: (upcomingSubs || []).length,
            retrying: (retrySubs || []).length,
            total_upcoming_amount: (upcomingSubs || []).reduce((sum, s) => sum + (s.amount || 0), 0),
          };

          details.affected_users = [...upcoming, ...retries];
          details.recent_executions = (recentLogs || []).map(l => ({
            id: l.id,
            action: l.action,
            details: l.details,
            created_at: l.created_at,
          }));
        } else if (jobname === "update-subscription-statuses") {
          // Assinaturas pendentes de verificação
          const { count: pendingCount } = await supabaseAdmin
            .from("user_subscriptions")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending");

          const { count: firstAttemptCount } = await supabaseAdmin
            .from("user_subscriptions")
            .select("id", { count: "exact", head: true })
            .eq("status", "first_attempt");

          const { count: overdueCount } = await supabaseAdmin
            .from("user_subscriptions")
            .select("id", { count: "exact", head: true })
            .eq("status", "overdue");

          details.stats = {
            pending: pendingCount || 0,
            first_attempt: firstAttemptCount || 0,
            overdue: overdueCount || 0,
          };
        } else if (jobname === "process-overdue-invoices") {
          const { count: overdueCount } = await supabaseAdmin
            .from("invoices")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending");

          details.stats = {
            overdue_invoices: overdueCount || 0,
          };
        }

        return Response.json({ details }, { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (error: any) {
      console.error("manage-crons error:", error);
      return Response.json(
        { error: error.message },
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};

function getNextRun(schedule: string): string {
  try {
    const parts = schedule.split(" ");
    const minute = parseInt(parts[0]) || 0;
    const hour = parseInt(parts[1]) || 0;
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(hour, minute, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString();
  } catch {
    return "unknown";
  }
}
