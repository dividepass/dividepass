/**
 * QA DO SLIDE EM DESTAQUE (2026-11-08) — grupo escolhido pelo admin.
 *
 * Confere o caminho COMPLETO do recurso:
 *   1) o PostgREST enxerga a coluna nova (`featured_in_slide`);
 *   2) a página pública da plataforma mostra o slide "Grupo em destaque"
 *      com o nome do grupo e o CTA "Quero entrar neste grupo";
 *   3) o slide é arrastável no celular (scroll-snap) e cabe na tela.
 *
 * A coluna é escolhida por SQL antes do teste (o botão do admin exige uma
 * sessão de admin, que este script não tem).
 *
 *   npm run dev
 *   node scripts/qa-destaque-slide.mjs
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa, qaGet } from './lib/conta-qa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'destaque-slide');
const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:5173';
const PLATAFORMA = process.env.QA_PLATAFORMA || 'netflix';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await getSessaoQa();
const REF = new URL(s.url).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;
const QA_EMAIL = process.env.QA_EMAIL || 'qa.mavis@divteste.com';
const perfil = await (
  await fetch(`${s.url}/rest/v1/users?select=id&email=eq.${QA_EMAIL}`, {
    headers: { apikey: s.anon, Authorization: `Bearer ${s.token}` },
  })
).json().catch(() => null);
const QA_ID = perfil?.[0]?.id;

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/* ── 1) O PostgREST enxerga a coluna nova? ───────────────────────────────── */
const marcados = await qaGet(
  'groups',
  `?select=id,name,service_id,featured_in_slide,max_size,has_slot_limit,members:group_members(status)&featured_in_slide=eq.true`
);
check(
  'PostgREST enxerga a coluna featured_in_slide',
  Array.isArray(marcados),
  marcados?.error_description || `${marcados?.length ?? 0} grupo(s) marcado(s)`
);

const GRUPO = marcados?.[0];
check('existe um grupo marcado para testar', !!GRUPO, GRUPO?.name || 'nenhum');

/* O slide precisa falar a verdade: grupo lotado não pode anunciar
   "Quero entrar neste grupo". */
const membrosAtivos = (GRUPO?.members || []).filter(
  (m) => m.status === 'active' || m.status === 'pending'
).length;
const LOTADO =
  GRUPO?.has_slot_limit !== false && Number(GRUPO?.max_size) > 0 && membrosAtivos >= Number(GRUPO.max_size);
const CTA_ESPERADO = LOTADO ? 'Entrar na lista de espera' : 'Quero entrar neste grupo';

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

const browser = await chromium.launch();

/* ── DESKTOP ───────────────────────────────────────────────────────────── */
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
await sessao(page);

const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));

await page.goto(`${BASE_URL}/dashboard/catalog/${PLATAFORMA}`, { waitUntil: 'domcontentloaded' });
await espera(3500);
await fecharPortoes(page);
await espera(600);

const primeiroSlide = page.locator('.plat-slide').first();
const textoSlide = await primeiroSlide.innerText().catch(() => '');
// O selo passa por text-transform: uppercase no CSS, então o texto lido vem
// em caixa alta. A comparação ignora a caixa.
const textoSlideLower = textoSlide.toLowerCase();
check(
  'o slide em destaque é o PRIMEIRO do trilho',
  textoSlideLower.includes('grupo em destaque'),
  textoSlide.replace(/\n/g, ' | ').slice(0, 120)
);
check(
  'o slide mostra o nome do grupo escolhido',
  !!GRUPO && textoSlide.includes(GRUPO.name),
  GRUPO?.name || 'sem grupo'
);
check(
  'o slide tem o CTA coerente com o estado do grupo',
  textoSlide.includes(CTA_ESPERADO),
  `esperado "${CTA_ESPERADO}" (lotado=${LOTADO})`
);
check(
  'grupo lotado: o slide avisa que está lotado',
  !LOTADO || textoSlideLower.includes('lotado'),
  textoSlideLower.includes('lotado') ? '' : 'sem aviso de lotado'
);
check(
  'grupo com vaga: o slide não inventa "lotado"',
  LOTADO || !textoSlideLower.includes('lotado'),
  ''
);
check(
  'o slide em destaque não tem a tag "OFF" (é escolha de curadoria)',
  !textoSlide.includes('OFF'),
  ''
);

const hrefCta = await primeiroSlide.locator('a[href*="/dashboard/groups/"]').first().getAttribute('href');
check('o CTA leva para o grupo', !!hrefCta, hrefCta || 'sem href');

const box = await primeiroSlide.boundingBox();
check('o slide cabe na largura da tela', !!box && box.width <= 1440, box ? `${Math.round(box.width)}px` : 'sem box');

await page.screenshot({ path: path.join(OUT, 'desktop-destaque.png'), fullPage: false });
check('sem erro de JS na página', erros.length === 0, erros.slice(0, 2).join(' | '));

/* ── MOBILE ────────────────────────────────────────────────────────────── */
const mctx = await browser.newContext({ ...devices['iPhone 13'] });
const m = await mctx.newPage();
await sessao(m);
const errosM = [];
m.on('pageerror', (e) => errosM.push(String(e)));

await m.goto(`${BASE_URL}/dashboard/catalog/${PLATAFORMA}`, { waitUntil: 'domcontentloaded' });
await espera(3500);
await fecharPortoes(m);
await espera(600);

const textoMobile = await m.locator('.plat-slide').first().innerText().catch(() => '');
const textoMobileLower = textoMobile.toLowerCase();
check(
  'no celular o slide em destaque aparece',
  textoMobileLower.includes('grupo em destaque') && !!GRUPO && textoMobile.includes(GRUPO.name),
  textoMobile.replace(/\n/g, ' | ').slice(0, 100)
);
check(
  'no celular o CTA também é coerente com o estado do grupo',
  textoMobile.includes(CTA_ESPERADO),
  `esperado "${CTA_ESPERADO}"`
);

const trilho = await m.locator('.plat-slides-track').first().evaluate((el) => ({
  overflowX: getComputedStyle(el).overflowX,
  snap: getComputedStyle(el).scrollSnapType,
}));
check('o trilho continua arrastável no celular', trilho.overflowX === 'auto', trilho.overflowX);
check('o trilho mantém o scroll-snap', /x/.test(trilho.snap || ''), trilho.snap);

const boxM = await m.locator('.plat-slide').first().boundingBox();
check(
  'o slide do celular tem altura proporcional',
  !!boxM && boxM.height < 320,
  boxM ? `${Math.round(boxM.width)}x${Math.round(boxM.height)}` : 'sem box'
);

const rolagem = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('sem rolagem horizontal na página', rolagem <= 1, `${rolagem}px`);

await m.screenshot({ path: path.join(OUT, 'mobile-destaque.png'), fullPage: false });
check('sem erro de JS no celular', errosM.length === 0, errosM.slice(0, 2).join(' | '));

await browser.close();

const passou = results.filter((r) => r.ok).length;
console.log(`\n${passou}/${results.length} verificacoes OK`);
if (passou !== results.length) {
  console.log('\nFALHAS:');
  for (const r of results.filter((x) => !x.ok)) console.log(` - ${r.name} ${r.detail}`);
  process.exitCode = 1;
}
