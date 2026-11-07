import { supabase } from './supabase';

/**
 * ENGAJAMENTO DE CATÁLOGO — regras de negócio das seções novas do dashboard.
 *
 * Tudo aqui roda no CLIENT (o usuário logado). As seções novas degradam com
 * elegância: se a migration `database/add-sponsored-offers.sql` ainda não foi
 * aplicada, a tabela não existe, o PostgREST devolve PGRST205 e a função
 * devolve um conjunto vazio em vez de explodir a tela inteira.
 */

/** O banco ainda não tem a tabela nova (migration não aplicada). */
export function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === 'PGRST205') return true;
  const texto = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
  return /does not exist|relation .* does not exist|schema cache/i.test(texto);
}

/** Erro de RLS/permissão: a seção some, mas o app continua vivo. */
function isForbiddenError(error) {
  if (!error) return false;
  const code = error.code || '';
  return code === '42501' || /permission denied|row-level security/i.test(
    `${error.message || ''} ${error.details || ''}`
  );
}

const logSilently = (scope, error) => {
  if (!error) return;
  // Ausência de tabela é o estado esperado antes da migration — não polui o console.
  if (isMissingTableError(error) || isForbiddenError(error)) return;
  // Ausência da RPC também: o SQL ainda não rodou. Silencia junto.
  if (isMissingFunctionError(error)) return;
  console.warn(`[${scope}]`, error.message);
};

/**
 * A RPC ainda não existe (o SQL da migration ainda não rodou).
 * O PostgREST responde PGRST202 / "Could not find the function ..." — não é
 * erro de código, é o estado esperado.
 */
function isMissingFunctionError(error) {
  if (!error) return false;
  if (error.code === 'PGRST202') return true;
  return /could not find the function|no function matches|function .* does not exist/i.test(
    `${error.message || ''} ${error.details || ''}`
  );
}

// ─────────────────────────────────────────────────────────────
// OFERTAS PATROCINADAS
// ─────────────────────────────────────────────────────────────

const SPONSORED_SELECT = `
  id,
  service_id,
  group_id,
  sponsor_user_id,
  sponsor_name,
  headline,
  description,
  badge,
  cta_label,
  cta_url,
  banner_url,
  placement,
  amount_paid,
  period_start,
  period_end,
  status,
  priority,
  impressions,
  clicks,
  created_at,
  service:service_id (
    id, name, full_name, slug, icon, icon_url, color, category,
    official_price, max_group_size
  ),
  group:group_id (
    id, name, slug, photo_url, price_per_slot, service_id, owner_id, max_size,
    service:service_id (id, name, slug, icon, icon_url, color)
  )
`;

/**
 * Ofertas ativas (a policy do banco já filtra status/período).
 * @param {'catalog'|'recommendation'} placement  filtro opcional de posição
 */
export async function fetchSponsoredOffers(placement) {
  try {
    const { data, error } = await supabase
      .from('sponsored_offers')
      .select(SPONSORED_SELECT)
      .eq('status', 'active')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(12);

    if (error) {
      logSilently('sponsored_offers', error);
      return [];
    }

    const offers = data || [];
    if (!placement) return offers;
    return offers.filter(
      (o) => o.placement === placement || o.placement === 'both'
    );
  } catch (err) {
    logSilently('sponsored_offers', err);
    return [];
  }
}

/**
 * Soma 1 numa métrica da oferta patrocinada (clique ou impressão).
 *
 * POR QUE UM RPC e não um UPDATE direto
 * ------------------------------------
 * A policy de `sponsored_offers` só deixa o ADMIN escrever. Um `PATCH` do
 * usuário comum é engolido pelo RLS: o PostgREST devolve **200 com lista
 * vazia** — sem erro, e a métrica nunca sai de zero. (Verificado: PATCH
 * anônimo em `sponsored_offers` → `200 []`.) Ou seja: o clique sumia e o
 * parceiro pagava por um destaque que não rendia nada mensurável.
 *
 * A RPC `increment_sponsor_metric` é SECURITY DEFINER: soma dentro do banco,
 * burla o RLS de propósito (é a única escrita pública na tabela) e só conta
 * oferta **ativa e dentro do período**.
 *
 * Best-effort: falhar a métrica não pode travar a navegação nem o clique.
 */
export async function registerSponsorMetric(offerId, metric = 'click') {
  if (!offerId) return;
  try {
    const { error } = await supabase.rpc('increment_sponsor_metric', {
      p_offer_id: offerId,
      p_metric: metric,
    });
    if (error) logSilently('increment_sponsor_metric', error);
  } catch (err) {
    logSilently('increment_sponsor_metric', err);
  }
}

/** Atalho: registra o clique no anúncio. */
export async function registerSponsorClick(offerId) {
  return registerSponsorMetric(offerId, 'click');
}

// ─────────────────────────────────────────────────────────────
// VOTOS ("O que você gostaria de compartilhar?")
// ─────────────────────────────────────────────────────────────

/** Service ids votados pelo usuário. */
export async function fetchUserVotes(userId) {
  if (!userId) return new Set();
  try {
    const { data, error } = await supabase
      .from('service_votes')
      .select('service_id')
      .eq('user_id', userId);

    if (error) {
      logSilently('service_votes', error);
      return new Set();
    }
    return new Set((data || []).map((row) => row.service_id));
  } catch (err) {
    logSilently('service_votes', err);
    return new Set();
  }
}

/**
 * Total de votos por serviço.
 * Usa a view `service_vote_counts` quando existe; senão cai para contar as
 * linhas de `service_votes` direto (o front só precisa do número).
 */
export async function fetchVoteCounts() {
  try {
    const { data, error } = await supabase
      .from('service_vote_counts')
      .select('service_id, votes')
      .limit(500);

    if (!error && data) {
      return new Map(data.map((row) => [row.service_id, Number(row.votes) || 0]));
    }
    logSilently('service_vote_counts', error);
  } catch (err) {
    logSilently('service_vote_counts', err);
  }

  try {
    const { data, error } = await supabase
      .from('service_votes')
      .select('service_id')
      .limit(5000);

    if (error) {
      logSilently('service_votes', error);
      return new Map();
    }
    const counts = new Map();
    (data || []).forEach((row) => {
      counts.set(row.service_id, (counts.get(row.service_id) || 0) + 1);
    });
    return counts;
  } catch (err) {
    logSilently('service_votes', err);
    return new Map();
  }
}

/**
 * Vota / deixa de votar. Devolve o novo estado (true = votou).
 */
export async function toggleServiceVote(serviceId, userId, wasVoted) {
  if (!userId || !serviceId) return { ok: false, voted: !!wasVoted };
  try {
    if (wasVoted) {
      const { error } = await supabase
        .from('service_votes')
        .delete()
        .eq('service_id', serviceId)
        .eq('user_id', userId);
      if (error) throw error;
      return { ok: true, voted: false };
    }

    const { error } = await supabase
      .from('service_votes')
      .upsert(
        { service_id: serviceId, user_id: userId },
        { onConflict: 'user_id,service_id', ignoreDuplicates: true }
      );
    if (error) throw error;
    return { ok: true, voted: true };
  } catch (err) {
    console.error('[service_votes] Falha ao votar:', err.message);
    return { ok: false, voted: !!wasVoted };
  }
}

// ─────────────────────────────────────────────────────────────
// LISTA DE ESPERA / "AVISE-ME QUANDO HOUVER UMA VAGA"
// Reaproveita `group_interest` (o que o admin já vê em "Lista de espera").
// ─────────────────────────────────────────────────────────────

export async function fetchWatchlist(userId) {
  if (!userId) return new Set();
  try {
    const { data, error } = await supabase
      .from('group_interest')
      .select('service_id')
      .eq('user_id', userId);

    if (error) {
      logSilently('group_interest', error);
      return new Set();
    }
    return new Set((data || []).map((row) => row.service_id));
  } catch (err) {
    logSilently('group_interest', err);
    return new Set();
  }
}

/** Liga/desliga o alerta de vaga para um serviço. */
export async function setWatchlist(serviceId, userId, active) {
  if (!userId || !serviceId) return { ok: false, watching: false };
  try {
    if (active) {
      const { error } = await supabase.from('group_interest').upsert(
        { service_id: serviceId, user_id: userId, group_id: null, message: null },
        { onConflict: 'service_id,user_id', ignoreDuplicates: true }
      );
      if (error) throw error;
      return { ok: true, watching: true };
    }

    const { error } = await supabase
      .from('group_interest')
      .delete()
      .eq('service_id', serviceId)
      .eq('user_id', userId);
    if (error) throw error;
    return { ok: true, watching: false };
  } catch (err) {
    console.error('[group_interest] Falha ao atualizar a lista de espera:', err.message);
    return { ok: false, watching: !active };
  }
}

// ─────────────────────────────────────────────────────────────
// INTERESSES DO ONBOARDING
// ─────────────────────────────────────────────────────────────

/** [{ serviceId, kind: 'current' | 'interested' }] */
export async function fetchUserInterests(userId) {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from('user_onboarding_interests')
      .select('platform_id, platform_name, kind')
      .eq('user_id', userId);

    if (error) {
      logSilently('user_onboarding_interests', error);
      return [];
    }
    return (data || [])
      .filter((row) => row.platform_id)
      .map((row) => ({
        serviceId: row.platform_id,
        name: row.platform_name,
        kind: row.kind,
      }));
  } catch (err) {
    logSilently('user_onboarding_interests', err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// CÁLCULO DE VAGAS E ECONOMIA (funções puras)
// ─────────────────────────────────────────────────────────────

export function countActiveMembers(group) {
  if (!group?.members) return 0;
  return group.members.filter(
    (m) => m.status === 'active' || m.status === 'pending'
  ).length;
}

export function getOpenSpots(group, service) {
  if (!group) return 0;
  if (group.has_slot_limit === false) return Infinity;
  const maxSize = group.max_size || service?.max_group_size;
  if (!maxSize) return Infinity;
  return Math.max(0, maxSize - countActiveMembers(group));
}

export function isGroupFull(group, service) {
  return getOpenSpots(group, service) === 0;
}

/**
 * Preço oficial de referência do serviço.
 * Preferimos o plano ativo mais barato (é o plano "padrão" que a pessoa
 * compraria sozinha) e caímos no preço da plataforma se não houver plano.
 */
export function getOfficialPrice(service, servicePlans = []) {
  const plans = (servicePlans || [])
    .filter((p) => p.service_id === service?.id && p.is_active !== false)
    .map((p) => Number(p.official_price))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (plans.length > 0) return Math.min(...plans);

  const direct = Number(service?.official_price);
  return Number.isFinite(direct) && direct > 0 ? direct : null;
}

/**
 * "Alternativas para economizar": serviços onde dividir mais sai bem mais barato
 * que comprar sozinho.
 */
export function buildSavingsOptions({ services, groups, servicePlans = [], limit = 4 }) {
  const options = [];

  services.forEach((service) => {
    const official = getOfficialPrice(service, servicePlans);
    if (!official) return;

    const serviceGroups = groups.filter(
      (g) => g.service_id === service.id && g.status !== 'closed'
    );
    if (serviceGroups.length === 0) return;

    const cheapest = serviceGroups.reduce(
      (min, g) => Math.min(min, Number(g.price_per_slot) || Infinity),
      Infinity
    );
    if (!Number.isFinite(cheapest) || cheapest <= 0) return;

    const savings = official - cheapest;
    if (savings <= 0) return;

    options.push({
      service,
      official,
      dividePassPrice: cheapest,
      savings,
      percent: Math.round((savings / official) * 100),
    });
  });

  return options
    .sort((a, b) => b.savings - a.savings || b.percent - a.percent)
    .slice(0, limit);
}

/**
 * Para onde o clique de uma oferta patrocinada leva.
 * Compartilhado entre o card grande (catálogo) e a faixa compacta do topo.
 */
export function resolveSponsorTarget(offer) {
  if (!offer) return null;
  if (offer.cta_url) return { external: true, href: offer.cta_url };
  if (offer.service) {
    return { external: false, to: `/dashboard/catalog/${offer.service.slug || offer.service.id}` };
  }
  if (offer.group) {
    const svc = offer.group.service;
    if (svc) return { external: false, to: `/dashboard/catalog/${svc.slug || svc.id}` };
    if (offer.group.slug) return { external: false, to: `/dashboard/groups/${offer.group.slug}` };
  }
  return null;
}

/**
 * "Novas vagas": grupos abertos com espaço sobrando, mais recentes primeiro.
 * `boostServiceIds` traz os serviços com oferta patrocinada para subirem.
 */
export function buildOpenOpportunities({ groups, services, limit = 4, boostServiceIds = new Set() }) {
  const servicesById = new Map(services.map((s) => [s.id, s]));

  return groups
    .filter((g) => g.status === 'open' || g.status === 'forming')
    .filter((g) => g.approval_status !== 'pending')
    .map((g) => {
      const service = servicesById.get(g.service_id);
      const spots = getOpenSpots(g, service);
      return { group: g, service, spots };
    })
    .filter((item) => item.spots === Infinity || item.spots > 0)
    .sort((a, b) => {
      const boostA = boostServiceIds.has(a.group.service_id) ? 1 : 0;
      const boostB = boostServiceIds.has(b.group.service_id) ? 1 : 0;
      if (boostA !== boostB) return boostB - boostA;

      const dateA = new Date(a.group.created_at || 0).getTime();
      const dateB = new Date(b.group.created_at || 0).getTime();
      return dateB - dateA;
    })
    .slice(0, limit);
}

// ─────────────────────────────────────────────────────────────
// RECOMENDAÇÕES
// ─────────────────────────────────────────────────────────────

const REASON = {
  current: 'Você já usa',
  interested: 'Combina com você',
  watchlist: 'Você pediu aviso de vaga',
  vote: 'Você votou nesse',
  sponsored: 'Oferta de parceiro',
  category: 'Gosta de coisas parecidas',
  new: 'Novidade no catálogo',
  popular: 'Popular entre quem divide',
};

/**
 * "Recomendados para você" — serviços escolhidos com base nos interesses da
 * pessoa. A ordenação é determinística e explicável: cada serviço carrega o
 * motivo pelo qual entrou na lista.
 *
 * @param {object} input
 * @param {Array}  input.services       serviços ativos do catálogo
 * @param {Array}  input.groups         grupos do usuário (com members)
 * @param {Array}  input.interests      [{ serviceId, kind }] do onboarding
 * @param {Set}    input.votes          ids votados
 * @param {Set}    input.watchlist      ids que a pessoa espera vaga
 * @param {Set}    input.subscribedIds  ids que a pessoa já assina
 * @param {Set}    input.sponsoredIds   ids com oferta patrocinada ativa
 * @param {Set}    input.boostServiceIds serviços sobriedos por doador
 */
export function buildRecommendations({
  services = [],
  groups = [],
  interests = [],
  votes = new Set(),
  watchlist = new Set(),
  subscribedIds = new Set(),
  sponsoredIds = new Set(),
  boostServiceIds = new Set(),
  limit = 6,
}) {
  const interestByService = new Map();
  interests.forEach((item) => {
    if (!item?.serviceId) return;
    const previous = interestByService.get(item.serviceId);
    // 'current' (uso hoje) pesa mais que 'interested' (tenho interesse)
    if (!previous || item.kind === 'current') {
      interestByService.set(item.serviceId, item.kind);
    }
  });

  // Categorias que a pessoa já assina → base para "gosta de coisas parecidas"
  const subscribedCategories = new Set(
    services
      .filter((s) => subscribedIds.has(s.id))
      .map((s) => s.category)
      .filter(Boolean)
  );

  const scored = [];

  services.forEach((service) => {
    if (!service || service.status === 'inactive') return;
    // Quem já tem o serviço não precisa de recomendação dele.
    if (subscribedIds.has(service.id)) return;

    const serviceGroups = groups.filter((g) => g.service_id === service.id);
    const openGroups = serviceGroups.filter((g) => {
      const spots = getOpenSpots(g, service);
      return spots === Infinity || spots > 0;
    });

    let score = 0;
    let reason = null;
    let reasonPriority = -1;

    const consider = (points, reasonKey) => {
      score += points;
      // Mantém o motivo mais forte (o primeiro que passa do threshold).
      if (points > reasonPriority) {
        reasonPriority = points;
        reason = reasonKey;
      }
    };

    const interestKind = interestByService.get(service.id);
    if (interestKind === 'current') consider(6, 'current');
    else if (interestKind === 'interested') consider(5, 'interested');

    if (watchlist.has(service.id)) consider(4, 'watchlist');
    if (votes.has(service.id)) consider(3, 'vote');

    // Paratrocínio: quem paga aparece antes — é o motor de receita.
    if (sponsoredIds.has(service.id) || boostServiceIds.has(service.id)) {
      consider(4, 'sponsored');
    }

    if (openGroups.length > 0) consider(3, null);
    else if (serviceGroups.length > 0) consider(1, null);

    if (subscribedCategories.has(service.category)) consider(2, 'category');

    // Popularidade: mais grupos = maisValidado pela comunidade
    score += Math.min(serviceGroups.length, 3);

    if (score <= 0) return;

    if (!reason) {
      reason = serviceGroups.length > 0 ? 'popular' : 'new';
    }

    scored.push({
      service,
      score,
      reason,
      reasonLabel: REASON[reason] || REASON.popular,
      groupCount: serviceGroups.length,
      openGroupCount: openGroups.length,
      openSpots: openGroups.reduce((acc, g) => {
        const spots = getOpenSpots(g, service);
        return acc + (spots === Infinity ? 0 : spots);
      }, 0),
      sponsored: sponsoredIds.has(service.id) || boostServiceIds.has(service.id),
    });
  });

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.openGroupCount !== a.openGroupCount) return b.openGroupCount - a.openGroupCount;
      return (a.service.name || '').localeCompare(b.service.name || '');
    })
    .slice(0, limit);
}

/**
 * Candidatos para o card "O que você gostaria de compartilhar?".
 * Prioriza o que a pessoa JÁ está esperando (é o voto que mais interessa) e
 * depois o que tem mais gente na fila mas ainda sem grupo.
 */
export function buildVoteCandidates({
  services = [],
  groups = [],
  watchlist = new Set(),
  votes = new Set(),
  voteCounts = new Map(),
  interestCounts = new Map(),
  limit = 6,
}) {
  const candidates = [];

  services.forEach((service) => {
    const serviceGroups = groups.filter((g) => g.service_id === service.id);
    const openGroups = serviceGroups.filter((g) => {
      const spots = getOpenSpots(g, service);
      return spots === Infinity || spots > 0;
    });

    const voteCount = voteCounts.get(service.id) || 0;
    const waiting = interestCounts.get(service.id) || 0;

    // Prioridade: o que a pessoa espera > o que tem mais votos > o que tem
    // mais gente na fila. Serviço já com vários grupos abertos entra por último.
    const priority =
      (watchlist.has(service.id) ? 100 : 0) +
      (votes.has(service.id) ? 50 : 0) +
      voteCount * 3 +
      waiting * 2 -
      openGroups.length * 5;

    candidates.push({
      service,
      voteCount,
      waiting,
      hasOpenGroup: openGroups.length > 0,
      voted: votes.has(service.id),
      priority,
    });
  });

  // Sem voto nenhum e sem ninguém na fila, não faz sentido mostrar o card.
  const totalVotes = candidates.reduce((acc, c) => acc + c.voteCount, 0);
  const totalWaiting = candidates.reduce((acc, c) => acc + c.waiting, 0);
  if (totalVotes === 0 && totalWaiting === 0) return [];

  return candidates
    .sort((a, b) => b.priority - a.priority || b.voteCount - a.voteCount)
    .slice(0, limit);
}

/**
 * Quantas pessoas estão esperando vaga por serviço.
 *
 * Usa a view `service_watchlist` (uma linha por pessoa na fila), que é
 * pública para autenticados. Ler a tabela `group_interest` direto NÃO
 * serve: o RLS entrega só as linhas do próprio usuário, então o card de
 * votação ficaria invisível para quem não está na fila de ninguém — e,
 * como ninguém visse o card, ninguém votaria nunca.
 */
export async function fetchInterestCounts() {
  try {
    const { data, error } = await supabase
      .from('service_watchlist')
      .select('service_id, user_id')
      .limit(5000);

    if (!error && data) {
      const counts = new Map();
      data.forEach((row) => {
        counts.set(row.service_id, (counts.get(row.service_id) || 0) + 1);
      });
      return counts;
    }
    logSilently('service_watchlist', error);
  } catch (err) {
    logSilently('service_watchlist', err);
  }

  // Fallback: sem a view, conta o que o RLS deixar ver (as próprias linhas).
  try {
    const { data, error } = await supabase
      .from('group_interest')
      .select('service_id')
      .limit(5000);

    if (error) {
      logSilently('group_interest', error);
      return new Map();
    }
    const counts = new Map();
    (data || []).forEach((row) => {
      counts.set(row.service_id, (counts.get(row.service_id) || 0) + 1);
    });
    return counts;
  } catch (err) {
    logSilently('group_interest', err);
    return new Map();
  }
}
