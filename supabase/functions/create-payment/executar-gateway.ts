/**
 * EXECUÇÃO DO GATEWAY
 * ===================
 *
 * Funções de apoio ao FAILOVER (ver `_shared/gateway-failover.ts`).
 *
 * POR QUE UM MÓDULO SEPARADO
 * --------------------------
 * O `switch` que escolhe o handler tem UM `import()` por gateway, e o
 * `import()` do Deno é ASSÍNCRONO: ele não pode ficar dentro de uma
 * expressão de `switch` que devolve `Response`. Este módulo resolve isso:
 * uma função por gateway, e o failover chama a da vez, em sequência.
 */

import type { GatewayId } from "../_shared/gateway-por-metodo.ts";

/**
 * Executa o handler do gateway e devolve a resposta.
 *
 * Qualquer exceção vira uma resposta 500 — a exceção escapa do handler
 * viraria um erro cru, e o front receberia um "Failed to fetch" em vez da
 * mensagem de erro.
 */
export async function executarGateway(
  gateway: GatewayId,
  req: Request,
  ctx: any,
): Promise<Response> {
  try {
    switch (gateway) {
      case "stripe": {
        const mod = await import("./handlers/stripe.ts");
        return await mod.default(req, ctx);
      }
      case "asaas": {
        const mod = await import("./handlers/asaas.ts");
        return await mod.default(req, ctx);
      }
      case "iopay": {
        const mod = await import("./handlers/iopay.ts");
        return await mod.default(req, ctx);
      }
      case "pagarme": {
        const mod = await import("./handlers/pagarme.ts");
        return await mod.default(req, ctx);
      }
      case "woovi": {
        const mod = await import("./handlers/woovi.ts");
        return await mod.default(req, ctx);
      }
      case "mercadopago":
      default: {
        const mod = await import("./handlers/mercadopago.ts");
        return await mod.default(req, ctx);
      }
    }
  } catch (erro: any) {
    console.error(`[create-payment] excecao no handler do gateway ${gateway}:`, erro);
    return new Response(
      JSON.stringify({
        error: "Erro inesperado ao processar o pagamento.",
        gateway,
        detalhe: erro?.message || String(erro),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * Lê o corpo da resposta como JSON (ou null se não for JSON).
 *
 * A resposta é clonada: o `caller` ainda precisa do corpo original.
 */
export async function corpoDaResposta(resposta: Response): Promise<any> {
  try {
    const texto = await resposta.clone().text();
    if (!texto) return null;
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/**
 * Extrai a mensagem de erro da resposta, para o log e para a resposta final.
 */
export async function mensagemDaResposta(resposta: Response): Promise<string> {
  const corpo = await corpoDaResposta(resposta);
  const msg = corpo?.error || corpo?.message;
  if (typeof msg === "string" && msg.trim()) return msg.trim();
  return `HTTP ${resposta.status}`;
}
