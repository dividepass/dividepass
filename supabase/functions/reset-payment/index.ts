import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const jsonResp = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResp({ error: "Sem Authorization header" }, 401);

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError) return jsonResp({ error: "Auth error: " + authError.message }, 401);
    if (!user) return jsonResp({ error: "User null" }, 401);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResp({ error: "Body não é JSON válido" }, 400);
    }

    const group_id = body?.group_id;
    if (!group_id) return jsonResp({ error: "group_id obrigatório" }, 400);

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: member, error: memberError } = await supabaseAdmin
      .from("group_members")
      .select("payment_status, status")
      .eq("group_id", group_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberError) return jsonResp({ error: "Query error: " + memberError.message }, 500);
    if (!member) return jsonResp({ error: "Membro não encontrado" }, 404);
    if (member.payment_status !== "expired") {
      return jsonResp({ error: "Status atual: " + member.payment_status + " (esperado: expired)" }, 400);
    }

    const { error: resetError } = await supabaseAdmin
      .from("group_members")
      .update({
        payment_status: "first_attempt",
        status: "pending",
        left_at: null,
        entrance_paid_at: null,
        entrance_payment_id: null,
        subscription_deadline: null,
        entrance_refunded: false,
      })
      .eq("group_id", group_id)
      .eq("user_id", user.id);

    if (resetError) return jsonResp({ error: "Update error: " + resetError.message }, 500);

    return jsonResp({ success: true });
  } catch (error) {
    return jsonResp({ error: "Catch: " + (error?.message || String(error)) }, 500);
  }
});
