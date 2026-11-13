// ============================================================================
// STATUS DOS GRUPOS VIA PARCEIRO — sincronização com a Pulse
// ============================================================================
//
// O que este módulo faz
// --------------------
// Lê o catálogo da Pulse (1 chamada) e deixa o estado de cada grupo Via
// Parceiro igual ao estado do produto na Pulse:
//
//   Pulse "Na vitrine"   → grupo `open`   + `public`  → liberado e clicável
//   Pulse "Indisponível" → grupo `closed` + `private` → DESATIVADO
//
// O que "desativado" significa na prática
// ---------------------------------------
// Um grupo desativado não aceita mais ninguém:
//
//   - sai da vitrine (não aparece para o cliente);
//   - o `create-payment` recusa com 403 `grupo_desativado`;
//   - o `joinGroup` recusa (ninguém entra no grupo);
//   - o checkout mostra a tela "Esgotado" em vez de cobrar.
//
// E VOLTA: quando a Pulse volta a liberar o produto, a sincronização reativa
// o grupo (`open` + `public`) e ele volta a aparecer na vitrine.
//
// REGRA DE OURO: só mexe em grupo cujo pacote ESTÁ no catálogo desta rodada.
// Se a API responder com o catálogo pela metade, nenhum grupo é desativado —
// é melhor um grupo "Na vitrine" velho do que apagar a vitrine inteira.
//
// Status e estoque são coisas diferentes
// -------------------------------------
//   - status "Indisponível" → o parceiro tirou o produto do cardápio: o grupo
//     é desativado e some da vitrine;
//   - status "Na vitrine" SEM estoque → o produto continua anunciado, mas o
//     grupo ganha a tag "Esgotado": a pessoa vê que existe e entra na lista
//     de espera, mas não consegue comprar (a tag é o bloqueio do
//     `create-payment`).
//
// Por que rodar no cron
// ---------------------
// Roda de 5 em 5 horas (job `pulse-status`). O estoque é atualizado a cada 5
// minutos pelo `pulse-poll`; o STATUS é mais estável e mudarar com menos
// frequência, então não precisa gastar chamada de API a cada 5 minutos.
// ============================================================================

import { pulseListPackages } from "./pulse.ts";
import {
  pacoteTemEstoque,
  statusPulseDoPacote,
  tagsDoGrupo,
  TAG_ESGOTADO,
  TAG_VIA_PARCEIRO,
  type PulsePackage,
  type StatusPulse,
} from "./pulse-catalog.ts";

export interface RelatorioStatusParceiro {
  /** Grupos Via Parceiro que foram analisados. */
  total: number;
  /** Quantos estão "Na vitrine" (liberados). */
  na_vitrine: number;
  /** Quantos o parceiro tirou do cardápio ("Indisponível" na Pulse). */
  indisponiveis: number;
  /** Quantos estão anunciados, porém SEM estoque (tag "Esgotado"). */
  esgotados: number;
  /** Grupos que foram DESATIVADOS nesta rodada (estavam abertos e saíram). */
  desativados: number;
  /** Grupos que foram REATIVADOS nesta rodada (voltaram a ser vendidos). */
  reativados: number;
  /** Grupos efetivamente escritos no banco. */
  atualizados: number;
  /** Grupos Via Parceiro sem pacote correspondente no catálogo. */
  sem_pacote: number;
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

function temTag(tags: unknown, tag: string): boolean {
  const lista = Array.isArray(tags) ? tags : [];
  return lista.some((t) => String(t || "").trim().toLowerCase() === tag.toLowerCase());
}

/**
 * Sincroniza o STATUS (e a disponibilidade) dos grupos Via Parceiro com a
 * Pulse.
 *
 * Nunca derruba o chamador: se a API falhar, devolve o erro no relatório e
 * não mexe em nenhum grupo.
 */
export async function sincronizarStatusParceiro(supabaseAdmin: any): Promise<RelatorioStatusParceiro> {
  const vazio: RelatorioStatusParceiro = {
    total: 0,
    na_vitrine: 0,
    indisponiveis: 0,
    esgotados: 0,
    desativados: 0,
    reativados: 0,
    atualizados: 0,
    sem_pacote: 0,
  };

  let pacotes: PulsePackage[] = [];
  try {
    const res = await pulseListPackages();
    pacotes = (res?.packages ?? []) as PulsePackage[];
  } catch (e: any) {
    return { ...vazio, erro: String(e?.message ?? e) };
  }

  if (!pacotes.length) {
    return { ...vazio, erro: "catálogo vazio" };
  }

  const agora = new Date().toISOString();

  // Espelhos: qual grupo corresponde a qual pacote.
  const { data: espelhos } = await supabaseAdmin
    .from("pulse_pacotes")
    .select("package_id, group_id, status, visible, stock")
    .not("group_id", "is", null);

  const grupoPorPacote = new Map<string, string>();
  for (const e of espelhos ?? []) {
    if (e?.package_id && e?.group_id) grupoPorPacote.set(e.package_id, e.group_id);
  }

  // Estado atual dos grupos Via Parceiro.
  const { data: grupos } = await supabaseAdmin
    .from("groups")
    .select("id, name, status, visibility, tags")
    .contains("tags", [TAG_VIA_PARCEIRO]);

  const grupoPorId = new Map<string, any>();
  for (const g of grupos ?? []) {
    if (g?.id) grupoPorId.set(g.id, g);
  }

  let naVitrine = 0;
  let indisponiveis = 0;
  let esgotados = 0;
  let desativados = 0;
  let reativados = 0;
  let atualizados = 0;

  for (const pkg of pacotes) {
    const groupId = grupoPorPacote.get(pkg.id);
    if (!groupId) continue; // produto que nunca foi importado: não é nosso grupo

    const grupo = grupoPorId.get(groupId);
    if (!grupo) continue;

    const statusPulse: StatusPulse = statusPulseDoPacote(pkg);
    const temEstoque = pacoteTemEstoque(pkg);

    // O que o grupo DEVE ficar, dado o estado do produto na Pulse.
    const desejado =
      statusPulse === "indisponivel"
        ? {
            // Partner tirou do cardápio → desativa e some da vitrine.
            // (sem a tag "Esgotado": o grupo não está na vitrine, a tag só
            // sujaria o dado — é o mesmo que o importador faz)
            status: "closed",
            visibility: "private",
            tags: [TAG_VIA_PARCEIRO],
          }
        : {
            // Na vitrine → continua anunciado; sem estoque leva a tag.
            status: "open",
            visibility: "public",
            tags: tagsDoGrupo(pkg, temEstoque),
          };

    if (statusPulse === "na_vitrine") naVitrine++;
    else indisponiveis++;
    if (desejado.tags.includes(TAG_ESGOTADO)) esgotados++;

    const mudancaDeStatus = String(grupo.status || "") !== desejado.status;
    const mudancaDeVisibilidade = String(grupo.visibility || "") !== desejado.visibility;
    const mudancaDeTags = !mesmasTags(grupo.tags, desejado.tags);

    if (mudancaDeStatus || mudancaDeVisibilidade || mudancaDeTags) {
      const { error } = await supabaseAdmin
        .from("groups")
        .update({
          status: desejado.status,
          visibility: desejado.visibility,
          tags: desejado.tags,
        })
        .eq("id", groupId);
      if (error) {
        console.error(`[pulse-status] erro ao atualizar o grupo "${grupo.name ?? groupId}":`, error.message);
        continue;
      }
      atualizados++;

      if (mudancaDeStatus) {
        if (desejado.status === "closed") {
          desativados++;
          console.log(`[pulse-status] desativado: ${grupo.name ?? groupId} (Pulse: Indisponível)`);
        } else {
          reativados++;
          console.log(`[pulse-status] reativado: ${grupo.name ?? groupId} (Pulse: Na vitrine)`);
        }
      }
    }

    // Espelho do painel: status do produto, visibilidade e estoque.
    const estoque = Number(pkg.available_stock);
    const estoqueFinal = Number.isFinite(estoque) ? estoque : 0;
    const statusEspelho = statusPulse === "na_vitrine" ? "importado" : "indisponivel";
    const visivelEspelho = statusPulse === "na_vitrine";

    const { data: espelho } = await supabaseAdmin
      .from("pulse_pacotes")
      .select("status, visible, stock")
      .eq("package_id", pkg.id)
      .maybeSingle();

    if (
      espelho &&
      (String(espelho.status || "") !== statusEspelho ||
        Boolean(espelho.visible) !== visivelEspelho ||
        Number(espelho.stock) !== estoqueFinal)
    ) {
      await supabaseAdmin
        .from("pulse_pacotes")
        .update({
          status: statusEspelho,
          visible: visivelEspelho,
          stock: estoqueFinal,
          availability: String(pkg.availability ?? ""),
          orderable_via_api: pkg.orderable_via_api !== false,
          last_synced_at: agora,
          updated_at: agora,
        })
        .eq("package_id", pkg.id);
    }
  }

  // Grupos Via Parceiro cujo pacote não veio no catálogo desta rodada: não
  // tocamos neles (podem ser só uma resposta parcial da API), mas contamos.
  let semPacote = 0;
  for (const g of grupos ?? []) {
    const temEspelho = (espelhos ?? []).some((e: any) => e.group_id === g.id);
    if (!temEspelho) semPacote++;
  }

  return {
    total: (grupos ?? []).length,
    na_vitrine: naVitrine,
    indisponiveis,
    esgotados,
    desativados,
    reativados,
    atualizados,
    sem_pacote: semPacote,
  };
}
