// ============================================================================
// PEDIDOS "VIA PARCEIRO" — COMPRA NA PULSE E ENTREGA NO DIVIDEPASS
// ============================================================================
//
// O CAMINHO COMPLETO
// ------------------
//   1. O cliente paga no gateway do DividePass.
//   2. `confirm-payment` confirma o pagamento e chama
//      `processarCompraViaParceiro`.
//   3. Aqui criamos (ou reaproveitamos) o pedido em `pulse_pedidos` com um
//      `external_id` PRÓPRIO e ESTÁVEL.
//   4. Chamamos `create_order` na Pulse com esse external_id.
//   5. Se a entrega vier na hora, gravamos em `group_credentials` com
//      `assigned_to` = o comprador. Se não vier, o webhook ou o job de
//      polling traz depois.
//
// GARANTIA DE "NÃO COBRA DUAS VEZES"
// ---------------------------------
//   - `external_id` é gerado UMA vez por pedido e nunca muda. Timeout ou
//     erro de rede → repetimos com o MESMO external_id (a Pulse devolve
//     `duplicate: true` e não cobra de novo).
//   - `pulse_pedidos` tem UNIQUE (transaction_code, group_id): o replay do
//     webhook do gateway não cria um segundo pedido.
//   - Se o pedido JÁ está entregue, a função sai sem comprar de novo.
//
// NENHUMA FALHA DESTA FUNÇÃO DERROBA A CONFIRMAÇÃO DO PAGAMENTO
// -----------------------------------------------------------
//   O cliente pagou: ele tem que entrar no grupo de qualquer jeito. Se a
//   Pulse falhar, o pedido fica "pendente" e o cron/webhook tenta de novo.
//   A confirmação de pagamento NUNCA retorna erro por causa da Pulse.
// ============================================================================

import {
  PulseError,
  pulseCreateOrder,
  pulseCheckStatus,
  pulseEhErro,
  pulseEmAndamento,
  pulseTemEntrega,
  type PulseDelivery,
} from "./pulse.ts";
import { TAG_VIA_PARCEIRO, normalizarTexto } from "./pulse-catalog.ts";

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem I, O, 0, 1 — evita confusão

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

/**
 * Data em que o acesso comprado vence (YYYY-MM-DD).
 *
 * O grupo "Via Parceiro" não renova sozinho: o acesso vale pelo período do
 * pacote e, depois, o cliente renova pelo fluxo normal (que dispara uma nova
 * compra na Pulse).
 */
export function dataValidade(durationDays: number, base?: Date): string {
  const dias = Number(durationDays) || 30;
  const d = base ? new Date(base) : new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().split("T")[0];
}

/**
 * Momento exato (timestamptz) em que o acesso comprado vence.
 *
 * Vira o `renewal_due_at` da assinatura: enquanto a data não passa, o
 * cliente tem acesso; depois disso, a assinatura fica ATRASADA (7 dias de
 * carência) e aparece o card de renovação.
 */
export function instanteValidade(durationDays: number, base?: Date): string {
  const dias = Number(durationDays) || 30;
  const d = base ? new Date(base) : new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString();
}

/**
 * Id do MEU pedido na Pulse: 8 caracteres, letras e números.
 *
 * Curto de propósito: é o `external_id` que aparece no painel da Pulse e
 * precisa ser ditável por alguém no telefone.
 */
export function gerarExternalId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < bytes.length; i++) {
    id += ALFABETO[bytes[i] % ALFABETO.length];
  }
  return id;
}

// ---------------------------------------------------------------------------
// DETECÇÃO DE GRUPO "VIA PARCEIRO"
// ---------------------------------------------------------------------------

export interface ContextoViaParceiro {
  viaParceiro: boolean;
  group_id: string;
  mapeamento: any | null;
  pacote: any | null;
  /** Dias de acesso que o cliente recebe com este produto. */
  durationDays: number;
  /** Preço de revenda (custo) que a Pulse vai cobrar. */
  custo: number | null;
}

/** Normaliza a lista de tags do grupo para comparação. */
export function normalizarTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.map((t) => normalizarTexto(String(t)));
  }
  if (typeof tags === "string") {
    return tags.split(",").map((t) => normalizarTexto(t));
  }
  return [];
}

/**
 * Descobre se o grupo é "Via Parceiro" e o que ele aponta na Pulse.
 *
 * Chamado no começo da confirmação de pagamento: é o que decide se a
 * assinatura vira "compra única com prazo" (sem cobrança recorrente).
 */
export async function resolverViaParceiro(
  supabaseAdmin: any,
  group_id: string,
): Promise<ContextoViaParceiro> {
  const vazio: ContextoViaParceiro = {
    viaParceiro: false,
    group_id,
    mapeamento: null,
    pacote: null,
    durationDays: 30,
    custo: null,
  };

  if (!group_id) return vazio;

  const { data: grupo } = await supabaseAdmin
    .from("groups")
    .select("id, name, tags, service_id")
    .eq("id", group_id)
    .maybeSingle();

  if (!grupo) return vazio;

  const tagAlvo = normalizarTexto(TAG_VIA_PARCEIRO);
  if (!normalizarTags(grupo.tags).includes(tagAlvo)) return vazio;

  const { data: mapeamento } = await supabaseAdmin
    .from("pulse_mapeamentos")
    .select("*")
    .eq("group_id", group_id)
    .maybeSingle();

  if (!mapeamento) {
    // Tem a tag mas não tem mapeamento: o admin precisa remapear.
    return { ...vazio, viaParceiro: true };
  }

  const { data: pacote } = await supabaseAdmin
    .from("pulse_pacotes")
    .select("*")
    .eq("package_id", mapeamento.package_id)
    .maybeSingle();

  return {
    viaParceiro: true,
    group_id,
    mapeamento,
    pacote,
    durationDays: Number(pacote?.duration_days ?? 30) || 30,
    custo: pacote?.price != null ? Number(pacote.price) : null,
  };
}

// ---------------------------------------------------------------------------
// PEDIDO
// ---------------------------------------------------------------------------

export interface DadosPedido {
  transaction_code: string;
  group_id: string;
  user_id: string;
  package_id: string;
  service_id?: string | null;
  payment_id?: string | null;
  preco_pago?: number | null;
  custo?: number | null;
}

/**
 * Cria (ou recupera) o pedido em `pulse_pedidos`.
 *
 * O `external_id` nasce aqui e nunca mais muda: é ele que garante que uma
 * repetição não vire uma segunda cobrança.
 */
export async function garantirPedido(supabaseAdmin: any, dados: DadosPedido): Promise<any> {
  const { data: existente } = await supabaseAdmin
    .from("pulse_pedidos")
    .select("*")
    .eq("transaction_code", dados.transaction_code)
    .eq("group_id", dados.group_id)
    .maybeSingle();

  if (existente) return existente;

  const base = {
    transaction_code: dados.transaction_code,
    group_id: dados.group_id,
    user_id: dados.user_id,
    package_id: dados.package_id,
    service_id: dados.service_id ?? null,
    payment_id: dados.payment_id ?? null,
    preco_pago: dados.preco_pago ?? null,
    custo: dados.custo ?? null,
    status: "pendente",
  };

  // 5 tentativas: o external_id é aleatório e o UNIQUE pode colidir.
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const external_id = gerarExternalId();
    const { data: criado, error } = await supabaseAdmin
      .from("pulse_pedidos")
      .insert({ ...base, external_id })
      .select("*")
      .single();

    if (!error && criado) {
      await registrarEvento(supabaseAdmin, {
        pedido_id: criado.id,
        package_id: dados.package_id,
        group_id: dados.group_id,
        user_id: dados.user_id,
        tipo: "pedido_criado",
        mensagem: `Pedido ${external_id} criado para o grupo ${dados.group_id}.`,
        detalhes: { external_id, transaction_code: dados.transaction_code },
      });
      return criado;
    }

    // Colisão de external_id: tenta outro.
    const mensagem = String(error?.message ?? "");
    if (!mensagem.toLowerCase().includes("duplicate") && !mensagem.toLowerCase().includes("unique")) {
      throw new Error(`Falha ao criar o pedido na Pulse: ${mensagem}`);
    }
  }

  throw new Error("Não foi possível gerar um external_id único para o pedido.");
}

// ---------------------------------------------------------------------------
// ENTREGA
// ---------------------------------------------------------------------------

export interface EntregaClassificada {
  kind: "accounts" | "link" | "code" | "custom" | null;
  contas: Array<{ email: string; password: string; credits: number | null }>;
  link: string | null;
  license: string | null;
  cloud: string | null;
}

/**
 * Lê a entrega da Pulse e diz o QUE é.
 *
 * A Pulse devolve (pode vir mais de um):
 *   - accounts[]       → contas com e-mail, senha e créditos
 *   - delivery_link    → link de ativação/entrega
 *   - license_key      → chave de licença
 *   - cloud_code_key   → código de acesso (ex.: Claude)
 */
export function classificarEntrega(entrega: PulseDelivery | null | undefined): EntregaClassificada {
  const vazio: EntregaClassificada = { kind: null, contas: [], link: null, license: null, cloud: null };
  if (!entrega) return vazio;

  const contas = Array.isArray(entrega.accounts) ? entrega.accounts : [];
  const link = typeof entrega.delivery_link === "string" && entrega.delivery_link.trim()
    ? entrega.delivery_link.trim()
    : null;
  const license = typeof entrega.license_key === "string" && entrega.license_key.trim()
    ? entrega.license_key.trim()
    : null;
  const cloud = typeof entrega.cloud_code_key === "string" && entrega.cloud_code_key.trim()
    ? entrega.cloud_code_key.trim()
    : null;

  let kind: EntregaClassificada["kind"] = null;
  if (contas.length > 0) kind = "accounts";
  else if (link) kind = "link";
  else if (license) kind = "code";
  else if (cloud) kind = "custom";

  return {
    kind,
    contas: contas
      .map((c) => ({
        email: String(c?.email ?? "").trim(),
        password: String(c?.password ?? "").trim(),
        credits: c?.credits != null ? Number(c.credits) : null,
      }))
      .filter((c) => c.email || c.password),
    link,
    license,
    cloud,
  };
}

/**
 * Grava a entrega para o comprador.
 *
 * Vai para `pulse_entregas` (e NÃO para `group_credentials`) por três
 * motivos:
 *   1. `group_credentials` é lida pelo navegador via RLS — um cliente não
 *      pode enxergar a conta de outro;
 *   2. o trigger `release_credential` do banco desaloca a credencial quando o
 *      membro sai do grupo, o que abriria a conta privada para o resto do
 *      grupo (a guarda está no SQL da migration);
 *   3. a conta da Pulse é do CLIENTE, não do grupo — o grupo é só a vitrine.
 *
 * Na renovação, a entrega anterior do mesmo comprador no mesmo grupo é
 * removida: a conta antiga venceu e não pode continuar aparecendo.
 */
export async function aplicarEntrega(
  supabaseAdmin: any,
  params: {
    group_id: string;
    user_id: string;
    entrega: PulseDelivery;
    pedido?: any;
    package_id?: string | null;
    package_title?: string | null;
    expira_em?: string | null;
  },
): Promise<{ linhas: number; tipo: string | null }> {
  const { group_id, user_id, entrega } = params;
  const info = classificarEntrega(entrega);
  if (!info.kind) return { linhas: 0, tipo: null };

  // Renova: a entrega anterior do comprador sai de cena.
  const { error: errDel } = await supabaseAdmin
    .from("pulse_entregas")
    .delete()
    .eq("group_id", group_id)
    .eq("user_id", user_id);
  if (errDel) {
    console.error("[pulse] erro ao remover entrega anterior:", errDel.message);
  }

  const agora = new Date().toISOString();
  const base: Record<string, unknown> = {
    group_id,
    user_id,
    pedido_id: params.pedido?.id ?? null,
    package_id: params.package_id ?? null,
    package_title: params.package_title ?? null,
    expira_em: params.expira_em ?? null,
    created_at: agora,
  };
  const linhas: any[] = [];

  if (info.kind === "accounts") {
    for (const conta of info.contas) {
      linhas.push({
        ...base,
        credential_type: "email_password",
        login_email: conta.email || null,
        login_password: conta.password || null,
        credential_notes: conta.credits != null ? `Créditos: ${conta.credits}` : null,
        credits: conta.credits,
      });
    }
  } else if (info.kind === "link") {
    linhas.push({
      ...base,
      credential_type: "link",
      credential_url: info.link,
      credential_notes: "Link de ativação/entrega.",
    });
  } else if (info.kind === "code") {
    linhas.push({
      ...base,
      credential_type: "code",
      credential_notes: info.license,
    });
  } else if (info.kind === "custom") {
    linhas.push({
      ...base,
      credential_type: "custom",
      credential_notes: info.cloud,
    });
  }

  if (linhas.length === 0) return { linhas: 0, tipo: info.kind };

  const { error } = await supabaseAdmin.from("pulse_entregas").insert(linhas);
  if (error) {
    console.error("[pulse] erro ao gravar entrega:", error.message);
    return { linhas: 0, tipo: info.kind };
  }

  return { linhas: linhas.length, tipo: info.kind };
}

// ---------------------------------------------------------------------------
// EVENTOS
// ---------------------------------------------------------------------------

export async function registrarEvento(
  supabaseAdmin: any,
  params: {
    pedido_id?: string | null;
    package_id?: string | null;
    group_id?: string | null;
    user_id?: string | null;
    tipo: string;
    mensagem?: string | null;
    detalhes?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabaseAdmin.from("pulse_eventos").insert({
      pedido_id: params.pedido_id ?? null,
      package_id: params.package_id ?? null,
      group_id: params.group_id ?? null,
      user_id: params.user_id ?? null,
      tipo: params.tipo,
      mensagem: params.mensagem ?? null,
      detalhes: params.detalhes ?? {},
    });
  } catch (e: any) {
    console.error("[pulse] erro ao registrar evento:", e?.message ?? e);
  }
}

/** Avisa o admin no painel (a aba "Eventos" do admin). */
async function avisarAdmin(
  supabaseAdmin: any,
  params: { titulo: string; mensagem: string; metadata: Record<string, unknown>; created_by?: string | null },
): Promise<void> {
  try {
    await supabaseAdmin.from("platform_events").insert({
      event_type: "pulse",
      title: params.titulo,
      message: params.mensagem,
      metadata: JSON.stringify(params.metadata),
      created_by: params.created_by ?? null,
    });
  } catch (e: any) {
    console.error("[pulse] erro ao avisar o admin:", e?.message ?? e);
  }
}

// ---------------------------------------------------------------------------
// ATUALIZAÇÃO DO PEDIDO
// ---------------------------------------------------------------------------

/**
 * Grava o que a Pulse respondeu.
 *
 * Status do Pulse → status interno:
 *   completed/entregue   → entregue
 *   pending/processing   → processando (volta no polling)
 *   error/refunded/...   → erro
 */
export async function atualizarPedidoComResposta(
  supabaseAdmin: any,
  pedido: any,
  resposta: any,
  extras: { custo?: number | null } = {},
): Promise<any> {
  const statusPulse = String(resposta?.status ?? "").toLowerCase();
  const temEntrega = pulseTemEntrega(resposta);
  const info = classificarEntrega(resposta?.delivery);

  let status = "processando";
  // "Entregue" SÓ quando a entrega veio junto. A Pulse pode responder
  // "completed" sem a entrega (acontece no pedido repetido, o `duplicate`):
  // marcar como entregue nesse caso deixaria o cliente sem acesso e o
  // polling — que só busca pedido pendente — nunca mais buscaria.
  if (temEntrega) status = "entregue";
  else if (pulseEhErro(resposta)) status = "erro";
  else status = "processando";

  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
    tentativas: Number(pedido?.tentativas ?? 0) + 1,
  };

  const pulseOrderId = resposta?.order_id || resposta?.id || null;
  if (pulseOrderId) patch.pulse_order_id = String(pulseOrderId);
  if (resposta?.delivery) patch.entrega = resposta.delivery;
  if (info.kind) patch.delivery_kind = info.kind;
  if (extras.custo != null) patch.custo = extras.custo;
  if (status === "erro") {
    patch.ultimo_erro = String(resposta?.error ?? resposta?.message ?? "Erro na entrega.");
    patch.error_code = "erro_pulse";
  }

  const { data: atualizado, error } = await supabaseAdmin
    .from("pulse_pedidos")
    .update(patch)
    .eq("id", pedido.id)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[pulse] erro ao atualizar pedido:", error.message);
    return pedido;
  }

  return atualizado ?? pedido;
}

// ---------------------------------------------------------------------------
// WEBHOOK URL
// ---------------------------------------------------------------------------

/** URL do webhook da Pulse (app_settings ou derivada do SUPABASE_URL). */
export async function resolverWebhookUrl(supabaseAdmin: any): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "pulse_webhook_url")
      .limit(1);
    const configurado = String((data?.[0]?.value ?? "")).trim();
    if (configurado) return configurado;
  } catch {
    /* app_settings pode não existir em algum ambiente */
  }

  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/functions/v1/pulse-webhook`;
}

// ---------------------------------------------------------------------------
// FLUXO PRINCIPAL
// ---------------------------------------------------------------------------

export interface ResultadoCompra {
  ok: boolean;
  pulou?: boolean;
  motivo?: string;
  pedidoId?: string;
  externalId?: string;
  status?: string;
  entregaAplicada?: number;
  erro?: string;
  errorCode?: string;
}

/**
 * Compra na Pulse o produto do grupo "Via Parceiro" e entrega ao comprador.
 *
 * Chamada pelo `confirm-payment` DEPOIS do pagamento estar registrado.
 * NUNCA lança: devolve o resultado e o chamador segue.
 */
export async function processarCompraViaParceiro(
  supabaseAdmin: any,
  params: {
    transaction_code: string;
    group_id: string;
    user_id: string;
    payment_id?: string | null;
    amount?: number | null;
    customer_name?: string | null;
    customer_whatsapp?: string | null;
  },
): Promise<ResultadoCompra> {
  try {
    const ctx = await resolverViaParceiro(supabaseAdmin, params.group_id);

    if (!ctx.viaParceiro) {
      return { ok: true, pulou: true, motivo: "grupo não é Via Parceiro" };
    }
    if (!ctx.mapeamento) {
      return { ok: true, pulou: true, motivo: "grupo sem mapeamento na Pulse" };
    }
    if (ctx.mapeamento.status !== "ativo") {
      return {
        ok: true,
        pulou: true,
        motivo: `mapeamento ${ctx.mapeamento.status}`,
      };
    }
    if (!ctx.pacote) {
      return { ok: true, pulou: true, motivo: "pacote não encontrado no espelho local" };
    }

    const pedido = await garantirPedido(supabaseAdmin, {
      transaction_code: params.transaction_code,
      group_id: params.group_id,
      user_id: params.user_id,
      package_id: ctx.mapeamento.package_id,
      service_id: ctx.pacote.service_id ?? null,
      payment_id: params.payment_id ?? null,
      preco_pago: params.amount ?? null,
      custo: ctx.custo,
    });

    // Já entregue: não compra de novo.
    if (pedido.status === "entregue") {
      return {
        ok: true,
        pedidoId: pedido.id,
        externalId: pedido.external_id,
        status: "entregue",
        motivo: "pedido já entregue",
      };
    }

    const webhookUrl = await resolverWebhookUrl(supabaseAdmin);

    try {
      const resposta = await pulseCreateOrder({
        package_id: ctx.mapeamento.package_id,
        external_id: pedido.external_id,
        customer_name: params.customer_name ?? undefined,
        customer_whatsapp: params.customer_whatsapp ?? undefined,
        webhook_url: webhookUrl ?? undefined,
      });

      const atualizado = await atualizarPedidoComResposta(supabaseAdmin, pedido, resposta, { custo: ctx.custo });

      let entregaAplicada = 0;
      if (atualizado.status === "entregue" && resposta?.delivery) {
        const aplicacao = await aplicarEntrega(supabaseAdmin, {
          group_id: params.group_id,
          user_id: params.user_id,
          entrega: resposta.delivery,
          pedido: atualizado,
          package_id: ctx.mapeamento.package_id,
          package_title: ctx.pacote?.title ?? null,
          expira_em: dataValidade(ctx.durationDays),
        });
        entregaAplicada = aplicacao.linhas;

        await registrarEvento(supabaseAdmin, {
          pedido_id: pedido.id,
          package_id: ctx.mapeamento.package_id,
          group_id: params.group_id,
          user_id: params.user_id,
          tipo: "entrega_aplicada",
          mensagem: `Entrega do pedido ${pedido.external_id} aplicada ao comprador.`,
          detalhes: { tipo: aplicacao.tipo, linhas: aplicacao.linhas },
        });
      }

      return {
        ok: true,
        pedidoId: pedido.id,
        externalId: pedido.external_id,
        status: atualizado.status,
        entregaAplicada,
      };
    } catch (e: any) {
      return await tratarErroCompra(supabaseAdmin, {
        erro: e,
        pedido,
        ctx,
        params,
      });
    }
  } catch (e: any) {
    console.error("[pulse] falha inesperada na compra Via Parceiro:", e?.message ?? e);
    return { ok: false, erro: String(e?.message ?? e) };
  }
}

/**
 * Traduz um erro da Pulse em ação.
 *
 * - pacote sumiu (404/410) → mapeamento vira "precisa_remap" + aviso no admin
 * - saldo insuficiente (400) → pedido "erro" + aviso (é problema de caixa)
 * - sem estoque (409) → pedido "erro" + aviso
 * - rede/timeout/429/503 → pedido continua "pendente": o polling tenta de novo
 */
async function tratarErroCompra(
  supabaseAdmin: any,
  ctx: {
    erro: any;
    pedido: any;
    ctx: ContextoViaParceiro;
    params: any;
  },
): Promise<ResultadoCompra> {
  const { erro, pedido, ctx: contexto, params } = ctx;
  const e = erro instanceof PulseError ? erro : null;
  const codigo = e?.code ?? "desconhecido";
  const mensagem = String(e?.message ?? erro?.message ?? "Erro desconhecido.");

  const patch: Record<string, unknown> = {
    ultimo_erro: mensagem,
    error_code: codigo,
    tentativas: Number(pedido?.tentativas ?? 0) + 1,
    updated_at: new Date().toISOString(),
  };

  // Erro de rede/timeout/rate limit: o pedido SEGUE PENDENTE (outra tentativa
  // pode resolver). Qualquer outro erro é definitivo por enquanto.
  const recuperavel = codigo === "rede" || codigo === "timeout" || codigo === "limite_requisicoes" || codigo === "servico_indisponivel";
  if (!recuperavel) patch.status = "erro";

  await supabaseAdmin.from("pulse_pedidos").update(patch).eq("id", pedido.id);

  await registrarEvento(supabaseAdmin, {
    pedido_id: pedido.id,
    package_id: contexto.mapeamento?.package_id ?? null,
    group_id: params.group_id,
    user_id: params.user_id,
    tipo: recuperavel ? "falha_temporaria" : "falha_compra",
    mensagem,
    detalhes: { codigo, recuperavel },
  });

  if (!recuperavel) {
    if (e?.precisaRemapear) {
      // O pacote sumiu do catálogo da Pulse: o grupo sai da vitrine e o
      // admin precisa remapear.
      await supabaseAdmin
        .from("pulse_mapeamentos")
        .update({ status: "precisa_remap", updated_at: new Date().toISOString() })
        .eq("id", contexto.mapeamento.id);
      await supabaseAdmin
        .from("pulse_pacotes")
        .update({ status: "indisponivel", visible: false, updated_at: new Date().toISOString() })
        .eq("package_id", contexto.mapeamento.package_id);
      await supabaseAdmin
        .from("groups")
        .update({ status: "closed", visibility: "private" })
        .eq("id", params.group_id);

      await avisarAdmin(supabaseAdmin, {
        titulo: "Pacote da Pulse sumiu do catálogo",
        mensagem:
          `O pacote "${contexto.pacote?.title ?? contexto.mapeamento.package_id}" não existe mais na Pulse. ` +
          `O grupo foi fechado e precisa de remapeamento no painel Pulse.`,
        metadata: { package_id: contexto.mapeamento.package_id, group_id: params.group_id, pedido: pedido.external_id },
      });
    } else if (codigo === "saldo_insuficiente") {
      await avisarAdmin(supabaseAdmin, {
        titulo: "Saldo insuficiente na Pulse",
        mensagem:
          `O pedido ${pedido.external_id} não saiu por falta de saldo na Pulse. ` +
          `Recarregue o saldo e rode o reprocessamento.`,
        metadata: { pedido: pedido.external_id, needed: e?.details?.needed ?? null },
      });
    } else if (codigo === "sem_estoque") {
      await avisarAdmin(supabaseAdmin, {
        titulo: "Pacote sem estoque na Pulse",
        mensagem: `O pedido ${pedido.external_id} falhou porque o pacote está sem estoque.`,
        metadata: { pedido: pedido.external_id, package_id: contexto.mapeamento.package_id },
      });
    }
  }

  return {
    ok: false,
    pedidoId: pedido.id,
    externalId: pedido.external_id,
    status: recuperavel ? "pendente" : "erro",
    erro: mensagem,
    errorCode: codigo,
  };
}

// ---------------------------------------------------------------------------
// REPROCESSAMENTO (polling)
// ---------------------------------------------------------------------------

/**
 * Consulta um pedido pendente na Pulse e aplica a entrega se ela tiver
 * chegado. É o que roda no job `pulse-poll` e o que roda quando o webhook
 * chega.
 */
export async function reprocessarPedido(
  supabaseAdmin: any,
  pedido: any,
  opcoes: { origem?: string } = {},
): Promise<{ ok: boolean; status?: string; entregue?: boolean; erro?: string }> {
  if (!pedido?.external_id) return { ok: false, erro: "pedido sem external_id" };

  try {
    const resposta = await pulseCheckStatus({ external_id: pedido.external_id });
    const atualizado = await atualizarPedidoComResposta(supabaseAdmin, pedido, resposta);

    if (atualizado.status === "entregue" && resposta?.delivery) {
      // O pacote dá o nome e o prazo que aparecem para o cliente.
      let pacote: any = null;
      if (pedido.package_id) {
        const { data } = await supabaseAdmin
          .from("pulse_pacotes")
          .select("title, duration_days")
          .eq("package_id", pedido.package_id)
          .maybeSingle();
        pacote = data ?? null;
      }

      const aplicacao = await aplicarEntrega(supabaseAdmin, {
        group_id: pedido.group_id,
        user_id: pedido.user_id,
        entrega: resposta.delivery,
        pedido: atualizado,
        package_id: pedido.package_id,
        package_title: pacote?.title ?? null,
        expira_em: dataValidade(Number(pacote?.duration_days ?? 30)),
      });

      await registrarEvento(supabaseAdmin, {
        pedido_id: pedido.id,
        package_id: pedido.package_id,
        group_id: pedido.group_id,
        user_id: pedido.user_id,
        tipo: "entrega_aplicada",
        mensagem: `Entrega do pedido ${pedido.external_id} aplicada (${opcoes.origem ?? "polling"}).`,
        detalhes: { tipo: aplicacao.tipo, linhas: aplicacao.linhas, origem: opcoes.origem ?? "polling" },
      });

      return { ok: true, status: "entregue", entregue: true };
    }

    return { ok: true, status: atualizado.status };
  } catch (e: any) {
    const codigo = e instanceof PulseError ? e.code : "desconhecido";
    const recuperavel = ["rede", "timeout", "limite_requisicoes", "servico_indisponivel"].includes(codigo);
    await supabaseAdmin
      .from("pulse_pedidos")
      .update({
        ultimo_erro: String(e?.message ?? e),
        error_code: codigo,
        tentativas: Number(pedido.tentativas ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pedido.id);

    return { ok: false, erro: String(e?.message ?? e), status: recuperavel ? "pendente" : "erro" };
  }
}

/**
 * Roda o reprocessamento de todos os pedidos pendentes.
 *
 * Limite por rodada (o padrão da Pulse é 30 req/min): não é para estourar o
 * rate limit.
 */
export async function reprocessarPendentes(
  supabaseAdmin: any,
  limite = 20,
): Promise<{ processados: number; entregues: number; erros: number }> {
  const { data: pendentes } = await supabaseAdmin
    .from("pulse_pedidos")
    .select("*")
    .in("status", ["pendente", "processando"])
    .order("updated_at", { ascending: true })
    .limit(limite);

  let entregues = 0;
  let erros = 0;

  for (const pedido of pendentes ?? []) {
    // A Pulse concluiu mas não devolveu a entrega (produto de entrega
    // manual, por exemplo): depois de várias tentativas o pedido para de
    // ficar batendo no polling e vira "erro" para o admin entregar à mão.
    if (Number(pedido.tentativas ?? 0) >= 5) {
      await supabaseAdmin
        .from("pulse_pedidos")
        .update({
          status: "erro",
          ultimo_erro:
            pedido.ultimo_erro ||
            "A Pulse concluiu o pedido mas não devolveu a entrega. Entregar manualmente ou reprocessar.",
          error_code: pedido.error_code || "sem_entrega",
          updated_at: new Date().toISOString(),
        })
        .eq("id", pedido.id);

      await registrarEvento(supabaseAdmin, {
        pedido_id: pedido.id,
        package_id: pedido.package_id,
        group_id: pedido.group_id,
        user_id: pedido.user_id,
        tipo: "entrega_nao_chegou",
        mensagem: `Pedido ${pedido.external_id} sem entrega após ${pedido.tentativas} tentativas.`,
        detalhes: { tentativas: pedido.tentativas },
      });

      erros++;
      continue;
    }

    const r = await reprocessarPedido(supabaseAdmin, pedido, { origem: "polling" });
    if (r.entregue) entregues++;
    if (!r.ok) erros++;
  }

  return { processados: (pendentes ?? []).length, entregues, erros };
}
