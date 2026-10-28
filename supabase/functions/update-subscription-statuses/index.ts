import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applySubscriptionLifecycle } from "../_shared/subscriptionLifecycle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ---------------------------------------------------------------------------
  // AUTORIZACAO
  //
  // A funcao roda com `verify_jwt = false` (o cron manda um segredo, nao um
  // JWT). Sem esta checagem ela viraria um endpoint PUBLICO que altera o
  // status das assinaturas de qualquer pessoa.
  //
  // Aceita: o SERVICE_ROLE_KEY, o segredo guardado em `app_settings` ou o
  // BILLING_CRON_SECRET do ambiente.
  // ---------------------------------------------------------------------------
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || "";
  const authHeader = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let authorized = authHeader === serviceRoleKey && serviceRoleKey !== "";

  if (!authorized && authHeader) {
    const { data: secretRows } = await createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceRoleKey,
    ).from("app_settings").select("value").in("key", [
      "recurring_billing_cron_secret",
      "billing_cron_secret",
      "subscription_status_cron_secret",
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
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? ""
    );

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    let totalUpdated = 0;

    // -------------------------------------------------------------------------
    // 1) FLUXO DE ENTRADA (taxa de adesao)
    //
    // first_attempt: a pessoa entrou mas nunca pagou a taxa. Apos 7 dias sem
    // nenhum pagamento ela vira 'overdue' (o prazo de 12h do
    // `subscription_deadline` ja foi conferido no passo 2).
    // -------------------------------------------------------------------------
    const { data: firstAttempts, error: e1 } = await supabaseAdmin
      .from("group_members")
      .select("user_id, group_id")
      .eq("payment_status", "first_attempt")
      .lt("created_at", sevenDaysAgo.toISOString());

    if (firstAttempts && firstAttempts.length > 0) {
      for (const m of firstAttempts) {
        const { data: hasPaid } = await supabaseAdmin
          .from("payments")
          .select("id")
          .eq("user_id", m.user_id)
          .eq("group_id", m.group_id)
          .eq("status", "paid")
          .limit(1)
          .maybeSingle();

        if (!hasPaid) {
          await supabaseAdmin
            .from("group_members")
            .update({ payment_status: "overdue", updated_at: now.toISOString() })
            .eq("user_id", m.user_id)
            .eq("group_id", m.group_id);
          totalUpdated++;
        }
      }
    }

    // 2) awaiting_subscription → overdue: o prazo de 12h para fechar a
    //    assinatura depois do pagamento da taxa de entrada passou.
    const { count: c2 } = await supabaseAdmin
      .from("group_members")
      .update({ payment_status: "overdue", updated_at: now.toISOString() })
      .eq("payment_status", "awaiting_subscription")
      .not("subscription_deadline", "is", null)
      .lt("subscription_deadline", now.toISOString());
    totalUpdated += c2 || 0;

    // -------------------------------------------------------------------------
    // 3) CICLO DE VIDA DA ASSINATURA (a regra oficial)
    //
    //    ATRASADA: a renovacao passou, mas ainda ha carencia de 7 dias — o
    //              grupo continua visivel e o usuario pode renovar.
    //    CANCELADA: passou da carencia — assinatura cancelada, usuario
    //              desvinculado do grupo e crons de cobranca canceladas.
    //
    //    A regra mora em `../_shared/subscriptionLifecycle.ts` (a mesma
    //   semantica do `src/lib/subscriptionAccess.js` do front).
    // -------------------------------------------------------------------------
    const lifecycle = await applySubscriptionLifecycle(supabaseAdmin, now);

    // -------------------------------------------------------------------------
    // 4) Sincroniza assinatura cancelada quando o MEMBRO foi cancelado
    //
    // O `rpc("exec_sql")` nao roda em producao (a RPC nao existe, 404) e o
    // `rpc()` do supabase-js v2 devolve um builder que tem `.then()` mas NAO
    // tem `.catch()`. A sincronizacao e feita direto, sem RPC.
    //
    // BUG CORRIGIDO (2026-10-25): o codigo antigo filtrava por GROUP_ID e
    // mudava o status de TODAS as assinaturas do grupo. O par correto e
    // (user_id, group_id): so a assinatura daquele membro muda.
    // -------------------------------------------------------------------------
    const syncTargets = await supabaseAdmin
      .from("group_members")
      .select("user_id, group_id, payment_status")
      .in("payment_status", ["overdue", "cancelled"]);

    if (syncTargets.error) throw syncTargets.error;

    /**
     * Aplica um patch nas assinaturas de um conjunto de PARES
     * (user_id, group_id). O PostgREST nao filtra por coluna composta, mas
     * aceita `or=(and(...),and(...))` — e ainda aceita `and` com `in` fora
     * dele. O lote evita uma requisicao por membro.
     */
    const applyPairUpdates = async (
      pairs: { user_id: string; group_id: string }[],
      patch: Record<string, string>,
      fromStatus: string[],
    ) => {
      if (!pairs.length) return 0;

      const BATCH = 40;
      let updated = 0;

      for (let i = 0; i < pairs.length; i += BATCH) {
        const batch = pairs.slice(i, i + BATCH);
        const filter = batch
          .map((p) => `and(user_id.eq.${p.user_id},group_id.eq.${p.group_id})`)
          .join(',');

        const { count, error } = await supabaseAdmin
          .from("user_subscriptions")
          .update(patch)
          .in("status", fromStatus)
          .or(filter);

        if (error) throw error;
        updated += count || 0;
      }

      return updated;
    };

    const members = syncTargets.data || [];
    const patchAt = { updated_at: now.toISOString() };

    // Membro cancelado → assinatura cancelada.
    //
    // O ATRASADO NÃO entra aqui de propósito: durante a carência de 7 dias a
    // assinatura continua 'active' (e, portanto, continua listada em "Minhas
    // Assinaturas" e "Assinaturas Ativas" como ATRASADA). Marcar como
    // 'expired' aqui esconderia a assinatura justamente no período em que o
    // usuário ainda pode renovar.
    const synced = await applyPairUpdates(
      members.filter((m) => m.payment_status === "cancelled"),
      { ...patchAt, status: "cancelled", billing_status: "cancelled" },
      ["active", "expired"],
    );

    // -------------------------------------------------------------------------
    // 5) Reativa a assinatura cujo membro voltou a ficar ativo.
    //
    // So 'expired' volta: 'cancelled' e um acao explicita (o usuario saiu ou
    // passou da carencia de 7 dias) e nao se desfaz sozinho — a reativacao
    // acontece pelo pagamento, que regrava a data de renovacao.
    // -------------------------------------------------------------------------
    const restoredTargets = await supabaseAdmin
      .from("group_members")
      .select("user_id, group_id")
      .eq("payment_status", "active")
      .eq("status", "active");

    if (restoredTargets.error) throw restoredTargets.error;

    const restored = await applyPairUpdates(
      restoredTargets.data || [],
      { ...patchAt, status: "active" },
      ["expired"],
    );

    return new Response(
      JSON.stringify({
        success: true,
        totalUpdated: totalUpdated + synced,
        overdue: lifecycle.overdue,
        cancelled: lifecycle.cancelled,
        cancelledIds: lifecycle.cancelledIds,
        synced,
        restored,
        timestamp: now.toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("update-subscription-statuses error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
