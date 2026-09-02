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
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized: " + (authError?.message || "no user") }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();

    if (callerProfile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Apenas administradores podem excluir usuários" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const target_user_id = body.target_user_id;
    if (!target_user_id) {
      return new Response(JSON.stringify({ error: "target_user_id obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (target_user_id === caller.id) {
      return new Response(JSON.stringify({ error: "Você não pode excluir sua própria conta por aqui" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[admin-delete-user] Deleting user ${target_user_id}`);

    await supabaseAdmin.from("group_members").delete().eq("user_id", target_user_id);
    await supabaseAdmin.from("user_subscriptions").delete().eq("user_id", target_user_id);
    await supabaseAdmin.from("payments").delete().eq("user_id", target_user_id);
    await supabaseAdmin.from("invoices").delete().eq("user_id", target_user_id);
    await supabaseAdmin.from("password_resets").delete().eq("user_id", target_user_id);
    await supabaseAdmin.from("notifications").delete().eq("user_id", target_user_id);
    await supabaseAdmin.from("activity_logs").delete().eq("user_id", target_user_id);
    await supabaseAdmin.from("email_logs").delete().eq("user_id", target_user_id);
    await supabaseAdmin.from("payment_attempts").delete().eq("user_id", target_user_id);

    const { data: wallet } = await supabaseAdmin
      .from("user_wallets").select("id").eq("user_id", target_user_id).maybeSingle();
    if (wallet) {
      await supabaseAdmin.from("wallet_transactions").delete().eq("wallet_id", wallet.id);
      await supabaseAdmin.from("user_wallets").delete().eq("user_id", target_user_id);
    }

    await supabaseAdmin.from("users").delete().eq("id", target_user_id);

    const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(target_user_id);
    if (authDelErr) console.error("[admin-delete-user] Auth delete warning:", authDelErr.message);

    console.log(`[admin-delete-user] User ${target_user_id} deleted`);

    return new Response(
      JSON.stringify({ success: true, message: "Usuário excluído com sucesso" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[admin-delete-user] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
