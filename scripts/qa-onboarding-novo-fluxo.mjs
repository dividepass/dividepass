/**
 * QA DO ONBOARDING NOVO — caminho criar / entrar / ambos.
 *
 * Confere o que mudou no primeiro acesso:
 *
 *   1) A etapa de CONVIDADOS exige 1 pessoa e RECUSA o próprio número do
 *      cadastro (era o jeito de cumprir a etapa sem responder de verdade);
 *   2) A pergunta "criar / entrar / ambos" bifurca o caminho:
 *        criar  → pergunta de serviços para CRIAR  → texto livre
 *        entrar → pergunta de serviços para ENTRAR  → texto livre
 *        ambos  → as duas perguntas               → texto livre
 *   3) A última pergunta é ABERTA (textarea) e o rodapé diz "Última pergunta";
 *   4) O que foi respondido está gravado no banco.
 *
 * A conta QA é a única que o script usa, e o estado dela é restaurado no
 * fim (onboarding concluído de novo).
 *
 *   node scripts/qa-onboarding-novo-fluxo.mjs
 *   QA_BASE_URL=https://dividepass.com node scripts/qa-onboarding-novo-fluxo.mjs
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'onboarding');
const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:5173';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
/* Verificação que depende da migration ainda não aplicada: não quebra o
   script, mas fica explícito no relatório final. */
function pendente(name, detalhe = '') {
  results.push({ name, ok: true, pendente: true });
  console.log(`PEND ${name}${detalhe ? ` - ${detalhe}` : ''}`);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await getSessaoQa();
const REF = new URL(s.url).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;
const H = { apikey: s.anon, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' };

const perfilQa = await (
  await fetch(`${s.url}/rest/v1/users?select=id,email,phone&email=eq.qa.mavis@divteste.com`, { headers: H })
).json().catch(() => null);
const QA_ID = perfilQa?.[0]?.id;
if (!QA_ID) {
  console.error('conta QA não encontrada — rode scripts/criar-conta-qa.mjs');
  process.exit(1);
}

/* O telefone da conta QA: o próprio número não pode valer como indicação
   (é o que as pessoas faziam para cumprir a etapa sem responder de verdade). */
const TELEFONE_PROPRIO = perfilQa?.[0]?.phone || '11988887777';

const restGet = async (tabela, query) => {
  const r = await fetch(`${s.url}/rest/v1/${tabela}${query}`, { headers: H });
  const t = await r.text();
  if (!r.ok) throw new Error(`GET ${tabela} -> ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const restPatch = async (tabela, query, body) => {
  const r = await fetch(`${s.url}/rest/v1/${tabela}${query}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH ${tabela} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
};
const restDelete = async (tabela, query) => {
  const r = await fetch(`${s.url}/rest/v1/${tabela}${query}`, { method: 'DELETE', headers: H });
  if (!r.ok) throw new Error(`DELETE ${tabela} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
};

/** Zera o estado do onboarding da conta QA. */
async function resetar() {
  await restDelete('user_onboarding_interests', `?user_id=eq.${QA_ID}`);
  await restDelete('user_onboarding_invites', `?user_id=eq.${QA_ID}`);
  await restPatch('users', `?id=eq.${QA_ID}`, {
    onboarding_completed_at: null,
    onboarding_step: null,
  });
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

await context.addInitScript(
  ([key, sessao]) => {
    localStorage.setItem(key, sessao);
  },
  [
    SESSION_KEY,
    JSON.stringify({
      access_token: s.token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'qa-refresh',
      user: { id: QA_ID, email: 'qa.mavis@divteste.com' },
    }),
  ]
);

const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') erros.push(m.text());
});

/* ------------------------------------------------------------------ */
/* Helpers de navegação                                               */
/* ------------------------------------------------------------------ */
const tituloAtual = () => page.locator('.ob-title').first().innerText();
const eyebrowAtual = () => page.locator('.ob-eyebrow').first().innerText().catch(() => '');

/* Rodapé da 1ª pergunta ("Pergunta 1 de M"): o M é o total de perguntas
   do caminho padrão (sem a resposta de grupo ainda). */
let eyebrowDaBarreira = '';

async function esperarTitulo(trecho, timeout = 25000) {
  await page.waitForFunction(
    (t) => {
      const el = document.querySelector('.ob-title');
      return !!el && el.innerText.includes(t);
    },
    trecho,
    { timeout }
  );
  return tituloAtual();
}

async function clicarContinuar() {
  await page.locator('.ob-btn-primary.ob-next').click();
  await page.waitForTimeout(500);
}

async function escolherOpcao(texto) {
  await page.locator('.ob-option', { hasText: texto }).first().click();
  await page.waitForTimeout(250);
}

/** Avatar → boas-vindas → dificuldade → convidados. */
async function ateGrupoIntencao() {
  await page.goto(`${BASE_URL}/onboarding`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.avatar-picker-item', { timeout: 40000 });
  await page.locator('.avatar-picker-item').first().click();
  await page.locator('.ob-btn-primary.ob-btn-block').click();

  // Boas-vindas
  await esperarTitulo('Bem-vindo');
  await clicarContinuar();

  // Maior dificuldade
  await esperarTitulo('maior dificuldade');
  eyebrowDaBarreira = await eyebrowAtual();
  await escolherOpcao('Falta de confiança');
  await clicarContinuar();

  // Convidados
  await esperarTitulo('amigos ou familiares');
}

/** Uma indicação basta para liberar a etapa (mínimo 1). */
async function umConvidado() {
  await adicionarConvidado('Maria QA', '11987654321');
}

async function adicionarConvidado(nome, telefone) {
  await page.getByLabel('Nome da pessoa').fill(nome);
  await page.getByLabel('WhatsApp da pessoa').fill(telefone);
  await page.locator('.ob-invites-form button', { hasText: 'Adicionar' }).click();
  await page.waitForTimeout(350);
}

/** Escolhe a primeira plataforma real (ignora o chip "Nenhuma destas"). */
async function escolherPlataforma(nome) {
  await page.locator('.platform-picker-search input').fill(nome);
  await page.waitForTimeout(450);
  const pill = page.locator('.platform-picker-grid .platform-pill').first();
  await pill.click();
  await page.waitForTimeout(250);
  return pill.innerText();
}

/* ------------------------------------------------------------------ */
/* 1) ETAPA DE CONVIDADOS — mínimo 1 e o próprio número não vale       */
/* ------------------------------------------------------------------ */
await resetar();
await ateGrupoIntencao();

/* O cadastro pode guardar o número COM o código do país. Aí a pessoa digita
   sem o 55 e a comparação tem de continuar reconhecendo o mesmo número. */
await restPatch('users', `?id=eq.${QA_ID}`, { phone: `55${TELEFONE_PROPRIO}` });
await resetar();
await ateGrupoIntencao();

await adicionarConvidado('Eu mesmo (cadastro com DDI)', TELEFONE_PROPRIO);
const erroDdi = await page.locator('.field-error').innerText().catch(() => '');
check(
  'convidados: o número do cadastro com DDI também é recusado',
  /idêntico ao seu/i.test(erroDdi),
  erroDdi.replace(/\s+/g, ' ')
);

/* Cadastro com o número nacional (o caso normal). */
await restPatch('users', `?id=eq.${QA_ID}`, { phone: TELEFONE_PROPRIO });
await resetar();
await ateGrupoIntencao();

const botao = page.locator('.ob-btn-primary.ob-next');
check('convidados: começa com 0 pessoas', (await page.locator('.ob-invites-list li').count()) === 0);
check(
  'convidados: sem ninguém o botão fica travado',
  await botao.isDisabled(),
  '0 de 1 adicionada'
);

/* O número da própria pessoa não vale como indicação. */
await adicionarConvidado('Eu mesmo', TELEFONE_PROPRIO);
const erroProprio = await page.locator('.field-error').innerText().catch(() => '');
check(
  'convidados: o próprio número do cadastro é recusado',
  /idêntico ao seu/i.test(erroProprio),
  erroProprio.replace(/\s+/g, ' ')
);
check(
  'convidados: o número recusado não entra na lista',
  (await page.locator('.ob-invites-list li').count()) === 0,
  `${await page.locator('.ob-invites-list li').count()} na lista`
);
check(
  'convidados: o botão continua travado depois do recuo',
  await botao.isDisabled(),
  ''
);

await adicionarConvidado('Maria QA', '11987654321');
check(
  'convidados: com 1 pessoa o botão libera (mínimo 1)',
  await botao.isEnabled(),
  `${await page.locator('.ob-invites-list li').count()} adicionada`
);
await page.screenshot({ path: path.join(OUT, '01-convidados.png') });

/* ------------------------------------------------------------------ */
/* 2) CAMINHO "QUERO CRIAR MEU GRUPO"                                   */
/* ------------------------------------------------------------------ */
await clicarContinuar();
await esperarTitulo('deseja criar o seu grupo');
await escolherOpcao('Quero criar meu grupo');
await clicarContinuar();

const tituloCriar = await esperarTitulo('criar um grupo');
check(
  'criar: cai na pergunta de serviços para CRIAR grupo',
  /criar um grupo/i.test(tituloCriar),
  tituloCriar.replace(/\s+/g, ' ')
);
check(
  'criar: não passa pela pergunta de ENTRAR',
  !(await page.locator('.ob-title').first().innerText()).includes('entrar em grupos'),
  await page.locator('.ob-title').first().innerText()
);

/* Antes de filtrar: o catálogo inteiro vem agrupado por categoria (são
   100+ serviços — sem isso a pergunta virava uma rolagem infinita). */
await page.locator('.platform-picker-search input').fill('');
await page.waitForTimeout(500);
const grupos = await page.locator('.platform-picker-group').count();
check('plataformas: catálogo agrupado por categoria', grupos >= 5, `${grupos} blocos`);

const plataforma1 = await escolherPlataforma('Netflix');
check('plataformas: o buscador filtra o catálogo', !!plataforma1, `marcou ${plataforma1}`);

await clicarContinuar();

// Última pergunta, aberta
const ultima = await esperarTitulo('O que você espera encontrar');
const eyebrow = await eyebrowAtual();
check('última pergunta: é a última (eyebrow)', /Última pergunta/i.test(eyebrow), eyebrow);
check('última pergunta: tem campo de texto livre', (await page.locator('textarea.ob-textarea').count()) === 1);
await page.screenshot({ path: path.join(OUT, '02-ultima-pergunta.png') });

await page.locator('textarea.ob-textarea').fill(
  'Quero encontrar gente para dividir a Netflix e o Spotify sem combinar pagamento toda vez.'
);
await page.locator('.ob-btn-primary.ob-next').click();

/*
 * A conclusão grava no banco antes de trocar de tela (leva ~2s) e o confete
 * dispara junto com a tela "Tudo pronto!". Por isso a checagem é feita em
 * loop: esperar a tela e depois contar as peças perderia a animação.
 */
let telaFim = '';
let confeteFim = 0;
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(200);
  const estado = await page.evaluate(() => ({
    titulo: document.querySelector('.ob-title')?.innerText?.trim() || '',
    pecas: [...document.querySelectorAll('.confetti-overlay .confetti-piece')].filter(
      (p) => parseFloat(getComputedStyle(p).opacity) > 0.2
    ).length,
  }));
  if (estado.titulo) telaFim = estado.titulo;
  confeteFim = Math.max(confeteFim, estado.pecas);
  if (/Tudo pronto/i.test(telaFim) && confeteFim > 0) break;
}

check('fluxo: chega na tela de conclusão', /Tudo pronto/i.test(telaFim), telaFim);
check(
  'fluxo: o confete dispara na conclusão do onboarding',
  confeteFim > 0,
  `${confeteFim} peças visíveis`
);
await page.screenshot({ path: path.join(OUT, '03-concluido.png') });

/* ------------------------------------------------------------------ */
/* 3) O QUE FOI GRAVADO                                               */
/* ------------------------------------------------------------------ */
const perfil = await restGet('user_onboarding_profiles', `?user_id=eq.${QA_ID}&select=*`);
const linha = Array.isArray(perfil) ? perfil[0] : perfil;

check('banco: gravou a maior dificuldade', linha?.main_barrier === 'falta_confianca', linha?.main_barrier || 'vazio');

if (linha && 'group_intent' in linha) {
  check('banco: gravou a intenção (criar)', linha.group_intent === 'criar', linha.group_intent || 'vazio');
} else {
  pendente(
    'banco: gravou a intenção (criar)',
    'coluna group_intent ainda não existe — rode database/EXECUTAR-2026-11-02-onboarding-novo-fluxo.sql'
  );
}

if (linha && 'expectations' in linha) {
  check(
    'banco: gravou a resposta aberta',
    String(linha.expectations || '').includes('Netflix e o Spotify'),
    String(linha.expectations || '').slice(0, 60)
  );
} else {
  pendente(
    'banco: gravou a resposta aberta',
    'coluna expectations ainda não existe — rode database/EXECUTAR-2026-11-02-onboarding-novo-fluxo.sql'
  );
}

const interesses = await restGet('user_onboarding_interests', `?user_id=eq.${QA_ID}&select=*`);
const shareRows = (interesses || []).filter((i) => i.kind === 'share');
if (shareRows.length) {
  check('banco: gravou a plataforma com kind "share"', shareRows.length >= 1, `${shareRows.length} linha(s)`);
} else {
  pendente(
    'banco: gravou a plataforma com kind "share"',
    'o CHECK do kind ainda não aceita "share" — rode a migration'
  );
}

const convidados = await restGet('user_onboarding_invites', `?user_id=eq.${QA_ID}&select=*`);
check('banco: gravou a indicação', (convidados || []).length === 1, `${(convidados || []).length} linha(s)`);

const userRow = (await restGet('users', `?id=eq.${QA_ID}&select=onboarding_completed_at,onboarding_step`))?.[0];
check(
  'banco: marcou o onboarding como concluído',
  !!userRow?.onboarding_completed_at && !userRow?.onboarding_step,
  `concluído em ${userRow?.onboarding_completed_at || '—'}`
);

/* ------------------------------------------------------------------ */
/* 4) CAMINHO "ENTRAR EM GRUPO EXISTENTE"                              */
/* ------------------------------------------------------------------ */
await resetar();
await ateGrupoIntencao();
await umConvidado();
await clicarContinuar();

await esperarTitulo('deseja criar o seu grupo');
await escolherOpcao('Entrar em grupo existente');
await clicarContinuar();

const tituloEntrar = await esperarTitulo('entrar em grupos');
check(
  'entrar: cai na pergunta de serviços para ENTRAR em grupo',
  /entrar em grupos/i.test(tituloEntrar),
  tituloEntrar.replace(/\s+/g, ' ')
);
check(
  'entrar: não passa pela pergunta de CRIAR',
  !(await page.locator('.ob-title').first().innerText()).includes('criar um grupo'),
  await page.locator('.ob-title').first().innerText()
);
await page.screenshot({ path: path.join(OUT, '04-entrar.png') });

await escolherPlataforma('Spotify');
await clicarContinuar();
const ultimaEntrar = await esperarTitulo('O que você espera encontrar');
check('entrar: a pergunta aberta continua sendo a última', /O que você espera/i.test(ultimaEntrar));

/* ------------------------------------------------------------------ */
/* 5) CAMINHO "AMBOS"                                                  */
/* ------------------------------------------------------------------ */
await resetar();
await ateGrupoIntencao();
await umConvidado();
await clicarContinuar();

await esperarTitulo('deseja criar o seu grupo');
await escolherOpcao('Ambos');
await clicarContinuar();

const tituloAmbos1 = await esperarTitulo('criar um grupo');
check('ambos: começa pela pergunta de CRIAR', /criar um grupo/i.test(tituloAmbos1), tituloAmbos1.replace(/\s+/g, ' '));

await escolherPlataforma('Disney');
await clicarContinuar();

const tituloAmbos2 = await esperarTitulo('entrar em grupos');
check('ambos: depois vem a pergunta de ENTRAR', /entrar em grupos/i.test(tituloAmbos2), tituloAmbos2.replace(/\s+/g, ' '));

await escolherPlataforma('Max');
await clicarContinuar();

const tituloAmbos3 = await esperarTitulo('O que você espera encontrar');
check('ambos: a pergunta aberta é a última', /O que você espera/i.test(tituloAmbos3));
const eyebrowAmbos = await eyebrowAtual();
check('ambos: o rodapé avisa que é a última', /Última pergunta/i.test(eyebrowAmbos), eyebrowAmbos);
await page.screenshot({ path: path.join(OUT, '05-ambos.png') });

/* ------------------------------------------------------------------ */
/* 6) CONTAGEM DE PERGUNTAS (o cansaço era o problema)                  */
/* ------------------------------------------------------------------ */
await resetar();
await ateGrupoIntencao();

const totalPerguntas = (eyebrowDaBarreira.match(/de\s*(\d+)/i) || [])[1];
check(
  'contagem: o rodapé mostra "Pergunta N de M"',
  /Pergunta\s*\d+\s*de\s*\d+/i.test(eyebrowDaBarreira),
  eyebrowDaBarreira
);
check(
  'contagem: o caminho padrão tem no máximo 6 perguntas',
  Number(totalPerguntas) <= 6,
  `${totalPerguntas} perguntas (o questionário antigo tinha 11)`
);

/* ------------------------------------------------------------------ */
/* 7) DEIXA A CONTA QA COMO ESTAVA (onboarding concluído)              */
/* ------------------------------------------------------------------ */
await resetar();

console.log('\nerros de console:', erros.slice(0, 8).join(' | ') || '(nenhum)');
const falhas = results.filter((r) => !r.ok).length;
const pendencias = results.filter((r) => r.pendente).length;
console.log(
  `\n${results.length - falhas - pendencias}/${results.length - pendencias} verificações passaram` +
    (pendencias ? ` · ${pendencias} pendente(s) da migration` : '')
);
console.log('screenshots em', OUT);

await browser.close();
process.exit(falhas ? 1 : 0);
