/**
 * GATEWAY POR MÉTODO DE PAGAMENTO — espelho JS do backend.
 *
 * É o MESMO conceito do backend (`supabase/functions/_shared/gateway-por-metodo.ts`).
 * As duas pontas precisam falar a mesma língua: as chaves salvas são
 * `active_gateway`, `split_gateway_enabled`, `split_gateway_pix` e
 * `split_gateway_card`.
 *
 * POR QUE DUPLICAR
 * ----------------
 * O checkout precisa saber qual gateway atende cada método ANTES de criar a
 * cobrança (para mostrar o formulário de cartão, o QR do Pix, o texto do
 * provedor). Não existe endpoint "qual o gateway do pix?" — e o backend não
 * pode ser consultado antes do pagamento. Então a regra é replicada aqui.
 *
 * Se mudar um, mude o outro. É o mesmo padrão já usado em
 * `_shared/ambiente.ts` ↔ `src/lib/ambiente.js`.
 *
 * REGRA DE OURO: com a divisão DESLIGADA (padrão), o comportamento é idêntico
 * ao de hoje — todo mundo cai no `active_gateway`.
 */

export const GATEWAYS_VALIDOS = [
  'mercadopago',
  'stripe',
  'asaas',
  'iopay',
  'pagarme',
  'woovi',
];

export const CHAVE_ACTIVE_GATEWAY = 'active_gateway';
export const CHAVE_SPLIT_ATIVO = 'split_gateway_enabled';
export const CHAVE_SPLIT_PIX = 'split_gateway_pix';
export const CHAVE_SPLIT_CARD = 'split_gateway_card';
export const CHAVE_SPLIT_ESCOPO = 'split_gateway_scope';

/** Onde a divisão vale. */
export const ESCOPO_V2 = 'v2';
export const ESCOPO_ALL = 'all';

/** Todas as chaves que a divisão usa (para ler de uma vez). */
export const CHAVES_GATEWAY = [
  CHAVE_ACTIVE_GATEWAY,
  CHAVE_SPLIT_ATIVO,
  CHAVE_SPLIT_PIX,
  CHAVE_SPLIT_CARD,
  CHAVE_SPLIT_ESCOPO,
];

export const GATEWAY_PADRAO = 'iopay';

/** Normaliza o nome do método. Aceita o que o IO Pay usa ('credit_card'). */
export function normalizarMetodo(valor) {
  const v = String(valor ?? '').trim().toLowerCase();
  if (v === 'pix') return 'pix';
  if (v === 'card' || v === 'cartao' || v === 'credit_card' || v === 'credito') return 'card';
  return null;
}

/** Normaliza um id de gateway; devolve null se não for conhecido. */
export function normalizarGateway(valor) {
  const v = String(valor ?? '').trim().toLowerCase();
  return GATEWAYS_VALIDOS.includes(v) ? v : null;
}

/**
 * A divisão está ligada?
 *
 * SÓ 'true' liga. Qualquer outra coisa ('1', 'sim', 'on', vazio, lixo)
 * significa DESLIGADA — errar para o lado seguro. (Mesma regra do backend:
 * `_shared/gateway-por-metodo.ts`.)
 */
export function splitAtivo(settings) {
  const v = String(settings?.[CHAVE_SPLIT_ATIVO] ?? '').trim().toLowerCase();
  return v === 'true';
}

/** O gateway padrão (o de sempre). */
export function gatewayPadrao(settings) {
  return normalizarGateway(settings?.[CHAVE_ACTIVE_GATEWAY]) ?? GATEWAY_PADRAO;
}

/**
 * Onde a divisão vale.
 *
 * Padrão: 'v2' (só no checkout de teste). 'all' só quando o admin
 * escolhe explicitamente — assim o checkout V1 (que está em produção e
 * funciona) não muda de comportamento durante os testes.
 */
export function escopoDoSplit(settings) {
  const v = String(settings?.[CHAVE_SPLIT_ESCOPO] ?? '').trim().toLowerCase();
  return v === ESCOPO_ALL ? ESCOPO_ALL : ESCOPO_V2;
}

/**
 * A divisão vale para ESTA cobrança?
 *
 * `clientePediuSplit` = true quando o cliente é o checkout V2 (que manda
 * `split_gateway: true` no body).
 */
export function splitAplicavel(settings, clientePediuSplit = false) {
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
 * `opcoes.split` sobrescreve a decisão.
 */
export function gatewayDoMetodo(settings, metodo, opcoes) {
  const padrao = gatewayPadrao(settings);
  const divido =
    opcoes && opcoes.split !== undefined ? opcoes.split : splitAplicavel(settings, false);
  if (!divido) return padrao;

  const m = normalizarMetodo(metodo);
  if (!m) return padrao;

  const chave = m === 'pix' ? CHAVE_SPLIT_PIX : CHAVE_SPLIT_CARD;
  const alvo = normalizarGateway(settings?.[chave]);
  return alvo ?? padrao;
}

/**
 * Decide o gateway de uma cobrança.
 *
 * `renewal` + `gatewayAtual` → fica no gateway que a assinatura já usa
 * (trocar deixaria duas cobranças vivas).
 */
export function resolverGatewayParaPagamento({ settings, metodo, renewal, gatewayAtual, split }) {
  if (renewal) {
    const atual = normalizarGateway(gatewayAtual);
    if (atual) return atual;
  }
  return gatewayDoMetodo(settings, metodo, { split });
}

/**
 * Monta o objeto de settings a partir das linhas de `app_settings`.
 * (as linhas chegam como [{key, value}])
 */
export function settingsDeLinhas(linhas) {
  const map = {};
  for (const linha of linhas || []) {
    if (linha && linha.key) map[linha.key] = linha.value;
  }
  return map;
}
