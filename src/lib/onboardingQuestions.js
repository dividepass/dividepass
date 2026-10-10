/**
 * Questionário de qualificação do onboarding.
 *
 * Fica no código, e não no banco, de propósito: as respostas são gravadas
 * em colunas tipadas de user_onboarding_profiles, então cada pergunta
 * carrega a `column` que ela alimenta. Se o questionário vivesse numa
 * tabela editável pelo admin, Bastaria alguém reordenar uma etapa para o
 * vínculo com a coluna quebrar em silêncio.
 *
 * A página de relatório (/admin/onboarding) renderiza os textos e as barras
 * a partir daqui — é a mesma fonte que o gate usa para perguntar.
 *
 * Cada `value` precisa ser único dentro da pergunta: o relatório agrupa por
 * value, e valor repetido faz duas respostas diferentes aparecerem somadas
 * na mesma barra (foi o que acontecia na pesquisa "utilizacao").
 */

export const INTEREST_CATEGORIES = {
  STREAMING: ['streaming'],
  MUSIC: ['musica'],
  AI: ['ia'],
  HEALTH: ['saude'],
  OTHER: ['cursos', 'produtividade', 'ferramentas', 'leitura', 'games', 'seguranca'],
};

export const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    type: 'info',
    title: 'O que é a DividePass?',
    content:
      'Somos uma plataforma de compartilhamento de assinaturas digitais.\n\n' +
      'Aqui você entra em grupos já existentes, criados e gerenciados pela ' +
      'DividePass, ou cria o seu próprio para dividir os custos de serviços ' +
      'como Netflix, Disney+, Spotify, ChatGPT Plus e muito mais.\n\n' +
      'Assim você compartilha os custos de assinaturas oficiais e economizar, ' +
      'com potencial de redução de até 80%, dependendo do serviço e das ' +
      'condições disponíveis.\n\n' +
      'Vamos conhecer seus interesses para encontrar as melhores oportunidades para você!',
  },

  {
    id: 'subscriptions_count',
    type: 'single',
    column: 'subscriptions_count_band',
    title: 'Quantas assinaturas você paga atualmente?',
    options: [
      { value: '1-2', label: '1 a 2' },
      { value: '3-4', label: '3 a 4' },
      { value: '5-6', label: '5 a 6' },
      { value: '7-8', label: '7 a 8' },
      { value: '9-10', label: '9 a 10' },
      { value: '10+', label: 'Acima de 10' },
      { value: 'nenhuma', label: 'Não pago nenhuma' },
    ],
  },

  {
    id: 'monthly_spend',
    type: 'single',
    column: 'monthly_spend_band',
    title: 'Quanto você gasta por mês com assinaturas?',
    options: [
      { value: 'ate-50', label: 'Até R$ 50' },
      { value: '50-100', label: 'R$ 50 a R$ 100' },
      { value: '100-200', label: 'R$ 100 a R$ 200' },
      { value: '200-300', label: 'R$ 200 a R$ 300' },
      { value: '300-500', label: 'R$ 300 a R$ 500' },
      { value: '500+', label: 'Acima de R$ 500' },
      { value: 'nao-sei', label: 'Não sei informar' },
    ],
  },

  {
    // Ramificação: quem já compartilha cai em "com quem", quem não cai na
    // barreira. É o único tipo com desvio de próximo passo.
    id: 'already_shares',
    type: 'yes_no',
    column: 'already_shares',
    title: 'Você já compartilha alguma assinatura digital com outras pessoas?',
    yesNext: 'shares_with',
    noNext: 'main_barrier',
  },

  {
    id: 'shares_with',
    type: 'multiple',
    column: 'shares_with',
    thenNext: 'group_interest',
    title: 'Com quem você compartilha suas assinaturas?',
    options: [
      { value: 'familia', label: 'Família' },
      { value: 'amigos', label: 'Amigos' },
      { value: 'parceiro', label: 'Namorado(a) ou parceiro(a)' },
      { value: 'colegas', label: 'Colegas de trabalho' },
      { value: 'desconhecidos', label: 'Pessoas que não conheço pessoalmente' },
    ],
  },

  {
    id: 'main_barrier',
    type: 'single',
    column: 'main_barrier',
    thenNext: 'group_interest',
    title: 'Qual é a maior dificuldade para você começar a compartilhar assinaturas?',
    customField: 'main_barrier_other',
    customOption: 'outro',
    options: [
      { value: 'falta_confianca', label: 'Falta de confiança' },
      { value: 'nao_conheco_pessoas', label: 'Não conheço pessoas para dividir' },
      { value: 'receio_senha', label: 'Tenho receio de compartilhar senhas' },
      { value: 'esquecem_pagar', label: 'Pessoas esquecem de pagar' },
      { value: 'alguem_sai', label: 'Alguém pode sair do grupo' },
      { value: 'organizar_pagamentos', label: 'Dificuldade para organizar os pagamentos' },
      { value: 'nunca_pensei', label: 'Nunca pensei nisso' },
      { value: 'dificuldade_tudo', label: 'Tenho dificuldade com tudo isso' },
      { value: 'outro', label: 'Outro motivo' },
    ],
  },

  {
    // Pergunta de conversão: separa quem já quer entrar de quem só está
    // mirando. É o filtro principal do relatório.
    id: 'group_interest',
    type: 'single',
    column: 'group_interest',
    title: 'Você tem interesse em entrar em um grupo para dividir assinaturas?',
    options: [
      { value: 'sim', label: 'Sim, quero entrar em um grupo' },
      { value: 'talvez', label: 'Talvez, quero conhecer as opções' },
      { value: 'nao', label: 'Não tenho interesse no momento' },
    ],
  },

  {
    id: 'current_platforms',
    type: 'platforms',
    kind: 'current',
    title: 'Quais destas plataformas você utiliza atualmente?',
    helper: 'Selecione todas as plataformas que você já usa.',
    categories: [
      ...INTEREST_CATEGORIES.STREAMING,
      ...INTEREST_CATEGORIES.MUSIC,
      ...INTEREST_CATEGORIES.AI,
      ...INTEREST_CATEGORIES.HEALTH,
      ...INTEREST_CATEGORIES.OTHER,
    ],
  },

  {
    id: 'interested_streaming',
    type: 'platforms',
    kind: 'interested',
    title: 'Em quais serviços de filmes e séries você teria interesse em entrar em um grupo?',
    helper: 'Selecione todas as opções que despertam seu interesse.',
    categories: INTEREST_CATEGORIES.STREAMING,
  },

  {
    id: 'interested_music',
    type: 'platforms',
    kind: 'interested',
    title: 'Quais serviços de música você gostaria de compartilhar?',
    helper: 'Selecione todas as opções que despertam seu interesse.',
    categories: INTEREST_CATEGORIES.MUSIC,
  },

  {
    id: 'interested_ai',
    type: 'platforms',
    kind: 'interested',
    title: 'Quais ferramentas de inteligência artificial e produtividade te interessam?',
    helper: 'Selecione todas as opções que despertam seu interesse.',
    categories: [...INTEREST_CATEGORIES.AI, ...INTEREST_CATEGORIES.OTHER],
  },

  {
    id: 'interested_health',
    type: 'platforms',
    kind: 'interested',
    title: 'Quais aplicativos de saúde e bem-estar te interessam?',
    helper: 'Selecione todas as opções que despertam seu interesse.',
    categories: INTEREST_CATEGORIES.HEALTH,
  },

  {
    id: 'recommend',
    type: 'text',
    column: 'would_recommend',
    title: 'Indicaria o DividePass para alguém? Ou criaria um grupo com você?',
    helper: 'Opcional. Conte como você nos encontraria.',
    placeholder: 'Ex: criaria um grupo de Netflix com a minha família...',
  },
];

/** Passo inicial usado quando o gate abre, antes de qualquer pergunta. */
export const AVATAR_STEP_ID = 'avatar';

/**
 * Sequência effective de passos, resolvendo a ramificação do yes/no.
 * `answers` usa o formato { [id]: value } com value cru (string, array ou
 * booleano), que é o que `pickColumnValue` converte para gravar.
 */
export function buildOnboardingPath(answers) {
  const byId = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s.id, s]));
  const path = [];
  const seen = new Set();
  let cursor = ONBOARDING_STEPS[0].id;

  while (cursor && byId[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    const step = byId[cursor];
    path.push(step);

    if (step.type === 'yes_no') {
      const isYes = answers?.[step.id] === true || answers?.[step.id] === 'sim';
      cursor = (isYes ? step.yesNext : step.noNext) || null;
      continue;
    }

    // `thenNext` existe porque os dois alvos da ramificação (shares_with e
    // main_barrier) são vizinhos na lista: seguir pela posição cairia no
    // outro e perguntaria a barreira mesmo para quem respondeu "sim".
    if (step.thenNext) {
      cursor = step.thenNext;
      continue;
    }

    const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1];
    cursor = next?.id ?? null;
  }

  return path;
}

/**
 * Colunas tipadas alimentadas por um conjunto de respostas.
 * Só entra o que o passo realmente salva — os passos de plataforma vão
 * para user_onboarding_interests e ficam de fora daqui.
 */
export function pickColumnValues(answers) {
  const row = {};

  for (const step of ONBOARDING_STEPS) {
    // Precisa vir antes dos `continue` por tipo: a coluna complementar é de
    // um passo do tipo single (o "Outro motivo"), que sairia no primeiro if.
    if (step.customField && answers?.[step.id] === step.customOption) {
      const other = answers?.[step.customField];
      if (typeof other === 'string' && other.trim()) {
        row[step.customField] = other.trim();
      }
    }

    if (!step.column) continue;
    const value = answers?.[step.id];

    if (step.type === 'yes_no') {
      if (typeof value === 'boolean') row[step.column] = value;
      continue;
    }

    if (step.type === 'multiple') {
      if (Array.isArray(value) && value.length) row[step.column] = value;
      continue;
    }

    if (step.type === 'single' || step.type === 'text') {
      if (typeof value === 'string' && value.trim()) row[step.column] = value.trim();
      continue;
    }
  }

  return row;
}

/** Rótulo legível de uma opção, para o relatório e para o perfil. */
export function labelForValue(step, value) {
  if (!step?.options) return value;
  return step.options.find((o) => o.value === value)?.label ?? value;
}

/** Rótulo legível de uma coluna, para a aba do UserDetail. */
export function columnLabel(column) {
  const step = ONBOARDING_STEPS.find((s) => s.column === column);
  return step ? step.title : column;
}