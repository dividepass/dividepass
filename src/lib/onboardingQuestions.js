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
  HEALTH: ['saude'],
  // Idiomas, finanças e cursos propriamente ditos (Duolingo, Busuu,
  // Nath Finanças, Descomplica, Brainly...).
  EDUCATION: ['cursos'],
  AI: ['ia', 'produtividade', 'ferramentas'],
  OTHER: ['leitura', 'games', 'seguranca'],
};

/* Nome legível de cada categoria de streaming_services. O relatório do
   onboarding usa para separar as plataformas dentro de cada pergunta — sem
   isso, o card de "filmes e séries" acaba mostrando junto o Spotify e o
   ChatGPT, porque o banco só guarda a categoria do serviço. */
export const CATEGORY_LABELS = {
  streaming: 'Filmes e séries',
  musica: 'Música',
  cursos: 'Educação e idiomas',
  ia: 'Inteligência artificial',
  produtividade: 'Produtividade',
  ferramentas: 'Ferramentas',
  leitura: 'Leitura',
  games: 'Games',
  saude: 'Saúde e bem-estar',
  seguranca: 'Segurança',
};

export const categoryLabel = (category) => CATEGORY_LABELS[category] || category || 'Outras';

export const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    type: 'info',
    title: 'Bem-vindo ao DividePass!',
    content:
      'Compartilhamos assinaturas digitais para você pagar até 80% menos ' +
      'em serviços como Netflix, Disney+ e Spotify.\n\n' +
      'Responda rapidinho para a gente encontrar as melhores oportunidades para você.',
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
    thenNext: 'current_platforms',
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
    thenNext: 'current_platforms',
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
    id: 'current_platforms',
    type: 'platforms',
    kind: 'current',
    title: 'Quais destas plataformas você utiliza atualmente?',
    helper: 'Marque as que você já usa.',
    categories: [
      ...INTEREST_CATEGORIES.STREAMING,
      ...INTEREST_CATEGORIES.MUSIC,
      ...INTEREST_CATEGORIES.HEALTH,
      ...INTEREST_CATEGORIES.EDUCATION,
      ...INTEREST_CATEGORIES.AI,
      ...INTEREST_CATEGORIES.OTHER,
    ],
  },

  {
    id: 'interested_streaming',
    type: 'platforms',
    kind: 'interested',
    title: 'Em quais serviços de filmes e séries você teria interesse em entrar em um grupo?',
    helper: 'Marque quantas quiser.',
    categories: INTEREST_CATEGORIES.STREAMING,
  },

  {
    id: 'interested_music',
    type: 'platforms',
    kind: 'interested',
    title: 'Quais serviços de música você gostaria de compartilhar?',
    helper: 'Marque quantas quiser.',
    categories: INTEREST_CATEGORIES.MUSIC,
  },

  {
    id: 'interested_education',
    type: 'platforms',
    kind: 'interested',
    title: 'Quais serviços de educação e idiomas te interessam?',
    helper: 'Cursos, idiomas e educação financeira.',
    categories: INTEREST_CATEGORIES.EDUCATION,
  },

  {
    id: 'interested_ai',
    type: 'platforms',
    kind: 'interested',
    title: 'Quais ferramentas de inteligência artificial e produtividade te interessam?',
    helper: 'Marque quantas quiser.',
    categories: INTEREST_CATEGORIES.AI,
  },

  {
    // Última etapa. Não é texto livre: o usuário adiciona as pessoas que
    // chamaria para um grupo, e o mínimo de 2 libera o botão de concluir.
    id: 'invites',
    type: 'invites',
    minInvites: 2,
    title: 'Se você fosse criar um grupo hoje para dividir assinaturas, tem amigos ou familiares que faria sentido convidar para participar?',
    helper: 'Adicione pelo menos 2 pessoas. Podemos avisar quando abrir grupos que combinam com elas.',
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

/**
 * Reconstroi o objeto `answers` a partir de uma linha de
 * user_onboarding_profiles — o inverso de pickColumnValues. Usado na
 * retomada do onboarding para preencher as etapas já respondidas.
 */
export function restoreAnswersFromProfile(row) {
  const answers = {};
  if (!row) return answers;

  for (const step of ONBOARDING_STEPS) {
    if (!step.column) continue;
    const value = row[step.column];
    if (value === null || value === undefined) continue;

    if (step.type === 'yes_no') {
      if (typeof value === 'boolean') answers[step.id] = value;
      continue;
    }
    if (step.type === 'multiple') {
      if (Array.isArray(value) && value.length) answers[step.id] = value;
      continue;
    }
    if (step.type === 'single') {
      answers[step.id] = value;
      continue;
    }
  }

  // Campo complementar do "Outro motivo".
  const barrier = ONBOARDING_STEPS.find((s) => s.column === 'main_barrier');
  if (barrier && answers[barrier.id] === barrier.customOption && row.main_barrier_other) {
    answers.main_barrier_other = row.main_barrier_other;
  }

  return answers;
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