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
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const authHeader = req.headers.get("authorization") || "";
      const apiKey = req.headers.get("apikey") || "";

      if (!authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Token não fornecido" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const jwt = authHeader.replace("Bearer ", "");
      const { data: { user: caller }, error: callerError } = await supabaseAdmin.auth.getUser(jwt);

      if (callerError || !caller) {
        return new Response(
          JSON.stringify({ error: "Token inválido" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const isAdmin = caller.app_metadata?.role === "admin";
      if (!isAdmin) {
        return new Response(
          JSON.stringify({ error: "Apenas administradores" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const body = await req.json();
      const { user_id, name, email, phone, cpf, role, status, password } = body;

      if (!user_id) {
        return new Response(
          JSON.stringify({ error: "user_id é obrigatório" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Atualiza dados em public.users
      const publicUpdate: Record<string, unknown> = {};
      if (name !== undefined) publicUpdate.name = name;
      if (email !== undefined) publicUpdate.email = email;
      if (phone !== undefined) publicUpdate.phone = phone;
      if (cpf !== undefined) publicUpdate.cpf = cpf;
      if (role !== undefined) publicUpdate.role = role;
      if (status !== undefined) publicUpdate.status = status;
      publicUpdate.updated_at = new Date().toISOString();

      const { error: publicError } = await supabaseAdmin
        .from("users")
        .update(publicUpdate)
        .eq("id", user_id);

      if (publicError) {
        throw publicError;
      }

      // Atualiza dados no Auth
      const authUpdate: Record<string, unknown> = {};
      if (email !== undefined) authUpdate.email = email;
      if (phone !== undefined) authUpdate.phone = phone;
      if (password !== undefined) authUpdate.password = password;
      if (name !== undefined) {
        authUpdate.user_metadata = { name };
      }

      if (Object.keys(authUpdate).length > 0) {
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
          user_id,
          authUpdate
        );

        if (authError) {
          throw authError;
        }
      }

      return Response.json(
        { success: true, message: "Usuário atualizado" },
        { headers: corsHeaders }
      );
    } catch (error) {
      console.error("admin-update-user error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
