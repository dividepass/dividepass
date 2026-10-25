import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Descricao e tipo de cada agendamento conhecido.
 *
 * `cron.job` guarda apenas o comando e a expressao de agendamento — nao tem
 * coluna de descricao nem de proximo disparo. Essas informacoes sao
 * calculadas aqui.
 */
const CRON_META: Record<string, { description: string; type: string; schedule: string; fullDescription: string }> = {
  "process-recurring-billing": {
    description: "Cobranças recorrentes - cobra cartões dos usuários com cobranças agendadas",
    type: "billing",
    schedule: "0 14 * * *",
    fullDescription: "Executa todo dia às 11h BRT. Busca todas as assinaturas ativas com `next_charge_at` <= agora, cartão cadastrado, e `retry_count` < 3. Para cada uma, cria uma transação no gateway (IOPay) usando o cartão salvo. Se sucesso: avança `next_charge_at`, cria fatura, credita wallet. Se falha: incrementa `retry_count`, agenda retry (+1d/+2d), cancela após 3 tentativas.",
  },
  "process-overdue-invoices": {
    description: "Faturas vencidas - processa faturas que passaram da data",
    type: "overdue",
    schedule: "0 6 * * *",
    fullDescription: "Executa todo dia às 03h BRT. Busca faturas com status 'pending' cuja data de vencimento passou. Tenta cobrar novamente ou marca como overdue.",
  },
  "update-subscription-statuses": {
    description: "Atualizar status de assinaturas",
    type: "status",
    schedule: "0 3 * * *",
    fullDescription: "Executa todo dia às 00h BRT. Atualiza automaticamente o status das assinaturas baseado em regras: `first_attempt` → `overdue` após 3 dias sem pagamento, `overdue` → `cancelled` após mais dias.",
  },
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
        // A RPC `exec_sql` (SQL arbitrario) NAO existe em producao — era por
        // causa dela que este painel mostrava uma lista INVENTADA de 3 jobs,
        // sempre "Ativos", sem saber se o agendamento existia de verdade.
        //
        // Agora usa uma RPC estreita e dedicada (`manage_cron_jobs`), criada
        // em database/add-cron-management.sql, que so le `cron.job`.
        const { data, error } = await supabaseAdmin.rpc("manage_cron_jobs");

        if (error) {
          console.error("[manage-crons] manage_cron_jobs:", error.message);
          return Response.json({
            crons: [],
            cron_source: "unavailable",
            message:
              "Nao foi possivel ler os agendamentos do banco. Rode database/add-cron-management.sql no SQL Editor do Supabase para habilitar a leitura real.",
            error: error.message,
          }, { headers: corsHeaders });
        }

        const crons = (Array.isArray(data) ? data : []).map((job: any) => ({
          jobid: job.jobid,
          jobname: job.jobname,
          schedule: job.schedule,
          command: job.command,
          active: job.active,
          // `cron.job` nao tem `next_run` nem `description` — o pg_cron calcula
          // o proximo disparo e nao o guarda. Aqui os dois sao calculados.
          description: CRON_META[job.jobname]?.description || "",
          next_run: job.schedule ? getNextRun(job.schedule) : "",
          type: job.type || CRON_META[job.jobname]?.type || "custom",
        }));

        return Response.json({ crons, cron_source: "database" }, { headers: corsHeaders });
      }

      if (action === "toggle") {
        const { jobid, active } = body;
        if (!jobid) {
          return new Response(JSON.stringify({ error: "jobid required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // RPC estreita: so agenda/desagenda um job de cron.job existente.
        const { error } = await supabaseAdmin.rpc("toggle_cron_job", {
          p_jobid: Number(jobid),
          p_active: !!active,
        });

        if (error) {
          console.error("[manage-crons] toggle_cron_job:", error.message);
          return Response.json({
            success: false,
            message: `Nao foi possivel alterar o agendamento via RPC (${error.message}). Configure manualmente no Supabase Dashboard > SQL Editor: SELECT cron.${active ? "schedule" : "unschedule"}(${jobid})`,
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
          overdue_invoices: [],
          recent_executions: [],
          stats: {},
        };

        // Mapear cron para seus dados
        const meta = CRON_META[jobname] || {};
        details.description = meta.fullDescription || meta.description || "";
        details.type = meta.type || "custom";

        // O schedule real vem do banco (`cron.job`). O valor fixo aqui e
        // apenas o fallback para quando o job nao esta agendado — assim a
        // tela mostra a verdade em vez de umaschedule inventada.
        let realSchedule = "";
        try {
          const { data: jobRows } = await supabaseAdmin.rpc("manage_cron_jobs");
          const job = (Array.isArray(jobRows) ? jobRows : []).find(
            (j: any) => j.jobname === jobname,
          );
          if (job) {
            realSchedule = job.schedule || "";
            details.next_run = job.schedule ? getNextRun(job.schedule) : "";
            details.active = job.active;
          }
        } catch (e) {
          console.error("[manage-crons] cron_details ao ler o job:", e);
        }
        details.schedule = realSchedule || meta.schedule || "";

        if (details.schedule) {
          details.next_run = getNextRun(details.schedule);
        }

        // Buscar logs de billing relevantes a este cron
        if (jobname === "process-recurring-billing") {
          // Assinaturas que seriam afetadas (próximas cobranças)
          const { data: upcomingSubs } = await supabaseAdmin
            .from("user_subscriptions")
            .select("id, user_id, group_id, next_charge_at, amount, retry_count, billing_status, card_id, card_last4, card_brand, billing_cycle")
            .eq("status", "active")
            .not("card_id", "is", null)
            .eq("billing_status", "active")
            .lte("next_charge_at", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
            .order("next_charge_at", { ascending: true });

          // Assinaturas com retry (falharam, tentando novamente)
          const { data: retrySubs } = await supabaseAdmin
            .from("user_subscriptions")
            .select("id, user_id, group_id, next_charge_at, amount, retry_count, billing_status, card_id, card_last4, card_brand, billing_cycle")
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
            return { ...s, subscription_id: s.id, user_name: user?.name, user_email: user?.email, group_name: group?.name, service_name: service?.name };
          }));

          const retries = await Promise.all((retrySubs || []).map(async (s) => {
            const [{ data: user }, { data: group }, { data: service }] = await Promise.all([
              supabaseAdmin.from("users").select("name, email").eq("id", s.user_id).maybeSingle(),
              supabaseAdmin.from("groups").select("name").eq("id", (s as any).group_id).maybeSingle(),
              supabaseAdmin.from("streaming_services").select("name").eq("id", (s as any).service_id).maybeSingle(),
            ]);
            return { ...s, subscription_id: s.id, user_name: user?.name, user_email: user?.email, group_name: group?.name, service_name: service?.name };
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
          // Faturas VENCIDAS de verdade.
          //
          // Antes contava TODAS as faturas `pending` — inclusive as que ainda
          // nao venceram — e por isso o painel mostrava "46 Faturas vencidas"
          // sem dizer QUEM eram. Agora filtra por vencimento real e devolve a
          // lista com nome, valor, dias de atraso e a assinatura relacionada,
          // para o admin ter em mao o que contornar.
          const today = new Date().toISOString().split("T")[0];

          const { data: overdueInvoices, error: overdueErr } = await supabaseAdmin
            .from("invoices")
            .select("id, user_id, group_id, service_id, amount, due_date, created_at")
            .eq("status", "pending")
            .lte("due_date", today)
            .order("due_date", { ascending: true })
            .limit(200);

          if (overdueErr) {
            console.error("[manage-crons] faturas vencidas:", overdueErr.message);
          }

          const invoiceRows = overdueInvoices || [];

          const enriched = await Promise.all(invoiceRows.map(async (inv: any) => {
            const [{ data: user }, { data: group }, { data: service }] = await Promise.all([
              supabaseAdmin.from("users").select("name, email").eq("id", inv.user_id).limit(1),
              supabaseAdmin.from("groups").select("name").eq("id", inv.group_id).limit(1),
              supabaseAdmin.from("streaming_services").select("name").eq("id", inv.service_id).limit(1),
            ]);

            const dueDate = inv.due_date ? new Date(inv.due_date) : null;
            const daysOverdue = dueDate
              ? Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / 86400000))
              : 0;

            // Assinatura que originou a fatura (para o botao de contorno).
            const { data: subRows } = await supabaseAdmin
              .from("user_subscriptions")
              .select("id, status, billing_status, card_last4, next_charge_at")
              .eq("user_id", inv.user_id)
              .eq("group_id", inv.group_id)
              .order("created_at", { ascending: false })
              .limit(1);

            const sub = (subRows && subRows[0]) || null;

            return {
              id: inv.id,
              user_id: inv.user_id,
              group_id: inv.group_id,
              subscription_id: sub?.id || null,
              user_name: (user && user[0] && user[0].name) || null,
              user_email: (user && user[0] && user[0].email) || null,
              group_name: (group && group[0] && group[0].name) || null,
              service_name: (service && service[0] && service[0].name) || null,
              amount: inv.amount,
              due_date: inv.due_date,
              days_overdue: daysOverdue,
              card_last4: sub?.card_last4 || null,
              subscription_status: sub?.status || null,
            };
          }));

          const { count: pendingCount } = await supabaseAdmin
            .from("invoices")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending");

          details.overdue_invoices = enriched;
          details.stats = {
            overdue_invoices: enriched.length,
            amount_overdue: enriched.reduce((sum: number, i: any) => sum + Number(i.amount || 0), 0),
            pending_invoices_total: pendingCount || 0,
            without_card: enriched.filter((i: any) => !i.card_last4).length,
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
