import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * PROVISIONA O E-MAIL GERENCIADO DO GRUPO
 *
 * O dono liga a opção "Deixar a DividePass gerenciar o e-mail do grupo com IA"
 * na criação do grupo. Esta function:
 *
 *   1. cria uma caixa de e-mail EXCLUSIVA do grupo no servidor (cPanel/UAPI);
 *   2. grava a caixa em `group_mailboxes` (servidor IMAP, usuario e senha);
 *   3. liga `groups.email_code_enabled` — é o que o botão "Buscar Código" do
 *      membro lê para decidir se a busca por código existe naquele grupo.
 *
 * A busca em si é feita pela function `fetch-email-code` (que já existe): ela
 * entra no IMAP da caixa do grupo, acha o e-mail mais recente e extrai o
 * código — por regex e, se falhar, pela IA (Groq).
 *
 * QUEM PODE CHAMAR
 *   O dono do grupo ou um admin da plataforma. O token da sessao e validado
 *   contra o grupo informado — nunca contra o que o corpo do pedido manda.
 *
 * CONFIGURACAO (app_settings)
 *   cpanel_host          host do cPanel        (padrao: cpanel.dividepass.com)
 *   cpanel_user          usuario do cPanel     (padrao: dividepass)
 *   cpanel_domain        dominio das caixas    (padrao: dividepass.com)
 *   cpanel_skip_update_db  '1'|'0'             (padrao: 1 — ver nota abaixo)
 *   group_email_prefix   prefixo da caixa      (padrao: grupo)
 *   imap_server          host IMAP             (padrao: mail.<dominio>)
 *   imap_port            porta IMAP            (padrao: 993)
 *
 * SEGREDOS (secret do Supabase)
 *   CPANEL_TOKEN         token de API do cPanel (Authorization: cpanel user:TOKEN)
 *
 * NOTA DO skip_update_db
 *   O cPanel espera `skip_update_db=1` quando o dominio aponta para um servidor
 *   de e-mail gerenciado fora do cPanel. Se a criacao falhar por causa do
 *   banco de e-mail, a function refaz a chamada com `skip_update_db=0`.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const DEFAULT_CONFIG = {
  cpanel_host: "cpanel.dividepass.com",
  cpanel_user: "dividepass",
  cpanel_domain: "dividepass.com",
  cpanel_skip_update_db: "1",
  group_email_prefix: "grupo",
  imap_server: "",
  imap_port: "993",
};

/* ------------------------------------------------------------------ utils */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Senha forte para a caixa do grupo (cPanel exige mistura de caracteres). */
function gerarSenha(tamanho = 20): string {
  const minusculas = "abcdefghijkmnopqrstuvwxyz";
  const maiusculas = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const numeros = "23456789";
  const simbolos = "!@#%_-";
  const todos = minusculas + maiusculas + numeros + simbolos;

  const bytes = new Uint8Array(tamanho);
  crypto.getRandomValues(bytes);

  const caracteres = Array.from(bytes, (b) => todos[b % todos.length]);
  // Garante pelo menos um de cada classe — cPanel recusa senha "fraca".
  const obrigatorios = [minusculas, maiusculas, numeros, simbolos];
  obrigatorios.forEach((conjunto, i) => {
    const b = new Uint8Array(1);
    crypto.getRandomValues(b);
    caracteres[i] = conjunto[b[0] % conjunto.length];
  });

  // Embaralha (a troca acima deixaria as classes sempre nas mesmas posicoes).
  for (let i = caracteres.length - 1; i > 0; i -= 1) {
    const b = new Uint8Array(2);
    crypto.getRandomValues(b);
    const j = b[0] % (i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join("");
}

/** Parte local do e-mail: letras, numeros e hifen. */
function sanitizarParteLocal(valor: string): string {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

function ehConflitoDeEmail(mensagem: string): boolean {
  const m = (mensagem || "").toLowerCase();
  return (
    m.includes("already exists") ||
    m.includes("already in use") ||
    m.includes("duplicate") ||
    m.includes("já existe")
  );
}

/* ------------------------------------------------------- cliente do cPanel */

/**
 * Chama a UAPI do cPanel.
 * `cpanelCall("Email", "add_pop", { email, password, ... })`
 */
async function cpanelCall(
  config: { host: string; user: string; token: string },
  module: string,
  fn: string,
  params: Record<string, string>,
): Promise<{ ok: boolean; status: number; errors: string[]; messages: string[]; data: any }> {
  const base = `https://${config.host}:2083/json-api/${config.user}`;
  const url = `${base}/${module}/${fn}`;
  const body = new URLSearchParams(params).toString();

  const resposta = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `cpanel ${config.user}:${config.token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const texto = await resposta.text();
  let bruto: any = null;
  try {
    bruto = JSON.parse(texto);
  } catch {
    bruto = null;
  }

  // O JSON-API embrulha a resposta da UAPI em "result".
  const result = bruto?.result ?? bruto?.data ?? bruto ?? {};
  const erros = result?.errors ?? bruto?.errors ?? [];
  const mensagens = result?.messages ?? bruto?.messages ?? [];
  const status = typeof result?.status === "number" ? result.status : (resposta.ok ? 1 : 0);

  return {
    ok: resposta.ok && status === 1,
    status,
    errors: Array.isArray(erros) ? erros : [String(erros)],
    messages: Array.isArray(mensagens) ? mensagens : [],
    data: result?.data ?? bruto?.data ?? null,
  };
}

/* ------------------------------------------------------------------ main */

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const cpanelToken = Deno.env.get("CPANEL_TOKEN") ?? "";

      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      if (!token) return json({ error: "Não autenticado" }, 401);

      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });

      const { data: userRes, error: userErr } = await supabaseUser.auth.getUser(token);
      if (userErr || !userRes?.user) {
        return json({ error: "Sessão inválida" }, 401);
      }
      const callerId = userRes.user.id;

      const { data: profile } = await supabaseAdmin
        .from("users")
        .select("id, role, name")
        .eq("id", callerId)
        .maybeSingle();

      const body = await req.json().catch(() => ({}));
      const groupId = String(body.group_id || "").trim();
      const action = String(body.action || "provision").trim();

      if (!groupId) {
        return json({ error: "Informe group_id." }, 400);
      }

      const { data: group } = await supabaseAdmin
        .from("groups")
        .select("id, name, slug, service_id, owner_id, status")
        .eq("id", groupId)
        .maybeSingle();

      if (!group) return json({ error: "Grupo não encontrado." }, 404);

      const isOwner = group.owner_id === callerId;
      const isAdmin = profile?.role === "admin";
      if (!isOwner && !isAdmin) {
        return json({ error: "Apenas o dono do grupo pode gerenciar o e-mail." }, 403);
      }

      /* ------------------------------------------------- configuracao */
      const { data: settings } = await supabaseAdmin
        .from("app_settings")
        .select("key, value")
        .in("key", Object.keys(DEFAULT_CONFIG));

      const cfg: Record<string, string> = { ...DEFAULT_CONFIG };
      (settings || []).forEach((s: { key: string; value: string }) => {
        if (s.value !== null && s.value !== undefined && String(s.value).trim() !== "") {
          cfg[s.key] = String(s.value).trim();
        }
      });

      const imapServer = cfg.imap_server || `mail.${cfg.cpanel_domain}`;
      const imapPort = parseInt(cfg.imap_port || "993", 10) || 993;

      /* ------------------------------- a caixa deste grupo ja existe? */
      const { data: mailboxAtual } = await supabaseAdmin
        .from("group_mailboxes")
        .select("group_id, email_address, managed_email, email_ai_enabled, provisioned_at")
        .eq("group_id", groupId)
        .maybeSingle();

      const actionPedida = ["status", "register"].includes(action) ? action : "provision";

      if (actionPedida === "status") {
        return json({
          success: true,
          provisioned: !!mailboxAtual?.managed_email && !!mailboxAtual?.email_address,
          email: mailboxAtual?.email_address || null,
          ai_enabled: !!mailboxAtual?.email_ai_enabled,
        });
      }

      /* -----------------------------------------------------------------
         REGISTER: o dono ja criou a caixa no painel do cPanel e quer so
         apontar o grupo para ela (e-mail + senha). Usado enquanto a
         criacao automatica nao esta configurada na plataforma.
         ----------------------------------------------------------------- */
      if (actionPedida === "register") {
        const email = String(body.email || "").trim().toLowerCase();
        const senha = String(body.password || "");

        if (!email || !email.includes("@")) {
          return json({ error: "Informe um e-mail válido para a caixa do grupo." }, 400);
        }
        if (!senha) {
          return json({ error: "Informe a senha da caixa do grupo." }, 400);
        }

        const servidor = String(body.imap_server || "").trim() || imapServer;
        const porta = parseInt(String(body.imap_port || "").trim() || String(imapPort), 10) || 993;

        const { error: gravErr } = await supabaseAdmin.from("group_mailboxes").upsert(
          {
            group_id: groupId,
            email_address: email,
            verification_email: email,
            email_imap_server: servidor,
            email_imap_port: porta,
            email_imap_user: email,
            email_imap_password: senha,
            email_allowed_senders: [],
            email_blocked_subjects: [],
            email_code_patterns: [],
            email_body_keywords: [],
            email_subject_includes: [],
            email_ai_enabled: true,
            managed_email: true,
            managed_by: "dono",
            provisioned_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "group_id" },
        );

        if (gravErr) {
          console.error(`[provision-group-mailbox] Erro ao registrar a caixa: ${gravErr.message}`);
          return json({ error: "Não foi possível registrar a caixa do grupo." }, 500);
        }

        await supabaseAdmin
          .from("groups")
          .update({ email_code_enabled: true, email_code_method: "imap", managed_email: true })
          .eq("id", groupId);

        return json({
          success: true,
          created: false,
          manual: true,
          email,
          ai_enabled: true,
          message: "Caixa do grupo registrada.",
        });
      }

      if (mailboxAtual?.managed_email && mailboxAtual?.email_address) {
        // Ja provisionada: nao cria outra caixa (a conta no cPanel e unica).
        await supabaseAdmin
          .from("groups")
          .update({ email_code_enabled: true, email_code_method: "imap", managed_email: true })
          .eq("id", groupId);

        return json({
          success: true,
          created: false,
          email: mailboxAtual.email_address,
          ai_enabled: true,
          message: "Este grupo já tem um e-mail gerenciado.",
        });
      }

      if (!cpanelToken) {
        return json(
          { error: "A criação automática de e-mail ainda não está configurada na plataforma." },
          503,
        );
      }

      /* ------------------------------------------- cria a caixa no cPanel */
      const prefixo = sanitizarParteLocal(cfg.group_email_prefix || "grupo");
      const baseSlug = sanitizarParteLocal(
        String(group.slug || group.id.slice(0, 6) || ""),
      ) || group.id.slice(0, 6).toLowerCase();

      let emailCriado = "";
      let senhaCriada = "";
      let ultimaErro = "";

      for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
        const sufixo = tentativa === 1 ? "" : `-${tentativa}`;
        const parteLocal = sanitizarParteLocal(`${prefixo}-${baseSlug}${sufixo}`);
        const email = `${parteLocal}@${cfg.cpanel_domain}`;
        const senha = gerarSenha();

        const params: Record<string, string> = {
          email,
          password: senha,
          quota: "0",
          domain: cfg.cpanel_domain,
          skip_update_db: cfg.cpanel_skip_update_db || "1",
        };

        const resposta = await cpanelCall(
          { host: cfg.cpanel_host, user: cfg.cpanel_user, token: cpanelToken },
          "Email",
          "add_pop",
          params,
        );

        if (resposta.ok) {
          emailCriado = email;
          senhaCriada = senha;
          break;
        }

        const erros = resposta.errors.join(" | ");
        ultimaErro = erros || `HTTP sem retorno (status ${resposta.status})`;

        // Conflito de nome: tenta o proximo sufixo.
        if (ehConflitoDeEmail(erros)) {
          continue;
        }

        // Falha por causa do banco de e-mail do servidor: refaz sem pular o
        // update do banco (necessario quando o dominio e local no cPanel).
        if (params.skip_update_db === "1" && !ehConflitoDeEmail(erros)) {
          const semSkip = await cpanelCall(
            { host: cfg.cpanel_host, user: cfg.cpanel_user, token: cpanelToken },
            "Email",
            "add_pop",
            { ...params, skip_update_db: "0" },
          );
          if (semSkip.ok) {
            emailCriado = email;
            senhaCriada = senha;
            break;
          }
          ultimaErro = semSkip.errors.join(" | ") || ultimaErro;
        }

        break;
      }

      if (!emailCriado) {
        console.error(`[provision-group-mailbox] Falha ao criar a caixa: ${ultimaErro}`);
        return json(
          {
            error: "Não foi possível criar o e-mail do grupo agora.",
            detail: ultimaErro,
          },
          502,
        );
      }

      /* ------------------------------ grava a caixa e liga a busca de código */
      const linha = {
        group_id: groupId,
        email_address: emailCriado,
        verification_email: emailCriado,
        email_imap_server: imapServer,
        email_imap_port: imapPort,
        email_imap_user: emailCriado,
        email_imap_password: senhaCriada,
        email_allowed_senders: [] as string[],
        email_blocked_subjects: [] as string[],
        email_code_patterns: [] as string[],
        email_body_keywords: [] as string[],
        email_subject_includes: [] as string[],
        // IA ligada: e o extrator que roda quando o regex nao acha o codigo.
        email_ai_enabled: true,
        managed_email: true,
        managed_by: "dividepass",
        provisioned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await supabaseAdmin
        .from("group_mailboxes")
        .upsert(linha, { onConflict: "group_id" });

      if (upsertErr) {
        console.error(`[provision-group-mailbox] Erro ao gravar a caixa: ${upsertErr.message}`);
        return json({ error: "A caixa foi criada, mas não foi registrada no grupo." }, 500);
      }

      const { error: grupoErr } = await supabaseAdmin
        .from("groups")
        .update({ email_code_enabled: true, email_code_method: "imap", managed_email: true })
        .eq("id", groupId);

      if (grupoErr) {
        // A coluna `managed_email` pode ainda nao existir (migration pendente):
        // refaz sem ela para nao perder a ligacao da busca de codigo.
        console.warn(`[provision-group-mailbox] Aviso ao ligar o grupo: ${grupoErr.message}`);
        await supabaseAdmin
          .from("groups")
          .update({ email_code_enabled: true, email_code_method: "imap" })
          .eq("id", groupId);
      }

      // Registro para a trilha do admin (falha aqui nao derruba a criacao).
      try {
        await supabaseAdmin.from("platform_events").insert({
          event_type: "group_managed_email_created",
          title: "E-mail gerenciado criado",
          message: `O e-mail ${emailCriado} foi criado para o grupo "${group.name || groupId}".`,
          metadata: JSON.stringify({ group_id: groupId, email: emailCriado }),
          created_by: callerId,
        });
      } catch (e) {
        console.warn("Platform event nao registrado:", e);
      }

      return json({
        success: true,
        created: true,
        email: emailCriado,
        ai_enabled: true,
        message: "E-mail do grupo criado.",
      });
    } catch (error: any) {
      return json(
        { error: error?.message || "Erro ao criar o e-mail do grupo" },
        500,
      );
    }
  },
};
