// ============================================================================
// IMPORTADOR DE CATÁLOGO — PULSE CODING → DIVIDEPASS
// ============================================================================
//
// O QUE ESTE CÓDIGO FAZ
// ---------------------
// Lê `list_packages` da Pulse e materializa cada pacote como um GRUPO do
// DividePass:
//
//   pacote da Pulse  →  plataforma (criada se não existir)
//                    →  service_plans (1 plano)
//                    →  groups (1 grupo, tag "Via Parceiro")
//                    →  pulse_pacotes (espelho local)
//                    →  pulse_mapeamentos (grupo ↔ pacote)
//
// O QUE ELE NÃO FAZ
// ------------------
//   - Não fixa package_id no código: tudo fica no banco e é re-sincronizado.
//   - Não compra nada: importar é grátis (a compra acontece só quando o
//     cliente paga, via confirm-payment).
//   - Não expõe indisponíveis: pacote que a Pulse não vende fica FORA da
//     vitrine (status closed + visibility private), mas continua no painel
//     do admin para o remapeamento.
//   - Não importa a categoria "Serviços": são serviços que o dono presta,
//     não contas para o cliente usar.
//
// O QUE ACONTECE QUANDO O CATÁLOGO MUDA
// -------------------------------------
//   - Preço/estoque/disponibilidade são atualizados a cada sync.
//   - Se a Pulse trocar o id de um pacote, o pacote antigo fica com
//     `status = 'indisponivel'` e o admin remapeia para o novo.
// ============================================================================

import { pulseListPackages, type PulsePackage } from "./pulse.ts";
import {
  TAG_VIA_PARCEIRO,
  MARKUP_PADRAO,
  calcularMargem,
  calcularPrecoVenda,
  categoriaEhIgnorada,
  derivarCiclo,
  limiterDescricao,
  pacoteEhVendavel,
  resolverPlataforma,
  slugify,
  type DestinoPlataforma,
} from "./pulse-catalog.ts";

const REGRAS_VIA_PARCEIRO =
  "Esta é uma entrega individual via Pulse Coding: o acesso é seu e só seu. " +
  "Não compartilhe a senha, o link ou a chave com ninguém. " +
  "Se puder, troque a senha no primeiro acesso.";

export interface RelatorioImport {
  total: number;
  criados: number;
  atualizados: number;
  indisponiveis: number;
  ignorados: number;
  erros: number;
  plataformas_criadas: number;
  sem_margem: number;
  detalhes: Array<{
    package_id: string;
    title: string;
    acao: string;
    plataforma?: string;
    grupo_id?: string;
    venda?: number | null;
    custo?: number | null;
    margem?: number | null;
    motivo?: string;
  }>;
}

export interface OpcoesImport {
  /** Markup aplicado sobre o `original_price`. */
  markup?: number;
  /** Admin que será o dono dos grupos criados (grupo oficial, sem repasse). */
  adminUserId?: string | null;
  /** Quando true, NADA é gravado: só o relatório do que aconteceria. */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// PLATAFORMA
// ---------------------------------------------------------------------------

async function garantirPlataforma(
  supabaseAdmin: any,
  destino: DestinoPlataforma,
  dryRun: boolean,
): Promise<{ id: string | null; nome: string; slug: string; criado: boolean }> {
  const { data: existente } = await supabaseAdmin
    .from("streaming_services")
    .select("id, name, slug")
    .eq("slug", destino.slug)
    .maybeSingle();

  if (existente) {
    return { id: existente.id, nome: existente.name, slug: existente.slug, criado: false };
  }

  if (dryRun) {
    return { id: null, nome: destino.nome, slug: destino.slug, criado: true };
  }

  const { data: novo, error } = await supabaseAdmin
    .from("streaming_services")
    .insert({
      name: destino.nome,
      full_name: destino.nome,
      slug: destino.slug,
      icon: destino.icone ?? "🧩",
      color: "#4F46E5",
      status: "active",
      max_group_size: 4,
    })
    .select("id, name, slug")
    .single();

  if (error) {
    throw new Error(`Falha ao criar a plataforma "${destino.nome}": ${error.message}`);
  }

  return { id: novo.id, nome: novo.name, slug: novo.slug, criado: true };
}

// ---------------------------------------------------------------------------
// PLANO
// ---------------------------------------------------------------------------

async function garantirPlano(
  supabaseAdmin: any,
  params: {
    service_id: string;
    pkg: PulsePackage;
    billing_cycle: string;
    sale_price: number | null;
    dryRun: boolean;
  },
): Promise<string | null> {
  const { service_id, pkg, billing_cycle, sale_price, dryRun } = params;

  // O plan_key leva o prefixo do package_id: o id da Pulse pode mudar, mas o
  // plano precisa ser o MESMO quando o pacote volta com outro id.
  const plan_key = `${slugify(pkg.title).slice(0, 38)}-${pkg.id.slice(0, 6)}`;

  const { data: existente } = await supabaseAdmin
    .from("service_plans")
    .select("id")
    .eq("service_id", service_id)
    .eq("plan_key", plan_key)
    .maybeSingle();

  if (existente) {
    if (!dryRun) {
      await supabaseAdmin
        .from("service_plans")
        .update({
          name: pkg.title,
          billing_cycle,
          official_price: sale_price,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existente.id);
    }
    return existente.id;
  }

  if (dryRun) return null;

  const { data: novo, error } = await supabaseAdmin
    .from("service_plans")
    .insert({
      service_id,
      name: pkg.title,
      plan_key,
      billing_cycle,
      official_price: sale_price,
      currency: "BRL",
      country: "Brasil",
      is_active: true,
      source_date: new Date().toISOString().split("T")[0],
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Falha ao criar o plano "${pkg.title}": ${error.message}`);
  }
  return novo.id;
}

// ---------------------------------------------------------------------------
// GRUPO
// ---------------------------------------------------------------------------

async function garantirGrupo(
  supabaseAdmin: any,
  params: {
    grupo_id?: string | null;
    service_id: string;
    plan_id: string;
    pkg: PulsePackage;
    billing_cycle: string;
    available_cycles: string[];
    custom_cycle_days: number | null;
    custom_cycle_months: number | null;
    sale_price: number;
    vendavel: boolean;
    adminUserId: string | null;
    dryRun: boolean;
  },
): Promise<string | null> {
  const p = params;

  const dados = {
    service_id: p.service_id,
    plan_id: p.plan_id,
    name: p.pkg.title,
    price_per_slot: p.sale_price,
    billing_cycle: p.billing_cycle,
    available_cycles: p.available_cycles,
    custom_cycle_days: p.custom_cycle_days,
    custom_cycle_months: p.custom_cycle_months,
    cycle_discount: 0,
    max_size: 4,
    // "Vagas ilimitadas": cada comprador leva a SUA conta da Pulse. O grupo é
    // a vitrine do produto, não um rateio de conta compartilhada.
    has_slot_limit: false,
    has_entrance_fee: false,
    entrance_fee: 0,
    status: p.vendavel ? "open" : "closed",
    visibility: p.vendavel ? "public" : "private",
    tags: [TAG_VIA_PARCEIRO],
    is_official: true,
    approval_status: "approved",
    owner_id: p.adminUserId,
    description: limiterDescricao(p.pkg.description),
    rules: REGRAS_VIA_PARCEIRO,
    plan_type: TAG_VIA_PARCEIRO,
    chat_enabled: false,
    email_code_enabled: false,
    verified: true,
    subscription_status: "active",
  };

  if (p.grupo_id) {
    if (!p.dryRun) {
      const { error } = await supabaseAdmin.from("groups").update(dados).eq("id", p.grupo_id);
      if (error) {
        throw new Error(`Falha ao atualizar o grupo "${p.pkg.title}": ${error.message}`);
      }
    }
    return p.grupo_id;
  }

  if (p.dryRun) return null;

  const { data: grupo, error } = await supabaseAdmin
    .from("groups")
    .insert(dados)
    .select("id")
    .single();

  if (error) {
    throw new Error(`Falha ao criar o grupo "${p.pkg.title}": ${error.message}`);
  }

  // Slug: convenção do repo (6 primeiros caracteres do id em maiúsculo).
  // O índice é UNIQUE, então há retry em caso de colisão.
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const slug = grupo.id.slice(0, 6).toUpperCase();
    const { error: errSlug } = await supabaseAdmin
      .from("groups")
      .update({ slug })
      .eq("id", grupo.id);
    if (!errSlug) break;
    if (tentativa === 5) {
      console.warn(`[pulse] não foi possível definir o slug do grupo ${grupo.id}: ${errSlug.message}`);
    }
  }

  return grupo.id;
}

// ---------------------------------------------------------------------------
// IMPORTAÇÃO
// ---------------------------------------------------------------------------

/**
 * Importa (ou atualiza) o catálogo da Pulse no DividePass.
 *
 * É idempotente: rodar mil vezes não cria grupo duplicado, porque o espelho
 * em `pulse_pacotes` guarda o group_id e o plan_id já criados.
 */
export async function importarCatalogoPulse(
  supabaseAdmin: any,
  opcoes: OpcoesImport = {},
): Promise<RelatorioImport> {
  const markup = opcoes.markup ?? MARKUP_PADRAO;
  const dryRun = opcoes.dryRun ?? false;

  const relatorio: RelatorioImport = {
    total: 0,
    criados: 0,
    atualizados: 0,
    indisponiveis: 0,
    ignorados: 0,
    erros: 0,
    plataformas_criadas: 0,
    sem_margem: 0,
    detalhes: [],
  };

  let adminUserId = opcoes.adminUserId ?? null;
  if (!adminUserId && !dryRun) {
    const { data: admin } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("role", "admin")
      .limit(1);
    adminUserId = admin?.[0]?.id ?? null;
  }

  const { packages } = await pulseListPackages();
  relatorio.total = packages.length;

  for (const pkg of packages) {
    try {
      // ── Fora do escopo: categoria "Serviços" ────────────────────────────
      if (categoriaEhIgnorada(pkg.category)) {
        if (!dryRun) {
          await supabaseAdmin.from("pulse_pacotes").upsert({
            package_id: pkg.id,
            title: pkg.title,
            category: pkg.category ?? null,
            status: "ignorado",
            ignorado: true,
            visible: false,
            motivo_ignorado: "Categoria Serviços: serviço prestado pelo dono, não produto para o cliente.",
            raw: pkg,
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: "package_id" });
        }
        relatorio.ignorados++;
        relatorio.detalhes.push({
          package_id: pkg.id,
          title: pkg.title,
          acao: "ignorado",
          motivo: "categoria Serviços",
        });
        continue;
      }

      const destino = resolverPlataforma(pkg);
      const plataforma = await garantirPlataforma(supabaseAdmin, destino, dryRun);
      if (plataforma.criado) relatorio.plataformas_criadas++;

      const ciclo = derivarCiclo(pkg.title);
      const sale_price = calcularPrecoVenda(pkg.original_price, markup);
      const custo = pkg.price != null ? Number(pkg.price) : null;
      const margem = calcularMargem(sale_price, custo);
      const vendavel = pacoteEhVendavel(pkg);

      if (margem != null && margem <= 0) relatorio.sem_margem++;

      // Espelho local: é o que permite não fixar o package_id no código.
      const { data: espelho } = await supabaseAdmin
        .from("pulse_pacotes")
        .select("*")
        .eq("package_id", pkg.id)
        .maybeSingle();

      let group_id = espelho?.group_id ?? null;
      let plan_id = espelho?.plan_id ?? null;

      if (plataforma.id) {
        plan_id = await garantirPlano(supabaseAdmin, {
          service_id: plataforma.id,
          pkg,
          billing_cycle: ciclo.billing_cycle,
          sale_price,
          dryRun,
        });

        group_id = await garantirGrupo(supabaseAdmin, {
          grupo_id,
          service_id: plataforma.id,
          plan_id: plan_id ?? "",
          pkg,
          billing_cycle: ciclo.billing_cycle,
          available_cycles: [ciclo.billing_cycle],
          custom_cycle_days: ciclo.custom_cycle_days,
          custom_cycle_months: ciclo.custom_cycle_months,
          sale_price: sale_price ?? 0,
          vendavel,
          adminUserId,
          dryRun,
        });
      }

      if (!dryRun) {
        await supabaseAdmin.from("pulse_pacotes").upsert({
          package_id: pkg.id,
          title: pkg.title,
          category: pkg.category ?? null,
          description: limiterDescricao(pkg.description),
          features: pkg.features ?? [],
          original_price: pkg.original_price ?? null,
          price: custo,
          markup,
          sale_price,
          stock: pkg.available_stock ?? pkg.stock ?? 0,
          availability: pkg.availability ?? null,
          delivery: pkg.delivery ?? null,
          orderable_via_api: pkg.orderable_via_api ?? false,
          duration_days: ciclo.duration_days,
          billing_cycle: ciclo.billing_cycle,
          service_id: plataforma.id,
          plan_id,
          group_id,
          status: vendavel ? "importado" : "indisponivel",
          visible: vendavel,
          ignorado: false,
          motivo_ignorado: null,
          raw: pkg,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "package_id" });

        // Mapeamento grupo ↔ pacote.
        if (group_id) {
          const { data: mapeamento } = await supabaseAdmin
            .from("pulse_mapeamentos")
            .select("id")
            .eq("group_id", group_id)
            .maybeSingle();

          const dadosMapa = {
            group_id,
            package_id: pkg.id,
            status: vendavel ? "ativo" : "indisponivel",
            custo,
            preco_venda: sale_price,
            margem,
            updated_at: new Date().toISOString(),
          };

          if (mapeamento) {
            await supabaseAdmin.from("pulse_mapeamentos").update(dadosMapa).eq("id", mapeamento.id);
          } else {
            await supabaseAdmin.from("pulse_mapeamentos").insert(dadosMapa);
          }
        }
      }

      if (vendavel) relatorio.criados++;
      else relatorio.indisponiveis++;

      relatorio.detalhes.push({
        package_id: pkg.id,
        title: pkg.title,
        acao: espelho?.group_id ? "atualizado" : "criado",
        plataforma: plataforma.nome,
        grupo_id: group_id ?? undefined,
        venda: sale_price,
        custo,
        margem,
      });
    } catch (e: any) {
      relatorio.erros++;
      relatorio.detalhes.push({
        package_id: pkg.id,
        title: pkg.title,
        acao: "erro",
        motivo: String(e?.message ?? e),
      });
    }
  }

  return relatorio;
}
