// ============================================================================
// Camada de API da Woovi — funções puras, sem dependência de Supabase.
//
// Por que este módulo existe (e por que é separado do handler):
//
//   1. TESTÁVEL. As funções daqui rodam em Node sem servidor, então dá para
//      chamar a API REAL da Woovi num teste automatizado. O handler, por
//      depender do cliente Supabase, não roda fora do Deno.
//
//   2. UMA FONTE DE VERDADE sobre o formato do payload. O que a API aceita
//      foi verificado de verdade contra o sandbox; as descobertas estão
//      comentadas em cada função.
//
// O QUE A API DE SANDBOX REVELOU (2026-11-04)
// ---------------------------------------------
//   - `Authorization` leva o AppID CRU (sem "Bearer"). O AppID é o Base64 de
//     `clientId:clientSecret`, e o `clientId` é case-sensitive: `Client_Id_`
//     funciona, `Client_id_` devolve 401. (Ver `normalizarAppId`.)
//   - `POST /api/v1/charge`: NÃO enviar `type`. O valor `PIX_CREDIT` aciona
//     o "Woovi Parcelado" (400: "Empresa não possui a feature para criação
//     de Woovi Parcelado"). Sem `type`, a API usa o padrão.
//   - `POST /api/v1/subscriptions`: `dayGenerateCharge` tem que ser HOJE
//     quando a jornada é PAYMENT_ON_APPROVAL, e ≥ 3 dias no futuro quando é
//     ONLY_RECURRENCY. A API valida isso e diz qual regra foi furada.
//   - `dayGenerateCharge` aceita ISO date ou número do dia — nos dois casos
//     a resposta ecoa o DIA DO MÊS (`dayGenerateCharge: 4`).
//   - O bloco do mandate na resposta se chama `pixRecurring` (o OpenAPI
//     diz `pixRecurringOptions` — a resposta real manda o primeiro).
//   - O `customer` NÃO tem id. O que identifica o cliente é o
//     `correlationID` — e `GET /api/v1/customer/{correlationID}` funciona.
// ============================================================================

import {
  wooviRequest,
  type WooviConfig,
  type WooviFrequency,
} from "./woovi.ts";

// ============================================================================
// CLIENTE
// ============================================================================

export type WooviCustomer = {
  name: string;
  email?: string;
  phone?: string;
  taxID?: string;
  correlationID?: string;
  address?: Record<string, string>;
};

/**
 * Cria (ou reaproveita) o cliente na Woovi.
 *
 * O `correlationID` é a chave idempotente: enviar os mesmos dados devolve o
 * cliente existente em vez de criar outro. Por isso ele é o nosso
 * `dp-user-<user_id>` — é ele que permite reencontrar o cliente depois.
 */
export async function createCustomer(
  cfg: WooviConfig,
  payload: WooviCustomer,
): Promise<any> {
  const res = await wooviRequest<any>(cfg, "POST", "/api/v1/customer", payload);
  return res?.customer || res;
}

/** Busca o cliente pelo correlationID (a API não tem id de cliente). */
export async function getCustomer(cfg: WooviConfig, correlationId: string): Promise<any> {
  const res = await wooviRequest<any>(cfg, "GET", `/api/v1/customer/${correlationId}`);
  return res?.customer || res;
}

/**
 * Atualiza o cliente na Woovi.
 *
 * PARA QUE SERVE
 * --------------
 * A ASSINATURA (Pix Automático) só é criada se a API conseguir resolver o
 * cliente pelo `taxID` (CPF). Sem ele:
 *
 *     POST /api/v1/subscriptions
 *     -> 400 {"error":"You need to inform a customer to create a subscription"}
 *
 * (Verificado na API em 07/11/2026.)
 *
 * E o `POST /api/v1/customer` NÃO aceita corrigir isso: um cliente que já
 * existe com os mesmos dados devolve 400 "Há outro cliente com esses dados".
 *
 * O caminho é o `PATCH /api/v1/customer/{correlationID}`: ele atualiza o
 * cliente que já existe, e a assinatura passa a ser criada. (Verificado.)
 *
 * O identificador é o `correlationID` — a API não tem id de cliente.
 */
export async function updateCustomer(
  cfg: WooviConfig,
  correlationId: string,
  patch: Record<string, any>,
): Promise<any> {
  const res = await wooviRequest<any>(cfg, "PATCH", `/api/v1/customer/${correlationId}`, patch);
  return res?.customer || res;
}

/**
 * Procura um cliente existente pelo CPF.
 *
 * POR QUE ISSO EXISTE
 * ------------------
 * A criação de cliente na Woovi NÃO é idempotente: se já existe um cliente
 * com os mesmos dados, o `POST /api/v1/customer` devolve
 *
 *     400 {"error":"Há outro cliente com esses dados"}
 *
 * — mesmo que o `correlationID` seja o mesmo. E o `GET /api/v1/customer`
 * ignora qualquer query param (não existe filtro por taxID na API), então a
 * busca é feita listando e filtrando aqui.
 *
 * Sem isso, a SEGUNDA compra do mesmo usuário travaria — por exemplo, se a
 * gravação do `users.customer_id_woovi` tivesse falhado, ou se o cadastro
 * tivesse sido feito na mão no painel da Woovi.
 */
export async function findCustomerByTaxID(
  cfg: WooviConfig,
  taxID: string,
  maxPaginas = 20,
): Promise<any | null> {
  const alvo = String(taxID || "").replace(/\D/g, "");
  if (!alvo) return null;

  const POR_PAGINA = 100;
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const skip = pagina * POR_PAGINA;
    const res = await wooviRequest<any>(
      cfg,
      "GET",
      `/api/v1/customer?limit=${POR_PAGINA}&skip=${skip}`,
    );
    const clientes = res?.customers || [];
    if (!clientes.length) return null;

    const achado = clientes.find((c: any) => {
      const doCliente = c?.taxID?.taxID || c?.taxID;
      return String(doCliente || "").replace(/\D/g, "") === alvo;
    });
    if (achado) return achado;

    if (!res?.pageInfo?.hasNextPage) return null;
  }
  return null;
}

// ============================================================================
// COBRANÇA AVULSA (Pix)
// ============================================================================

export type WooviCharge = {
  identifier: string;
  brCode: string | null;
  qrCodeImage: string | null;
  paymentLinkUrl: string | null;
  status: string;
  globalID: string | null;
  value: number;
};

/**
 * Cria uma cobrança Pix avulsa.
 *
 * NÃO ENVIAR `type`. Ver a nota no topo do arquivo: `PIX_CREDIT` dispara o
 * "Woovi Parcelado" e a API recusa para quem não tem a feature.
 */
export async function createCharge(
  cfg: WooviConfig,
  args: {
    valueCents: number;
    correlationId: string;
    comment: string;
    customer: Record<string, any>;
  },
): Promise<WooviCharge> {
  const res = await wooviRequest<any>(cfg, "POST", "/api/v1/charge", {
    value: args.valueCents,
    correlationID: args.correlationId,
    comment: args.comment,
    customer: args.customer,
  });

  const charge = res?.charge || res;
  const identifier = charge?.identifier || charge?.globalID || charge?.id;

  if (!identifier) {
    throw new Error("Cobrança criada sem identificador de retorno.");
  }
  if (!charge?.brCode) {
    throw new Error("Cobrança criada sem código Pix (brCode).");
  }

  return {
    identifier,
    brCode: charge.brCode,
    qrCodeImage: charge.qrCodeImage || null,
    paymentLinkUrl: charge.paymentLinkUrl || null,
    status: charge.status || "ACTIVE",
    globalID: charge.globalID || null,
    value: Number(charge.value || args.valueCents),
  };
}

// ============================================================================
// PIX AUTOMÁTICO (mandato de recorrência)
// ============================================================================

export type WooviMandate = {
  globalID: string;
  recurrencyId: string | null;
  emv: string | null;
  status: string;
  journey: string;
  frequency: WooviFrequency;
  paymentLinkUrl: string | null;
};

/**
 * Cria o mandate de Pix Automático.
 *
 * `dayGenerateCharge`:
 *   - PAYMENT_ON_APPROVAL → o dia do mês de HOJE (a API exige "today");
 *   - ONLY_RECURRENCY     → a data ISO do próximo vencimento, que precisa
 *                           estar ≥ 3 dias no futuro (a API exige).
 *
 * A API ecoa o resultado como DIA DO MÊS, então mandar a ISO date também
 * funciona e fixa o dia da renovação.
 */
export async function createPixAutomatic(
  cfg: WooviConfig,
  args: {
    valueCents: number;
    correlationId: string;
    comment: string;
    customer: Record<string, any>;
    frequency: WooviFrequency;
    dayGenerateCharge: number | string;
    dayDue: number;
    journey: "PAYMENT_ON_APPROVAL" | "ONLY_RECURRENCY";
    retryPolicy: string;
  },
): Promise<WooviMandate> {
  const res = await wooviRequest<any>(cfg, "POST", "/api/v1/subscriptions", {
    name: "DividePass",
    value: args.valueCents,
    comment: args.comment,
    correlationID: args.correlationId,
    type: "PIX_RECURRING",
    frequency: args.frequency,
    dayGenerateCharge: args.dayGenerateCharge,
    dayDue: args.dayDue,
    customer: args.customer,
    pixRecurringOptions: {
      journey: args.journey,
      retryPolicy: args.retryPolicy,
    },
  });

  const sub = res?.subscription || res;
  const globalID = sub?.globalID || sub?.id;

  if (!globalID) {
    throw new Error("Assinatura Pix Automático criada sem globalID.");
  }

  // O nome do bloco difere entre a documentação (`pixRecurring`) e o schema
  // do OpenAPI (`pixRecurringOptions`). Lemos os dois.
  const recurring = sub?.pixRecurring || sub?.pixRecurringOptions || {};

  return {
    globalID,
    recurrencyId: recurring.recurrencyId || null,
    emv: recurring.emv || null,
    // O STATUS DO MANDATO não vem na criação: a assinatura vem como
    // "ACTIVE" (quer dizer "a assinatura existe"), mas o pagador ainda não
    // autorizou nada. Quem manda a resposta é o webhook
    // (PIX_AUTOMATIC_APPROVED / PIX_AUTOMATIC_REJECTED).
    status: recurring.status || "CREATED",
    journey: recurring.journey || args.journey,
    frequency: args.frequency,
    paymentLinkUrl: sub?.paymentLinkUrl || sub?.paymentLink || null,
  };
}

/** Consulta a assinatura (usado no polling e na reconciliação). */
export async function getSubscription(cfg: WooviConfig, globalID: string): Promise<any> {
  const res = await wooviRequest<any>(cfg, "GET", `/api/v1/subscriptions/${globalID}`);
  return res?.subscription || res;
}

/** Lista as parcelas de uma assinatura (usado no polling). */
export async function listInstallments(cfg: WooviConfig, globalID: string): Promise<any[]> {
  const res = await wooviRequest<any>(cfg, "GET", `/api/v1/subscriptions/${globalID}/installments`);
  return res?.installments || [];
}

/** Cancela o mandate (usado quando a assinatura é cancelada). */
export async function cancelSubscription(cfg: WooviConfig, globalID: string): Promise<void> {
  await wooviRequest<any>(cfg, "PUT", `/api/v1/subscriptions/${globalID}/cancel`, {});
}

// ============================================================================
// COBRANÇA DE PARCELA (o "forçar o pagamento" da recorrência)
// ============================================================================

/**
 * Cobra UMA parcela de uma assinatura de Pix Automático que JÁ EXISTE.
 *
 * É o que permite o pagamento forçado: quando a recorrência falha (a pessoa
 * não tinha dinheiro no vencimento), ela entra no app e paga agora. A
 * cobrança é da PARCELA que já existe, da assinatura que já existe — nenhuma
 * assinatura nova é criada (senão a pessoa acabaria com várias recorrências
 * de PIX Automático e mais de uma cobrança por ciclo).
 *
 *   POST /api/v1/installments/{id}/cobr        → cria a cobrança da parcela
 *   POST /api/v1/installments/{id}/cobr/retry  → refaz uma cobrança que falhou
 *
 * O `value` é opcional: sem ele a Woovi cobra o valor da parcela.
 */
export async function createInstallmentCharge(
  cfg: WooviConfig,
  args: { installmentId: string; valueCents?: number; retry?: boolean },
): Promise<WooviCharge> {
  const caminho = args.retry
    ? `/api/v1/installments/${args.installmentId}/cobr/retry`
    : `/api/v1/installments/${args.installmentId}/cobr`;

  const payload: Record<string, any> = {};
  if (typeof args.valueCents === "number" && args.valueCents > 0) {
    payload.value = args.valueCents;
  }

  const res = await wooviRequest<any>(cfg, "POST", caminho, payload);
  const charge = res?.charge || res?.cobr || res;
  const identifier = charge?.identifier || charge?.globalID || charge?.id;

  if (!identifier) {
    throw new Error("Cobrança da parcela criada sem identificador de retorno.");
  }

  return {
    identifier,
    brCode: charge?.brCode || null,
    qrCodeImage: charge?.qrCodeImage || null,
    paymentLinkUrl: charge?.paymentLinkUrl || null,
    status: charge?.status || "ACTIVE",
    globalID: charge?.globalID || null,
    value: Number(charge?.value || args.valueCents || 0),
  };
}

/**
 * A parcela que ainda está para ser paga.
 *
 * A Woovi cria as parcelas de forma incremental: a última é a que está
 * `SCHEDULED` (agendada para o próximo vencimento). É nela que a cobrança
 * forçada é feita.
 */
export function parcelaEmAberto(parcelas: any[]): any | null {
  const lista = Array.isArray(parcelas) ? parcelas : [];
  if (!lista.length) return null;

  const naoPagas = lista.filter((p) => {
    const st = String(p?.status || p?.cobr?.status || "").toUpperCase();
    return st !== "COMPLETED" && st !== "CANCELLED" && st !== "EXPIRED";
  });

  return naoPagas[naoPagas.length - 1] || lista[lista.length - 1] || null;
}
