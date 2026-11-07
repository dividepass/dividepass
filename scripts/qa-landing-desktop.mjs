/**
 * QA da landing no DESKTOP: o card do preço, o confete e a rolagem.
 *   node scripts/qa-landing-desktop.mjs
 */
import { chromium } from 'playwright';
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));

await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.split-demo', { timeout: 45000 });

/* Espera o grupo fechar para pegar o card cheio com o confete. */
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(700);
  const dentro = await page.locator('.split-part.is-in').count();
  if (dentro === 4) break;
}
await page.waitForTimeout(400);

const estado = await page.evaluate(() => {
  const card = document.querySelector('.split-demo');
  const r = card.getBoundingClientRect();
  return {
    pessoas: document.querySelectorAll('.split-part.is-in').length,
    vagas: document.querySelectorAll('.split-part.is-vaga').length,
    confete: card.querySelectorAll('.confetti-piece').length,
    largura: Math.round(r.width),
    /* o card não pode estourar a coluna do hero */
    estourou: r.width > window.innerWidth,
    scrollX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
check('desktop: o card mostra 4 pessoas', estado.pessoas === 4, `${estado.pessoas} pessoas`);
check('desktop: nenhuma vaga sobrando', estado.vagas === 0);
check('desktop: o confete está no card', estado.confete > 0, `${estado.confete} peças`);
check('desktop: o card não estourou a largura', !estado.estourou && !estado.scrollX, `largura ${estado.largura}px`);
await page.screenshot({ path: path.join(OUT, '05-desktop-card.png') });

/* Rolagem: todas as seções aparecem e nada some. */
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(1600);
const rodape = await page.evaluate(() => {
  const faq = document.querySelector('.faq-section');
  const cta = document.querySelector('.cta-section');
  return {
    faqVisivel: faq ? faq.getBoundingClientRect().height > 0 : false,
    ctaVisivel: cta ? cta.getBoundingClientRect().height > 0 : false,
    scrollX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
check('desktop: o FAQ aparece na rolagem', rodape.faqVisivel);
check('desktop: o CTA final aparece na rolagem', rodape.ctaVisivel);
check('desktop: a página não rola na horizontal', !rodape.scrollX);
await page.screenshot({ path: path.join(OUT, '06-desktop-rodape.png') });

console.log('\nerros de console:', erros.slice(0, 5).join(' | ') || '(nenhum)');
const falhas = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - falhas}/${results.length} verificações passaram`);

await browser.close();
process.exit(falhas ? 1 : 0);
