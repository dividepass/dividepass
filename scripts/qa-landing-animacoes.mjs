/**
 * QA DAS ANIMAÇÕES DA LANDING PAGE.
 *
 * Confere o que foi pedido:
 *
 *   1) O card do preço sorteia a plataforma a cada visita (vem do catálogo
 *      com preço oficial real);
 *   2) As pessoas entram uma a uma (1 → 4) e o preço de cada uma cai;
 *   3) Quando o grupo fecha com 4 pessoas, o confete dispara;
 *   4) As seções aparecem animadas conforme a rolagem;
 *   5) O cadastro termina com confete.
 *
 * O cadastro é testado com a chamada de signup interceptada: nenhum usuário
 * real é criado no banco.
 *
 *   node scripts/qa-landing-animacoes.mjs
 *   QA_BASE_URL=https://dividepass.com node scripts/qa-landing-animacoes.mjs
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'landing');
const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:5173';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

/* ══════════════════════════════════════════════════════════════════ */
/* 1-3) O CARD DO PREÇO: sorteio, entrada das pessoas e confete       */
/* ══════════════════════════════════════════════════════════════════ */
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') erros.push(m.text());
});

await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.split-demo', { timeout: 45000 });

const lerCard = () =>
  page.evaluate(() => {
    const card = document.querySelector('.split-demo');
    if (!card) return null;
    const texto = (el) => el?.innerText?.trim() || '';
    const partes = [...card.querySelectorAll('.split-part')];
    return {
      plataforma: texto(card.querySelector('.split-service')),
      precoOficial: texto(card.querySelector('.split-price-full strong')),
      noGrupo: texto(card.querySelector('.split-group-badge')),
      dentro: partes.filter((p) => p.classList.contains('is-in')).length,
      vagas: partes.filter((p) => p.classList.contains('is-vaga')).length,
      precos: partes.map((p) => texto(p.querySelector('strong'))),
      confete: card.querySelectorAll('.confetti-piece').length,
    };
  });

const inicial = await lerCard();
check('card: o bloco do preço aparece', !!inicial, inicial?.plataforma);
check(
  'card: mostra o preço oficial da plataforma',
  /R\$\s*\d/.test(inicial?.precoOficial || ''),
  inicial?.precoOficial
);
check(
  'card: começa com 1 pessoa no grupo',
  inicial?.dentro === 1 && inicial?.vagas === 3,
  `${inicial?.dentro} dentro / ${inicial?.vagas} vagas`
);
await page.screenshot({ path: path.join(OUT, '01-card-1-pessoa.png') });

/* Acompanha a entrada das pessoas. */
const amostras = [];
let viuConfete = false;
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(800);
  const c = await lerCard();
  if (!c) break;
  amostras.push(c.dentro);
  if (c.confete > 0) viuConfete = true;
  if (c.dentro === 4 && viuConfete) {
    await page.screenshot({ path: path.join(OUT, '02-card-4-pessoas-confete.png') });
    break;
  }
}

const maxPessoas = Math.max(...amostras);
check(
  'card: as pessoas vão entrando no grupo',
  maxPessoas >= 4,
  `chegou a ${maxPessoas} pessoas (sequência: ${amostras.join(' → ')})`
);
check('card: o confete dispara quando o grupo fecha', viuConfete);

/* O preço por pessoa tem que cair junto com o grupo. */
const precoDe1 = (inicial?.precos || [])[0];
const precoFinal = await page.evaluate(() => {
  const partes = [...document.querySelectorAll('.split-part')];
  const dentro = partes.filter((p) => p.classList.contains('is-in'));
  return dentro.length ? dentro[dentro.length - 1].querySelector('strong')?.innerText?.trim() : '';
});
const numero = (t) => parseFloat(String(t || '').replace(/[^\d,]/g, '').replace(',', '.')) || 0;
check(
  'card: o preço de cada um cai quando mais gente entra',
  numero(precoFinal) > 0 && numero(precoFinal) < numero(precoDe1),
  `${precoDe1} → ${precoFinal}`
);

/* ══════════════════════════════════════════════════════════════════ */
/* 1b) A plataforma muda a cada visita                                */
/* ══════════════════════════════════════════════════════════════════ */
const sorteios = [];
for (let i = 0; i < 4; i++) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.split-demo .split-service', { timeout: 45000 });
  sorteios.push(
    await page.evaluate(() => document.querySelector('.split-service')?.innerText?.trim() || '')
  );
}
const distintas = new Set(sorteios);
check(
  'card: a plataforma muda a cada carregamento da página',
  distintas.size > 1,
  `viram: ${sorteios.join(' | ')}`
);

/* ══════════════════════════════════════════════════════════════════ */
/* 4) AS SEÇÕES APARECEM ANIMADAS NA ROLAGEM                           */
/* ══════════════════════════════════════════════════════════════════ */
await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.faq-section', { timeout: 45000 });

const antesDoScroll = await page.evaluate(() => {
  const s = document.querySelector('.faq-section');
  return getComputedStyle(s).transform;
});
await page.locator('.faq-section').scrollIntoViewIfNeeded();
await page.waitForTimeout(1400);
const depoisDoScroll = await page.evaluate(() => {
  const s = document.querySelector('.faq-section');
  const t = getComputedStyle(s).transform;
  return { transform: t, visivel: s.getBoundingClientRect().height > 0 };
});
check(
  'scroll: a seção anima ao entrar na tela',
  antesDoScroll !== depoisDoScroll.transform,
  `${antesDoScroll} → ${depoisDoScroll.transform}`
);
check('scroll: a seção continua visível depois de animar', depoisDoScroll.visivel);
await page.screenshot({ path: path.join(OUT, '03-scroll-faq.png') });

/* ══════════════════════════════════════════════════════════════════ */
/* 5) O CADASTRO TERMINA COM CONFETE                                  */
/* ══════════════════════════════════════════════════════════════════ */
/* O signup é interceptado: nenhum usuário real é criado. */
await page.route('**/auth/v1/signup', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      email: 'qa.animacoes@divteste.com',
      user: {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        email: 'qa.animacoes@divteste.com',
        created_at: new Date().toISOString(),
      },
    }),
  });
});

await page.goto(`${BASE_URL}/register`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#name', { timeout: 30000 });

await page.fill('#name', 'QA Animacoes');
await page.locator('.register-form button[type="submit"]').click();
await page.waitForSelector('#phone', { timeout: 15000 });
await page.fill('#phone', '11988887777');
await page.locator('.register-form button[type="submit"]').click();
await page.waitForSelector('#email', { timeout: 15000 });
await page.fill('#email', 'qa.animacoes@divteste.com');
await page.locator('.register-form button[type="submit"]').click();

/* Passo 4: origem (obrigatória). */
await page.waitForSelector('#leadSourceLabel', { timeout: 15000 });
await page.locator('.lead-source-option, .lead-source-pill, button:has-text("Google")').first().click();
await page.locator('.register-form button[type="submit"]').click();

await page.waitForSelector('#password', { timeout: 15000 });
await page.fill('#password', 'QaAnimacoes!2026');
await page.fill('#confirmPassword', 'QaAnimacoes!2026');
await page.locator('.register-form button[type="submit"]').click();

await page.waitForSelector('.success-message', { timeout: 25000 });
/* Espera as peças saírem do frame 0 (opacity 0) para contar as VISÍVEIS —
   o confete existe no DOM desde o primeiro frame. */
await page.waitForTimeout(700);
const confeteCadastro = await page.evaluate(() => {
  const pecas = [...document.querySelectorAll('.confetti-overlay .confetti-piece')];
  return pecas.filter((p) => parseFloat(getComputedStyle(p).opacity) > 0.2).length;
});
check('cadastro: a tela de sucesso aparece', true, 'Conta criada!');
check('cadastro: o confete dispara na conclusão', confeteCadastro > 0, `${confeteCadastro} peças visíveis`);
await page.screenshot({ path: path.join(OUT, '04-cadastro-confete.png') });

await ctx.close();

console.log('\nerros de console:', erros.slice(0, 6).join(' | ') || '(nenhum)');
const falhas = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - falhas}/${results.length} verificações passaram`);
console.log('screenshots em', OUT);

await browser.close();
process.exit(falhas ? 1 : 0);
