/**
 * Mede o CONTRASTE do botão "Entrar como este usuário" na ficha do usuário
 * do admin (`/admin/users/<id>`), nos dois temas.
 *
 * POR QUE: o Vite junta TODOS os CSS do app em UM arquivo só. Uma regra
 * `.btn-outline` de outra página (que entra no bundle por último) vence a
 * global do `index.css` — e o botão do suporte fica com texto branco sobre
 * cartão branco: some da tela.
 *
 * uso:
 *   node scripts/medir-botao-impersonacao.mjs [urlDaFicha]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'impersonacao');
const BASE_URL = process.env.QA_BASE_URL || 'https://dividepass.com';
const ALVO_ID = process.env.ALVO_ID || 'da547a24-3189-4ffa-a8d1-1aa72697a2b2';
const QA_EMAIL = process.env.QA_EMAIL || 'qa.mavis@divteste.com';

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const s = await getSessaoQa();
const REF = new URL(s.url).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;
const H = { apikey: s.anon, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' };
const perfil = await (
  await fetch(`${s.url}/rest/v1/users?select=id,email,role&email=eq.${QA_EMAIL}`, { headers: H })
).json();
const QA = perfil?.[0];
if (!QA) throw new Error('conta QA não encontrada');
if (QA.role !== 'admin') {
  console.log('!! a conta QA não está com role=admin — o painel /admin não abre.');
  console.log('   (promova com: node scripts/supabase-sql.mjs --query "update public.users set role=\'admin\' where id=\'' + QA.id + '\'")');
  process.exit(2);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await context.addInitScript(
  ([key, sessao]) => {
    try {
      if (!localStorage.getItem(key)) localStorage.setItem(key, sessao);
    } catch {
      /* storage bloqueado */
    }
  },
  [
    SESSION_KEY,
    JSON.stringify({
      access_token: s.token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'qa-refresh',
      user: { id: QA.id, email: QA_EMAIL },
    }),
  ]
);
const page = await context.newPage();

await page.goto(`${BASE_URL}/admin/users/${ALVO_ID}`, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 4500));

const medir = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) =>
      /Entrar como este usuário/i.test(b.textContent || '')
    );
    if (!el) return null;
    const parse = (cor) => {
      const m = cor && cor.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = '1'] = m[1].split(',').map((x) => parseFloat(x));
      return { r, g, b, a };
    };
    const canal = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = ({ r, g, b }) => 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
    const fundoReal = (node) => {
      const pilha = [];
      let atual = node;
      while (atual) {
        const c = parse(getComputedStyle(atual).backgroundColor);
        if (c && c.a > 0) pilha.push(c);
        if (c && c.a >= 1) break;
        atual = atual.parentElement;
      }
      let base = { r: 255, g: 255, b: 255 };
      for (let i = pilha.length - 1; i >= 0; i--) {
        const c = pilha[i];
        base = {
          r: c.r * c.a + base.r * (1 - c.a),
          g: c.g * c.a + base.g * (1 - c.a),
          b: c.b * c.a + base.b * (1 - c.a),
        };
      }
      return base;
    };
    const razao = (corTexto, fundo) => {
      const t = parse(corTexto);
      if (!t) return null;
      const tl = lum(t);
      const bl = lum(fundo);
      const [a, b] = tl > bl ? [tl, bl] : [bl, tl];
      return (a + 0.05) / (b + 0.05);
    };
    const cs = getComputedStyle(el);
    const fundo = fundoReal(el);
    return {
      texto: cs.color,
      corDoBotao: cs.backgroundColor,
      borda: cs.borderColor,
      fundoReal: `rgb(${Math.round(fundo.r)}, ${Math.round(fundo.g)}, ${Math.round(fundo.b)})`,
      razao: razao(cs.color, fundo),
      visivel: el.getBoundingClientRect().width > 0,
      desabilitado: el.disabled,
    };
  });

for (const tema of ['light', 'dark']) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem('dp-theme', t);
    } catch {
      /* storage bloqueado */
    }
  }, tema);
  await new Promise((r) => setTimeout(r, 600));
  const m = await medir();
  console.log(`[${tema}]`, JSON.stringify(m));
  if (m) console.log(`   contraste = ${m.razao?.toFixed(2)}:1  (precisa >= 4.5)`);
  await page.screenshot({
    path: path.join(OUT, `botao-${tema}.png`),
    clip: { x: 820, y: 100, width: 620, height: 120 },
  });
}

await browser.close();
