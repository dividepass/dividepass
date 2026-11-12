/**
 * QA — IMPERSONAÇÃO DO ADMIN (entrar na conta do cliente e voltar).
 *
 * Confere, no navegador de verdade, o recurso que o admin usa em
 * `/admin/users/<id>`:
 *
 *   1. o botão "Entrar como este usuário" EXISTE na ficha do usuário;
 *   2. ao clicar, o navegador entra na conta do CLIENTE (/dashboard) sem a
 *      senha dele (a senha não é lida nem alterada);
 *   3. aparece o banner "Você está como <alvo>" com o botão
 *      "Voltar ao painel admin";
 *   4. ao voltar, o admin é RESTAURADO e volta para /admin/users/<id>.
 *
 * NADA é cobrado e nada é criado no banco: o alvo precisa existir e a
 * senha do alvo não é tocada.
 *
 * A conta QA precisa estar com `role = 'admin'` em `public.users` (o edge
 * confere o papel nos DOIS lugares). O script NÃO promove nem rebaixa
 * ninguém — quem faz isso é o `supabase-sql.mjs`, na mão.
 *
 *   QA_BASE_URL=https://dividepass.com node scripts/qa-impersonacao-admin.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';
import { consultarSql } from './supabase-sql.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'impersonacao');
const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:5273';

const QA_EMAIL = process.env.QA_EMAIL || 'qa.mavis@divteste.com';
/* O alvo precisa ser uma conta de TESTE (domínio divteste.com) — nunca a
   conta de um cliente real. */
const ALVO_ID = process.env.ALVO_ID || 'da547a24-3189-4ffa-a8d1-1aa72697a2b2';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const s = await getSessaoQa();
const REF = new URL(s.url).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;
const H = { apikey: s.anon, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' };

const perfilQa = await (
  await fetch(`${s.url}/rest/v1/users?select=id,email,role&email=eq.${QA_EMAIL}`, { headers: H })
).json().catch(() => null);
const QA = perfilQa?.[0];
if (!QA) {
  console.error('conta QA não encontrada');
  process.exit(1);
}
check('a conta QA está com papel de admin', QA.role === 'admin', `role = ${QA.role}`);

const alvo = await (
  await fetch(`${s.url}/rest/v1/users?select=id,email,name,role&id=eq.${ALVO_ID}`, { headers: H })
).json().catch(() => null);
const ALVO = alvo?.[0];
if (!ALVO) {
  console.error('alvo não encontrado');
  process.exit(1);
}
check('o alvo é uma conta de teste', /@divteste\.com$/i.test(ALVO.email || ''), ALVO.email);
check('o alvo não é admin (senão a edge bloqueia)', ALVO.role !== 'admin', `role = ${ALVO.role}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
/* A sessão do QA é injetada SÓ na primeira carga da aba.
   O `addInitScript` roda em TODA navegação — se injetasse sempre, ele
   sobrescreveria a sessão do CLIENTE depois da impersonação e o teste
   mediria a sessão errada (o app continuaria logado como admin). */
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
const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));
/* O botão pede confirmação antes de entrar na conta do cliente. */
page.on('dialog', async (d) => {
  console.log(`   (confirm: ${d.message().split('\n')[0]})`);
  await d.accept();
});

async function fecharPortoes(p) {
  for (const sel of ['.push-gate-skip', '.pwa-gate-skip', '.push-gate-secondary', '.pwa-gate-secondary', '.push-gate-close', '.pwa-gate-close']) {
    const b = p.locator(sel).first();
    if (await b.count()) {
      await b.click({ timeout: 3000 }).catch(() => {});
      await espera(300);
    }
  }
}

/* A senha do alvo é comparada ANTES e DEPOIS. O bcrypt gera um salt novo a
   cada hash — se a senha tivesse sido reescrita, o hash mudaria inteiro. */
const hashSenhaAlvo = async () => {
  const r = await consultarSql(
    `select coalesce(encrypted_password,'') as h from auth.users where id='${ALVO_ID}'`
  );
  return String(r?.[0]?.h || '');
};
const hashAntes = await hashSenhaAlvo();

/* ── 1) A FICHA DO USUÁRIO TEM O BOTÃO ─────────────────────────────────── */
await page.goto(`${BASE_URL}/admin/users/${ALVO_ID}`, { waitUntil: 'domcontentloaded' });
await espera(4000);
await fecharPortoes(page);

const botao = page.locator('button', { hasText: 'Entrar como este usuário' }).first();
check('a ficha do usuário tem o botão "Entrar como este usuário"', (await botao.count()) > 0);
check('o botão não está travado', (await botao.count()) > 0 && (await botao.isEnabled()));

/* O botão precisa APARECER: no tema claro uma regra `.btn-outline` de outra
   página (o Vite junta todo o CSS num arquivo) deixava o texto branco sobre
   cartão branco — contraste 1,05:1, ou seja, sumia da tela. */
const medirContraste = () =>
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
    const cs = getComputedStyle(el);
    const fundo = fundoReal(el);
    const tl = lum(parse(cs.color));
    const bl = lum(fundo);
    const [a, b] = tl > bl ? [tl, bl] : [bl, tl];
    return { razao: (a + 0.05) / (b + 0.05), texto: cs.color, fundo: `rgb(${Math.round(fundo.r)}, ${Math.round(fundo.g)}, ${Math.round(fundo.b)})` };
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
  await espera(700);
  const m = await medirContraste();
  check(
    `[${tema}] o botão "Entrar como este usuário" aparece (contraste >= 4.5)`,
    !!m && m.razao >= 4.5,
    m ? `${m.razao.toFixed(2)}:1 (texto ${m.texto} sobre ${m.fundo})` : 'botão não encontrado'
  );
}
await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
});
await espera(400);

await page.screenshot({ path: path.join(OUT, '1-ficha-usuario.png'), fullPage: true });

/* ── 2) ENTRA NA CONTA DO CLIENTE ───────────────────────────────────────── */
await botao.click();
await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
await espera(4500);
await fecharPortoes(page);

/* O alvo pode cair no /onboarding (conta de teste sem cadastro completo) —
   o que importa é que ele saiu do painel admin e está na conta do CLIENTE. */
check(
  'o navegador saiu do admin e entrou na conta do cliente',
  /\/(dashboard|onboarding)/.test(page.url()) && !/\/admin\//.test(page.url()),
  page.url()
);

const quemSou = await page.evaluate(() => {
  const raw = localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token')) || '');
  try {
    return JSON.parse(raw)?.user?.email || '';
  } catch {
    return '';
  }
});
check('a sessão do navegador agora é a do cliente', quemSou === ALVO.email, quemSou || '(vazio)');

/* ── 3) O BANNER DE VOLTA ───────────────────────────────────────────────── */
const banner = page.locator('text=Você está como').first();
const temBanner = (await banner.count()) > 0;
check('aparece o banner "Você está como ..."', temBanner);

const btnVoltar = page.locator('button', { hasText: 'Voltar ao painel admin' }).first();
check('o banner tem o botão "Voltar ao painel admin"', (await btnVoltar.count()) > 0);
await page.screenshot({ path: path.join(OUT, '2-dentro-da-conta-do-cliente.png'), fullPage: true });

/* ── 4) VOLTA AO PAINEL ADMIN ───────────────────────────────────────────── */
if ((await btnVoltar.count()) > 0) {
  await btnVoltar.click();
  await page.waitForURL(/\/admin\/users\//, { timeout: 30000 }).catch(() => {});
  await espera(4000);
  await fecharPortoes(page);

  check('o admin voltou para a ficha do usuário', /\/admin\/users\//.test(page.url()), page.url());

  const quemSouDepois = await page.evaluate(() => {
    const raw = localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token')) || '');
    try {
      return JSON.parse(raw)?.user?.email || '';
    } catch {
      return '';
    }
  });
  check('a sessão voltou a ser a do admin', quemSouDepois === QA_EMAIL, quemSouDepois || '(vazio)');

  const botaoDepois = page.locator('button', { hasText: 'Entrar como este usuário' }).first();
  check('a ficha do usuário continua com o botão (não travou nada)', (await botaoDepois.count()) > 0);
  await page.screenshot({ path: path.join(OUT, '3-voltou-ao-admin.png'), fullPage: true });
}

check('sem erro de JS na tela', erros.length === 0, erros.slice(0, 2).join(' | '));

/* ── 5) A SENHA DO ALVO NÃO FOI MEXIDA ──────────────────────────────────── */
/* A impersonação usa magiclink de uso único: o hash da senha do alvo tem que
   ser o MESMO de antes. */
const hashDepois = await hashSenhaAlvo();
check(
  'a senha do cliente NÃO foi alterada (hash idêntico)',
  hashAntes.length > 0 && hashAntes === hashDepois,
  `${hashAntes.slice(0, 12)}... -> ${hashDepois.slice(0, 12)}...`
);

await browser.close();

const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULTADO: ${ok}/${results.length} checks OK`);
console.log('Screenshots em:', OUT);
process.exit(ok === results.length ? 0 : 1);
