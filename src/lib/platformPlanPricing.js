/**
 * PLANOS DA PLATAFORMA — REGRAS DE PREÇO (parte pura)
 * ==================================================
 *
 * Este módulo tem a matemática dos planos da plataforma SEM depender do
 * Supabase: dá para rodar em node (teste/QA) e no browser. A parte que fala
 * com o banco fica em `platformPlans.js`, que reexporta tudo daqui.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OS LIMITES DO PLANO SÃO POR PESSOA
 *
 * `min_price`, `max_price` e `suggested_price` são o valor que CADA MEMBRO
 * paga por mês (`groups.price_per_slot`) — não o total do grupo.
 *
 * Confirmação nos dados de produção:
 *   - o plano "Padrão - Com anúncio" (Prime Video) tem mínimo de R$ 4,90 e
 *     existe um grupo com EXATAMENTE R$ 4,90 por vaga;
 *   - se o limite fosse do total, 6 vagas a R$ 4,90 dariam R$ 0,82 por pessoa
 *     — abaixo do piso da plataforma (R$ 5,00 por vaga);
 *   - os 9 planos com faixa cadastrada têm o `suggested_price` DENTRO do
 *     próprio [min, max] — só acontece se os três campos estiverem na mesma
 *     escala, que é a de uma pessoa.
 */

/** Numero seguro: null quando o valor nao existe ou nao e numero. */
export function num(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Ordena planos: `sort_order` primeiro, depois preco oficial. */
export function sortPlans(plans) {
  return [...(plans || [])].sort((a, b) => {
    const orderDiff = (a.sort_order || 0) - (b.sort_order || 0);
    if (orderDiff !== 0) return orderDiff;
    return (num(a.official_price) || 0) - (num(b.official_price) || 0);
  });
}

/**
 * Limites de preco do plano (por pessoa).
 * @returns {{min:number|null, max:number|null, suggested:number|null}}
 */
export function planPriceBounds(plan) {
  return {
    min: num(plan?.min_price),
    max: num(plan?.max_price),
    suggested: num(plan?.suggested_price),
  };
}

/**
 * Faixa de preco POR PESSOA definida pelo plano (`min_price`/`max_price`).
 * É aqui que mora o teto: o dono não pode cobrar de cada membro mais (nem
 * menos) do que o plano permite.
 *
 * @returns {{min:number|null, max:number|null, suggested:number|null}}
 */
export function planSlotRange(plan) {
  const { min, max, suggested } = planPriceBounds(plan);
  return {
    min: min && min > 0 ? min : null,
    max: max && max > 0 ? max : null,
    suggested: suggested && suggested > 0 ? suggested : null,
  };
}

/**
 * Faixa de preco do TOTAL do grupo (a faixa por pessoa levada para o total
 * do grupo conforme o numero de vagas).
 *
 * @param {object} plan plano da plataforma
 * @param {number|string} slots quantidade de vagas do grupo
 * @returns {{min:number|null, max:number|null}}
 */
export function planTotalRange(plan, slots = 1) {
  const { min, max } = planSlotRange(plan);
  const count = Math.max(1, parseInt(slots, 10) || 1);
  return {
    min: min ? Math.round(min * count * 100) / 100 : null,
    max: max ? Math.round(max * count * 100) / 100 : null,
  };
}

/**
 * O preco por pessoa esta fora da faixa do plano?
 *
 * @param {object} plan plano da plataforma
 * @param {number|string} perSlot valor por pessoa (por vaga)
 * @returns {{outOfRange:boolean, min:number|null, max:number|null, below:boolean}}
 */
export function slotPriceOutOfRange(plan, perSlot) {
  const { min, max } = planSlotRange(plan);
  const value = parseFloat(perSlot);
  if (!Number.isFinite(value) || value <= 0 || (!min && !max)) {
    return { outOfRange: false, min, max, below: false };
  }
  const below = min ? value < min : false;
  const above = max ? value > max : false;
  return { outOfRange: below || above, min, max, below };
}

/**
 * A faixa do plano escrita por extenso — a mesma frase na tela de pagamento,
 * no erro de validação e no editor de planos.
 *
 * @param {object} plan plano da plataforma
 * @returns {string} ex.: "de R$ 6,00 a R$ 9,90 por pessoa"
 */
export function planSlotRangeText(plan, format = (v) => `R$ ${(parseFloat(v) || 0).toFixed(2).replace('.', ',')}`) {
  const { min, max } = planSlotRange(plan);
  if (min && max) return `de ${format(min)} a ${format(max)} por pessoa`;
  if (min) return `a partir de ${format(min)} por pessoa`;
  if (max) return `até ${format(max)} por pessoa`;
  return '';
}

/**
 * Linhas de detalhe do plano para o card (qualidade, telas, observacoes).
 * @returns {string[]}
 */
export function planDetailLines(plan) {
  const lines = [];
  if (plan?.quality) lines.push(`Qualidade: ${plan.quality}`);

  const screens = num(plan?.max_screens);
  if (screens) {
    lines.push(`Telas simultâneas: ${screens} aparelho${screens > 1 ? 's' : ''}`);
  }

  const members = num(plan?.max_members);
  if (members) {
    lines.push(`Até ${members} membro${members > 1 ? 's' : ''} no grupo`);
  }

  if (plan?.details) lines.push(plan.details);
  return lines;
}

/**
 * Nome automatico do grupo: [plataforma] + [plano]. Sem plano vinculado usa
 * [plataforma] + [id curto do grupo], que so existe depois do rascunho criado.
 */
export function buildGroupName({ platform, plan, groupId } = {}) {
  const platformName = (platform?.name || '').trim();
  const planName = (plan?.name || '').trim();

  if (platformName && planName) {
    return `${platformName} ${planName}`.slice(0, 200);
  }

  const shortId = (groupId || '').slice(0, 6).toUpperCase();
  if (platformName && shortId) {
    return `${platformName} ${shortId}`.slice(0, 200);
  }
  return platformName || 'Grupo';
}

/** `slug`/`plan_key` a partir do nome do plano. */
export function slugifyPlanKey(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/** Plano novo em branco (formulário de planos da plataforma). */
export function emptyPlanDraft() {
  return {
    id: '',
    name: '',
    official_price: '',
    max_members: '',
    suggested_price: '',
    min_price: '',
    max_price: '',
    max_screens: '',
    quality: '',
    details: '',
    billing_cycle: 'monthly',
    is_active: true,
  };
}

/**
 * O plano tem os campos novos (migration aplicada)? Sem eles o plano so
 * informa nome e preco oficial — o wizard mostra menos e nao trava o preco.
 */
export function planHasPricingBounds(plan) {
  return !!plan && ('min_price' in plan || 'suggested_price' in plan || 'max_price' in plan);
}

/* ---------------------------------------------------------------------------
 * PREÇO DO GRUPO A PARTIR DO PLANO
 * ------------------------------------------------------------------------- */

/**
 * Acréscimo aplicado sobre o valor do plano: o grupo cobra o plano + 8% e
 * esse total é fracionado entre as vagas abertas.
 */
export const GROUP_PLAN_MARKUP = 0.08;

/**
 * Valor base do plano usado para calcular o total do grupo.
 *
 * É o PREÇO OFICIAL do plano que aparece no card (o valor que a plataforma
 * cobra). O "valor sugerido" do plano só entra como reserva quando o oficial
 * não existe — usar um valor que o dono não vê no card quebraria a confiança
 * na conta.
 */
export function planBasePrice(plan) {
  if (!plan) return 0;
  const official = num(plan.official_price);
  if (official && official > 0) return official;
  const suggested = num(plan.suggested_price);
  if (suggested && suggested > 0) return suggested;
  return 0;
}

/**
 * Preço OFICIAL do plano (o que a plataforma cobra) — sem o valor sugerido
 * como reserva. Serve para mostrar ao dono o custo real da conta.
 */
export function planOfficialPrice(plan) {
  const official = num(plan?.official_price);
  return official && official > 0 ? official : 0;
}

/**
 * O total recomendado para o grupo.
 *
 * A ordem de preferencia:
 *   1) o VALOR SUGERIDO do plano (por pessoa) x vagas — é o que o admin
 *      cadastrou para este plano e sempre cabe dentro da faixa do proprio
 *      plano (min/max);
 *   2) sem valor sugerido: o preco oficial do plano + 8% (a margem do grupo).
 *
 * @param {object} plan plano da plataforma
 * @param {number|string} slots quantidade de vagas do grupo
 */
export function suggestedGroupTotal(plan, slots = 1) {
  const count = Math.max(1, parseInt(slots, 10) || 1);
  const { suggested } = planSlotRange(plan);

  if (suggested) return Math.round(suggested * count * 100) / 100;

  const base = planBasePrice(plan);
  if (!base) return 0;
  return Math.round(base * (1 + GROUP_PLAN_MARKUP) * 100) / 100;
}

/**
 * Valor por vaga: o total do grupo dividido pelas vagas abertas.
 * @param {number|string} total total do grupo
 * @param {number|string} slots quantidade de vagas
 */
export function pricePerSlot(total, slots) {
  const count = parseInt(slots, 10);
  const value = parseFloat(total);
  if (!Number.isFinite(value) || !count || count <= 0) return 0;
  return Math.round((value / count) * 100) / 100;
}

/**
 * Limite de vagas do grupo: o máximo do plano quando existe, senão o limite
 * da plataforma (`streaming_services.max_group_size`).
 */
export function maxSlotsFor(plan, service) {
  const fromPlan = parseInt(plan?.max_members, 10);
  if (Number.isFinite(fromPlan) && fromPlan > 0) return fromPlan;
  const fromService = parseInt(service?.max_group_size, 10);
  if (Number.isFinite(fromService) && fromService > 0) return fromService;
  return 10;
}
