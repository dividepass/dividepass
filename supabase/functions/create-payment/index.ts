import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  CHAVES_GATEWAY,
  normalizarMetodo,
  resolverGatewayParaPagamento,
  splitAplicavel,
} from "../_shared/gateway-por-metodo.ts";
// Failover: quando o gateway falha por motivo técnico, a cobrança é tentada
// no próximo gateway da fila. Ver `_shared/gateway-failover.ts`.
import {
  falhaTecnicaDoGateway,
  filaDeGateways,
} from "../_shared/gateway-failover.ts";
// Execução do handler por gateway (o `import()` é assíncrono, então não cabe
// num `switch` que devolve `Response`).
import {
  corpoDaResposta,
  executarGateway,
  mensagemDaResposta,
} from "./executar-gateway.ts";
import { cancelSubscription } from "../_shared/woovi-api.ts";
import { getWooviConfig } from "../_shared/woovi.ts";

/** As chaves que a Woovi precisa para montar a configuração (AppID + ambiente). */
const CHAVES_WOOVI = [
  "woovi_app_id_production",
  "woovi_app_id_sandbox",
  "woovi_app_id",
  "ambiente",
];

/**
 * Cancela o mandate do Pix Automático de uma assinatura.
 *
 * Usado quando a pessoa renova por OUTRO meio (cartão): o mandate que
 * continuaria cobrando sozinha é cancelado — senão haveria duas cobranças
 * pelo mesmo ciclo.
 *
 * Falha aqui NÃO cancela o pagamento: a pessoa quer pagar, e o pagamento
 * segue. O que fica para trás é a limpeza do mandate — e ela é logada.
 */
async function cancelarMandateWoovi(supabaseAdmin: any, globalID: string): Promise<void> {
  try {
    const { data: linhas } = await supabaseAdmin
      .from("app_settings")
      .select("key, value")
      .in("key", CHAVES_WOOVI);

    const settings: Record<string, string> = {};
    for (const linha of linhas || []) {
      if (linha?.key) settings[linha.key] = linha.value;
    }

    const cfg = getWooviConfig(settings);
    if (!cfg.appId) {
      console.warn(
        `[create-payment] sem AppID da Woovi (${cfg.env}) — mandate ${globalID} NÃO foi cancelado`,
      );
      return;
    }

    await cancelSubscription(cfg, globalID);
    console.log(
      `[create-payment] mandate Woovi ${globalID} cancelado (a recorrência duplicaria a cobrança)`,
    );

    await supabaseAdmin
      .from("user_subscriptions")
      .update({ woovi_recurrence_status: "CANCELLED" })
      .eq("woovi_subscription_id", globalID);
  } catch (e: any) {
    console.error(
      `[create-payment] falha ao cancelar o mandate ${globalID}:`,
      e?.message || e,
    );
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_GATEWAYS = ["mercadopago", "stripe", "asaas", "iopay", "pagarme", "woovi"];

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      // ---------------------------------------------------------------------
      // AUTENTICACAO (S12) — PRIMEIRO, antes de qualquer validacao de payload
      // ---------------------------------------------------------------------
      // Antes, `user_id` vinha do BODY e nao havia nenhuma validacao de JWT.
      // Qualquer um criava uma assinatura/grupo em nome de outra pessoa.
      // Agora o chamador e autenticado e o user_id e derivado do token.
      // A checagem vem antes da validacao do body para nao revelar detalhes
      // de schema (quais campos existem) a quem nao esta autenticado.
      // ---------------------------------------------------------------------
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();

      if (!token) {
        return new Response(
          JSON.stringify({ error: "Não autenticado" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !authData?.user) {
        return new Response(
          JSON.stringify({ error: "Token inválido" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let user_id = authData.user.id;

      const body = await req.json();
      const { group_id, billing_cycle, months, reason, referral_code, payment_type, gateway: bodyGateway, coupon_id, discount_amount, final_amount, invoice_id } = body;

      if (!group_id || !reason) {
        return new Response(
          JSON.stringify({ error: "Dados incompletos" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Cobranca de fatura: so pode ser paga por quem e o dono da fatura.
      if (payment_type === "invoice") {
        if (!invoice_id) {
          return new Response(
            JSON.stringify({ error: "invoice_id é obrigatório para pagamento de fatura" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const { data: invoice } = await supabaseAdmin
          .from("invoices")
          .select("id, user_id, status")
          .eq("id", invoice_id)
          .maybeSingle();

        if (!invoice || invoice.user_id !== authData.user.id) {
          return new Response(
            JSON.stringify({ error: "Fatura não encontrada" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        user_id = invoice.user_id;
      }

      // ── GATEWAY: quem decide é o BANCO, não o frontend ─────────────────────
      //
      // A DIVISÃO POR MÉTODO (split_gateway_*) permite que o PIX vá para um
      // gateway e o cartão para outro. A configuração mora em `app_settings`
      // e é lida aqui — assim um cliente antigo (ou desatualizado) não cobra
      // no gateway errado, e o Admin continua sendo a única fonte de verdade.
      //
      // A EXCEÇÃO é a RENOVAÇÃO: a assinatura já tem um gateway e um
      // `gateway_subscription_id` lá. Trocar agora deixaria DUAS cobranças
      // vivas (a antiga continuando no gateway antigo e a nova no gateway
      // novo) — e o dinheiro do usuário ia para o lugar errado.
      const { data: gatewayRows } = await supabaseAdmin
        .from("app_settings")
        .select("key, value")
        .in("key", CHAVES_GATEWAY);

      const gatewaySettings: Record<string, string> = {};
      for (const linha of gatewayRows || []) {
        if (linha?.key) gatewaySettings[linha.key] = linha.value;
      }

      const metodoPagamento = normalizarMetodo(body.payment_method);
      const ehRenovacao = body.renewal === true;

      let gatewayDaAssinatura: string | null = null;
      let mandateWooviDaAssinatura: string | null = null;
      if (ehRenovacao) {
        const { data: subs } = await supabaseAdmin
          .from("user_subscriptions")
          .select("gateway, woovi_subscription_id")
          .eq("user_id", user_id)
          .eq("group_id", group_id)
          .order("created_at", { ascending: false })
          .limit(1);
        const linha = subs?.[0];
        gatewayDaAssinatura = linha?.gateway || null;
        mandateWooviDaAssinatura = linha?.woovi_subscription_id || null;
      }

      const gateway = resolverGatewayParaPagamento({
        settings: gatewaySettings,
        metodo: metodoPagamento,
        renewal: ehRenovacao,
        gatewayAtual: gatewayDaAssinatura,
        split: splitAplicavel(gatewaySettings, body.split_gateway === true),
      });

      if (!VALID_GATEWAYS.includes(gateway)) {
        return new Response(
          JSON.stringify({ error: "Gateway de pagamento inválido" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(
        `[create-payment] gateway=${gateway} (pedido=${bodyGateway || "-"} metodo=${metodoPagamento || "-"}) ` +
        `type=${payment_type} group=${group_id}`
      );

      // ── A RECORRÊNCIA DA WOOVI NÃO SOBREVIVE À TROCA DE GATEWAY ───────────
      //
      // A assinatura tinha um Pix Automático ativo (a Woovi cobra sozinha no
      // dia do vencimento). Se a pessoa renova por CARTÃO, o mandate continua
      // vivo e a Woovi cobraria o ciclo seguinte — ALÉM do cartão. Duas
      // cobranças pelo mesmo ciclo.
      //
      // Por isso o mandate é cancelado quando a renovação vai para outro
      // gateway. O inverso (quem tinha cartão e renova por PIX) não precisa
      // de nada: o job de recorrência do cartão não roda para assinatura da
      // Woovi, e a cobrança passa a ser o Pix Automático.
      if (ehRenovacao && mandateWooviDaAssinatura && gateway !== "woovi") {
        await cancelarMandateWoovi(supabaseAdmin, mandateWooviDaAssinatura);
      }

      // ── Grupo aguardando aprovação ──────────────────────────────────────
      // Grupo criado por usuário só pode ser vendido depois da aprovação do
      // admin. O grupo aparece no catálogo (a pessoa pode entrar na fila), mas
      // ninguem paga enquanto ele não for aprovado.
      //
      // A renovação de uma assinatura já existente NÃO é bloqueada: a pessoa
      // pagou antes e o acesso dela depende disso.
      const isRenewal = body.renewal === true;
      if (!isRenewal && payment_type !== "invoice") {
        const { data: groupForApproval } = await supabaseAdmin
          .from("groups")
          .select("id, name, approval_status, tags")
          .eq("id", group_id)
          .maybeSingle();

        if (groupForApproval && groupForApproval.approval_status !== "approved") {
          const isRejected = groupForApproval.approval_status === "rejected";
          console.log(
            `[create-payment] BLOQUEADO: grupo ${group_id} approval_status=${groupForApproval.approval_status}`,
          );
          return new Response(
            JSON.stringify({
              error: isRejected
                ? "Este grupo foi recusado pela equipe e não aceita pagamentos."
                : "Este grupo está aguardando aprovação da equipe DividePass. Os pagamentos são liberados assim que o grupo for aprovado.",
              code: "group_not_approved",
              approval_status: groupForApproval.approval_status,
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // ── Produto ESGOTADO no fornecedor ──────────────────────────────────
        // O importador marca com a tag "Esgotado" o grupo cujo estoque no
        // parceiro acabou. O front já mostra isso e não deixa entrar, mas a
        // trava que importa é esta: o front pode ser contornado chamando a
        // API direto, e aí o cliente pagaria por um produto que não existe.
        //
        // A renovação NÃO é bloqueada: a pessoa pagou antes e o acesso dela
        // depende disso.
        const tags = Array.isArray(groupForApproval?.tags) ? groupForApproval.tags : [];
        const esgotado = tags.some(
          (t: string) => String(t || "").trim().toLowerCase() === "esgotado",
        );
        if (esgotado) {
          console.log(`[create-payment] BLOQUEADO: grupo ${group_id} esta ESGOTADO`);
          return new Response(
            JSON.stringify({
              error:
                "Este produto está sem estoque no momento. Logo que o fornecedor reponha, ele volta a ficar disponível.",
              code: "grupo_esgotado",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // ATENCAO: `discount_amount` e `final_amount` vem do BODY do cliente e
      // sao NAO CONFIAVEIS. O handler do IO Pay (handlers/iopay.ts) ignora
      // esses valores e recalcula o desconto a partir da tabela `coupons`
      // (handlers/coupon.ts). Os outros handlers (stripe, asaas, mercadopago,
      // pagarme) ainda os usam e PRECISAM da mesma correcao — porem esses
      // gateways estao inativos (app_settings.active_gateway = 'iopay') e
      // quebrados por TDZ.
      const ctx = { supabaseAdmin, supabaseUrl, group_id, user_id, billing_cycle, months, reason, referral_code, payment_type, corsHeaders, body, coupon_id, discount_amount, final_amount };

      // ── FAILOVER DE GATEWAY ───────────────────────────────────────────────
      //
      // Se o gateway escolhido falhar por motivo TÉCNICO (fora do ar, 5xx,
      // falta de credencial), a cobrança é tentada no próximo gateway da
      // fila — para o cliente não parar de ser cobrado por causa de um
      // gateway com problema.
      //
      // Só troca quando a falha é COMPROVADAMENTE anterior à cobrança: se o
      // CLIENTE recusou (cartão recusado) ou o pedido é inválido (CPF
      // faltando, grupo esgotado), a resposta vai direto para ele — trocar
      // de gateway só faria a mesma recusa acontecer de novo.
      //
      // A fila vem de `app_settings` (`gateway_failover_pix` /
      // `gateway_failover_card`). Vazio = failover desligado.
      //
      // A RENOVAÇÃO fica SEM failover, de propósito: a assinatura já tem uma
      // cobrança viva no gateway dela (`gateway_subscription_id`). Se o gateway
      // falhar e a cobrança for feita em OUTRO, a assinatura antiga continua
      // lá — e pode cobrar o cliente de novo no ciclo seguinte. Já a
      // renovação que o cron faz é um caminho separado.
      const fila = ehRenovacao
        ? [gateway]
        : filaDeGateways(gateway, gatewaySettings, metodoPagamento);

      let ultimaResposta: Response | null = null;
      let ultimaFalha = "";

      for (const gatewayParaUsar of fila) {
        const resposta = await executarGateway(gatewayParaUsar, req, ctx);

        if (resposta.ok) {
          if (gatewayParaUsar !== gateway) {
            console.log(
              `[create-payment] FAILOVER: ${gateway} falhou, cobranca feita no ${gatewayParaUsar}`,
            );
          }
          return resposta;
        }

        // Guarda a resposta para o caso de a fila acabar.
        ultimaResposta = resposta;
        ultimaFalha = await mensagemDaResposta(resposta);

        const corpo = await corpoDaResposta(resposta);
        if (!falhaTecnicaDoGateway(resposta.status, corpo)) {
          // Não é falha técnica: o erro é do negócio e vai para o cliente.
          break;
        }

        console.error(
          `[create-payment] gateway ${gatewayParaUsar} falhou tecnicamente (HTTP ${resposta.status}): ${ultimaFalha}`,
        );
        if (gatewayParaUsar === fila[fila.length - 1]) break;
      }

      return ultimaResposta ?? new Response(
        JSON.stringify({ error: ultimaFalha || "Não foi possível concluir o pagamento." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error("create-payment error:", error);
      // `catch` sem anotação entrega `unknown` — a mensagem precisa vir
      // segura, senão o front receberia "[object Object]" em vez do motivo.
      const mensagem =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Erro inesperado ao processar o pagamento.";
      return new Response(
        JSON.stringify({ error: mensagem }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
