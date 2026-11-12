import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Trilha de auditoria da impersonação.
 *
 * São DUAS tabelas de propósito:
 *
 * 1) `activity_logs` — tem RLS ligado e ZERO policies: nenhum cliente
 *    (nem autenticado) consegue ler nem forjar registro nela. Como a edge
 *    roda com SERVICE_ROLE_KEY, ela escreve contornando o RLS. É a trilha
 *    confiável.
 *
 * 2) `platform_events` — é a trilha que o painel admin mostra na aba de
 *    eventos, mas o INSERT dela é liberado para QUALQUER autenticado
 *    (`WITH CHECK (true)`), ou seja, ela pode ser falsificada pelo próprio
 *    cliente. Por isso ela sozinha não serve como prova: registramos nas duas.
 *
 * Se a `activity_logs` não existir (ou o enum `action` não aceitar o valor),
 * a falha não pode derrubar a impersonação — a auditoria em `platform_events`
 * ainda acontece e o erro fica no log da função.
 */
async function registrarAuditoria(
  supabaseAdmin: any,
  dados: {
    adminId: string;
    adminEmail: string;
    targetId: string;
    targetName: string;
    targetEmail: string;
  },
) {
  const { adminId, adminEmail, targetId, targetName, targetEmail } = dados;
  const descricao = `Impersonação: o admin ${adminEmail} entrou na conta de ${targetName || targetEmail} (${targetEmail}).`;

  // 1) Trilha confiável (sem policy visível para o client).
  try {
    const { error } = await supabaseAdmin.from("activity_logs").insert({
      user_id: targetId,
      action: "view",
      entity_type: "user",
      entity_id: targetId,
      description: descricao,
    });
    if (error) console.error("admin-impersonate: activity_logs:", error.message);
  } catch (e) {
    console.error("admin-impersonate: activity_logs (exception):", e);
  }

  // 2) Trilha visível no painel admin (pode ser falsificada pelo client).
  try {
    const { error } = await supabaseAdmin.from("platform_events").insert({
      event_type: "admin_impersonation",
      title: "Impersonação de usuário",
      message: descricao,
      // String JSON: funciona tanto se `metadata` for jsonb quanto text.
      metadata: JSON.stringify({
        admin_id: adminId,
        target_id: targetId,
        target_email: targetEmail,
      }),
      created_by: adminId,
    });
    if (error) console.error("admin-impersonate: platform_events:", error.message);
  } catch (e) {
    console.error("admin-impersonate: platform_events (exception):", e);
  }
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      // -------------------------------------------------------------------
      // GUARDA DE ADMIN
      //
      // Sem isto, qualquer pessoa autenticada viraria admin: a função
      // segura o SERVICE_ROLE_KEY e consegue gerar acesso para qualquer
      // conta. O token do chamador é validado no Auth e o papel é conferido
      // nos DOIS lugares onde o projeto guarda o papel de admin
      // (`auth.users.raw_app_meta_data.role` e `public.users.role`) — o
      // mesmo critério duplo usado em `create-custom-charge`.
      // -------------------------------------------------------------------
      const authHeader = req.headers.get("authorization") || "";
      if (!authHeader.startsWith("Bearer ")) {
        return json({ error: "Token não fornecido" }, 401);
      }

      const jwt = authHeader.replace("Bearer ", "").trim();
      const {
        data: { user: caller },
        error: callerError,
      } = await supabaseAdmin.auth.getUser(jwt);

      if (callerError || !caller) {
        return json({ error: "Token inválido" }, 401);
      }

      const { data: adminProfile } = await supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", caller.id)
        .maybeSingle();

      const isAdmin =
        (caller.app_metadata && caller.app_metadata.role === "admin") ||
        (adminProfile && adminProfile.role === "admin");

      if (!isAdmin) {
        return json({ error: "Apenas administradores" }, 403);
      }

      // -------------------------------------------------------------------
      // ALVO DA IMPERSONAÇÃO
      // -------------------------------------------------------------------
      const body = await req.json();
      const targetId = body?.user_id;

      if (!targetId) {
        return json({ error: "user_id é obrigatório" }, 400);
      }

      if (targetId === caller.id) {
        return json({ error: "Não é possível entrar na própria conta pelo suporte." }, 403);
      }

      const { data: targetProfile, error: targetError } = await supabaseAdmin
        .from("users")
        .select("id, name, email, role, status")
        .eq("id", targetId)
        .maybeSingle();

      if (targetError) throw targetError;
      if (!targetProfile) {
        return json({ error: "Usuário não encontrado." }, 404);
      }

      // Impersonar outro admin seria escalada de privilégio: o impersonado
      // continuaria admin dentro da conta alvo. Bloqueado aqui e na edge.
      if (targetProfile.role === "admin") {
        return json(
          { error: "Não é possível entrar na conta de outro administrador." },
          403,
        );
      }

      const { data: targetAuth, error: targetAuthError } =
        await supabaseAdmin.auth.admin.getUserById(targetId);

      if (targetAuthError || !targetAuth?.user) {
        return json(
          { error: "Este usuário não tem login no Supabase Auth (sem e-mail válido)." },
          404,
        );
      }

      const targetEmail = targetAuth.user.email || targetProfile.email;
      if (!targetEmail) {
        return json({ error: "Usuário sem e-mail — não há como gerar o acesso." }, 400);
      }

      // -------------------------------------------------------------------
      // GERAÇÃO DO ACESSO (sem e-mail, sem senha, sem mexer na senha)
      //
      // `generateLink` com type "magiclink" SÓ cria o token — não dispara
      // e-mail para o cliente e não altera a senha dele. O navegador do
      // admin troca a própria sessão com esse token de uso único.
      // -------------------------------------------------------------------
      const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: targetEmail,
      });

      if (linkError) {
        console.error("admin-impersonate: generateLink:", linkError.message);
        return json(
          { error: `Não foi possível gerar o acesso temporário: ${linkError.message}` },
          500,
        );
      }

      const properties = link?.properties;
      const tokenHash = properties?.hashed_token;

      if (!tokenHash) {
        return json({ error: "O Supabase não devolveu o token de acesso." }, 500);
      }

      await registrarAuditoria(supabaseAdmin, {
        adminId: caller.id,
        adminEmail: caller.email || "admin",
        targetId,
        targetName: targetProfile.name || "",
        targetEmail,
      });

      // Devolve só o token de uso único e os dados do alvo. Nunca a senha,
      // nunca o hash da senha, nunca um token do alvo.
      return json({
        success: true,
        token_hash: tokenHash,
        email: targetEmail,
        user_id: targetId,
        target_name: targetProfile.name || "",
        verification_type: properties?.verification_type || "magiclink",
      });
    } catch (error) {
      console.error("admin-impersonate error:", error);
      return json({ error: error.message }, 500);
    }
  },
};
