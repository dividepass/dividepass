import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendUserEmail, loadEmailSettings } from "../_shared/user-emails.ts";
import { welcomeTemplate, appUrl } from "../_shared/email-templates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * E-MAIL DE BOAS-VINDAS
 *
 * Chamado pelo front logo depois do cadastro (fire and forget: a tela de
 * "Conta criada!" não espera o e-mail sair).
 *
 * Por que uma função só para isso, e não um INSERT direto na `users`?
 *  - O envio de e-mail é uma conexão TLS; fazer isso no front travaria a tela.
 *  - A trava de duplicidade (`email_logs.dedup_key`) fica num lugar só.
 *  - O job diário (`send-lifecycle-emails`) usa o MESMO template e a MESMA
 *    trava, então quem falhou aqui é recuperado lá — sem duplicar.
 *
 * AUTORIZAÇÃO
 *  - service_role: allowed (sistema / job).
 *  - JWT de usuário: allowed, e o e-mail SEMPRE vai para o próprio usuário
 *    logado. O `user_id` do corpo é ignorado nesse caso — é o que impede
 *    alguém de usar a função para encher a caixa de outra pessoa.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || "";
    const authHeader = (req.headers.get("Authorization") || "")
      .replace(/^Bearer\s+/i, "")
      .trim();

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}) as any);

    let targetUserId = String(body?.user_id || "").trim();

    const isServiceRole =
      serviceRoleKey !== "" && authHeader === serviceRoleKey;

    if (!isServiceRole) {
      // ── Usuário logado: só pode receber o e-mail dele mesmo ─────────────
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Não autenticado" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data: userRes, error: userErr } =
        await supabaseAdmin.auth.getUser(authHeader);

      if (userErr || !userRes?.user) {
        return new Response(
          JSON.stringify({ error: "Sessão inválida" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      targetUserId = userRes.user.id;
    }

    if (!targetUserId) {
      return new Response(
        JSON.stringify({ error: "user_id é obrigatório" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const settings = await loadEmailSettings(supabaseAdmin);
    if (!settings.welcome) {
      return new Response(
        JSON.stringify({
          success: true,
          sent: false,
          reason: "desativado nas configurações",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Dados do usuário ───────────────────────────────────────────────────
    let user: any = null;
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("id, name, email")
      .eq("id", targetUserId)
      .maybeSingle();
    user = profile;

    if (!user?.email) {
      // Perfil ainda não sincronizado (o cadastro é assíncrono): tenta o
      // auth.users, que é a fonte da verdade do e-mail.
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(
        targetUserId,
      );
      const email = authUser?.user?.email;
      if (!email) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Usuário sem e-mail cadastrado",
          }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      user = {
        id: targetUserId,
        name:
          authUser?.user?.user_metadata?.name ||
          String(email).split("@")[0],
        email,
      };
    }

    const url = appUrl({
      SITE_URL: Deno.env.get("SITE_URL"),
      APP_URL: Deno.env.get("APP_URL"),
    });

    const content = welcomeTemplate({
      name: user.name || "cliente",
      url,
    });

    const result = await sendUserEmail(supabaseAdmin, {
      eventType: "welcome",
      dedupKey: `welcome:${user.id}`,
      userId: user.id,
      to: user.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      meta: {
        user_name: user.name || null,
        user_email: user.email,
        source: "signup",
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        sent: result.sent,
        reason: result.reason,
        error: result.error || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("send-welcome-email error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Erro ao enviar" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
