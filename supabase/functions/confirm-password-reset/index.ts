import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const { token, newPassword } = await req.json();

      if (!token || !newPassword) {
        return new Response(JSON.stringify({ error: "Token e nova senha são obrigatórios" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (newPassword.length < 6) {
        return new Response(JSON.stringify({ error: "A senha deve ter pelo menos 6 caracteres" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: resetRecord, error: fetchError } = await supabaseAdmin
        .from("password_resets")
        .select("id, user_id, email, expires_at, used")
        .eq("token", token)
        .eq("used", false)
        .maybeSingle();

      if (fetchError || !resetRecord) {
        return new Response(JSON.stringify({ error: "Token inválido ou já utilizado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (new Date(resetRecord.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: "Token expirado. Solicite uma nova recuperação de senha." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        resetRecord.user_id,
        { password: newPassword },
      );

      if (updateError) {
        console.error("Failed to update password:", updateError);
        return new Response(JSON.stringify({ error: "Erro ao atualizar senha" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin
        .from("password_resets")
        .update({ used: true })
        .eq("id", resetRecord.id);

      console.log(`Password reset successfully for ${resetRecord.email}`);

      return Response.json(
        { success: true, message: "Senha redefinida com sucesso!" },
        { headers: corsHeaders },
      );
    } catch (error) {
      console.error("confirm-password-reset error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
