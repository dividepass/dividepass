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
  classificarProduto,
  derivarCiclo,
  limparDescricao,
  marcarComoDividePass,
  normalizarTexto,
  pacoteEhVendavel,
  pacoteTemEstoque,
  resolverPlataforma,
  rotuloCiclo,
  slugify,
  tagsDoGrupo,
  type DestinoPlataforma,
} from "./pulse-catalog.ts";

const REGRAS_VIA_PARCEIRO =
  "Esta é uma entrega individual via DividePass: o acesso é seu e só seu. " +
  "Não compartilhe a senha, o link ou a chave com ninguém. " +
  "Se puder, troque a senha no primeiro acesso.";

/**
 * E-mail do admin OFICIAL da plataforma (o dono).
 *
 * Os grupos importados são do DONO, não de quem rodou o sync: o `owner_id`
 * decide para onde vai o repasse do dinheiro.
 */
const EMAIL_ADMIN_OFICIAL = "admin@dividepass.com";

/**
 * Quem é o DONO dos grupos importados.
 *
 * SEMPRE o admin oficial (`admin@dividepass.com`), nunca quem disparou o
 * sync. Antes, o importador usava o id de quem chamou a função — um sync
 * feito por uma conta de teste deixava os 79 grupos com o dono errado (e o
 * repasse do dinheiro iria para a conta errada).
 *
 * Se o admin oficial não existir, cai no admin mais antigo.
 */
export async function resolverDonoAdmin(supabaseAdmin: any): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("users")
    .select("id, email, role, created_at")
    .eq("role", "admin")
    .order("created_at", { ascending: true });

  const lista = data ?? [];
  const oficial = lista.find(
    (u: any) => normalizarTexto(u?.email) === normalizarTexto(EMAIL_ADMIN_OFICIAL),
  );
  return oficial?.id ?? lista[0]?.id ?? null;
}

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
): Promise<{ id: string | null; nome: string; slug: string; criado: boolean; icon_url: string | null }> {
  const { data: existente } = await supabaseAdmin
    .from("streaming_services")
    .select("id, name, slug, icon_url")
    .eq("slug", destino.slug)
    .maybeSingle();

  if (existente) {
    return {
      id: existente.id,
      nome: existente.name,
      slug: existente.slug,
      criado: false,
      icon_url: existente.icon_url ?? null,
    };
  }

  if (dryRun) {
    return { id: null, nome: destino.nome, slug: destino.slug, criado: true, icon_url: null };
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
    .select("id, name, slug, icon_url")
    .single();

  if (error) {
    throw new Error(`Falha ao criar a plataforma "${destino.nome}": ${error.message}`);
  }

  return { id: novo.id, nome: novo.name, slug: novo.slug, criado: true, icon_url: novo.icon_url ?? null };
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

  // O CHECK do banco em `service_plans.billing_cycle` aceita SÓ quatro
  // valores: monthly, quarterly, semiannual e annual. `days` e `custom` são
  // válidos em `groups`, mas não aqui.
  //
  // O prazo exato (7 dias, 30 dias) NÃO se perde: ele vive no GRUPO, em
  // `custom_cycle_days`, e é o que vale na hora de cobrar e de expirar.
  const cicloDoPlano = ["monthly", "quarterly", "semiannual", "annual"].includes(billing_cycle)
    ? billing_cycle
    : "monthly";

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
          name: marcarComoDividePass(pkg.title),
          billing_cycle: cicloDoPlano,
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
      name: marcarComoDividePass(pkg.title),
      plan_key,
      billing_cycle: cicloDoPlano,
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
    custom_cycle_label: string | null;
    sale_price: number;
    vendavel: boolean;
    temEstoque: boolean;
    adminUserId: string | null;
    photo_url: string | null;
    dryRun: boolean;
  },
): Promise<string | null> {
  const p = params;

  const dados = {
    service_id: p.service_id,
    plan_id: p.plan_id,
    // CAPA: a API de revenda NÃO devolve imagem nenhuma (nenhum dos 23
    // campos é capa). O que existe é o logo da plataforma no Supabase
    // Storage — é ele que vira a capa do grupo. Plataforma sem logo
    // (as que o importador cria) fica com o placeholder com ícone.
    photo_url: p.photo_url,
    // O nome e a description são o que o CLIENTE lê: a marca do fornecedor
    // aparece como DIVIDEPASS (decisão do dono). O título cru fica no espelho
    // `pulse_pacotes`, que é o painel do admin.
    name: marcarComoDividePass(p.pkg.title),
    price_per_slot: p.sale_price,
    billing_cycle: p.billing_cycle,
    available_cycles: p.available_cycles,
    custom_cycle_days: p.custom_cycle_days,
    custom_cycle_months: p.custom_cycle_months,
    custom_cycle_label: p.custom_cycle_label,
    cycle_discount: 0,
    max_size: 4,
    // "Vagas ilimitadas": cada comprador leva a SUA conta da Pulse. O grupo é
    // a vitrine do produto, não um rateio de conta compartilhada.
    has_slot_limit: false,
    has_entrance_fee: false,
    entrance_fee: 0,
    status: p.vendavel ? "open" : "closed",
    visibility: p.vendavel ? "public" : "private",
    // Sem estoque no parceiro: o grupo continua NA VITRINE (a pessoa vê que
    // o produto existe) mas ganha a tag "Esgotado" — o mesmo comportamento de
    // um grupo cheio: ninguém entra e ninguém paga.
    //
    // Grupo que está FORA da vitrine (o parceiro nem libera para revenda) não
    // precisa da tag: ela é invisível ali e só suja o dado.
    tags: !p.vendavel
      ? [TAG_VIA_PARCEIRO]
      : tagsDoGrupo(p.pkg, p.temEstoque),
    is_official: true,
    approval_status: "approved",
    owner_id: p.adminUserId,
    description: marcarComoDividePass(limparDescricao(p.pkg.description)),
    rules: REGRAS_VIA_PARCEIRO,
    // `plan_type` fica VAZIO de propósito: o selo "Via Parceiro" já vem da
    // tag, e usar o plan_type também fazia aparecer um chip duplicado
    // ("Tipo de conta compartilhada: Via Parceiro") — que além de repetir,
    // descrevia errado (o acesso é privado, não compartilhado).
    plan_type: null,
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
 * Markup configurado no painel (`/admin/settings` → Revenda).
 *
 * Cai no padrão (20%) se ainda não houver nada gravado. O valor vem do
 * BANCO, e não do código — o dono muda a margem sem precisar republicar
 * nada.
 */
export async function resolverMarkup(supabaseAdmin: any): Promise<number> {
  try {
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "pulse_markup")
      .limit(1);
    const bruto = String(data?.[0]?.value ?? "").replace(",", ".").trim();
    const n = Number(bruto);
    if (Number.isFinite(n) && n >= 0 && n <= 500) return n;
  } catch {
    /* app_settings pode não existir em algum ambiente */
  }
  return MARKUP_PADRAO;
}

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
  const markup = opcoes.markup ?? await resolverMarkup(supabaseAdmin);
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

  // O DONO dos grupos é o admin oficial da plataforma — nunca quem disparou
  // o sync (o `owner_id` manda no repasse do dinheiro).
  let adminUserId = opcoes.adminUserId ?? null;
  if (!dryRun) {
    const dono = await resolverDonoAdmin(supabaseAdmin);
    if (dono) adminUserId = dono;
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
      // Assinatura x pagamento único + tipo de entrega (a API não tem campo
      // para isso: sai do `delivery`, dos créditos e do período no título).
      const classificacao = classificarProduto(pkg, ciclo);
      const sale_price = calcularPrecoVenda(pkg.original_price, markup);
      const custo = pkg.price != null ? Number(pkg.price) : null;
      const margem = calcularMargem(sale_price, custo);
      const vendavel = pacoteEhVendavel(pkg);
      // Estoque do parceiro: se acabou, o grupo fica visível mas marcado
      // "Esgotado" (ninguém entra, ninguém paga).
      const temEstoque = pacoteTemEstoque(pkg);

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
          // ATENÇÃO: o campo do parâmetro é `grupo_id` (português) e a
          // variável local é `group_id` (inglês). A forma abreviada
          // (`grupo_id,`) procuraria uma variável `grupo_id` que não existe
          // e derrubaria o import inteiro com "grupo_id is not defined".
          grupo_id: group_id,
          service_id: plataforma.id,
          plan_id: plan_id ?? "",
          pkg,
          billing_cycle: ciclo.billing_cycle,
          available_cycles: [ciclo.billing_cycle],
          custom_cycle_days: ciclo.custom_cycle_days,
          custom_cycle_months: ciclo.custom_cycle_months,
          custom_cycle_label: rotuloCiclo(ciclo),
          sale_price: sale_price ?? 0,
          vendavel,
          temEstoque,
          adminUserId,
          photo_url: plataforma.icon_url,
          dryRun,
        });
      }

      if (!dryRun) {
        await supabaseAdmin.from("pulse_pacotes").upsert({
          package_id: pkg.id,
          title: pkg.title,
          category: pkg.category ?? null,
          description: limparDescricao(pkg.description),
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
            natureza: classificacao.natureza,
            entrega_tipo: classificacao.entrega,
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
