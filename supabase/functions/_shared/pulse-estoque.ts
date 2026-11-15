// ============================================================================
// ESTOQUE DO PARCEIRO — tag "Esgotado"
// ============================================================================
//
// O que este módulo faz
// --------------------
// Busca o catálogo na API de revenda (1 chamada) e aplica o estoque nos
// grupos Via Parceiro:
//
//   - estoque > 0  → tira a tag "Esgotado" (o produto volta a ser vendido);
//   - estoque <= 0 → põe a tag "Esgotado" (o grupo continua visível na
//     vitrine, mas ninguém entra e ninguém paga).
//
// Por que rodar no cron
// --------------------
// O `create-payment` bloqueia a venda quando a tag está lá — mas a tag só
// fica correta se o estoque for atualizado. Atualizar aqui custa UMA chamada
// de `list_packages` por rodada do polling (o job roda a cada 5 minutos), o
// que fica folgado dentro do limite de 30 requisições por minuto da API.
//
//Regra de estoque
// ---------------
// Quem manda é o `available_stock` (o que dá para vender agora) e NÃO o
// `stock`: em 22 produtos de entrega manual o `stock` é 0 mas ainda há
// estoque à venda. Usar o `stock` errado apagaria esses 22 da vitrine.
// ============================================================================

import { pulseListPackages } from "./pulse.ts";
import { pacoteTemEstoque, tagsDoGrupo, TAG_ESGOTADO, TAG_VIA_PARCEIRO } from "./pulse-catalog.ts";

export interface ResultadoEstoque {
  /** Grupos que tiveram a tag mudada. */
  atualizados: number;
  /** Quantos grupos estão sem estoque agora. */
  esgotados: number;
  /** A chamada na API falhou? */
  erro?: string;
}

/** Normaliza as tags para comparar (ordem não conta). */
function mesmasTags(a: unknown, b: unknown): boolean {
  const lista = (v: unknown): string[] =>
    (Array.isArray(v) ? v : [])
      .map((t) => String(t || "").trim())
      .filter(Boolean)
      .sort();
  const x = lista(a);
  const y = lista(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Atualiza o estoque (e a tag "Esgotado") dos grupos Via Parceiro.
 *
 * Nunca derruba o chamador: se a API falhar, devolve o erro no resultado e
 * deixa as tags como estão.
 */
export async function atualizarEstoque(supabaseAdmin: any): Promise<ResultadoEstoque> {
  let pacotes: any[] = [];
  try {
    const res = await pulseListPackages();
    pacotes = res?.packages ?? [];
  } catch (e: any) {
    return { atualizados: 0, esgotados: 0, erro: String(e?.message ?? e) };
  }

  if (!pacotes.length) {
    return { atualizados: 0, esgotados: 0, erro: "catálogo vazio" };
  }

  // Só o que já está importado interessa (o resto não tem grupo).
  const { data: espelhos } = await supabaseAdmin
    .from("pulse_pacotes")
    .select("package_id, group_id, stock")
    .not("group_id", "is", null);

  const grupoPorPacote = new Map<string, string>();
  for (const e of espelhos ?? []) {
    if (e?.package_id && e?.group_id) grupoPorPacote.set(e.package_id, e.group_id);
  }

  const estoquePorPacote = new Map<string, number>();
  for (const p of pacotes) {
    const disp = Number(p?.available_stock);
    estoquePorPacote.set(p.id, Number.isFinite(disp) ? disp : 0);
  }

  let atualizados = 0;
  let esgotados = 0;

  for (const [packageId, groupId] of grupoPorPacote) {
    const pkg = pacotes.find((p) => p.id === packageId);
    if (!pkg) continue;

    const temEstoque = pacoteTemEstoque(pkg);
    const tags = tagsDoGrupo(pkg, temEstoque);
    if (!temEstoque) esgotados++;

    // Estado atual do grupo (para não escrever à toa).
    const { data: grupo } = await supabaseAdmin
      .from("groups")
      .select("id, tags, status, visibility")
      .eq("id", groupId)
      .maybeSingle();

    if (!grupo) continue;

    // Só mexe no que está NA VITRINE. Grupo fora da vitrine (produto que o
    // parceiro nem libera para revenda) é cuidado pelo sync completo.
    if (grupo.status !== "open" || grupo.visibility !== "public") continue;

    const tagsAtuais = Array.isArray(grupo.tags) ? grupo.tags : [];
    const temViaParceiro = tagsAtuais.some(
      (t: string) => String(t || "").trim().toLowerCase() === TAG_VIA_PARCEIRO.toLowerCase(),
    );
    // Não mexe em grupo que não é da revenda.
    if (!temViaParceiro) continue;

    if (!mesmasTags(tagsAtuais, tags)) {
      await supabaseAdmin.from("groups").update({ tags }).eq("id", groupId);
      atualizados++;
    }

    // Mantém o espelho com o estoque atual (o painel mostra).
    const estoque = estoquePorPacote.get(packageId) ?? 0;
    const { data: espelho } = await supabaseAdmin
      .from("pulse_pacotes")
      .select("stock")
      .eq("package_id", packageId)
      .maybeSingle();
    if (espelho && Number(espelho.stock) !== estoque) {
      await supabaseAdmin
        .from("pulse_pacotes")
        .update({ stock: estoque, updated_at: new Date().toISOString() })
        .eq("package_id", packageId);
    }
  }

  return { atualizados, esgotados };
}

/** Só para o log ficar legível. */
export const TAG_ESGOTADO_LABEL = TAG_ESGOTADO;
