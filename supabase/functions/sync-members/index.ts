import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { group_id } = body;

    console.log(`[sync-members] Starting sync${group_id ? ` for group ${group_id}` : " (all groups)"}...`);

    // Fetch active subscriptions
    let subQuery = supabase
      .from("user_subscriptions")
      .select("id, user_id, group_id, status")
      .eq("status", "active");

    if (group_id) {
      subQuery = subQuery.eq("group_id", group_id);
    }

    const { data: activeSubs, error: subErr } = await subQuery;
    if (subErr) {
      console.error("[sync-members] Subscription query error:", subErr);
      return Response.json({ error: subErr.message }, { status: 500, headers: corsHeaders });
    }

    console.log(`[sync-members] Found ${activeSubs?.length || 0} active subscriptions`);

    let synced = 0;
    let alreadyOk = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (const sub of activeSubs || []) {
      // Check existing group_member
      const { data: existing } = await supabase
        .from("group_members")
        .select("id, status, payment_status")
        .eq("group_id", sub.group_id)
        .eq("user_id", sub.user_id)
        .maybeSingle();

      if (existing && existing.status === "active" && existing.payment_status === "active") {
        alreadyOk++;
        continue;
      }

      // Upsert group_member to active
      const { error: upsertErr } = await supabase
        .from("group_members")
        .upsert({
          group_id: sub.group_id,
          user_id: sub.user_id,
          status: "active",
          payment_status: "active",
          joined_at: existing?.joined_at || new Date().toISOString(),
        }, { onConflict: "group_id, user_id" });

      if (upsertErr) {
        errors++;
        errorDetails.push(`${sub.user_id}@${sub.group_id}: ${upsertErr.message}`);
        console.error(`[sync-members] Upsert error for ${sub.user_id}@${sub.group_id}:`, upsertErr);
      } else {
        synced++;
        console.log(`[sync-members] Synced ${sub.user_id} → group ${sub.group_id}`);
      }
    }

    // Also sync group_members that have active subscriptions but missing user_subscriptions
    // (edge case: group_member was set active but sub wasn't created)
    let gmQuery = supabase
      .from("group_members")
      .select("id, user_id, group_id, status, payment_status")
      .eq("status", "active")
      .eq("payment_status", "active");

    if (group_id) {
      gmQuery = gmQuery.eq("group_id", group_id);
    }

    const { data: activeMembers } = await gmQuery;
    let orphanMembers = 0;
    for (const member of activeMembers || []) {
      const { data: subExists } = await supabase
        .from("user_subscriptions")
        .select("id")
        .eq("user_id", member.user_id)
        .eq("group_id", member.group_id)
        .eq("status", "active")
        .maybeSingle();

      if (!subExists) {
        orphanMembers++;
      }
    }

    const result = {
      success: true,
      total_subscriptions: activeSubs?.length || 0,
      synced,
      already_ok: alreadyOk,
      orphan_members: orphanMembers,
      errors,
      error_details: errorDetails.length > 0 ? errorDetails : undefined,
    };

    console.log("[sync-members] Result:", JSON.stringify(result));
    return Response.json(result, { headers: corsHeaders });

  } catch (e: any) {
    console.error("[sync-members] Fatal error:", e);
    return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
  }
});
