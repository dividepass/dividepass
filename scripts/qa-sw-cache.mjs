/**
 * DIAGNÓSTICO DO SERVICE WORKER (08/11/2026).
 *
 * Reproduz o que acontece no navegador de um cliente que ja abriu o app:
 * registra o SW, recarrega e confere QUAL bundle de /assets/index-*.js
 * o navegador pede e QUAL ele recebe.
 *
 *   node scripts/qa-sw-cache.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PERFIL = path.join(ROOT, 'qa-out', 'perfil-sw');
const BASE = process.env.QA_BASE_URL || 'https://dividepass.com';

if (!fs.existsSync(PERFIL)) fs.mkdirSync(PERFIL, { recursive: true });

const ctx = await chromium.launchPersistentContext(PERFIL, { viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const pedidos = [];
page.on('response', async (r) => {
  const u = r.url();
  if (/index-[^/]+\.(js|css)$/.test(u) || u.endsWith('/sw.js')) {
    pedidos.push(`${r.status()} ${u.replace(BASE, '')}`);
  }
});

console.log('--- 1a visita (instala o service worker) ---');
await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(4000);

const swAtivo = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'sem suporte';
  const regs = await navigator.serviceWorker.getRegistrations();
  return regs.map((r) => `${r.active?.scriptURL || '?'} (${r.active?.state || '?'})`).join(', ') || 'nenhum';
});
console.log('service worker:', swAtivo);

const caches1 = await page.evaluate(async () => {
  const nomes = await window.caches.keys();
  const out = {};
  for (const n of nomes) {
    const c = await window.caches.open(n);
    out[n] = (await c.keys()).map((k) => k.url.replace(location.origin, '')).slice(0, 12);
  }
  return out;
});
console.log('caches:', JSON.stringify(caches1, null, 2));

console.log('\n--- 2a visita (recarrega; é aqui que o cliente real cai) ---');
pedidos.length = 0;
await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(4000);
console.log('recursos pedidos:');
for (const p of pedidos) console.log('  ' + p);

const caches2 = await page.evaluate(async () => {
  const nomes = await window.caches.keys();
  const out = {};
  for (const n of nomes) {
    const c = await window.caches.open(n);
    out[n] = (await c.keys()).map((k) => k.url.replace(location.origin, '')).filter((u) => /index-|sw\.js/.test(u));
  }
  return out;
});
console.log('caches depois:', JSON.stringify(caches2, null, 2));

// O que a tela mostra? O icone da categoria e emoji (antigo) ou svg (novo)?
const icone = await page.evaluate(() => {
  const el = document.querySelector('.topic-card-icon');
  if (!el) return 'sem topicos';
  return el.querySelector('svg') ? 'SVG (build nova)' : 'EMOJI (build antiga)';
});
console.log('topicos na tela:', icone);

await ctx.close();
