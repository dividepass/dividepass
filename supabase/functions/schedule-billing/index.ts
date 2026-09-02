import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

      // Verificar admin
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "No auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const jwt = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabaseAdmin.auth.getUser(jwt);
      if (!user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: profile } = await supabaseAdmin
        .from("users").select("role").eq("id", user.id).maybeSingle();
      if (profile?.role !== "admin") {
        return new Response(JSON.stringify({ error: "Not admin" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const body = await req.json();
      const { action } = body;

      if (action === "search_user") {
        const { email } = body;
        if (!email || email.length < 3) {
          return new Response(JSON.stringify({ error: "email required (min 3 chars)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Buscar em auth.users (fonte verdadeira de emails)
        const { data: authUsers, error: authErr } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });

        if (authErr) {
          console.error("listUsers error:", authErr);
          return new Response(JSON.stringify({ error: "Failed to list users: " + authErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Filtrar por email
        const matched = (authUsers?.users || []).filter(u =>
          u.email && u.email.toLowerCase().includes(email.toLowerCase())
        );

        console.log("Auth users found:", matched.length, "of", authUsers?.users?.length || 0);

        // Enriquecer com dados do profile
        const enriched = await Promise.all(matched.slice(0, 10).map(async (au) => {
          const { data: profile } = await supabaseAdmin
            .from("users")
            .select("name, role")
            .eq("id", au.id)
            .maybeSingle();

          const { count } = await supabaseAdmin
            .from("user_subscriptions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", au.id)
            .eq("status", "active");

          return {
            id: au.id,
            name: profile?.name || au.email?.split("@")[0] || "Sem nome",
            email: au.email,
            role: profile?.role || "user",
            sub_count: count || 0,
          };
        }));

        // Filtrar admins (o admin nao precisa agendar cobranca pra si mesmo)
        const users = enriched.filter(u => u.role !== "admin");

        console.log("Final results:", JSON.stringify(users));

        return Response.json({ users }, { headers: corsHeaders });
      }

      if (action === "list_subscriptions") {
        const userId = body.user_id;
        let query = supabaseAdmin
          .from("user_subscriptions")
          .select("id, user_id, group_id, service_id, amount, billing_cycle, status, billing_status, card_id, card_last4, card_brand, next_charge_at, retry_count, last_charge_at")
          .eq("status", "active");

        if (userId) {
          query = query.eq("user_id", userId);
        }

        const { data, error } = await query.order("created_at", { ascending: false });

        if (error) throw error;

        // Enriquecer com dados de grupo e servico
        const enriched = await Promise.all((data || []).map(async (sub) => {
          const [{ data: group }, { data: service }] = await Promise.all([
            supabaseAdmin.from("groups").select("id, name").eq("id", sub.group_id).maybeSingle(),
            supabaseAdmin.from("streaming_services").select("id, name").eq("id", sub.service_id).maybeSingle(),
          ]);
          return { ...sub, group, service };
        }));

        return Response.json({ subscriptions: enriched }, { headers: corsHeaders });
      }

      if (action === "schedule") {
        const { subscription_id, charge_date, amount, reason } = body;
        if (!subscription_id || !charge_date) {
          return new Response(JSON.stringify({ error: "subscription_id and charge_date required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Buscar dados da assinatura
        const { data: sub, error: subError } = await supabaseAdmin
          .from("user_subscriptions")
          .select("id, user_id, group_id, service_id, amount, billing_cycle, custom_cycle_months, gateway, card_id, card_last4, card_brand")
          .eq("id", subscription_id)
          .single();

        if (subError || !sub) {
          console.error("Schedule billing sub fetch error:", subError);
          return new Response(JSON.stringify({ error: "Subscription not found: " + (subError?.message || "null") }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Buscar dados extras do usuario, grupo e servico separadamente
        const [{ data: userData }, { data: groupData }, { data: serviceData }] = await Promise.all([
          supabaseAdmin.from("users").select("id, name, email").eq("id", sub.user_id).maybeSingle(),
          supabaseAdmin.from("groups").select("id, name, owner_id").eq("id", sub.group_id).maybeSingle(),
          supabaseAdmin.from("streaming_services").select("id, name").eq("id", sub.service_id).maybeSingle(),
        ]);

        sub.user = userData;
        sub.group = groupData;
        sub.service = serviceData;

        const chargeAmount = amount || sub.amount;
        const description = reason || `Cobrança manual - ${sub.service?.name || "Assinatura"}`;

        // Criar billing_cycle agendada
        const { data: billingCycle, error: bcError } = await supabaseAdmin
          .from("billing_cycles")
          .insert({
            subscription_id: sub.id,
            user_id: sub.user_id,
            group_id: sub.group_id,
            amount: chargeAmount,
            charge_date: charge_date,
            status: "pending",
            gateway: sub.gateway || "iopay",
            attempt_number: 1,
          })
          .select()
          .single();

        if (bcError) throw bcError;

        // Atualizar next_charge_at da assinatura
        await supabaseAdmin
          .from("user_subscriptions")
          .update({ next_charge_at: new Date(charge_date + "T14:00:00Z").toISOString() })
          .eq("id", sub.id);

        // Log
        await supabaseAdmin.from("billing_logs").insert({
          subscription_id: sub.id,
          user_id: sub.user_id,
          group_id: sub.group_id,
          action: "manual_schedule",
          details: {
            billing_cycle_id: billingCycle.id,
            charge_date,
            amount: chargeAmount,
            reason: description,
            scheduled_by: user.id,
          },
        });

        return Response.json({
          success: true,
          billing_cycle_id: billingCycle.id,
          subscription_id: sub.id,
          user_name: sub.user?.name,
          group_name: sub.group?.name,
          service_name: sub.service?.name,
          amount: chargeAmount,
          charge_date,
        }, { headers: corsHeaders });
      }

      if (action === "charge_now") {
        const { billing_cycle_id } = body;
        if (!billing_cycle_id) {
          return new Response(JSON.stringify({ error: "billing_cycle_id required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Buscar billing cycle
        const { data: bc, error: bcError } = await supabaseAdmin
          .from("billing_cycles")
          .select("id, subscription_id, user_id, group_id, amount, gateway")
          .eq("id", billing_cycle_id)
          .single();

        if (bcError || !bc) {
          return new Response(JSON.stringify({ error: "Billing cycle not found" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Chamar process-recurring-billing com a subscription especifica
        const functionUrl = `${supabaseUrl}/functions/v1/process-recurring-billing`;
        const resp = await fetch(functionUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            manual: true,
            subscription_id: bc.subscription_id,
            billing_cycle_id: bc.id,
          }),
        });

        const data = await resp.text();
        console.log(`Manual charge ${billing_cycle_id} [${resp.status}]:`, data.substring(0, 500));

        // Log
        await supabaseAdmin.from("billing_logs").insert({
          subscription_id: bc.subscription_id,
          user_id: bc.user_id,
          group_id: bc.group_id,
          action: "manual_charge",
          details: {
            billing_cycle_id: bc.id,
            triggered_by: user.id,
            gateway_response_status: resp.status,
          },
        });

        return Response.json({
          success: resp.ok,
          status: resp.status,
          response: data.substring(0, 2000),
        }, { headers: corsHeaders });
      }

      if (action === "cancel_schedule") {
        const { billing_cycle_id } = body;
        if (!billing_cycle_id) {
          return new Response(JSON.stringify({ error: "billing_cycle_id required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        await supabaseAdmin
          .from("billing_cycles")
          .update({ status: "cancelled" })
          .eq("id", billing_cycle_id);

        await supabaseAdmin.from("billing_logs").insert({
          action: "manual_cancel",
          details: { billing_cycle_id, cancelled_by: user.id },
        });

        return Response.json({ success: true }, { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (error: any) {
      console.error("schedule-billing error:", error);
      return Response.json(
        { error: error.message },
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
