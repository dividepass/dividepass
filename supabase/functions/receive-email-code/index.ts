import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CODE_PATTERNS = [
  /c[oó]digo[:\s]*(\d{4,8})/i,
  /c[oó]digo\s+de\s+(?:verifica[çc][ãa]o|valida[çc][ãa]|acesso)[:\s]*(\d{4,8})/i,
  /verification\s+code[:\s]*(\d{4,8})/i,
  /your\s+(?:verification\s+)?code[:\s]*(\d{4,8})/i,
  /use\s+(?:this\s+)?code[:\s]*(\d{4,8})/i,
  /pin[:\s]*(\d{4,8})/i,
  /(\d{6})\s+(?:is\s+your|for\s+your|é\s+seu)/i,
  /enter\s+(\d{4,8})/i,
  /digite\s+(\d{4,8})/i,
  /insira\s+(\d{4,8})/i,
  /\b(\d{6})\b/,
  /\b(\d{8})\b/,
];

const DEFAULT_BLOCKED_SUBJECTS = [
  "password",
  "recuperação",
  "redefinição",
  "redefinição de senha",
  "recuperação de senha",
  "alteração",
  "segurança",
  "seguranca",
  "alerta",
  "suspens",
  "novo dispositivo",
  "new device",
  "unusual",
  "compromised",
  "sua senha foi alterada",
  "your password was changed",
  "login activity",
  "atividade suspeita",
  "account locked",
  "conta bloqueada",
  "verify your identity",
  "confirme sua identidade",
];

function extractCode(
  body: string,
  blockedSubjects: string[],
): { code: string | null; reason?: string } {
  const lowerBody = (body || "").toLowerCase();
  for (const pattern of blockedSubjects) {
    if (lowerBody.includes(pattern.toLowerCase())) {
      return { code: null, reason: `Assunto bloqueado: ${pattern}` };
    }
  }

  for (const regex of CODE_PATTERNS) {
    const match = body.match(regex);
    if (match && match[1]) {
      return { code: match[1] };
    }
  }

  return { code: null, reason: "Nenhum código encontrado" };
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      // Validate shared secret
      const authHeader = req.headers.get("authorization") || "";
      const sharedSecret = Deno.env.get("RECEIVE_CODE_SECRET") || "";
      
      if (!sharedSecret) {
        console.error("RECEIVE_CODE_SECRET not configured");
        return new Response(
          JSON.stringify({ error: "Server not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (authHeader !== `Bearer ${sharedSecret}`) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const body = await req.json();
      const {
        recipient,
        code: rawCode,
        sender,
        subject,
        body: emailBody,
        manual_action_url,
        manual_action_label,
        manual_action_note,
      } = body;

      if (!recipient) {
        return new Response(
          JSON.stringify({ error: "recipient is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      // Find group by verification_email
      const { data: group, error: groupError } = await supabaseAdmin
        .from("groups")
        .select("id, email_code_enabled, email_code_method, email_blocked_subjects")
        .eq("verification_email", recipient)
        .single();

      if (groupError || !group) {
        console.log(`No group found for email: ${recipient}`);
        return new Response(
          JSON.stringify({ error: `No group configured for ${recipient}` }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!group.email_code_enabled) {
        return new Response(
          JSON.stringify({ error: "Email code not enabled for this group" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (group.email_code_method !== "webhook") {
        return new Response(
          JSON.stringify({ error: "This group uses IMAP, not webhook" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Extract code - use rawCode if provided, otherwise try email body
      let foundCode = rawCode;
      let foundSender = sender || "";
      let foundSubject = subject || "";

      if (!foundCode && emailBody) {
        const blockedSubjects = [
          ...DEFAULT_BLOCKED_SUBJECTS,
          ...(group.email_blocked_subjects || []),
        ];
        const result = extractCode(emailBody, blockedSubjects);
        foundCode = result.code;
      }

      // E-mail de confirmação sem código: entrega a URL pro usuário clicar.
      // O link é de uso único — nunca acessado pelo servidor.
      if (!foundCode && manual_action_url) {
        const { error: insertError } = await supabaseAdmin
          .from("verification_pins")
          .insert({
            group_id: group.id,
            code: null,
            source_email: foundSender || null,
            manual_action_url,
            manual_action_label: manual_action_label || "Abrir e confirmar",
            manual_action_note: manual_action_note || null,
            used: false,
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          });

        if (insertError) {
          console.error("Failed to save manual action:", insertError);
          return new Response(
            JSON.stringify({ error: "Failed to save action link" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        console.log(`Action link saved for group ${group.id}: ${manual_action_url}`);

        return new Response(
          JSON.stringify({
            success: true,
            group_id: group.id,
            requires_manual_action: true,
            manual_action_url,
            sender: foundSender,
            subject: foundSubject,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!foundCode) {
        return new Response(
          JSON.stringify({ error: "No verification code found in email" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Save to verification_pins
      const { error: insertError } = await supabaseAdmin
        .from("verification_pins")
        .insert({
          group_id: group.id,
          code: foundCode,
          source_email: foundSender,
          used: false,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        });

      if (insertError) {
        console.error("Failed to save verification pin:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to save code" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.log(`Code saved for group ${group.id}: ${foundCode} from ${foundSender}`);

      return new Response(
        JSON.stringify({
          success: true,
          group_id: group.id,
          code: foundCode,
          sender: foundSender,
          subject: foundSubject,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (error) {
      console.error("receive-email-code error:", error);
      return new Response(
        JSON.stringify({ error: error.message || "Internal error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  },
};
