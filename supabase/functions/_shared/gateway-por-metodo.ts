/**
 * GATEWAY POR MÉTODO DE PAGAMENTO
 * ===============================
 *
 * PROBLEMA QUE RESOLVE
 * ---------------------
 * O DividePass tinha UM gateway para tudo: `app_settings.active_gateway`.
 * Isso não permite, por exemplo, cobrar o PIX na Woovi (Pix Automático) e o
 * cartão de crédito na IO Pay — cada compra ia para o mesmo gateway.
 *
 * Aqui entra a DIVISÃO POR MÉTODO:
 *
 *   active_gateway        → o gateway padrão (o de sempre, quando a divisão
 *                            está desligada). Continua valendo para tudo.
 *   split_gateway_enabled → 'true' liga a divisão.
 *   split_gateway_pix     → gateway que recebe a cobrança de PIX.
 *   split_gateway_card    → gateway que recebe a cobrança de cartão.
 *   split_gateway_scope   → ONDE a divisão vale:
 *                            'v2'  (padrão) só no checkout V2 (de teste);
 *                            'all' em todos os checkouts.
 *
 * POR QUE O ESCOPO EXISTE
 * -----------------------
 * O checkout V1 (o que está em produção e funciona) não pode mudar de
 * comportamento enquanto a integração está sendo testada. Por isso a
 * divisão é, por padrão, **só no checkout V2**. Quando a integração
 * estivervalidada, o admin troca o escopo para 'all' e a divisão passa
 * a valer em todo lugar — inclusive no V1.
 *
 * REGRA DE OURO
 * -------------
 * Com a divisão DESLIGADA (padrão), o comportamento é IDÊNTICO ao de hoje:
 * todo mundo cai no `active_gateway`. Nada muda no site até o admin
 * ligar a divisão de propósito.
 *
 * RENOVAÇÃO
 * ---------
 * Uma renovação NÃO troca de gateway: a assinatura já existe e já tem um
 * `gateway_subscription_id` no gateway antigo. Trocar agora deixaria duas
 * cobranças vivas (a antiga continuando no gateway antigo e a nova no
 * gateway novo). Por isso `resolverGatewayParaPagamento` recebe o gateway
 * atual da assinatura e o preserva.
 *
 * POR QUE UM MÓDULO PRÓPRIO
 * -------------------------
 * A MESMA regra é usada pelas edge functions (Deno) e pelo frontend (JS). O
 * arquivo `src/lib/gatewayPorMetodo.js` é a cópia espelhada — troque em um e
 * troque no outro. É o mesmo padrão já usado em `_shared/ambiente.ts` ↔
 * `src/lib/ambiente.js`.
 */

export const GATEWAYS_VALIDOS = [
  "mercadopago",
  "stripe",
  "asaas",
  "iopay",
  "pagarme",
  "woovi",
] as const;

export type GatewayId = (typeof GATEWAYS_VALIDOS)[number];

/** 'pix' ou 'card'. `null` = método desconhecido/ausente. */
export type MetodoPagamento = "pix" | "card";

export const CHAVE_ACTIVE_GATEWAY = "active_gateway";
export const CHAVE_SPLIT_ATIVO = "split_gateway_enabled";
export const CHAVE_SPLIT_PIX = "split_gateway_pix";
export const CHAVE_SPLIT_CARD = "split_gateway_card";
export const CHAVE_SPLIT_ESCOPO = "split_gateway_scope";

/** Onde a divisão vale. */
export const ESCOPO_V2 = "v2";
export const ESCOPO_ALL = "all";

/** Todas as chaves que a divisão usa (para ler de uma vez). */
export const CHAVES_GATEWAY = [
  CHAVE_ACTIVE_GATEWAY,
  CHAVE_SPLIT_ATIVO,
  CHAVE_SPLIT_PIX,
  CHAVE_SPLIT_CARD,
  CHAVE_SPLIT_ESCOPO,
];

export const GATEWAY_PADRAO = "iopay";

/** Normaliza o nome do método. Aceita o que o IO Pay usa ('credit_card'). */
export function normalizarMetodo(valor: unknown): MetodoPagamento | null {
  const v = String(valor ?? "").trim().toLowerCase();
  if (v === "pix") return "pix";
  if (v === "card" || v === "cartao" || v === "credit_card" || v === "credito") {
    return "card";
  }
  return null;
}

/** Normaliza um id de gateway; devolve null se não for conhecido. */
export function normalizarGateway(valor: unknown): GatewayId | null {
  const v = String(valor ?? "").trim().toLowerCase();
  return (GATEWAYS_VALIDOS as readonly string[]).includes(v) ? (v as GatewayId) : null;
}

/**
 * A divisão está ligada?
 *
 * SÓ 'true' liga. Qualquer outra coisa ('1', 'sim', 'on', vazio, lixo)
 * significa DESLIGADA — errar para o lado seguro. A divisão mexe em para
 * onde o dinheiro do cliente vai; uma configuração ambígua não pode virar
 * uma cobrança no gateway errado.
 */
export function splitAtivo(settings: Record<string, unknown> | null | undefined): boolean {
  const v = String(settings?.[CHAVE_SPLIT_ATIVO] ?? "").trim().toLowerCase();
  return v === "true";
}

/** O gateway padrão (o de sempre). */
export function gatewayPadrao(settings: Record<string, unknown> | null | undefined): GatewayId {
  return normalizarGateway(settings?.[CHAVE_ACTIVE_GATEWAY]) ?? GATEWAY_PADRAO;
}

/**
 * Onde a divisão vale.
 *
 * Padrão: 'v2' (só no checkout de teste). 'all' só quando o admin
 * escolhe explicitamente — assim o checkout V1 (que está em produção e
 * funciona) não muda de comportamento durante os testes.
 */
export function escopoDoSplit(settings: Record<string, unknown> | null | undefined): string {
  const v = String(settings?.[CHAVE_SPLIT_ESCOPO] ?? "").trim().toLowerCase();
  return v === ESCOPO_ALL ? ESCOPO_ALL : ESCOPO_V2;
}

/**
 * A divisão vale para ESTA cobrança?
 *
 * @param clientePediuSplit  true quando o cliente é o checkout V2 (que
 *                           manda `split_gateway: true` no body).
 */
export function splitAplicavel(
  settings: Record<string, unknown> | null | undefined,
  clientePediuSplit = false,
): boolean {
  if (!splitAtivo(settings)) return false;
  if (escopoDoSplit(settings) === ESCOPO_ALL) return true;
  return clientePediuSplit === true;
}

/**
 * Qual gateway atende um método.
 *
 *   - divisão desligada → gateway padrão (comportamento de hoje);
 *   - divisão ligada → o gateway configurado para aquele método; se o
 *     gateway do método não existir ou for desconhecido → gateway padrão.
 *
 * `opcoes.split` sobrescreve a decisão (o backend passa o resultado de
 * `splitAplicavel`, que já considera o escopo e o pedido do cliente).
 */
export function gatewayDoMetodo(
  settings: Record<string, unknown> | null | undefined,
  metodo: unknown,
  opcoes?: { split?: boolean },
): GatewayId {
  const padrao = gatewayPadrao(settings);
  const divido =
    opcoes && opcoes.split !== undefined ? opcoes.split : splitAplicavel(settings, false);
  if (!divido) return padrao;

  const m = normalizarMetodo(metodo);
  if (!m) return padrao;

  const chave = m === "pix" ? CHAVE_SPLIT_PIX : CHAVE_SPLIT_CARD;
  const alvo = normalizarGateway(settings?.[chave]);
  return alvo ?? padrao;
}

/**
 * Decide o gateway de uma cobrança.
 *
 * @param settings    as chaves de app_settings (active_gateway + split_*)
 * @param metodo      'pix' | 'card' (o que o usuário escolheu na tela)
 * @param renewal     true quando é a RENOVAÇÃO de uma assinatura que já existe
 * @param gatewayAtual o gateway que a assinatura já usa (renovação)
 */
export function resolverGatewayParaPagamento(args: {
  settings: Record<string, unknown> | null | undefined;
  metodo: unknown;
  renewal?: boolean;
  gatewayAtual?: string | null;
  split?: boolean;
}): GatewayId {
  const { settings, metodo, renewal, gatewayAtual, split } = args;

  // Renovação: fica no gateway que a assinatura já usa.
  if (renewal) {
    const atual = normalizarGateway(gatewayAtual);
    if (atual) return atual;
  }

  return gatewayDoMetodo(settings, metodo, { split });
}
