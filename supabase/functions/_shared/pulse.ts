// ============================================================================
// CLIENTE DA API DE REVENDA DA PULSE CODING
// ============================================================================
//
// Por que este arquivo existe
// ---------------------------
// A API da Pulse é um endpoint único com um corpo JSON que sempre traz
// "action". O lado perigoso dela NÃO é o formato da requisição — é o
// TRATAMENTO DE ERRO, porque o status HTTP sozinho não diz o que aconteceu:
//
//   HTTP 400  → "Saldo insuficiente" (code: saldo_insuficiente) OU dado inválido
//   HTTP 404  → "Pacote não existe" (code: pacote_inexistente) OU "Order not found"
//               (sem `code` nenhum!)
//   HTTP 409  → "Sem estoque" (code: sem_estoque)
//   HTTP 410  → pacote antigo / indisponível
//
// Ou seja: o discriminador real é o CAMPO `code` do corpo, com o status HTTP
// como segunda pista. Este módulo traduz isso em `PulseError.code`, para o
// resto do sistema decidir (remapear, avisar o admin, tentar de novo) sem
// precisar conhecer a API.
//
// REGRAS QUE ESTE MÓDULO CUMPRE
// -------------------------------
// 1. A chave vive SÓ no ambiente (`PULSE_API_KEY`). Ela nunca é logada, nunca
//    volta em erro e nunca entra em resposta. Este módulo não tem nenhum
//    `console.log` do valor da chave — nem em caso de exceção.
// 2. Timeout de 30 s em TODA chamada (AbortController), para uma edge function
//    não ficar pendurada esperando a Pulse.
// 3. `create_order` NUNCA é Called com um `external_id` novo em retry: quem
//    repete é o chamador, com o MESMO external_id. Aqui o retry automático
//    existe só para erro de rede/429/503, onde repetir o MESMO payload é seguro
//    porque a API trata external_id repetido como duplicata (não cobra de novo).
// 4. Nenhum log com o corpo bruto da resposta de pedido — ele traz email e
//    senha da conta entregue. O log só registra status, código e ids.
// ============================================================================

/** Endpoint padrão. Pode ser trocado por PULSE_API_URL (sem segredo). */
export const PULSE_API_URL =
  Deno.env.get("PULSE_API_URL") ??
  "https://nepatnfgqlcvunmrpddr.supabase.co/functions/v1/reseller-api";

/** Timeout padrão de qualquer chamada à Pulse. */
export const PULSE_TIMEOUT_MS = 30_000;

/** Quantas vezes repetir em erro de rede / 429 / 503. */
const PULSE_MAX_TENTATIVAS = 3;

// ---------------------------------------------------------------------------
// TIPOS
// ---------------------------------------------------------------------------

export type PulseErrorCode =
  | "dados_invalidos"
  | "chave_invalida"
  | "sem_permissao"
  | "saldo_insuficiente"
  | "sem_estoque"
  | "conflito"
  | "pacote_inexistente"
  | "pacote_antigo"
  | "pedido_inexistente"
  | "limite_requisicoes"
  | "servico_indisponivel"
  | "timeout"
  | "rede"
  | "resposta_invalida"
  | "desconhecido";

export interface PulseErrorOptions {
  status?: number;
  code?: PulseErrorCode;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

/**
 * Erro tipado da API da Pulse.
 *
 * `code` é o campo que o resto do sistema usa para decidir. `status` fica
 * disponível para diagnóstico, mas NUNCA deve ser a única condição testada.
 */
export class PulseError extends Error {
  readonly status: number;
  readonly code: PulseErrorCode;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(message: string, options: PulseErrorOptions = {}) {
    super(message);
    this.name = "PulseError";
    this.status = options.status ?? 0;
    this.code = options.code ?? "desconhecido";
    this.details = options.details ?? {};
    this.retryable = options.retryable ?? false;
  }

  /** O pacote sumiu do catálogo? Precisa de remapeamento manual. */
  get precisaRemapear(): boolean {
    return this.code === "pacote_inexistente" || this.code === "pacote_antigo";
  }

  /** Vale a pena tentar de novo sozinho? */
  get deveRepetir(): boolean {
    return this.retryable;
  }
}

export interface PulsePackage {
  id: string;
  title: string;
  description?: string;
  category?: string;
  /** Preço de venda ao consumidor final (é o que a Pulse cobra de quem compra). */
  original_price?: number;
  /** Preço de revenda: o que EU pago na Pulse por este pacote. */
  price?: number;
  base_price?: number;
  discount_pct?: number;
  stock?: number;
  automatic_stock?: number;
  purchase_capacity?: number;
  available_stock?: number;
  /** "automatic" | "manual" | "unavailable" */
  availability?: string;
  /** "automatica" | "manual" */
  delivery?: string;
  orderable_via_api?: boolean;
  in_stock?: boolean;
  available?: boolean;
  credits?: number;
  credit_amount?: number;
  features?: string[];
  min_quantity?: number;
  max_quantity?: number;
  [k: string]: unknown;
}

export interface PulseAccount {
  email?: string;
  password?: string;
  credits?: number;
  [k: string]: unknown;
}

export interface PulseDelivery {
  /** Contas prontas (e-mail + senha). Pode vir mais de uma. */
  accounts?: PulseAccount[];
  /** Link de ativação/entrega (ex.: ChatGPT Go, Gemini). */
  delivery_link?: string;
  /** Chave de licença. */
  license_key?: string;
  /** Código de acesso (ex.: Claude). */
  cloud_code_key?: string;
  [k: string]: unknown;
}

export interface PulseOrder {
  id?: string;
  order_id?: string;
  status?: string;
  external_id?: string;
  delivery?: PulseDelivery;
  price?: number;
  created_at?: string;
  [k: string]: unknown;
}

export interface PulsePingResult {
  ok: boolean;
  pong?: boolean;
  api_version?: string;
  server_time?: string;
  reseller_email?: string;
  actions?: string[];
}

export interface PulseBalanceResult {
  ok: boolean;
  /** Saldo disponível para pedidos. */
  balance?: number;
  reseller_balance?: number;
  purchase_balance?: number;
  available_for_orders?: number;
  email?: string;
}

export interface PulsePackagesResult {
  ok: boolean;
  packages: PulsePackage[];
  balance?: number;
  tier?: string;
  tier_label?: string;
  categories?: unknown;
  orderable_categories?: string[];
  delivery_method?: string;
}

export interface PulseCreateOrderInput {
  package_id: string;
  external_id: string;
  customer_name?: string;
  customer_whatsapp?: string;
  webhook_url?: string;
  /** Só valida: não cobra e não cria pedido. */
  dry_run?: boolean;
}

export interface PulseOrdersResult {
  ok: boolean;
  orders: PulseOrder[];
}

// ---------------------------------------------------------------------------
// TRADUÇÃO DE ERRO
// ---------------------------------------------------------------------------

/**
 * Descobre o `code` do corpo da resposta da Pulse.
 *
 * A API devolve `code` em texto minúsculo com underscore (ex.:
 * "saldo_insuficiente"). Quando o corpo não tem `code` (caso do "Order not
 * found"), caímos no status.
 */
function codeDoCorpo(body: any): PulseErrorCode | null {
  const raw = typeof body?.code === "string" ? body.code.trim().toLowerCase() : "";
  if (!raw) return null;

  const mapa: Record<string, PulseErrorCode> = {
    saldo_insuficiente: "saldo_insuficiente",
    insufficient_balance: "saldo_insuficiente",
    sem_estoque: "sem_estoque",
    out_of_stock: "sem_estoque",
    pacote_inexistente: "pacote_inexistente",
    package_not_found: "pacote_inexistente",
    pacote_antigo: "pacote_antigo",
    pacote_indisponivel: "pacote_antigo",
    package_gone: "pacote_antigo",
    dados_invalidos: "dados_invalidos",
    invalid_request: "dados_invalidos",
    chave_invalida: "chave_invalida",
    invalid_api_key: "chave_invalida",
    unauthorized: "sem_permissao",
    forbidden: "sem_permissao",
    limite_requisicoes: "limite_requisicoes",
    rate_limit: "limite_requisicoes",
    servico_indisponivel: "servico_indisponivel",
    service_unavailable: "servico_indisponivel",
  };

  return mapa[raw] ?? null;
}

/** Código padrão quando o corpo não diz nada (o status HTTP manda). */
function codePorStatus(status: number): PulseErrorCode {
  if (status === 400) return "dados_invalidos";
  if (status === 401) return "chave_invalida";
  if (status === 402) return "saldo_insuficiente";
  if (status === 403) return "sem_permissao";
  if (status === 404) return "pacote_inexistente";
  if (status === 409) return "conflito";
  if (status === 410) return "pacote_antigo";
  if (status === 429) return "limite_requisicoes";
  if (status === 503) return "servico_indisponivel";
  if (status >= 500) return "servico_indisponivel";
  return "desconhecido";
}

/** Esse erro vale um retry automático? */
function retryablePorStatus(status: number): boolean {
  return status === 429 || status === 503 || status >= 500;
}

// ---------------------------------------------------------------------------
// CHAVE E ASSINATURA
// ---------------------------------------------------------------------------

/**
 * Lê a chave do ambiente.
 *
 * A chave NUNCA aparece em log, erro ou resposta: quando ela falta, o erro
 * diz exatamente o que fazer, sem repetir o valor.
 */
export function pulseApiKey(): string {
  const key = (Deno.env.get("PULSE_API_KEY") ?? "").trim();
  if (!key) {
    throw new PulseError(
      "PULSE_API_KEY não configurada. Cadastre o secret no Supabase (supabase secrets set PULSE_API_KEY=...).",
      { code: "chave_invalida" },
    );
  }
  return key;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Calcula a assinatura do webhook: "sha256=" + HMAC-SHA256 do corpo CRU,
 * usando a API key como segredo.
 *
 * O corpo precisa ser o texto EXATO recebido — por isso as funções de webhook
 * leem `await req.text()` e nunca `req.json()`.
 */
export async function pulseAssinaWebhook(corpoCru: string, segredo?: string): Promise<string> {
  const secret = segredo ?? pulseApiKey();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = await crypto.subtle.sign("HMAC", key, encoder.encode(corpoCru));
  return `sha256=${hex(assinatura)}`;
}

/**
 * Confere a assinatura do webhook em tempo constante.
 *
 * Calcula o HMAC esperado do corpo CRU e compara com o header recebido byte a
 * byte, acumulando a diferença — sem sair no primeiro caractere diferente.
 */
export async function pulseConfereAssinatura(
  corpoCru: string,
  header: string | null,
  segredo?: string,
): Promise<boolean> {
  if (!header) return false;
  const recebida = header.trim();
  const prefixo = "sha256=";
  if (!recebida.startsWith(prefixo)) return false;

  let esperada: string;
  try {
    esperada = await pulseAssinaWebhook(corpoCru, segredo);
  } catch {
    return false;
  }

  const a = new TextEncoder().encode(esperada);
  const b = new TextEncoder().encode(recebida);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// REQUISIÇÃO
// ---------------------------------------------------------------------------

interface PulseRequestOptions {
  timeoutMs?: number;
  /** Nº máximo de tentativas (inclui a primeira). */
  tentativas?: number;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Chamada crua à API da Pulse.
 *
 * Devolve o corpo JSON já parseado. Erros viram `PulseError` com `code`
 * pronto para decisão.
 */
export async function pulseRequest(
  action: string,
  payload: Record<string, unknown> = {},
  options: PulseRequestOptions = {},
): Promise<any> {
  const timeoutMs = options.timeoutMs ?? PULSE_TIMEOUT_MS;
  const tentativas = options.tentativas ?? PULSE_MAX_TENTATIVAS;
  const url = PULSE_API_URL;
  const key = pulseApiKey();

  let ultimoErro: PulseError | null = null;

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resposta = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action, ...payload }),
        signal: controller.signal,
      });

      const texto = await resposta.text();
      let corpo: any = null;
      try {
        corpo = texto ? JSON.parse(texto) : null;
      } catch {
        corpo = null;
      }

      if (resposta.ok && corpo?.ok !== false) {
        return corpo ?? { ok: true };
      }

      // A API respondeu com erro (HTTP ou ok:false).
      const mensagem =
        (typeof corpo?.error === "string" && corpo.error.trim()) ||
        `A API da Pulse respondeu ${resposta.status}.`;
      const code = codeDoCorpo(corpo) ?? codePorStatus(resposta.status);
      const erro = new PulseError(mensagem, {
        status: resposta.status,
        code,
        details: {
          action,
          needed: corpo?.needed ?? null,
          balance: corpo?.balance ?? null,
          available: corpo?.available ?? null,
          package_id: corpo?.package_id ?? null,
          retry_after: resposta.headers.get("retry-after"),
        },
        retryable: retryablePorStatus(resposta.status),
      });

      if (!erro.retryable || tentativa === tentativas) throw erro;

      ultimoErro = erro;
      // Backoff: 1s, 2s, 4s… (e um respiro maior no 429).
      const espera429 = code === "limite_requisicoes" ? 5000 : 0;
      await espera(1000 * 2 ** (tentativa - 1) + espera429);
      continue;
    } catch (e: any) {
      if (e instanceof PulseError) {
        if (!e.retryable || tentativa === tentativas) throw e;
        ultimoErro = e;
        await espera(1000 * 2 ** (tentativa - 1));
        continue;
      }

      // Abort por timeout?
      const nome = String(e?.name ?? "");
      const mensagem = nome === "AbortError"
        ? `A API da Pulse não respondeu em ${Math.round(timeoutMs / 1000)}s.`
        : "Falha de rede ao falar com a API da Pulse.";

      const erro = new PulseError(mensagem, {
        code: nome === "AbortError" ? "timeout" : "rede",
        status: 0,
        details: { action },
        retryable: true,
      });

      if (tentativa === tentativas) throw erro;
      ultimoErro = erro;
      await espera(1000 * 2 ** (tentativa - 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw ultimoErro ?? new PulseError("Falha desconhecida ao chamar a API da Pulse.", { code: "desconhecido" });
}

// ---------------------------------------------------------------------------
// AÇÕES
// ---------------------------------------------------------------------------

/** Teste de conexão. Não cobra nada. */
export async function pulsePing(): Promise<PulsePingResult> {
  return await pulseRequest("ping", {}, { tentativas: 2 });
}

/** Saldo disponível para pedidos. */
export async function pulseGetBalance(): Promise<PulseBalanceResult> {
  return await pulseRequest("get_balance", {}, { tentativas: 2 });
}

/** Catálogo de pacotes. */
export async function pulseListPackages(): Promise<PulsePackagesResult> {
  const res = await pulseRequest("list_packages", {}, { tentativas: 2 });
  const pacotes = Array.isArray(res?.packages) ? res.packages : [];
  return { ...res, packages: pacotes };
}

/**
 * Compra (ou, com `dry_run`, apenas valida).
 *
 * IMPORTANTE: repetir com o MESMO `external_id` devolve o mesmo pedido com
 * `duplicate: true` e NÃO cobra de novo. Nunca gere um `external_id` novo
 * para o mesmo pedido.
 */
export async function pulseCreateOrder(input: PulseCreateOrderInput): Promise<any> {
  if (!input?.package_id) {
    throw new PulseError("package_id é obrigatório para create_order.", { code: "dados_invalidos" });
  }
  if (!input?.external_id) {
    throw new PulseError("external_id é obrigatório para create_order.", { code: "dados_invalidos" });
  }

  const payload: Record<string, unknown> = {
    package_id: input.package_id,
    external_id: input.external_id,
  };
  if (input.customer_name) payload.customer_name = input.customer_name;
  if (input.customer_whatsapp) payload.customer_whatsapp = input.customer_whatsapp;
  if (input.webhook_url) payload.webhook_url = input.webhook_url;
  if (input.dry_run) payload.dry_run = true;

  return await pulseRequest("create_order", payload);
}

/** Status e entrega de um pedido (por id da Pulse ou pelo meu external_id). */
export async function pulseCheckStatus(params: {
  order_id?: string;
  external_id?: string;
}): Promise<any> {
  if (!params?.order_id && !params?.external_id) {
    throw new PulseError("Informe order_id ou external_id para check_status.", { code: "dados_invalidos" });
  }
  const payload: Record<string, unknown> = {};
  if (params.order_id) payload.order_id = params.order_id;
  if (params.external_id) payload.external_id = params.external_id;

  try {
    return await pulseRequest("check_status", payload);
  } catch (e: any) {
    // A Pulse responde 404 sem `code` quando o pedido não existe
    // ({"error":"Order not found"}). Sem este ajuste, o erro seria lido como
    // "pacote inexistente" — e o remapeamento do catálogo dispararia errado.
    if (e instanceof PulseError && e.status === 404 && e.code === "pacote_inexistente") {
      throw new PulseError(e.message, {
        status: 404,
        code: "pedido_inexistente",
        details: e.details,
      });
    }
    throw e;
  }
}

/** Meus pedidos na Pulse. */
export async function pulseListOrders(filters: {
  limit?: number;
  status?: string;
  external_id?: string;
} = {}): Promise<PulseOrdersResult> {
  const payload: Record<string, unknown> = {};
  if (filters.limit) payload.limit = filters.limit;
  if (filters.status) payload.status = filters.status;
  if (filters.external_id) payload.external_id = filters.external_id;

  const res = await pulseRequest("list_orders", payload);
  const pedidos = Array.isArray(res?.orders) ? res.orders : [];
  return { ...res, orders: pedidos };
}

// ---------------------------------------------------------------------------
// HELPERS DE LEITURA DA ENTREGA
// ---------------------------------------------------------------------------

/** O pedido já tem algo entregue? */
export function pulseTemEntrega(pedido: any): boolean {
  const d = pedido?.delivery;
  if (!d) return false;
  if (Array.isArray(d.accounts) && d.accounts.length > 0) return true;
  if (typeof d.delivery_link === "string" && d.delivery_link.trim()) return true;
  if (typeof d.license_key === "string" && d.license_key.trim()) return true;
  if (typeof d.cloud_code_key === "string" && d.cloud_code_key.trim()) return true;
  return false;
}

/** Status do pedido normalizado. */
export function pulseStatus(pedido: any): string {
  return String(pedido?.status ?? "").trim().toLowerCase();
}

/** O pedido terminou com erro (e não com entrega)? */
export function pulseEhErro(pedido: any): boolean {
  const s = pulseStatus(pedido);
  return ["error", "erro", "failed", "refunded", "revertedido", "cancelled", "canceled", "expired", "expirado"].includes(s);
}

/** O pedido ainda está em andamento? */
export function pulseEmAndamento(pedido: any): boolean {
  const s = pulseStatus(pedido);
  return !s || ["pending", "pendente", "processing", "processando", "paid", "pago"].includes(s);
}
