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
  { titulo: "combo", destino: { slug: "combos-pulse", nome: "Combos Pulse", criar: true, icone: "🎁" } },

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
  { titulo: "clone", destino: { slug: "pulse-clone", nome: "Pulse Clone", criar: true, icone: "🧬" } },
  { titulo: "extensao", destino: { slug: "pulse-coding", nome: "Pulse Coding", criar: true, icone: "🧩" } },
  { titulo: "pulse coding", destino: { slug: "pulse-coding", nome: "Pulse Coding", criar: true, icone: "🧩" } },
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

/** Descrição da Pulse vira texto limpo para o card do grupo. */
export function limparDescricao(texto: string | null | undefined): string {
  if (!texto) return "";
  return String(texto)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
