import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/send-notification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { subscription_id, group_id } = body;

    if (!subscription_id || !group_id) {
      return new Response(JSON.stringify({ error: "subscription_id e group_id são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verify user owns this subscription
    const { data: sub, error: subFetchErr } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id, user_id, group_id, status")
      .eq("id", subscription_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (subFetchErr || !sub) {
      return new Response(JSON.stringify({ error: "Assinatura não encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const now = new Date().toISOString();

    // Buscar subscription para pegar MP preapproval id
    const { data: fullSub } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id, user_id, group_id, status, gateway, mercado_pago_subscription_id")
      .eq("id", subscription_id)
      .eq("user_id", user.id)
      .maybeSingle();

    // Cancelar preapproval no MP (fire-and-forget)
    if (fullSub?.gateway === "mercadopago" && fullSub.mercado_pago_subscription_id) {
      const mpAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") || "";
      if (mpAccessToken) {
        fetch(`https://api.mercadopago.com/preapproval/${fullSub.mercado_pago_subscription_id}`, {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${mpAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "cancelled" }),
        }).then(r => console.log("MP preapproval cancelled:", r.status))
          .catch(e => console.error("Failed to cancel MP preapproval:", e));
      }
    }

    // Update group_members using admin (bypasses RLS)
    const { error: memberError } = await supabaseAdmin
      .from("group_members")
      .update({ status: "cancelled", left_at: now, payment_status: "cancelled" })
      .eq("group_id", group_id)
      .eq("user_id", user.id);

    if (memberError) {
      console.error("[cancel-subscription] group_members update error:", memberError);
    }

    // Update user_subscriptions using admin (bypasses RLS)
    const { error: subError } = await supabaseAdmin
      .from("user_subscriptions")
      .update({ status: "cancelled", billing_status: "cancelled", updated_at: now })
      .eq("id", subscription_id);

    if (subError) {
      console.error("[cancel-subscription] user_subscriptions update error:", subError);
      return new Response(JSON.stringify({ error: "Erro ao cancelar assinatura: " + subError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Cancel pending billing cycles (fire-and-forget)
    supabaseAdmin
      .from("billing_cycles")
      .update({ status: "cancelled" })
      .eq("subscription_id", subscription_id)
      .eq("status", "pending")
      .then(() => {})
      .catch(() => {});

    // Platform events (fire-and-forget)
    const { data: grp } = await supabaseAdmin.from("groups").select("name").eq("id", group_id).maybeSingle();
    const { data: usr } = await supabaseAdmin.from("users").select("name").eq("id", user.id).maybeSingle();
    const userName = usr?.name || user.email;
    const groupName = grp?.name || "Grupo";

    supabaseAdmin.from("platform_events").insert({
      event_type: "subscription_cancelled",
      title: "Assinatura cancelada",
      message: `${userName} cancelou a assinatura do grupo "${groupName}".`,
      metadata: JSON.stringify({ user_id: user.id, group_id, subscription_id }),
      created_by: user.id,
    }).then(() => {}).catch(() => {});

    supabaseAdmin.from("platform_events").insert({
      event_type: "member_left",
      title: "Membro saiu do grupo",
      message: `${userName} saiu do grupo "${groupName}" ao cancelar a assinatura.`,
      metadata: JSON.stringify({ user_id: user.id, group_id, reason: "subscription_cancelled" }),
      created_by: user.id,
    }).then(() => {}).catch(() => {});

    // Notify group owner (fire-and-forget)
    const { data: groupOwner } = await supabaseAdmin.from("groups").select("owner_id").eq("id", group_id).maybeSingle();
    const recipients = [user.id, groupOwner?.owner_id].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i);
    if (recipients.length > 0) {
      await dispatchNotification(supabaseAdmin, {
        title: "Assinatura cancelada",
        message: `${userName} cancelou a assinatura do grupo "${groupName}".`,
        event_type: "subscription_cancelled",
        metadata: { user_id: user.id, group_id, subscription_id },
        audience: { type: "users", user_ids: recipients },
        channels: ["in_app", "push"],
        url: `/dashboard/groups/${group_id}`,
      }).catch((e) => console.error("push notification error (cancel):", e));
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("[cancel-subscription] error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
