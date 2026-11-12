/**
 * FAILOVER DE GATEWAY
 * ===================
 *
 * O QUE FAZ
 * ---------
 * Quando a cobrança no gateway escolhido falha por motivo TÉCNICO (o
 * gateway está fora, a API responde 5xx, a rede cai), esta módulo devolve a
 * PRÓXIMA opção de gateway para tentar. Assim o cliente não fica sem ser
 * cobrado porque um gateway teve um dia ruim.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * Em 09/11/2026 o `create-payment` ficou com 503 BOOT_ERROR (sintaxe
 * quebrada no empacotamento) e o botão "Gerar PIX" passou a responder
 * "Failed to fetch" para todo mundo. A cobrança de PIX ficou 100% fora do
 * ar até a função voltar.
 *
 * Um failover NÃO resolveria aquele caso (a função nem subia), mas resolve
 * o caso geral: gateway fora do ar, API lenta, 5xx do provedor. Nesses
 * dias, o dinheiro do cliente não pode parar de entrar.
 *
 * A REGRA DE OURO: SÓ TROCA DE GATEWAY QUANDO NADA FOI COBRADO
 * -------------------------------------------------------------
 * Trocar de gateway depois que o dinheiro já saiu seria COBRAR EM DOBRO.
 * Por isso o failover só acontece quando a falha é COMPROVADAMENTE anterior
 * à cobrança:
 *
 *   - erro de rede / timeout ao falar com o gateway (nada foi criado);
 *   - resposta 5xx do gateway na hora de ABRIR a cobrança;
 *   - o gateway recusou por configuração (falta chave, AppID, etc.).
 *
 * NÃO é falha técnica (e NÃO troca de gateway):
 *
 *   - o CLIENTE recusou (cartão recusado, saldo insuficiente);
 *   - o pedido do cliente é inválido (CPF faltando, grupo esgotado,
 *     cupom expirado, fatura já paga);
 *   - o grupo não está aprovado;
 *   - qualquer 4xx que seja do domínio do negócio.
 *
 * Nesses casos a resposta vai direto para o usuário: trocar de gateway
 * só faria o mesmo pedido ser recusado de novo, e — pior — num gateway
 * diferente, com a mesma recusa.
 *
 * COMO O ADMIN CONFIGURA
 * ----------------------
 * Duas chaves em `app_settings`:
 *
 *   - `gateway_failover_pix`  → lista separada por vírgula para PIX;
 *   - `gateway_failover_card` → lista separada por vírgula para cartão.
 *
 * Exemplo: `gateway_failover_pix = "iopay,mercadopago"`.
 *
 * VAZIO (ou chave ausente) = failover DESLIGADO. É o padrão seguro: sem
 * configuração explícita do admin, o comportamento é o de hoje (um gateway
 * só). Ligar o failover manda o dinheiro para outro gateway, e isso é uma
 * decisão de negócio — não uma coisa que o código deve inventar.
 *
 * A JANELA DE DÚVIDA (e por que ela é pequena)
 * --------------------------------------------
 * Existe um caso em que a falha NÃO é comprovadamente anterior à cobrança:
 * a requisição foi enviada ao gateway, o gateway criou a cobrança, e a
 * resposta se perdeu (timeout ou reset de conexão). Aí o failover pode
 * cobrar uma segunda vez — no OUTRO gateway.
 *
 * Mitigações já no lugar:
 *   - o `correlationID` de cada tentativa é único e o gateway recusa
 *     repetição: a MESMA tentativa nunca é cobrada duas vezes;
 *   - a renovação (assinatura que já existe) fica SEM failover — ver
 *     `create-payment/index.ts`;
 *   - a falha só é tratada como técnica quando é 5xx, erro de rede ou
 *     credencial faltando — recusa do cliente nunca troca de gateway.
 *
 * A CÓPIA ESPELHADA
 * ------------------
 * O frontend tem a sua cópia em `src/lib/gatewayPorMetodo.js`. As DUAS
 * precisam falar a mesma coisa — troque em uma e troque na outra.
 */

import {
  normalizarGateway,
  normalizarMetodo,
  type GatewayId,
  type MetodoPagamento,
} from "./gateway-por-metodo.ts";

export const CHAVE_FAILOVER_PIX = "gateway_failover_pix";
export const CHAVE_FAILOVER_CARD = "gateway_failover_card";

/**
 * Lê a lista de failover do admin para um método.
 *
 * Devolve os gateways na ORDEM em que devem ser tentados, já normalizados
 * e sem repetição. Um nome desconhecido na configuração é IGNORADO (não
 * quebra a cobrança) — a lista é configuração, e configuração errada não
 * pode derrubar o pagamento.
 */
export function gatewaysDeFailover(
  settings: Record<string, unknown> | null | undefined,
  metodo: unknown,
): GatewayId[] {
  const m: MetodoPagamento | null = normalizarMetodo(metodo);
  if (!m) return [];

  const chave = m === "pix" ? CHAVE_FAILOVER_PIX : CHAVE_FAILOVER_CARD;
  const bruto = String(settings?.[chave] ?? "").trim();
  if (!bruto) return [];

  const vistos = new Set<GatewayId>();
  const saida: GatewayId[] = [];
  for (const parte of bruto.split(",")) {
    const g = normalizarGateway(parte.trim());
    if (!g || vistos.has(g)) continue;
    vistos.add(g);
    saida.push(g);
  }
  return saida;
}

/**
 * A resposta do gateway diz que a cobrança NÃO saiu?
 *
 * É a pergunta que separa "trocar de gateway" de "devolver o erro ao
 * cliente". A resposta é `true` só quando é seguro e necessário trocar.
 *
 * @param status   status HTTP devolvido pelo handler do gateway
 * @param corpo    corpo já parseado da resposta (pode ser null)
 */
export function falhaTecnicaDoGateway(status: number, corpo: any): boolean {
  // 5xx do gateway: a API do provedor caiu. Nada foi cobrado (o gateway
  // não conseguiu abrir a cobrança).
  if (status >= 500) return true;

  // 4xx é, por padrão, do domínio do negócio: recusa do cliente, dado
  // inválido, cupom expirado. Trocar de gateway não resolve — e numa
  // recusa de cartão, o outro gateway também recusaria.
  //
  // A EXCEÇÃO é o gateway dizer que está com FALHA DE CONFIGURAÇÃO: aí a
  // cobrança não tem como sair daquele gateway, e o cliente não tem culpa.
  // O corpo traz um `code` que o handler define justamente para isso.
  if (status >= 400 && status < 500) {
    const code = String(corpo?.code || "");
    const ehConfiguracao =
      code === "gateway_not_configured" ||
      code === "woovi_app_id_missing" ||
      code === "gateway_sem_credenciais";
    return ehConfiguracao;
  }

  return false;
}

/**
 * Monta a fila de gateways a tentar: o principal primeiro, depois os de
 * failover (sem repetir o principal).
 *
 * @param principal o gateway que a cobrança deve usar
 * @param settings  as chaves de app_settings
 * @param metodo    'pix' | 'card'
 */
export function filaDeGateways(
  principal: GatewayId,
  settings: Record<string, unknown> | null | undefined,
  metodo: unknown,
): GatewayId[] {
  const fila: GatewayId[] = [principal];
  for (const g of gatewaysDeFailover(settings, metodo)) {
    if (!fila.includes(g)) fila.push(g);
  }
  return fila;
}
