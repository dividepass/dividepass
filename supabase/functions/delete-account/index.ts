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

    const userId = user.id;

    // Check for pending payments (first_attempt, awaiting_subscription, awaiting_entrance)
    const { data: pendingMembers } = await supabaseAdmin
      .from("group_members")
      .select("group_id, payment_status, groups(name)")
      .eq("user_id", userId)
      .in("payment_status", ["first_attempt", "awaiting_entrance", "awaiting_subscription"]);

    if (pendingMembers && pendingMembers.length > 0) {
      const pendingList = pendingMembers.map((m: any) => ({
        group_name: m.groups?.name || m.group_id,
        status: m.payment_status,
      }));

      return new Response(
        JSON.stringify({
          error: "has_pending_payments",
          message: "Você possui pagamentos pendentes. Quite todos antes de excluir sua conta.",
          pending: pendingList,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[delete-account] User ${userId} deleting their account`);

    // 1. Remove from all groups
    await supabaseAdmin.from("group_members").delete().eq("user_id", userId);

    // 2. Delete user subscriptions
    await supabaseAdmin.from("user_subscriptions").delete().eq("user_id", userId);

    // 3. Delete payments
    await supabaseAdmin.from("payments").delete().eq("user_id", userId);

    // 4. Delete invoices
    await supabaseAdmin.from("invoices").delete().eq("user_id", userId);

    // 5. Delete password resets
    await supabaseAdmin.from("password_resets").delete().eq("user_id", userId);

    // 6. Delete notifications
    await supabaseAdmin.from("notifications").delete().eq("user_id", userId);

    // 7. Delete wallet data
    const { data: wallet } = await supabaseAdmin
      .from("user_wallets")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (wallet) {
      await supabaseAdmin.from("wallet_transactions").delete().eq("wallet_id", wallet.id);
      await supabaseAdmin.from("user_wallets").delete().eq("user_id", userId);
    }

    // 8. Delete activity logs
    await supabaseAdmin.from("activity_logs").delete().eq("user_id", userId);

    // 9. Delete email logs
    await supabaseAdmin.from("email_logs").delete().eq("user_id", userId);

    // 10. Delete payment attempts
    await supabaseAdmin.from("payment_attempts").delete().eq("user_id", userId);

    // 11. Delete from users table
    await supabaseAdmin.from("users").delete().eq("id", userId);

    // 12. Delete from Supabase Auth
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error("[delete-account] Auth delete error:", deleteAuthError.message);
    }

    console.log(`[delete-account] User ${userId} deleted successfully`);

    return new Response(
      JSON.stringify({ success: true, message: "Conta excluída com sucesso" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[delete-account] Error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
