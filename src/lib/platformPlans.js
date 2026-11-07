import { supabase } from './supabase';
import { sortPlans, slugifyPlanKey } from './platformPlanPricing';

/**
 * PLANOS DA PLATAFORMA (service_plans)
 * ====================================
 *
 * A plataforma (streaming_services) tem N planos padrao. O dono do grupo
 * escolhe UM deles no wizard de criacao e, com isso, herda:
 *   - o teto de preco POR PESSOA (min_price / max_price) — ninguem cria
 *     grupo cobrando de cada membro mais (nem menos) do que o plano permite;
 *   - a quantidade maxima de membros (max_members);
 *   - os detalhes que aparecem no card (qualidade, telas simultaneas).
 *
 * IMPORTANTE: min_price / max_price / suggested_price são valores POR PESSOA
 * (é o que cada membro paga por mês), não o total do grupo.
 *
 * A matemática pura (faixas, total sugerido, nome do grupo) mora em
 * `platformPlanPricing.js` — sem dependencia do Supabase, para poder rodar
 * em node no QA. Aqui ficam só as funções que falam com o banco.
 *
 * As colunas novas entram por migration
 * (database/add-platform-plans-and-group-visibility.sql). Ate ela existir, o
 * front continua funcionando: os campos vem `undefined` e a UI so mostra o
 * que existe (nome + preco oficial).
 */

/* Reexporta toda a parte pura para quem importa deste arquivo. */
export {
  sortPlans,
  planPriceBounds,
  planSlotRange,
  planSlotRangeText,
  planTotalRange,
  slotPriceOutOfRange,
  planDetailLines,
  buildGroupName,
  slugifyPlanKey,
  emptyPlanDraft,
  planHasPricingBounds,
  GROUP_PLAN_MARKUP,
  planBasePrice,
  planOfficialPrice,
  suggestedGroupTotal,
  pricePerSlot,
  maxSlotsFor,
} from './platformPlanPricing';

/**
 * Planos ativos de uma plataforma.
 * @param {string} serviceId id da plataforma (streaming_services.id)
 * @returns {Promise<Array>} lista de planos (vazia se a plataforma nao tem plano)
 */
export async function fetchPlansForService(serviceId) {
  if (!serviceId) return [];

  const { data, error } = await supabase
    .from('service_plans')
    .select('*')
    .eq('service_id', serviceId)
    .eq('is_active', true);

  if (error) {
    console.error('[platformPlans] falha ao ler planos da plataforma:', error.message);
    return [];
  }
  return sortPlans(data || []);
}

/**
 * Planos de varias plataformas de uma vez (evita N consultas quando a tela
 * mostra varias plataformas com seus planos).
 * @param {string[]} serviceIds
 * @returns {Promise<Object>} mapa { [serviceId]: plans[] }
 */
export async function fetchPlansForServices(serviceIds) {
  const ids = (serviceIds || []).filter(Boolean);
  if (!ids.length) return {};

  const { data, error } = await supabase
    .from('service_plans')
    .select('*')
    .in('service_id', ids)
    .eq('is_active', true);

  if (error) {
    console.error('[platformPlans] falha ao ler planos:', error.message);
    return {};
  }

  const map = {};
  (data || []).forEach((plan) => {
    if (!map[plan.service_id]) map[plan.service_id] = [];
    map[plan.service_id].push(plan);
  });
  Object.keys(map).forEach((key) => { map[key] = sortPlans(map[key]); });
  return map;
}

/* ---------------------------------------------------------------------------
 * GRAVAR PLANOS (painel admin)
 * ------------------------------------------------------------------------- */

function toNumOrNull(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/** O banco respondeu que nao conhece uma das colunas novas. */
export function isMissingPlanColumn(error) {
  if (!error) return false;
  const texto = `${error.message || ''} ${error.details || ''} ${error.code || ''} ${error.hint || ''}`;
  return /(column|does not exist|nao existe|PGRST204|42703)/i.test(texto);
}

/**
 * Salva os planos de uma plataforma (cria/edita/remove).
 *
 * A migration pode ainda nao ter sido aplicada: nesse caso o insert/update
 * falha com 42703 e a gravacao e refeita so com as colunas antigas (o plano
 * fica salvo com nome e preco oficial, sem os limites).
 *
 * CONFLITO DE `plan_key`
 * ----------------------
 * A chave do plano vem do nome (`slugifyPlanKey`) e o banco tem
 * UNIQUE(service_id, plan_key). Duas Situacoes quebravam esse insert/update:
 *
 *  1) o plano novo tem o mesmo nome de um plano que JA existe no banco
 *     (a chave antiga ainda esta la) -> INSERT viola a unicidade;
 *  2) o admin renomeia um plano para o nome de OUTRO (troca de nomes) ->
 *     o UPDATE bate na chave que a outra linha ainda ocupa.
 *
 * A solucao aqui: as chaves sao calculadas olhando o estado final do banco
 * (linhas que ficam + a lista da tela), e a troca de chave acontece em
 * DUAS etapas — primeiro a linha vai para uma chave temporaria, depois para
 * a definitiva. Assim nunca existe duas linhas com a mesma chave ao mesmo
 * tempo, nem no meio do caminho.
 *
 * @param {string} serviceId plataforma
 * @param {Array} plans lista de planos (sem `id` = novo)
 * @param {string[]} originalIds ids dos planos que existiam antes (para remover)
 * @returns {Promise<{ok:boolean, saved:number, error?:string}>}
 */
export async function saveServicePlans(serviceId, plans, originalIds = []) {
  const list = (plans || []).filter(p => (p.name || '').trim());
  if (!serviceId) return { ok: false, saved: 0, error: 'Plataforma não informada.' };

  /* ── 1) estado atual dos planos da plataforma no banco ── */
  let dbRows = [];
  try {
    const { data, error: readErr } = await supabase
      .from('service_plans')
      .select('id, plan_key')
      .eq('service_id', serviceId);
    if (!readErr && Array.isArray(data)) dbRows = data;
  } catch {
    /* sem leitura: seguimos com a lista da tela (o insert ainda funciona) */
  }

  const currentIds = list.map(p => p.id).filter(Boolean);
  const removedIds = (originalIds || []).filter(id => id && !currentIds.includes(id));

  /* Chaves que continuam ocupadas por linhas que NAO vamos mexer. As linhas
     da propria lista sao excluidas: elas recebem a chave definitiva aqui. */
  const takenKeys = new Set(
    dbRows
      .filter(r => !currentIds.includes(r.id) && !removedIds.includes(r.id))
      .map(r => r.plan_key)
      .filter(Boolean),
  );

  const usedKeys = new Set();
  const prepared = list.map((plan, index) => {
    const base = slugifyPlanKey(plan.name) || `plano-${index + 1}`;
    let key = base;
    let suffix = 1;
    while (usedKeys.has(key) || takenKeys.has(key)) {
      suffix += 1;
      key = `${base}-${suffix}`.slice(0, 50);
    }
    usedKeys.add(key);

    return {
      id: plan.id || '',
      key,
      base: {
        service_id: serviceId,
        name: plan.name.trim().slice(0, 100),
        plan_key: key,
        billing_cycle: plan.billing_cycle || 'monthly',
        official_price: toNumOrNull(plan.official_price) ?? 0,
        currency: 'BRL',
        country: 'Brasil',
        is_active: plan.is_active !== false,
      },
      extra: {
        max_members: toIntOrNull(plan.max_members),
        suggested_price: toNumOrNull(plan.suggested_price),
        min_price: toNumOrNull(plan.min_price),
        max_price: toNumOrNull(plan.max_price),
        max_screens: toIntOrNull(plan.max_screens),
        quality: plan.quality || null,
        details: plan.details || null,
        is_default: !!plan.is_default,
        sort_order: index,
      },
    };
  });

  /* Chave que a linha tem hoje no banco (para saber se precisa trocar). */
  const currentKeyById = new Map(dbRows.map(r => [r.id, r.plan_key]));

  try {
    // 2) remove os planos que o admin apagou da lista
    for (const id of removedIds) {
      const { error: delErr } = await supabase.from('service_plans').delete().eq('id', id);
      if (delErr && !isMissingPlanColumn(delErr)) throw delErr;
    }

    /* 3) ETAPA 1 — tira as linhas que vão trocar de chave de um lugar
       temporário, para a troca de nomes não bater na chave da outra linha. */
    const renaming = prepared.filter(
      p => p.id && currentKeyById.get(p.id) && currentKeyById.get(p.id) !== p.key,
    );
    for (const plan of renaming) {
      const tempKey = `tmp-${plan.id.slice(0, 8)}-${Math.random().toString(36).slice(2, 8)}`;
      const { error: tmpErr } = await supabase
        .from('service_plans')
        .update({ plan_key: tempKey })
        .eq('id', plan.id);
      if (tmpErr && !isMissingPlanColumn(tmpErr)) throw tmpErr;
    }

    // 4) ETAPA 2 — grava cada plano (update com a chave definitiva / insert)
    for (const plan of prepared) {
      if (plan.id) {
        const full = { ...plan.base, ...plan.extra };
        let { error: updErr } = await supabase.from('service_plans').update(full).eq('id', plan.id);
        if (updErr && isMissingPlanColumn(updErr)) {
          const { error: retryErr } = await supabase
            .from('service_plans')
            .update(plan.base)
            .eq('id', plan.id);
          if (retryErr) throw retryErr;
        } else if (updErr) {
          throw updErr;
        }
      } else {
        const full = { ...plan.base, ...plan.extra };
        let { error: insErr } = await supabase.from('service_plans').insert(full);
        if (insErr && isMissingPlanColumn(insErr)) {
          const { error: retryErr } = await supabase.from('service_plans').insert(plan.base);
          if (retryErr) throw retryErr;
        } else if (insErr) {
          throw insErr;
        }
      }
    }

    return { ok: true, saved: prepared.length };
  } catch (error) {
    return { ok: false, saved: 0, error: error.message };
  }
}
