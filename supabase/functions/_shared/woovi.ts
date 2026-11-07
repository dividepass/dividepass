// ============================================================================
// Cliente HTTP da Woovi (API v1) + helpers de domínio do Pix Automático.
//
// Este é o ÚNICO lugar do projeto que sabe falar com a Woovi. O handler de
// criação (`create-payment/handlers/woovi.ts`), o webhook (`woovi-webhook`) e o
// polling (`check-woovi-tx`) importam daqui, para que:
//
//   - a URL base (produção x sandbox) nunca divirja entre os três;
//   - o header de autenticação nunca seja montado de dois jeitos diferentes;
//   - o mapeamento de status da Woovi para "aprovado / recusado" seja um só.
//
// AUTENTICAÇÃO (armadilha nº 1)
// ---------------------------------------------------------------------------
// A Woovi NÃO usa "Bearer". O AppID vai cru no header `Authorization`:
//
//     Authorization: <AppID>
//
// A documentação oficial diz: "Não utilize o prefixo `Bearer`. Envie o valor
// bruto do `AppID` no header." — developers.woovi.com/docs/apis/api-getting-started
//
// Endereços: produção https://api.woovi.com | sandbox https://api.woovi-sandbox.com
//
// DINHEIRO
// ---------------------------------------------------------------------------
// TODOS os valores monetários da API Woovi são em CENTAVOS (`value: 100` = R$ 1,00).
// O DividePass trabalha em REAIS. A conversão acontece em `toCents`/`fromCents`.
// ============================================================================

import { getAmbiente, type AmbienteOperacao } from "./ambiente.ts";

export const WOOVI_PROD = "https://api.woovi.com";
export const WOOVI_SANDBOX = "https://api.woovi-sandbox.com";

// ─────────────────────────────────────────────────────────────────────────────
// APPID POR AMBIENTE
// ─────────────────────────────────────────────────────────────────────────────
//
// POR QUE SÃO DOIS
// ---------------
// A Woovi tem DUAS contas separadas: a de teste (api.woovi-sandbox.com) e a
// real (api.woovi.com). Cada uma tem o seu AppID, e o AppID de uma NÃO
// funciona na outra — a API responde 401 "appID inválido".
//
// Antes, o projeto guardava UM AppID só (`woovi_app_id`) e trocava apenas a
// URL. Resultado: com o interruptor em "produção", a API real recebia o
// AppID do sandbox e recusava TODA requisição com 401 "appID inválido" —
// erro que não dá pista nenhuma do que era o problema.
//
// AGORA
// -----
//   woovi_app_id_sandbox    → AppID da conta de TESTE  (api.woovi-sandbox.com)
//   woovi_app_id_production  → AppID da conta REAL     (api.woovi.com)
//   woovi_app_id             → chave LIGADA (histórico): guardava o AppID do
//                              sandbox. Continua valendo como reserva do
//                              sandbox, para nada quebrar.
//
// O par (AppID, URL) é inseparable: cada AppID só vale na URL da sua conta.
// Por isso a escolha é feita por AMBIENTE, e nunca "o AppID de um ambiente
// com a URL do outro".
export const WOOVI_APP_ID_SANDBOX_KEY = "woovi_app_id_sandbox";
export const WOOVI_APP_ID_PRODUCTION_KEY = "woovi_app_id_production";
/** Chave legada: guardava o AppID do sandbox. Reserva do ambiente de teste. */
export const WOOVI_APP_ID_LEGACY_KEY = "woovi_app_id";

/** Frequências aceitas pelo Pix Automático. `BIMONTHLY` NÃO é suportado. */
export type WooviFrequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "SEMIANNUALLY" | "ANNUALLY";

export type WooviConfig = {
  appId: string;
  baseUrl: string;
  env: "production" | "sandbox";
};

export class WooviApiError extends Error {
  status: number;
  payload: any;
  constructor(message: string, status: number, payload?: any) {
    super(message);
    this.name = "WooviApiError";
    this.status = status;
    this.payload = payload;
  }
}

/** Reais (DividePass) → centavos (Woovi). */
export function toCents(amount: number): number {
  return Math.round(Number(amount || 0) * 100);
}

/** Centavos (Woovi) → reais (DividePass). */
export function fromCents(cents: number): number {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

/**
 * Normaliza o AppID antes de mandá-lo no header.
 *
 * POR QUE ISSO EXISTE
 * -------------------
 * O AppID da Woovi é o Base64 de `clientId:clientSecret`:
 *
 *     const appID = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
 *
 * A API resolve a application pelo `clientId` de forma CASE-SENSITIVE, e o
 * valor gravado na conta usa `Client_Id_` (I maiúsculo). Uma chave copiada
 * como `Client_id_` (i minúsculo) é recusada com 401 "appID inválido" — e o
 * erro não dá nenhuma pista de que é uma letra de diferença.
 *
 * Verificado na API de sandbox: `Client_id_` → 401, `Client_Id_` → 200.
 *
 * A normalização só troca o prefixo quando o Base64 realmente decodifica
 * para esse formato. Uma credencial que já vem certa passa intocada.
 */
export function normalizarAppId(valor: string | null | undefined): string {
  const bruto = String(valor || "").trim();
  if (!bruto) return "";

  try {
    const decodificado = atob(bruto);
    if (decodificado.includes("Client_id_")) {
      const corrigido = decodificado.replace(/Client_id_/g, "Client_Id_");
      return btoa(corrigido);
    }
  } catch {
    // Não é Base64 (ou não é decodificável neste runtime) — devolve como veio.
    return bruto;
  }

  return bruto;
}

/**
 * Lê a configuração da Woovi do `app_settings`.
 *
 * O AMBIENTE (produção x sandbox) NÃO é uma configuração da Woovi: é o
 * interruptor global do sistema, compartilhado por todos os gateways que
 * têm versão de teste. Ele vem de `app_settings.ambiente` ou da variável de
 * ambiente `AMBIENTE` (que tem precedência — é assim que a instância de
 * staging da VPS se declara sandbox).
 *
 * Um único interruptor, um único lugar para trocar.
 *
 * O APPID, ao contrário, É específico da Woovi: cada conta (teste e real) tem
 * o seu. Por isso o AppID vem da chave que combina com o ambiente — nunca
 * de uma chave "genérica". Ver `WOOVI_APP_ID_SANDBOX_KEY` /
 * `WOOVI_APP_ID_PRODUCTION_KEY`.
 */
export function getWooviConfig(settings: Record<string, string>): WooviConfig {
  const ambiente = getAmbiente(settings);
  return {
    appId: normalizarAppId(appIdDoAmbiente(settings, ambiente)),
    baseUrl: ambiente === "sandbox" ? WOOVI_SANDBOX : WOOVI_PROD,
    env: ambiente,
  };
}

/**
 * Devolve o AppID que vale para um ambiente.
 *
 * Sandbox: `woovi_app_id_sandbox` e, se estiver vazio, a chave legada
 * `woovi_app_id` (que sempre guardou o AppID de teste).
 *
 * Produção: SÓ `woovi_app_id_production`. Sem reserva: cair no AppID do
 * sandbox aqui reproduziria o 401 "appID inválido" — e, pior, poderia
 * mandar uma cobrança de verdade para uma conta errada se os dois AppIDs
 * fossem válidos. Quando falta, quem chama mostra uma mensagem clara.
 */
export function appIdDoAmbiente(
  settings: Record<string, string> | null | undefined,
  ambiente: AmbienteOperacao,
): string {
  const map = settings || {};
  if (ambiente === "sandbox") {
    return String(map[WOOVI_APP_ID_SANDBOX_KEY] || map[WOOVI_APP_ID_LEGACY_KEY] || "").trim();
  }
  return String(map[WOOVI_APP_ID_PRODUCTION_KEY] || "").trim();
}

/**
 * Mensagem de erro pronta para a tela quando falta o AppID do ambiente.
 *
 * Diz o que falta e ONDE resolver — um 401 "appID inválido" não diz nada
 * disso (e o usuário não tem como adivinhar que o problema é a conta de
 * produção vs a de teste).
 */
export function erroAppIdAusente(ambiente: AmbienteOperacao): string {
  const rotulo = ambiente === "sandbox" ? "sandbox" : "produção";
  // "AppID do Sandbox" x "AppID de Produção" — o campo do painel.
  const campo = ambiente === "sandbox" ? "AppID do Sandbox" : "AppID de Produção";
  return (
    `Credenciais da Woovi (${rotulo}) não configuradas. ` +
    `Cadastre o AppID em Admin → Configurações → Woovi (campo "${campo}").`
  );
}

/**
 * Extrai a mensagem de erro do corpo da Woovi.
 *
 * Formato esperado (401 de AppID inválido):
 *   { "data": null, "errors": [ { "message": "appID inválido" } ] }
 *
 * Mas a API não é 100% consistente: às vezes vem `errors` como string, às vezes
 * vem `message` no topo. Vamos tentar todos.
 */
export function extractWooviError(payload: any, fallback: string): string {
  if (!payload) return fallback;
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const first = payload.errors[0];
    if (typeof first === "string") return first;
    if (first?.message) return String(first.message);
  }
  if (typeof payload.errors === "string") return payload.errors;
  if (payload.message) return String(payload.message);
  if (payload.error) return String(payload.error);
  if (payload.detail) return String(payload.detail);
  return fallback;
}

/**
 * Chamada autenticada na API Woovi.
 *
 * Lança `WooviApiError` em qualquer resposta não-2xx, para que cada chamador
 * decida o que fazer (registrar tentativa, responder 4xx, etc.).
 */
export async function wooviRequest<T = any>(
  cfg: WooviConfig,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: any,
): Promise<T> {
  if (!cfg.appId) {
    throw new WooviApiError("Woovi não configurado (AppID ausente).", 500);
  }

  const url = `${cfg.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    // AppID CRU — sem "Bearer". (ver cabeçalho deste arquivo)
    "Authorization": cfg.appId,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  const started = Date.now();
  let resp: Response;
  try {
    resp = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e: any) {
    throw new WooviApiError(`Falha de rede ao chamar a Woovi: ${e?.message || e}`, 0);
  }

  const raw = await resp.text();
  let parsed: any = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }
  }

  console.log(
    `[woovi] ${method} ${path} -> ${resp.status} (${Date.now() - started}ms) ${raw.substring(0, 400)}`,
  );

  if (!resp.ok) {
    throw new WooviApiError(
      extractWooviError(parsed, `Woovi respondeu ${resp.status}`),
      resp.status,
      parsed,
    );
  }

  return (parsed ?? {}) as T;
}

// ============================================================================
// CICLO DE COBRANÇA
// ============================================================================

/**
 * Mapeia o ciclo do DividePass para a frequência do Pix Automático.
 *
 * O Pix Automático aceita: WEEKLY, MONTHLY, QUARTERLY, SEMIANNUALLY, ANNUALLY.
 * `BIMONTHLY` NÃO é suportado pela Woovi.
 *
 * Ciclos do DividePass que NÃO têm equivalente (e por isso ficam SEM
 * Pix Automático): `custom` (N meses arbitrário) e `days` (ciclo em dias).
 * Nesses casos a recorrência continua no cron do `process-recurring-billing`.
 */
export function wooviFrequencyForCycle(cycle: string): WooviFrequency | null {
  switch (cycle) {
    case "monthly":
      return "MONTHLY";
    case "quarterly":
      return "QUARTERLY";
    case "semiannual":
      return "SEMIANNUALLY";
    case "annual":
      return "ANNUALLY";
    default:
      return null;
  }
}

/** Quantos meses o ciclo cobre (usado para calcular a data da próxima cobrança). */
export function wooviCycleMonths(cycle: string, customMonths?: number | null): number {
  switch (cycle) {
    case "quarterly":
      return 3;
    case "semiannual":
      return 6;
    case "annual":
      return 12;
    case "custom":
      return Number(customMonths) || 1;
    default:
      return 1;
  }
}

/**
 * Calcula a data da próxima cobrança do DividePass.
 *
 * IMPORTANTE: espelha EXATAMENTE o cálculo que já existe em
 * `create-payment/handlers/iopay.ts` e em `check-iopay-tx/index.ts`:
 *
 *     const nextChargeAt = new Date();
 *     nextChargeAt.setMonth(nextChargeAt.getMonth() + cycleMonths);
 *
 * O `dayGenerateCharge` do Pix Automático é o dia do mês da cobrança. Como o
 * DividePass cobra sempre "mesmo dia do mês em que a pessoa entrou", o dia
 * gerado aqui é o mesmo dia em que `next_charge_at` cai. Se os dois divergirem,
 * o Woovi cobra num dia e o banco renewa em outro.
 *
 * DIFERENÇA EM RELAÇÃO AO CÓDIGO EXISTENTE: aqui o dia é LIMITADO ao último
 * dia do mês, em vez de transbordar. O `setMonth` do JS transborda (31 de
 * janeiro + 1 mês = 3 de março), mas no Pix Automático o dia 31 vira dia 28
 * (ou 29) em fevereiro. Sem o limite, o `next_charge_at` cairia em março e a
 * Woovi cobraria em fevereiro — o painel mostraria uma data e o dinheiro sairia
 * em outra.
 */
export function nextChargeDate(
  cycle: string,
  customMonths?: number | null,
  customDays?: number | null,
  base: Date = new Date(),
): Date {
  const d = new Date(base.getTime());
  if (cycle === "days") {
    d.setDate(d.getDate() + (Number(customDays) || 1));
    return d;
  }

  const months = wooviCycleMonths(cycle, customMonths);
  const dia = d.getDate();

  // `setDate(1)` antes do `setMonth` evita o transbordo (31 de janeiro + 1
  // mês não pode virar 3 de março).
  d.setDate(1);
  d.setMonth(d.getMonth() + months);

  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimoDia));
  return d;
}

/**
 * Dia do mês (1..31) em que a cobrança deve ser gerada.
 *
 * Na Jornada 3 (PAYMENT_ON_APPROVAL) o que importa é o dia de HOJE: é ele
 * que faz a primeira cobrança sair na hora, em vez de só no mês que vem.
 */
export function chargeDayOfMonth(date: Date): number {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return Math.min(date.getDate(), lastDay);
}

// ============================================================================
// STATUS
// ============================================================================

/**
 * A Woovi usa status em CAIXA ALTA: `ACTIVE`, `COMPLETED`, `EXPIRED`,
 * `APPROVED`, `REJECTED`, `CREATED`...
 *
 * Uma assinatura Pix Automático aprovada tem `pixRecurringOptions.status`
 * = `APPROVED`; um mandate rejeitado = `REJECTED`. Uma charge paga = `COMPLETED`.
 */
export function isApprovedStatus(status: string | null | undefined): boolean {
  const s = String(status || "").toUpperCase().trim();
  return ["COMPLETED", "APPROVED", "PAID", "SETTLED", "CONFIRMED", "SUCCESS"].includes(s);
}

export function isRejectedStatus(status: string | null | undefined): boolean {
  const s = String(status || "").toUpperCase().trim();
  return ["REJECTED", "EXPIRED", "FAILED", "CANCELED", "CANCELLED", "DENIED", "REFUNDED"].includes(s);
}

// ============================================================================
// CORRELATION ID
// ============================================================================

/**
 * `correlationID` é a chave que amarra a resposta da Woovi com o nosso banco.
 * Ele volta no webhook, e é por ele que encontramos a assinatura/cobrança.
 *
 * Formato: `{group_id}:{user_id}:{type}:{kind}`
 *   - `kind = "charge"` → cobrança avulsa (fatura, adesão, combined)
 *   - `kind = "rec"`    → assinatura Pix Automático (e suas parcelas)
 *
 * O `kind` existe porque o fluxo `combined` cria UM charge e UM mandate: sem
 * ele, o webhook não saberia qual dos dois eventos posteriores deve ser confirmado.
 */
export function buildCorrelationId(groupId: string, userId: string, type: string, kind: "charge" | "rec"): string {
  return `${groupId}:${userId}:${type}:${kind}`;
}

export type ParsedCorrelationId = {
  groupId: string;
  userId: string;
  type: string;
  kind: "charge" | "rec";
};

/** Faz o parse do correlationID. Devolve `null` se não for do nosso formato. */
export function parseCorrelationId(correlationId: string | null | undefined): ParsedCorrelationId | null {
  const parts = String(correlationId || "").split(":");
  if (parts.length !== 4) return null;
  const [groupId, userId, type, kind] = parts;
  if (!groupId || !userId || !type) return null;
  if (kind !== "charge" && kind !== "rec") return null;
  return { groupId, userId, type, kind };
}
