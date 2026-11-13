// ============================================================================
// IMPORTAÇÃO DO CATÁLOGO DA PULSE PARA O DIVIDEPASS
// ============================================================================
//
// A IDEA
// ------
// Cada pacote da Pulse vira um GRUPO do DividePass dentro da plataforma certa
// (Netflix, ChatGPT, Claude, Prime Video...), marcado com a tag "Via Parceiro".
// O cliente vê o grupo na vitrine normal, paga no gateway do DividePass e a
// compra na Pulse acontece depois do pagamento confirmado.
//
// Por que grupo e não "produto" novo? Porque o DividePass já tem vitrine,
// checkout, assinatura, fatura, repasse, renewal e painel de credenciais
// prontos — e o `group_credentials` aceita VÁRIAS credenciais por grupo
// (o UNIQUE de group_id foi dropado em remove-group-credentials-unique.sql).
// Cada compra cria uma credencial nova com assigned_to = o comprador, então
// a conta da Pulse é PRIVADA: 1 compra = 1 cliente.
//
// REGRAS DE NEGÓCIO (decididas pelo dono)
// ---------------------------------------
//   - Preço de venda = original_price + 20% de markup (configurável por grupo).
//   - Pacote indisponível na Pulse (orderable_via_api = false) É importado,
//     mas fica FORA da vitrine (status closed + visibility private).
//   - Categoria "Serviços" é EXCLUÍDA do import automático (são serviços que
//     o dono presta, não contas para o cliente usar).
//   - Nada é fixo no código: o package_id fica no banco e é re-sincronizado.
// ============================================================================

import type { PulsePackage } from "./pulse.ts";

/** Tag que marca os grupos que vêm da Pulse. */
export const TAG_VIA_PARCEIRO = "Via Parceiro";

/**
 * Tag de produto ESGOTADO no parceiro.
 *
 * Quando o estoque do fornecedor acaba, o grupo continua na vitrine (a
 * pessoa vê que o produto existe) mas não aceita mais gente: é o mesmo
 * comportamento de um grupo cheio.
 */
export const TAG_ESGOTADO = "Esgotado";

/**
 * O PARCEIRO APARECE COMO DIVIDEPASS.
 *
 * Decisão do dono: o cliente não precisa saber de onde veio o produto — o
 * parceiro é a DIVIDEPASS. Então, em tudo que o cliente lê, a marca do
 * fornecedor vira "DividePass".
 *
 * O espelho local (`pulse_pacotes`) CONTINUA com o texto cru: quem precisa
 * saber qual pacote é qual é o painel do ADMIN, não o cliente.
 */
const MARCAS_PARCEIRO = [
  "pulse coding",
  "pulse codig",
  "pulse clone",
  "pulsecoding",
  "pulse",
];

/**
 * Troca a marca do fornecedor por "DividePass" e arruma o texto.
 *
 * "ANTIGRAVITY — 1 BILHÃO DE TOKENS | PULSE" → "ANTIGRAVITY — 1 BILHÃO DE TOKENS | DividePass"
 * "Suporte da PULSE para dúvidas"               → "Suporte da DividePass para dúvidas"
 * "Extensão Pulse Codig Duração De 1 dia"        → "Extensão DividePass — Duração De 1 dia"
 */
export function marcarComoDividePass(texto: string | null | undefined): string {
  if (texto == null) return "";
  let s = String(texto);

  // A marca vira DividePass. Quando ela está NO MEIO do nome, entra um
  // separador ("Extensão DividePass — Duração De 7 dias"); quando está no
  // começo ou no fim, o texto original já fica bom ("DividePass Clone — 01
  // Clone", "… | DividePass").
  s = s.replace(
    /pulse(?:\s+coding|\s+codig|\s+clone)?/gi,
    (match: string, offset: number, whole: string) => {
      const antes = whole.slice(0, offset);
      const depois = whole.slice(offset + match.length);
      const noComecoDaLinha = /(^|\n)[ \t]*$/.test(antes);
      const precisaSeparador =
        !noComecoDaLinha &&
        /^\s+[A-ZÀ-Ú]/.test(depois) &&
        !/[-–—|]$/.test(antes.trimEnd());
      return precisaSeparador ? "DividePass — " : "DividePass";
    },
  );

  // Limpeza final de espaço.
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Categorias da Pulse que NÃO entram no import automático. */
export const CATEGORIAS_IGNORADAS = ["serviços", "servicos"];

/** Markup padrão aplicado sobre o `original_price`. */
export const MARKUP_PADRAO = 20;

// ---------------------------------------------------------------------------
// REGRAS DE PLATAFORMA
// ---------------------------------------------------------------------------

export interface DestinoPlataforma {
  /** Slug no DividePass. */
  slug: string;
  /** Nome da plataforma (usado quando precisa ser criada). */
  nome: string;
  /** A plataforma ainda não existe no DividePass e precisa ser criada? */
  criar: boolean;
  /** Emoji da plataforma (só usado quando ela é criada). */
  icone?: string;
}

/** Normaliza texto para comparação: sem acento, minúsculo. */
export function normalizarTexto(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

interface RegraPlataforma {
  /** Trecho procurado no título normalizado. */
  titulo?: string;
  /** Categoria normalizada. */
  categoria?: string;
  destino: DestinoPlataforma;
}

/**
 * Ordem importa: a primeira regra que casar vence.
 *
 * As plataformas que já existem no DividePass vêm primeiro; depois as que
 * precisam ser criadas; por último, o fallback pela categoria da Pulse.
 */
const REGRAS_PLATAFORMA: RegraPlataforma[] = [
  // ── Combos primeiro ────────────────────────────────────────────────────
  // "Combo Play — Spotify Premium + YouTube Premium | 3 Meses Cada" contém o
  // nome de outros serviços: se as regras por serviço viessem antes, o combo
  // cairia na plataforma de um deles (Spotify) em vez de ser um produto só.
  { titulo: "combo", destino: { slug: "combos", nome: "Combos", criar: true, icone: "🎁" } },

  // ── Streaming (já existem no DividePass) ────────────────────────────────
  { titulo: "amazon prime video", destino: { slug: "prime-video", nome: "Prime Video", criar: false } },
  { titulo: "prime video", destino: { slug: "prime-video", nome: "Prime Video", criar: false } },
  { titulo: "netflix", destino: { slug: "netflix", nome: "Netflix", criar: false } },
  { titulo: "spotify", destino: { slug: "spotify", nome: "Spotify", criar: false } },
  { titulo: "youtube premium", destino: { slug: "youtube", nome: "YouTube", criar: false } },
  { titulo: "crunchyroll", destino: { slug: "crunchyroll", nome: "Crunchyroll", criar: false } },

  // ── IA (já existem) ─────────────────────────────────────────────────────
  { titulo: "chatgpt", destino: { slug: "chatgpt", nome: "ChatGPT", criar: false } },
  { titulo: "api codex", destino: { slug: "chatgpt", nome: "ChatGPT", criar: false } },
  { titulo: "codex", destino: { slug: "chatgpt", nome: "ChatGPT", criar: false } },
  { titulo: "claude", destino: { slug: "claude", nome: "Claude", criar: false } },
  { titulo: "google ai plus", destino: { slug: "gemini", nome: "Gemini", criar: false } },
  { titulo: "google ai pro", destino: { slug: "gemini", nome: "Gemini", criar: false } },
  { titulo: "gemini", destino: { slug: "gemini", nome: "Gemini", criar: false } },

  // ── Produtividade (já existem) ──────────────────────────────────────────
  { titulo: "canva", destino: { slug: "canva", nome: "Canva", criar: false } },
  { titulo: "adobe express", destino: { slug: "creative-cloud", nome: "Creative Cloud", criar: false } },
  { titulo: "capcut", destino: { slug: "capcut", nome: "CapCut", criar: false } },
  { titulo: "figma", destino: { slug: "figma", nome: "Figma", criar: false } },
  { titulo: "notion", destino: { slug: "notion", nome: "Notion", criar: false } },
  { titulo: "apple music", destino: { slug: "apple-music", nome: "Apple Music", criar: false } },
  { titulo: "microsoft office 365", destino: { slug: "microsoft-365", nome: "Microsoft 365", criar: false } },
  { titulo: "duolingo", destino: { slug: "duolingo", nome: "DuoLingo", criar: false } },
  { titulo: "lovable", destino: { slug: "lovable", nome: "Lovable", criar: false } },

  // ── Plataformas que ainda não existem no DividePass ────────────────────
  { titulo: "nord vpn", destino: { slug: "nord-vpn", nome: "NordVPN", criar: true, icone: "🛡️" } },
  { titulo: "elevenlabs", destino: { slug: "elevenlabs", nome: "ElevenLabs", criar: true, icone: "🎙️" } },
  { titulo: "suno", destino: { slug: "suno", nome: "Suno", criar: true, icone: "🎵" } },
  { titulo: "ilovepdf", destino: { slug: "ilovepdf", nome: "iLovePDF", criar: true, icone: "📄" } },
  { titulo: "autodesk", destino: { slug: "autodesk", nome: "Autodesk", criar: true, icone: "🏗️" } },
  { titulo: "coursera", destino: { slug: "coursera", nome: "Coursera", criar: true, icone: "🎓" } },
  { titulo: "videoapi", destino: { slug: "videoapi", nome: "VIDEOAPI", criar: true, icone: "🎬" } },
  { titulo: "antigravity", destino: { slug: "antigravity", nome: "Antigravity", criar: true, icone: "🛰️" } },
  { titulo: "manus", destino: { slug: "manus", nome: "Manus", criar: true, icone: "🤖" } },
  { titulo: "muse ai", destino: { slug: "muse-ai", nome: "Muse AI", criar: true, icone: "🎨" } },
  { titulo: "clone", destino: { slug: "clones", nome: "Clones", criar: true, icone: "🧬" } },
  { titulo: "extensao", destino: { slug: "extensoes", nome: "Extensões", criar: true, icone: "🧩" } },
  { titulo: "pulse coding", destino: { slug: "extensoes", nome: "Extensões", criar: true, icone: "🧩" } },
];

/**
 * Descobre a plataforma de destino de um pacote.
 *
 * Regra: 1º título, 2º categoria (usando o slug derivado dela), 3º fallback
 * pela categoria (plataforma nova com o nome da categoria da Pulse).
 */
export function resolverPlataforma(pkg: PulsePackage): DestinoPlataforma {
  const titulo = normalizarTexto(pkg.title);
  const categoria = normalizarTexto(pkg.category);

  for (const regra of REGRAS_PLATAFORMA) {
    if (regra.titulo && titulo.includes(regra.titulo)) return regra.destino;
  }

  // Categoria conhecida que vira plataforma com o nome dela.
  const nomeDaCategoria = (pkg.category ?? "").trim();
  if (nomeDaCategoria) {
    const slug = slugify(nomeDaCategoria);
    return { slug, nome: nomeDaCategoria, criar: true, icone: "🧩" };
  }

  return { slug: "pulse", nome: "Pulse", criar: true, icone: "⚡" };
}

/** "Antigravity — 25 MILHÕES" -> "antigravity-25-milhoes" */
export function slugify(texto: string): string {
  return normalizarTexto(texto)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** A categoria entra no import automático? */
export function categoriaEhIgnorada(categoria: string | null | undefined): boolean {
  const c = normalizarTexto(categoria);
  return CATEGORIAS_IGNORADAS.includes(c);
}

// ---------------------------------------------------------------------------
// DURAÇÃO E CICLO
// ---------------------------------------------------------------------------

export interface CicloDerivado {
  /** Ciclo do grupo no DividePass. */
  billing_cycle: "monthly" | "quarterly" | "semiannual" | "annual" | "days";
  /** Dias de acesso que o cliente recebe (o grupo "vence" nesse prazo). */
  duration_days: number;
  custom_cycle_days: number | null;
  custom_cycle_months: number | null;
}

/**
 * Deriva a duração do produto a partir do título.
 *
 * "Amazon Prime Video 6M" -> 180 dias; "Duração De 1 dia - 100 créditos" ->
 * 1 dia; "Claude — 25 milhões de tokens" -> 30 dias (padrão, editável).
 *
 * Quando o título tem mais de uma unidade ("30 dias ... Por Dia"), vence a
 * PRIMEIRA que aparece — é a duração do produto.
 */
export function derivarCiclo(titulo: string | null | undefined): CicloDerivado {
  const t = normalizarTexto(titulo);

  const candidatos: Array<{ pos: number; dias: number }> = [];

  const reAno = /(\d+)\s*(ano|anos|ano(s)?)/.exec(t);
  if (reAno) candidatos.push({ pos: reAno.index ?? 0, dias: parseInt(reAno[1], 10) * 365 });

  const reMes = /(\d+)\s*(mes|meses)/.exec(t);
  if (reMes) candidatos.push({ pos: reMes.index ?? 0, dias: parseInt(reMes[1], 10) * 30 });

  const reDia = /(\d+)\s*(dia|dias)/.exec(t);
  if (reDia) candidatos.push({ pos: reDia.index ?? 0, dias: parseInt(reDia[1], 10) });

  // "1M" / "3M" / "6M" / "12M" colado no fim (ex.: "Amazon Prime Video 6M").
  const reM = /(\d+)\s*m\b/.exec(t);
  if (reM && !/\d+\s*(mes|meses)/.test(t)) {
    candidatos.push({ pos: reM.index ?? 0, dias: parseInt(reM[1], 10) * 30 });
  }

  candidatos.sort((a, b) => a.pos - b.pos);
  const dias = candidatos.length > 0 ? Math.max(1, candidatos[0].dias) : 30;

  if (dias % 365 === 0) {
    return {
      billing_cycle: "annual",
      duration_days: dias,
      custom_cycle_days: null,
      custom_cycle_months: Math.round(dias / 30),
    };
  }
  if (dias % 180 === 0) {
    return {
      billing_cycle: "semiannual",
      duration_days: dias,
      custom_cycle_days: null,
      custom_cycle_months: Math.round(dias / 30),
    };
  }
  if (dias % 90 === 0) {
    return {
      billing_cycle: "quarterly",
      duration_days: dias,
      custom_cycle_days: null,
      custom_cycle_months: Math.round(dias / 30),
    };
  }
  if (dias % 30 === 0) {
    return {
      billing_cycle: "monthly",
      duration_days: dias,
      custom_cycle_days: null,
      custom_cycle_months: Math.round(dias / 30),
    };
  }
  return {
    billing_cycle: "days",
    duration_days: dias,
    custom_cycle_days: dias,
    custom_cycle_months: null,
  };
}

/**
 * Rótulo do período, gravado em `groups.custom_cycle_label`.
 *
 * O front usa esse rótulo para não escrever "1 dias" nem "/mês por perfil"
 * num pacote que vale por 7 dias.
 */
export function rotuloCiclo(ciclo: CicloDerivado): string | null {
  if (ciclo.billing_cycle === "days") {
    const n = ciclo.custom_cycle_days ?? 0;
    if (n <= 0) return null;
    return `${n} ${n === 1 ? "dia" : "dias"}`;
  }
  if (ciclo.billing_cycle === "custom") {
    const n = ciclo.custom_cycle_months ?? 0;
    if (n <= 0) return null;
    return `${n} ${n === 1 ? "mês" : "meses"}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// NATUREZA DA COBRANÇA
// ---------------------------------------------------------------------------

export type NaturezaCobranca = "recorrente" | "pagamento_unico";

export interface ClassificacaoProduto {
  /** A cobrança se repete (assinatura) ou é uma compra só. */
  natureza: NaturezaCobranca;
  /** A entrega chega sozinha ou precisa de mão? */
  entrega: "automatica" | "manual";
  /** O produto entrega SALDO (créditos/tokens) em vez de acesso contínuo. */
  ehSaldo: boolean;
  /** O título traz um período ("1 mês", "12 meses", "7 dias"). */
  temPeriodo: boolean;
}

/**
 * CLASSIFICA A COBRANÇA DO PRODUTO.
 *
 * A API de revenda NÃO tem campo "recorrente": nenhum dos 23 campos diz se o
 * produto é assinatura ou pagamento único. A classificação sai do que a API
 * devolve de verdade:
 *
 *   - `delivery`: "automatica" | "manual" (a entrega chega sozinha ou por mão);
 *   - `credits` / `credit_amount`: saldo que vem junto;
 *   - o título: o período ("1 mês", "12 meses", "7 dias") e o tipo de saldo
 *     ("100 créditos", "1 BILHÃO DE TOKENS").
 *
 * Regra:
 *
 *   - ASSINATURA (`recorrente`): o produto dá ACESSO CONTÍNUO a um serviço e
 *     o cliente renova — "Netflix 1 mês", "Canva Pro 12 meses", "VIDEOAPI
 *     Plano Starter | 1 mês".
 *   - PAGAMENTO ÚNICO (`pagamento_unico`): o produto dá SALDO (créditos,
 *     tokens) ou é uma extensão curta — "Extensão 7 dias - 100 créditos",
 *     "ANTIGRAVITY 1 BILHÃO DE TOKENS", "CloneSupa - 2 Clones". O cliente não
 *     "renova": ele compra de novo quando o saldo acaba.
 */
export function classificarProduto(
  pkg: {
    title?: string | null;
    credits?: number | null;
    credit_amount?: number | null;
    delivery?: string | null;
  } | null | undefined,
  ciclo?: CicloDerivado | null,
): ClassificacaoProduto {
  const titulo = normalizarTexto(pkg?.title);
  const temPeriodo = /(\d+)\s*(anos?|mes(?:es)?|dias?|m\b)/.test(titulo);
  const ehSaldo =
    Number(pkg?.credits ?? 0) > 0 ||
    Number(pkg?.credit_amount ?? 0) > 0 ||
    /credito|token|saldo/.test(titulo);
  const entrega: "automatica" | "manual" =
    normalizarTexto(pkg?.delivery) === "manual" ? "manual" : "automatica";

  const natureza: NaturezaCobranca =
    !temPeriodo || ehSaldo || ciclo?.billing_cycle === "days" ? "pagamento_unico" : "recorrente";

  return { natureza, entrega, ehSaldo, temPeriodo };
}

/** Rótulo curto da natureza, para o painel. */
export function rotuloNatureza(natureza: NaturezaCobranca | string | null | undefined): string {
  return natureza === "recorrente" ? "Recorrente" : "Pagamento único";
}

// ---------------------------------------------------------------------------
// PREÇO
// ---------------------------------------------------------------------------

/**
 * Preço de venda no DividePass.
 *
 * Regra do dono: `original_price` (preço de venda ao consumidor final na
 * Pulse) + 20% de markup. Arredonda para 2 casas.
 */
export function calcularPrecoVenda(originalPrice: number | null | undefined, markup = MARKUP_PADRAO): number | null {
  if (originalPrice == null) return null;
  const base = Number(originalPrice);
  if (!Number.isFinite(base)) return null;
  return Math.round(base * (1 + (Number(markup) || 0) / 100) * 100) / 100;
}

/** Margem bruta em R$ (venda - custo). */
export function calcularMargem(precoVenda: number | null, custo: number | null): number | null {
  if (precoVenda == null || custo == null) return null;
  return Math.round((Number(precoVenda) - Number(custo)) * 100) / 100;
}

/** O pacote está vendável agora? */
export function pacoteEhVendavel(pkg: PulsePackage): boolean {
  if (pkg.orderable_via_api === false) return false;
  if (pkg.available === false) return false;
  if (pkg.availability === "unavailable") return false;
  return true;
}

// ---------------------------------------------------------------------------
// STATUS DO PRODUTO NA PULSE
// ---------------------------------------------------------------------------

/**
 * O status do produto na Pulse, no MESMO vocabulário do painel da Pulse.
 *
 *   - "na_vitrine"   → "Na vitrine": o parceiro libera o produto para revenda.
 *   - "indisponivel" → "Indisponível": o parceiro NÃO libera mais o produto.
 *
 * É esse status que manda no estado do grupo no DividePass: um grupo que
 * estava "Na vitrine" e vira "Indisponível" é DESATIVADO (ninguém paga,
 * ninguém entra) — e volta a ser reativado quando a Pulse volta a liberar.
 *
 * REGRA: status e ESTOQUE são coisas diferentes.
 *
 *   - status "Indisponível" → o produto não é oferecido; o grupo é
 *     desativado e sai da vitrine (não faz sentido anunciar o que o
 *     fornecedor tirou do cardápio);
 *   - status "Na vitrine" SEM estoque → o produto continua anunciado, mas
 *     marcado como "Esgotado" (a pessoa vê que existe, entra na lista de
 *     espera, mas não consegue comprar).
 *
 * Hoje os dois andam juntos no catálogo (os 23 produtos indisponíveis são
 * exatamente os 23 com estoque zero), mas a API trata os campos separados —
 * e é por isso que a sincronização olha para os dois.
 */
export type StatusPulse = "na_vitrine" | "indisponivel";

export function statusPulseDoPacote(pkg: PulsePackage): StatusPulse {
  return pacoteEhVendavel(pkg) ? "na_vitrine" : "indisponivel";
}

/** Rótulo do status no mesmo tom do painel da Pulse. */
export function rotuloStatusPulse(status: StatusPulse): string {
  return status === "na_vitrine" ? "Na vitrine" : "Indisponível";
}

/**
 * O parceiro TEM estoque deste pacote?
 *
 * A API traz cinco campos de estoque e eles NÃO concordam: `stock` é o
 * estoque automático (fica 0 em tudo que é de entrega manual), enquanto
 * `available_stock` é o que dá para vender agora. Por isso a resposta usa o
 * `available_stock` — usar o `stock` apagaria da vitrine 22 produtos que
 * ainda estão à venda.
 *
 * Estoque <= 0 não significa "some da vitrine": o grupo continua visível
 * com a tag "Esgotado" e o cliente não consegue entrar.
 */
export function pacoteTemEstoque(pkg: PulsePackage): boolean {
  if (pkg.in_stock === false) return false;
  if (pkg.available === false) return false;
  const disponivel = Number(pkg.available_stock);
  if (!Number.isFinite(disponivel)) return true; // sem o dado: não inventa zerado
  return disponivel > 0;
}

/**
 * Calcula as tags do grupo a partir do produto.
 *
 * "Esgotado" entra quando o parceiro não tem estoque; "Via Parceiro" sempre
 * (é o que marca o grupo como vindo da revenda).
 */
export function tagsDoGrupo(pkg: PulsePackage, temEstoque: boolean): string[] {
  return temEstoque ? [TAG_VIA_PARCEIRO] : [TAG_VIA_PARCEIRO, TAG_ESGOTADO];
}

/** Descrição da Pulse vira texto limpo para o card do grupo. */
export function limparDescricao(texto: string | null | undefined): string {
  if (!texto) return "";
  return String(texto)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
