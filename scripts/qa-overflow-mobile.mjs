/**
 * Diagnóstico de overflow horizontal no mobile (2026-11-08).
 * Lista os elementos que estouram a largura da viewport.
 *
 *   node scripts/qa-overflow-mobile.mjs
 */
import { chromium, devices } from 'playwright';
import { getSessaoQa } from './lib/conta-qa.mjs';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:5173';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await getSessaoQa();
const REF = new URL(s.url).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;
const H = { apikey: s.anon, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' };
const perfil = await (
  await fetch(`${s.url}/rest/v1/users?select=id&email=eq.${process.env.QA_EMAIL || 'qa.mavis@divteste.com'}`, { headers: H })
).json();
const QA_ID = perfil?.[0]?.id;

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await ctx.addInitScript(
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
      user: { id: QA_ID, email: process.env.QA_EMAIL || 'qa.mavis@divteste.com' },
    }),
  ]
);

for (const rota of ['/dashboard', '/dashboard/catalog/netflix']) {
  await page.goto(`${BASE_URL}${rota}`, { waitUntil: 'domcontentloaded' });
  await espera(3500);

  const relatorio = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const culpados = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      if (r.right > vw + 1 || r.left < -1) {
        culpados.push({
          sel: `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`,
          left: Math.round(r.left),
          right: Math.round(r.right),
          w: Math.round(r.width),
        });
      }
    });
    return { vw, scrollWidth: document.documentElement.scrollWidth, culpados: culpados.slice(0, 25) };
  });

  console.log(`\n=== ${rota} ===`);
  console.log(`viewport ${relatorio.vw}px | scrollWidth ${relatorio.scrollWidth}px`);
  relatorio.culpados.forEach((c) => console.log(`  ${c.sel}  left=${c.left} right=${c.right} w=${c.w}`));
  if (!relatorio.culpados.length) console.log('  (nenhum elemento estourando)');
}

await browser.close();
