/**
 * Captura das telas de PRODUCAO no celular (para conferir o que o usuario ve).
 *
 *   node scripts/qa-producao-mobile.mjs
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'producao');
const BASE_URL = process.env.QA_BASE_URL || 'https://dividepass.com';

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const s = await getSessaoQa();
const REF = new URL(s.url).hostname.split('.')[0];
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.addInitScript(
  ([k, v]) => localStorage.setItem(k, v),
  [
    `sb-${REF}-auth-token`,
    JSON.stringify({
      access_token: s.token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'qa',
      user: { id: '45e7fb01-fe95-4068-aa9e-ca26685f2cc8', email: 'qa.mavis@divteste.com' },
    }),
  ]
);

async function fecharPortoes(p) {
  for (const sel of ['.push-gate-skip', '.pwa-gate-skip', '.push-gate-secondary', '.pwa-gate-secondary', '.push-gate-close', '.pwa-gate-close']) {
    const b = p.locator(sel).first();
    if (await b.count()) {
      await b.click({ timeout: 3000 }).catch(() => {});
      await espera(350);
    }
  }
}

/* VISÃO GERAL */
await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
await espera(6000);
await fecharPortoes(page);
await espera(3500);
await page.screenshot({ path: path.join(OUT, 'mobile-visao-geral.png') });
await page.screenshot({ path: path.join(OUT, 'mobile-visao-geral-inteira.png'), fullPage: true });
console.log('ok: visao geral');

/* PLATAFORMA */
await page.goto(`${BASE_URL}/dashboard/catalog/netflix`, { waitUntil: 'domcontentloaded' });
await espera(6000);
await fecharPortoes(page);
await espera(3500);
await page.screenshot({ path: path.join(OUT, 'mobile-plataforma.png') });
console.log('ok: plataforma');

/* CATÁLOGO */
await page.goto(`${BASE_URL}/dashboard/catalog`, { waitUntil: 'domcontentloaded' });
await espera(6000);
await fecharPortoes(page);
await espera(3500);
await page.screenshot({ path: path.join(OUT, 'mobile-catalogo.png') });
console.log('ok: catalogo');

await browser.close();
console.log('screenshots em', OUT);
