/**
 * QA DAS AJUSTES FINOS (2026-11-08) — dashboard, catálogo e plataforma.
 *
 * Confere no navegador (conta QA):
 *   - o filtro "Verificados" e o seletor de ordenação NÃO ficam grudados;
 *   - o header da plataforma tem só o nome + os 2 botões;
 *   - o slide da plataforma é arrastável no celular e tem altura proporcional;
 *   - a vitrine do dashboard no celular tem tópicos, banner, círculos e cards;
 *   - o catálogo tem o banner slider e os tópicos;
 *   - nenhuma rolagem horizontal na página.
 *
 *   npm run dev
 *   node scripts/qa-ajustes-finos.mjs
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'ajustes-finos');
const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:5173';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await getSessaoQa();
const REF = new URL(s.url).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;
const H = { apikey: s.anon, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' };
const QA_EMAIL = process.env.QA_EMAIL || 'qa.mavis@divteste.com';
const perfil = await (
  await fetch(`${s.url}/rest/v1/users?select=id&email=eq.${QA_EMAIL}`, { headers: H })
).json().catch(() => null);
const QA_ID = perfil?.[0]?.id;

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function fecharPortoes(p) {
  const alvos = [
    '.push-gate-skip',
    '.pwa-gate-skip',
    '.push-gate-secondary',
    '.pwa-gate-secondary',
    '.push-gate-close',
    '.pwa-gate-close',
  ];
  for (const sel of alvos) {
    const botao = p.locator(sel).first();
    if (await botao.count()) {
      await botao.click({ timeout: 3000 }).catch(() => {});
      await espera(350);
    }
  }
}

function sessao(page) {
  return page.addInitScript(
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
        user: { id: QA_ID, email: QA_EMAIL },
      }),
    ]
  );
}

/* ── DESKTOP ───────────────────────────────────────────────────────────── */
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
await sessao(page);

const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/i.test(m.text())) return;
  erros.push(m.text());
});

/* PLATAFORMA */
await page.goto(`${BASE_URL}/dashboard/catalog/netflix`, { waitUntil: 'domcontentloaded' });
await espera(3000);
await fecharPortoes(page);
await espera(500);

const headerTexto = await page.locator('.catalog-detail-header').first().innerText();
check(
  'header da plataforma tem só nome + botões',
  !headerTexto.includes('Escolha um grupo') &&
    !headerTexto.includes('grupos abertos') &&
    !headerTexto.includes('pessoas entraram') &&
    !headerTexto.includes('OFF'),
  headerTexto.replace(/\n/g, ' | ').slice(0, 120)
);
check(
  'header mantém os 2 botões',
  headerTexto.includes('Compartilhar') && headerTexto.includes('Lista de Espera'),
  headerTexto.replace(/\n/g, ' | ').slice(0, 120)
);

/* FILTROS: precisam ficar lado a lado, não grudados */
const filtro = await page.locator('.catalog-filters-row').first().boundingBox();
const verificados = await page.locator('.catalog-filters-row .filter-btn').first().boundingBox();
const seletor = await page.locator('.catalog-filters-row .sort-select-wrap').first().boundingBox();
check('filtros existem na tela', !!filtro && !!verificados && !!seletor);
if (filtro && verificados && seletor) {
  const mesmaLinha = Math.abs(verificados.y - seletor.y) < 6;
  const colados = Math.abs(verificados.x + verificados.width - seletor.x) < 4;
  check('filtros ficam na MESMA linha', mesmaLinha, `y=${Math.round(verificados.y)} vs ${Math.round(seletor.y)}`);
  check('filtros NÃO ficam grudados', !colados, `gap=${Math.round(seletor.x - (verificados.x + verificados.width))}px`);

  const busca = await page.locator('.catalog-filters .search-input-wrap').first().boundingBox();
  check(
    'filtros não invadem o campo de busca',
    !!busca && busca.x + busca.width <= verificados.x,
    `busca termina em ${busca ? Math.round(busca.x + busca.width) : '?'} / filtro começa em ${Math.round(verificados.x)}`
  );
}

/* SLIDES: trilho com scroll-snap (arrastável) */
const trilho = await page.locator('.plat-slides-track').first().boundingBox();
check('trilho dos slides existe', !!trilho);
const scroll = await page.locator('.plat-slides-track').first().evaluate((el) => ({
  overflowX: getComputedStyle(el).overflowX,
  snap: getComputedStyle(el).scrollSnapType,
  rolavel: el.scrollWidth > el.clientWidth + 4,
}));
check('trilho dos slides rola na horizontal', scroll.overflowX === 'auto', scroll.overflowX);
check('trilho dos slides tem scroll-snap (arrastável)', /x/.test(scroll.snap), scroll.snap);

await page.screenshot({ path: path.join(OUT, 'desktop-plataforma.png') });

/* CATÁLOGO */
await page.goto(`${BASE_URL}/dashboard/catalog`, { waitUntil: 'domcontentloaded' });
await espera(3000);
await fecharPortoes(page);
await espera(500);

check('catálogo tem o banner slider', (await page.locator('.cat-banner-card').count()) > 0);
check('catálogo tem os tópicos em cards', (await page.locator('.topic-card').count()) > 3);
check(
  'catálogo não tem mais o card quadrado de oferta',
  (await page.locator('.sponsored-section').count()) === 0
);

const topico = page.locator('.topic-card').nth(1);
if (await topico.count()) {
  await topico.click();
  await espera(600);
  const ativo = await page.locator('.topic-card.active').count();
  check('tópico filtra o catálogo', ativo > 0);
}

await page.screenshot({ path: path.join(OUT, 'desktop-catalogo.png') });

/* DASHBOARD */
await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
await espera(3500);
await fecharPortoes(page);
await espera(500);
await page.screenshot({ path: path.join(OUT, 'desktop-dashboard.png') });

/* ── MOBILE ────────────────────────────────────────────────────────────── */
const ctxM = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
const m = await ctxM.newPage();
await sessao(m);
m.on('pageerror', (e) => erros.push(`mobile: ${String(e)}`));

await m.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
await espera(3500);
await fecharPortoes(m);
await espera(600);

const vitrine = await m.locator('.storefront').count();
check('vitrine aparece no celular', vitrine > 0);
// Os ícones redondos dependem dos grupos (que chegam do contexto): espera
// a fileira aparecer antes de contar.
await m
  .waitForSelector('.storefront-circle', { timeout: 15000 })
  .catch(() => {});
check('vitrine tem tópicos', (await m.locator('.storefront .topic-card').count()) > 3);
check('vitrine tem banner', (await m.locator('.storefront .cat-banner-card').count()) > 0);
check(
  'vitrine tem ícones redondos',
  (await m.locator('.storefront-circle').count()) > 0,
  `${await m.locator('.storefront-circle').count()} círculos`
);
check('vitrine tem cards quadrados', (await m.locator('.storefront-card').count()) > 2);

const heroBox = await m.locator('.dash-hero').first().boundingBox();
check(
  'hero do celular não é gigante (altura < 420px)',
  !!heroBox && heroBox.height < 420,
  heroBox ? `${Math.round(heroBox.width)}x${Math.round(heroBox.height)}` : 'sem hero'
);

const titulo = await m.locator('.dash-hero-pick').first().innerText();
check('texto do hero é curto', titulo.length < 40, titulo);

const overflowDash = await m.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
);
check('dashboard no celular não tem rolagem horizontal', !overflowDash);

await m.screenshot({ path: path.join(OUT, 'mobile-dashboard.png') });
await m.screenshot({ path: path.join(OUT, 'mobile-dashboard-inteiro.png'), fullPage: true });

/* PLATAFORMA NO CELULAR */
await m.goto(`${BASE_URL}/dashboard/catalog/netflix`, { waitUntil: 'domcontentloaded' });
await espera(3000);
await fecharPortoes(m);
await espera(500);

const slideBox = await m.locator('.plat-slide').first().boundingBox();
check(
  'slide do celular tem altura proporcional (< 320px)',
  !!slideBox && slideBox.height < 320,
  slideBox ? `${Math.round(slideBox.width)}x${Math.round(slideBox.height)}` : 'sem slide'
);

const trackM = await m.locator('.plat-slides-track').first().evaluate((el) => ({
  overflowX: getComputedStyle(el).overflowX,
  snap: getComputedStyle(el).scrollSnapType,
}));
check('slide do celular é arrastável', trackM.overflowX === 'auto', trackM.overflowX);
check('slide do celular tem scroll-snap', /x/.test(trackM.snap || ''), trackM.snap);

const textoOculto = await m.locator('.plat-slide-sub').first().isVisible().catch(() => false);
check('descrição do slide some no celular', !textoOculto);

const overflowPlat = await m.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
);
check('plataforma no celular não tem rolagem horizontal', !overflowPlat);

await m.screenshot({ path: path.join(OUT, 'mobile-plataforma.png') });

/* CATÁLOGO NO CELULAR */
await m.goto(`${BASE_URL}/dashboard/catalog`, { waitUntil: 'domcontentloaded' });
await espera(3000);
await fecharPortoes(m);
await espera(500);
const overflowCat = await m.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
);
check('catálogo no celular não tem rolagem horizontal', !overflowCat);
await m.screenshot({ path: path.join(OUT, 'mobile-catalogo.png') });

check('sem erro de JS', erros.length === 0, erros.slice(0, 3).join(' | '));

await browser.close();

const falhas = results.filter((r) => !r.ok);
console.log('');
console.log(`RESULTADO: ${results.length - falhas.length}/${results.length} checks OK`);
console.log(`Screenshots em: ${OUT}`);
if (falhas.length) {
  falhas.forEach((f) => console.log(`  FALHOU: ${f.name} ${f.detail || ''}`));
  process.exit(1);
}
