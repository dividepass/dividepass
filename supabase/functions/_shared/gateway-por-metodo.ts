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
 * A renovação é uma cobrança NOVA e o MEIO é o que a pessoa escolheu agora.
 * Por isso a renovação segue o gateway do MÉTODO: o PIX da assinatura é o
 * Pix Automático (Woovi) e o cartão vai para o gateway de cartão.
 *
 * A troca de gateway na renovação NÃO deixa duas cobranças vivas:
 *   - quem tinha cartão e renova por PIX passa a ser cobrada pela Woovi (o
 *     job de recorrência do cartão não roda para assinatura da Woovi);
 *   - quem tinha a Woovi e renova por cartão tem o mandate cancelado (ver
 *     `create-payment`).
 *
 * A assinatura que JÁ é da Woovi continua na Woovi no PIX: o mandate é dela
 * e trocar criaria uma segunda recorrência para a mesma pessoa.
 *
 * POR QUE UM MÓDULO PRÓPRIO
 * -------------------------
 * A MESMA regra é usada pelas edge functions (Deno) e pelo frontend (JS). O
 * arquivo `src/lib/gatewayPorMetodo.js` é a cópia espelhada — troque em um e
 * troque no outro. É o mesmo padrão já usado em `_shared/ambiente.ts` ↔
 * `src/lib/ambiente.js`.
 */

/**
 * Os gateways que o sistema aceita.
 *
 * A lista e o tipo ficam em sincronia por construção (ver as duas checagens
 * logo abaixo): o tipo é escrito à mão e a lista é conferida contra ele.
 *
 * POR QUE O TIPO NÃO VEM DA LISTA
 * -------------------------------
 * A lista é um `const` (runtime) e o tipo é derivado dela com
 * `(typeof GATEWAYS_VALIDOS)[number]`. Isso funciona no arquivo-fonte, mas
 * QUEBRA no arquivo empacotado para o painel do Supabase: o empacotador
 * iça os `export type` para o TOPO do arquivo (para que todos os módulos
 * enxerguem) e mantém as `const` dentro do namespace do módulo. O tipo no
 * topo passaria a referenciar uma `const` que ainda não existe naquele
 * escopo — e o `deno check` acusaria "Cannot find name 'GATEWAYS_VALIDOS'".
 *
 * Escrevendo o tipo como união de literais, ele é autossuficiente: vale no
 * fonte e no pacote.
 */
export type GatewayId =
  | "mercadopago"
  | "stripe"
  | "asaas"
  | "iopay"
  | "pagarme"
  | "woovi";

export const GATEWAYS_VALIDOS = [
  "mercadopago",
  "stripe",
  "asaas",
  "iopay",
  "pagarme",
  "woovi",
] as const;

// Checagem 1: todo gateway da LISTA é um GatewayId válido.
// (Se alguém acrescentar um gateway na lista sem acrescentar no tipo,
// esta linha para de compilar.)
const _listaTemSomenteGatewaysValidos: readonly GatewayId[] = GATEWAYS_VALIDOS;

// Checagem 2: todo GatewayId do TIPO está na LISTA.
// (Se alguém remover um gateway do tipo mas esquecer a lista, idem.)
type _FaltandoNaLista = Exclude<GatewayId, (typeof GATEWAYS_VALIDOS)[number]>;
const _tipoTemTodosDaLista: _FaltandoNaLista extends never ? true : false = true;

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

/**
 * Todas as chaves que a divisão usa (para ler de uma vez).
 *
 * Inclui as chaves de FAILOVER (`gateway_failover_pix` /
 * `gateway_failover_card`) porque a leitura é feita com um `IN (...)` só —
 * uma ida ao banco em vez de duas. Ver `_shared/gateway-failover.ts`.
 */
export const CHAVES_GATEWAY = [
  CHAVE_ACTIVE_GATEWAY,
  CHAVE_SPLIT_ATIVO,
  CHAVE_SPLIT_PIX,
  CHAVE_SPLIT_CARD,
  CHAVE_SPLIT_ESCOPO,
  "gateway_failover_pix",
  "gateway_failover_card",
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

  if (renewal) {
    const atual = normalizarGateway(gatewayAtual);
    const m = normalizarMetodo(metodo);

    // A assinatura que JÁ é da Woovi (Pix Automático) continua na Woovi no
    // PIX: o mandate é dela — trocar de gateway agora criaria uma segunda
    // recorrência para a mesma pessoa.
    if (atual === "woovi") {
      if (!m || m === "pix") return "woovi";
      // Renovar por CARTÃO uma assinatura da Woovi: o mandate é cancelado
      // no create-payment (senão haveria duas cobranças vivas) e a
      // assinatura passa a ser cobrada pelo cartão.
      return gatewayDoMetodo(settings, m, { split });
    }

    // A renovação é uma cobrança NOVA e o MEIO é o que a pessoa escolheu
    // agora. O PIX da assinatura é o Pix Automático (Woovi) — por isso a
    // renovação por PIX vai para o gateway do PIX, e não para o gateway
    // que a assinatura usava (que pode ser o cartão).
    //
    // A troca não deixa duas cobranças vivas: quem tinha cartão e renova
    // por PIX passa a ser cobrada pela Woovi (o job de recorrência do
    // cartão não roda para assinatura da Woovi) e quem tinha a Woovi e
    // renova por cartão tem o mandate cancelado.
    if (m) return gatewayDoMetodo(settings, m, { split });
    if (atual) return atual;
  }

  return gatewayDoMetodo(settings, metodo, { split });
}
