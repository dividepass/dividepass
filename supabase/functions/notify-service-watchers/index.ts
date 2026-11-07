import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/send-notification.ts";

/**
 * Avisa quem está na lista de espera de um serviço que uma vaga abriu.
 *
 * A lista de espera é a tabela `group_interest` (a mesma que o admin vê em
 * "Lista de espera"). Quando um grupo novo é aprovado para o serviço X, todos
 * que salvaram "Avise-me quando houver uma vaga" no X recebem a notificação.
 *
 * Quem pode chamar: admin (aprovação de grupo) ou o dono do grupo.
 */

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

      const body = await req.json().catch(() => ({}));
      const serviceId = String(body.service_id || "").trim();
      const groupId = String(body.group_id || "").trim();

      if (!serviceId && !groupId) {
        return new Response(JSON.stringify({ error: "Informe service_id ou group_id." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      /* Descobre o serviço e o grupo a partir do que foi informado. */
      let resolvedServiceId = serviceId;
      let group = null;
      let service = null;

      if (groupId) {
        const { data: groupData } = await supabaseAdmin
          .from("groups")
          .select("id, name, service_id, owner_id, status")
          .eq("id", groupId)
          .maybeSingle();

        if (!groupData) {
          return new Response(JSON.stringify({ error: "Grupo não encontrado." }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        group = groupData;
        resolvedServiceId = groupData.service_id;

        const isOwner = groupData.owner_id === userRes.user.id;
        if (profile?.role !== "admin" && !isOwner) {
          return new Response(
            JSON.stringify({ error: "Apenas o dono do grupo ou um admin pode avisar a lista de espera." }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      const { data: serviceData } = await supabaseAdmin
        .from("streaming_services")
        .select("id, name, slug")
        .eq("id", resolvedServiceId)
        .maybeSingle();

      if (!serviceData) {
        return new Response(JSON.stringify({ error: "Serviço não encontrado." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      service = serviceData;

      /* Quem está esperando vaga nesse serviço. */
      const { data: watchers, error: watchersErr } = await supabaseAdmin
        .from("group_interest")
        .select("user_id")
        .eq("service_id", resolvedServiceId);

      if (watchersErr) {
        return new Response(JSON.stringify({ error: watchersErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const candidates = Array.from(new Set((watchers || []).map((row: any) => row.user_id)));

      /* Quem já tem o serviço não precisa do aviso. */
      let recipients = candidates;
      if (candidates.length > 0) {
        const { data: subscriptions } = await supabaseAdmin
          .from("user_subscriptions")
          .select("user_id")
          .eq("service_id", resolvedServiceId)
          .in("status", ["active", "pending"]);

        const alreadySubscribed = new Set(
          (subscriptions || []).map((row: any) => row.user_id)
        );
        recipients = candidates.filter((id: string) => !alreadySubscribed.has(id));
      }

      if (recipients.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            recipients: 0,
            message: "Ninguém está na lista de espera deste serviço.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const title = group
        ? `Vaga aberta: ${service.name}`
        : `Novidade: ${service.name}`;
      const message = group
        ? `O grupo "${group.name}" abriu uma vaga para ${service.name}. Corra para garantir seu lugar.`
        : `Já existe um grupo disponível para ${service.name}. Entre agora antes que lote.`;

      const result = await dispatchNotification(supabaseAdmin, {
        title,
        message,
        event_type: "group_opened",
        metadata: {
          service_id: resolvedServiceId,
          service_name: service.name,
          group_id: group?.id || null,
          group_name: group?.name || null,
        },
        audience: { type: "users", user_ids: recipients },
        channels: ["in_app", "push"],
        url: `/dashboard/catalog/${service.slug || service.id}`,
        created_by: profile?.id || userRes.user.id,
      });

      return new Response(JSON.stringify({ success: true, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error: any) {
      return new Response(
        JSON.stringify({ error: error.message || "Erro ao avisar a lista de espera" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  },
};
