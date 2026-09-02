import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { group_id } = await req.json();
    if (!group_id) {
      return new Response(JSON.stringify({ error: "group_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch group data
    const { data: group, error: groupError } = await supabaseAdmin
      .from("groups")
      .select("id, name, owner_id")
      .eq("id", group_id)
      .single();

    if (groupError || !group) {
      return new Response(JSON.stringify({ error: "Group not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check permission: admin or owner
    const { data: caller } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (caller?.role !== "admin" && group.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "Permission denied" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. Get all active members
    const { data: members } = await supabaseAdmin
      .from("group_members")
      .select("user_id")
      .eq("group_id", group_id)
      .eq("status", "active");

    const memberIds = (members || []).map(m => m.user_id);

    // 2. Cancel all subscriptions for this group
    const { data: subs } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id")
      .eq("group_id", group_id)
      .in("status", ["active", "pending"]);

    if (subs && subs.length > 0) {
      await supabaseAdmin
        .from("user_subscriptions")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .in("id", subs.map(s => s.id));
    }

    // 3. Delete group credentials
    await supabaseAdmin
      .from("group_credentials")
      .delete()
      .eq("group_id", group_id);

    // 4. Create notifications for all members
    if (memberIds.length > 0) {
      const notifications = memberIds.map(uid => ({
        user_id: uid,
        title: "Grupo encerrado",
        message: `O grupo "${group.name}" foi removido. Sua assinatura foi cancelada automaticamente.`,
        event_type: "group_deleted",
        metadata: JSON.stringify({ group_id, group_name: group.name }),
      }));

      await supabaseAdmin.from("notifications").insert(notifications);
    }

    // 5. Log platform event
    await supabaseAdmin.from("platform_events").insert({
      event_type: "group_deleted",
      title: "Grupo removido",
      message: `O grupo "${group.name}" foi removido por ${caller?.role === "admin" ? "administrador" : "criador"}. ${subs?.length || 0} assinatura(s) cancelada(s). ${memberIds.length} membro(s) notificado(s).`,
      metadata: JSON.stringify({ group_id, group_name: group.name, subscriptions_cancelled: subs?.length || 0, members_notified: memberIds.length }),
      created_by: user.id,
    });

    // 6. Delete the group
    const { error: deleteError } = await supabaseAdmin
      .from("groups")
      .delete()
      .eq("id", group_id);

    if (deleteError) throw deleteError;

    return new Response(JSON.stringify({
      success: true,
      subscriptions_cancelled: subs?.length || 0,
      members_notified: memberIds.length,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
