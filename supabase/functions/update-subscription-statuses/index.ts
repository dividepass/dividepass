import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    let totalUpdated = 0;

    // 1. first_attempt → overdue: 7 days passed with no successful payment
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

    // 2. awaiting_subscription → overdue: deadline passed
    const { count: c2 } = await supabaseAdmin
      .from("group_members")
      .update({ payment_status: "overdue", updated_at: now.toISOString() })
      .eq("payment_status", "awaiting_subscription")
      .not("subscription_deadline", "is", null)
      .lt("subscription_deadline", now.toISOString());
    totalUpdated += c2 || 0;

    // 3. active → overdue: subscription expired
    const { count: c3 } = await supabaseAdmin
      .from("group_members")
      .update({ payment_status: "overdue", updated_at: now.toISOString() })
      .eq("payment_status", "active")
      .not("subscription_deadline", "is", null)
      .lt("subscription_deadline", now.toISOString());
    totalUpdated += c3 || 0;

    // 4. overdue → cancelled: more than 3 months overdue
    const { count: c4 } = await supabaseAdmin
      .from("group_members")
      .update({
        payment_status: "cancelled",
        status: "cancelled",
        left_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("payment_status", "overdue")
      .lt("updated_at", threeMonthsAgo.toISOString());
    totalUpdated += c4 || 0;

    // 5. Sync user_subscriptions status
    //
    // `exec_sql` nao existe em producao (404) e o `rpc()` do supabase-js v2
    // devolve um builder que tem `.then()` mas NAO tem `.catch()` — usar
    // `.catch()` aqui quebrava a function inteira com
    // "supabaseAdmin.rpc(...).catch is not a function". O try/catch abaixo
    // deixa a RPC falhar silenciosamente e o fallback direto faz o trabalho.
    try {
      await supabaseAdmin.rpc("exec_sql", {
        query: `
        UPDATE user_subscriptions us
        SET status = CASE
          WHEN gm.payment_status = 'active' THEN 'active'::subscription_status
          WHEN gm.payment_status = 'overdue' THEN 'expired'::subscription_status
          WHEN gm.payment_status = 'cancelled' THEN 'cancelled'::subscription_status
          ELSE us.status
        END,
        updated_at = NOW()
        FROM group_members gm
        WHERE us.user_id = gm.user_id
          AND us.group_id = gm.group_id
          AND gm.payment_status IN ('overdue', 'cancelled', 'active')
          AND us.status != CASE
            WHEN gm.payment_status = 'active' THEN 'active'::subscription_status
            WHEN gm.payment_status = 'overdue' THEN 'expired'::subscription_status
            WHEN gm.payment_status = 'cancelled' THEN 'cancelled'::subscription_status
            ELSE us.status
          END
      `
      });
    } catch {
      // rpc might not exist, fallback to direct queries
    }

    // Fallback: direct update for user_subscriptions
    const { count: c5a } = await supabaseAdmin
      .from("user_subscriptions")
      .update({ status: "expired", updated_at: now.toISOString() })
      .eq("status", "active")
      .in("group_id",
        (await supabaseAdmin.from("group_members").select("group_id").eq("payment_status", "overdue")).data?.map((m: any) => m.group_id) || []
      );
    const { count: c5b } = await supabaseAdmin
      .from("user_subscriptions")
      .update({ status: "cancelled", updated_at: now.toISOString() })
      .eq("status", "active")
      .in("group_id",
        (await supabaseAdmin.from("group_members").select("group_id").eq("payment_status", "cancelled")).data?.map((m: any) => m.group_id) || []
      );

    return new Response(
      JSON.stringify({
        success: true,
        totalUpdated: totalUpdated + (c5a || 0) + (c5b || 0),
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
