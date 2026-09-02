import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      if (!token) {
        return new Response(JSON.stringify({ error: "Não autenticado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });

      const { data: userRes, error: userErr } = await supabaseUser.auth.getUser(token);
      if (userErr || !userRes?.user) {
        return new Response(JSON.stringify({ error: "Sessão inválida" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: profile } = await supabaseAdmin
        .from("users")
        .select("id, role, name, email")
        .eq("id", userRes.user.id)
        .maybeSingle();

      if (profile?.role !== "admin") {
        return new Response(JSON.stringify({ error: "Apenas administradores podem enviar alertas." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const groupId = body.group_id;
      const title = String(body.title || "").trim();
      const message = String(body.message || "").trim();

      if (!groupId || !title || !message) {
        return new Response(JSON.stringify({ error: "Dados incompletos" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: group, error: groupErr } = await supabaseAdmin
        .from("groups")
        .select("id, name, service_id")
        .eq("id", groupId)
        .maybeSingle();

      if (groupErr || !group) {
        return new Response(JSON.stringify({ error: "Grupo não encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: members, error: membersErr } = await supabaseAdmin
        .from("group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .in("status", ["active", "pending"]);

      if (membersErr) {
        return new Response(JSON.stringify({ error: membersErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const notifications = (members || []).map((member: { user_id: string }) => ({
        user_id: member.user_id,
        title,
        message,
        event_type: "group_alert",
        metadata: JSON.stringify({ group_id: groupId, group_name: group.name, sent_by: profile?.id || userRes.user.id }),
        read: false,
      }));

      if (notifications.length === 0) {
        return new Response(JSON.stringify({ error: "Este grupo não possui membros para notificar." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: insertErr } = await supabaseAdmin.from("notifications").insert(notifications);
      if (insertErr) {
        return new Response(JSON.stringify({ error: insertErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin.from("platform_events").insert({
        event_type: "group_alert",
        title: "Alerta enviado ao grupo",
        message: `${profile?.name || profile?.email || 'Admin'} enviou um alerta para o grupo "${group.name}" (${notifications.length} membro(s)).`,
        metadata: JSON.stringify({ group_id: groupId, group_name: group.name, recipients: notifications.length, title }),
        created_by: profile?.id || userRes.user.id,
      });

      return new Response(JSON.stringify({ success: true, recipients: notifications.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message || "Erro ao enviar alerta" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
