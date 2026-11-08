import { supabase } from './supabase';

/**
 * Insights da Visão Geral do dashboard.
 *
 * DOIS DADOS QUE O APP NÃO CONSEGUE LER SOZINHO (usuário comum):
 *
 *   1) "Top mais vendidos" — a RLS de `payments` só mostra o pagamento da
 *      própria pessoa. O ranking de VENDAS de todo mundo vem da função
 *      `dividepass_top_sold_services` (SECURITY DEFINER, só devolve contagem
 *      e preço).
 *
 *   2) "Últimas assinaturas" — quem entrou nos grupos, com nome mascarado.
 *      Vem de `dividepass_recent_subscribers`.
 *
 * AMBAS as funções podem ainda não existir em produção (o SQL é aplicado na
 * mão pelo time). Por isso TODA chamada aqui tem alternativa: se a função
 * não existir, o componente usa o ranking alternativo (popularidade pelos
 * grupos) e a lista de membros visíveis. A tela nunca fica quebrada por
 * causa de uma migration pendente.
 */

/** Função do banco ainda não aplicada em produção. */
function isMissingRpc(error) {
  if (!error) return false;
  const code = error.code || '';
  const message = error.message || '';
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    /does not exist/i.test(message) ||
    /não existe/i.test(message) ||
    /function .* not found/i.test(message)
  );
}

/** Formata "R$ 19,90" (sem depender do Intl do navegador). */
export function fmtBRL(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

/**
 * Mascaramento de nome: "Allan Martins" → "Allan M***".
 * Mesma regra do banco (primeiro nome + inicial do sobrenome).
 */
export function maskName(rawName) {
  const base = (rawName || '').trim();
  if (!base) return 'Participante';
  const semEmail = base.includes('@') ? base.split('@')[0] : base;
  const partes = semEmail.split(/\s+/).filter(Boolean);
  if (!partes.length) return 'Participante';
  const primeiro = partes[0];
  if (partes.length === 1) return primeiro;
  return `${primeiro} ${partes[1].charAt(0).toUpperCase()}***`;
}

/** Inicial do primeiro nome (a que aparece no círculo do avatar). */
export function initialOf(rawName) {
  const base = (rawName || '').trim();
  const semEmail = base.includes('@') ? base.split('@')[0] : base;
  return (semEmail.charAt(0) || '?').toUpperCase();
}

/**
 * Ranking de "mais vendidos".
 *
 * @returns {{ items: Array, source: 'db' | 'fallback' }}
 */
export async function fetchTopSoldServices({ limit = 10, services = [], groups = [] } = {}) {
  try {
    const { data, error } = await supabase.rpc('dividepass_top_sold_services', { p_limit: limit });

    if (error) {
      if (!isMissingRpc(error)) {
        console.warn('[dashboardInsights] top mais vendidos:', error.message);
      }
      return { items: buildPopularityRanking({ services, groups, limit }), source: 'fallback' };
    }

    const items = (data || []).map((row) => ({
      id: row.service_id,
      name: row.service_name,
      slug: row.service_slug,
      iconUrl: row.icon_url,
      color: row.color,
      category: row.category,
      officialPrice: Number(row.official_price) || 0,
      fromPrice: Number(row.from_price) || 0,
      soldCount: Number(row.sold_count) || 0,
      savingsPct: Number(row.savings_pct) || 0,
      groupsCount: Number(row.groups_count) || 0,
      source: 'db',
    }));

    // Se a função devolveu vazio (base ainda sem vendas), o ranking
    // alternativo dá a tela pra quem está começando.
    if (!items.length) {
      return { items: buildPopularityRanking({ services, groups, limit }), source: 'fallback' };
    }

    return { items, source: 'db' };
  } catch (err) {
    console.warn('[dashboardInsights] top mais vendidos (fallback):', err?.message);
    return { items: buildPopularityRanking({ services, groups, limit }), source: 'fallback' };
  }
}

/**
 * RANKING ALTERNATIVO — usado enquanto a função do banco não existe (ou quando
 * ainda não houve venda). Ordena por popularidade real: quantas pessoas já
 * estão nos grupos de cada plataforma. Não é "vendas", mas é o mesmo spirit de
 * "o que a galera mais compra" e não mente sobre o número.
 */
export function buildPopularityRanking({ services = [], groups = [], limit = 10 }) {
  const porServico = new Map();

  groups.forEach((group) => {
    if (!group?.service_id) return;
    // Só quem PAGOU (membro ativo). "pending" ainda não entrou.
    const membros = (group.members || []).filter((m) => m.status === 'active').length;
    const atual = porServico.get(group.service_id) || { membros: 0, grupos: 0, preco: Infinity };
    atual.membros += membros;
    atual.grupos += 1;
    const preco = Number(group.price_per_slot);
    if (Number.isFinite(preco) && preco > 0 && preco < atual.preco) atual.preco = preco;
    porServico.set(group.service_id, atual);
  });

  const ranking = services
    .filter((s) => s?.status === 'active' || !s?.status)
    .map((s) => {
      const info = porServico.get(s.id) || { membros: 0, grupos: 0, preco: Infinity };
      const fromPrice = Number.isFinite(info.preco) ? info.preco : 0;
      const officialPrice = Number(s.official_price) || 0;
      return {
        id: s.id,
        name: s.name,
        slug: s.slug,
        iconUrl: s.icon_url,
        color: s.color,
        category: s.category,
        officialPrice,
        fromPrice,
        soldCount: info.membros,
        savingsPct:
          officialPrice > 0 && fromPrice > 0
            ? Math.round(((officialPrice - fromPrice) / officialPrice) * 100)
            : 0,
        groupsCount: info.grupos,
        // Sem a função do banco, o número NÃO é venda: é gente no grupo.
        // O card muda o rótulo para não mentir.
        source: 'fallback',
      };
    })
    .filter((item) => item.groupsCount > 0)
    .sort(
      (a, b) =>
        b.soldCount - a.soldCount ||
        b.groupsCount - a.groupsCount ||
        (a.name || '').localeCompare(b.name || '')
    );

  return ranking.slice(0, limit);
}

/**
 * Últimas assinaturas (nome mascarado + avatar + inicial).
 *
 * @returns {{ items: Array, source: 'db' | 'fallback' }}
 */
export async function fetchRecentSubscribers({ serviceId = null, limit = 8 } = {}) {
  try {
    const { data, error } = await supabase.rpc('dividepass_recent_subscribers', {
      p_service_id: serviceId,
      p_limit: limit,
    });

    if (error) {
      if (!isMissingRpc(error)) {
        console.warn('[dashboardInsights] últimas assinaturas:', error.message);
      }
      return { items: await fetchRecentSubscribersFallback({ serviceId, limit }), source: 'fallback' };
    }

    const items = (data || []).map((row) => ({
      id: row.user_id,
      displayName: row.display_name,
      initial: row.initial,
      avatarUrl: row.avatar_url,
      joinedAt: row.joined_at,
      groupName: row.group_name,
      serviceName: row.service_name,
      serviceSlug: row.service_slug,
    }));

    return { items, source: 'db' };
  } catch (err) {
    console.warn('[dashboardInsights] últimas assinaturas (fallback):', err?.message);
    return { items: await fetchRecentSubscribersFallback({ serviceId, limit }), source: 'fallback' };
  }
}

/**
 * LISTA ALTERNATIVA — usada enquanto a função do banco não existe.
 * Lê os Membros dos grupos (a RLS já libera isso para qualquer usuário
 * logado) e monta a mesma lista com o nome mascarado no navegador.
 */
async function fetchRecentSubscribersFallback({ serviceId = null, limit = 8 }) {
  try {
    let query = supabase
      .from('group_members')
      .select(
        `
        id, status, created_at,
        user:user_id (id, name, nickname, avatar_url),
        group:group_id (id, name, service_id, service:service_id (id, name, slug))
      `
      )
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(120);

    const { data, error } = await query;
    if (error) {
      console.warn('[dashboardInsights] membros do grupo (fallback):', error.message);
      return [];
    }

    return (data || [])
      .map((member) => {
        const service = member.group?.service || null;
        const rawName = member.user?.nickname || member.user?.name || '';
        return {
          id: member.user?.id || member.id,
          displayName: maskName(rawName),
          initial: initialOf(rawName),
          avatarUrl: member.user?.avatar_url || null,
          joinedAt: member.created_at,
          groupName: member.group?.name || null,
          serviceName: service?.name || null,
          serviceSlug: service?.slug || null,
          serviceId: service?.id || null,
        };
      })
      .filter((row) => (serviceId ? row.serviceId === serviceId : true))
      .slice(0, limit);
  } catch (err) {
    console.warn('[dashboardInsights] últimas assinaturas (fallback):', err?.message);
    return [];
  }
}

/** "há 3 dias", "há 2 horas" — para a lista de últimas assinaturas. */
export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';

  const minutos = Math.floor(diff / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;

  const dias = Math.floor(horas / 24);
  if (dias < 30) return `há ${dias} dia${dias === 1 ? '' : 's'}`;

  const meses = Math.floor(dias / 30);
  return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
}
