/* QA do card do Grupo Oficial da DividePass no WhatsApp (rota /dashboard).
 *
 * O que este script confere:
 *   1) O card existe no dashboard e usa o icone oficial da marca (SVG proprio).
 *   2) O card fica ACIMA do card de feedback (ordem real do DOM).
 *   3) O botao aponta para o link do grupo (chat.whatsapp.com) em nova aba.
 *   4) O texto de convite e o pedido pelo usuario estao no card.
 *
 * Nao grava nada: e leitura pura do dashboard com a conta QA unica.
 *
 * Uso: node scripts/qa-card-whatsapp.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'qa-out');
const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:5174';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const cfg = {};
fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m) cfg[m[1].trim()] = m[2].trim();
});
const BASE = cfg.VITE_SUPABASE_URL;
const ANON = cfg.VITE_SUPABASE_ANON_KEY;
const REF = new URL(BASE).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;

// A senha vem do .env local (ignorado pelo git) — nunca fica no repositorio.
const QA_USER = {
  email: cfg.QA_EMAIL || process.env.QA_EMAIL || 'qa.mavis@divteste.com',
  password: cfg.QA_PASSWORD || process.env.QA_PASSWORD || '',
};
if (!QA_USER.password) {
  console.error('Falta QA_PASSWORD no .env local (veja .env.example).');
  process.exit(1);
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const login = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(QA_USER),
  });
  const body = await login.json().catch(() => ({}));
  if (!body.access_token) {
    console.error('sem sessao da conta QA:', login.status, JSON.stringify(body).slice(0, 200));
    process.exit(1);
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });

  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value);
    window.sessionStorage.setItem('dp_push_gate_skipped', '1');
  }, [SESSION_KEY, JSON.stringify({
    access_token: body.access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: body.refresh_token,
    user: body.user,
  })]);

  /* A conta QA nunca terminou o onboarding (ela existe para sondagem), e sem
   * avatar o AvatarGate toma a tela. Em vez de sujar a producao, so a LEITURA
   * do perfil e remendada: onboarding marcado e um avatar local. Nenhum POST. */
  await page.route('**/rest/v1/users**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const json = await res.json().catch(() => null);
    const remendar = (u) => (u && typeof u === 'object'
      ? { ...u, onboarding_completed_at: u.onboarding_completed_at || '2026-01-01T00:00:00Z', avatar_url: u.avatar_url || '/avatars/avatar-03.svg' }
      : u);
    const bodyOut = Array.isArray(json) ? json.map(remendar) : remendar(json);
    return route.fulfill({
      status: res.status(),
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(bodyOut),
    });
  });

  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  check('abre em /dashboard (nao virou /onboarding)', !page.url().includes('/onboarding'), page.url());

  const card = page.locator('.wa-group-card');
  check('o card do WhatsApp existe no dashboard', (await card.count()) === 1, `count=${await card.count()}`);

  if (await card.count()) {
    // 1) Icone oficial da marca (o SVG do WhatsApp, nao um lucide generico)
    const svgPath = await card.locator('svg path').first().getAttribute('d').catch(() => '');
    check('usa o icone oficial do WhatsApp (SVG da marca)',
      !!svgPath && svgPath.includes('17.472 14.382'), (svgPath || '').slice(0, 40));

    // 2) Ordem no DOM: WhatsApp ANTES do feedback
    const ordem = await page.evaluate(() => {
      const wa = document.querySelector('.wa-group-card');
      const fb = document.querySelector('.feedback-cta-card');
      if (!wa || !fb) return { wa: !!wa, fb: !!fb, waAntes: false };
      const waY = wa.getBoundingClientRect().top + window.scrollY;
      const fbY = fb.getBoundingClientRect().top + window.scrollY;
      return { wa: true, fb: true, waAntes: waY < fbY, waY, fbY };
    });
    check('o card de feedback existe', ordem.fb, '');
    check('o card do WhatsApp fica ACIMA do card de feedback', ordem.waAntes,
      `waY=${Math.round(ordem.waY)} fbY=${Math.round(ordem.fbY)}`);

    // 3) Botao com o link do grupo, abrindo em nova aba
    const btn = card.locator('a.wa-group-btn');
    check('o card tem botao de entrada', (await btn.count()) === 1, '');
    const href = await btn.getAttribute('href').catch(() => '');
    check('o botao aponta para o link do grupo (chat.whatsapp.com)',
      !!href && href.includes('chat.whatsapp.com'), href);
    check('o botao abre em nova aba', (await btn.getAttribute('target')) === '_blank', '');
    const btnText = (await btn.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    check('o botao tem uma chamada clara', /entrar/i.test(btnText), btnText);

    // 4) Textos do convite
    const desc = (await card.locator('.wa-group-desc').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    check('o texto de convite do usuario esta no card',
      desc.includes('Entre no nosso Grupo Oficial da DividePass no WhatsApp') && desc.includes('vagas que surgirem'),
      desc);
    check('o texto comeca com o coracao roxo', desc.trim().startsWith('\u{1F49C}'), desc.slice(0, 12));
    const titulo = (await card.locator('.wa-group-title').innerText().catch(() => '')).trim();
    check('o titulo fala do Grupo Oficial', /Grupo Oficial/i.test(titulo), titulo);

    // Print do card isolado
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await card.screenshot({ path: path.join(OUT, 'card-whatsapp.png') });

    // Print do contexto (WhatsApp + feedback juntos)
    const feedback = page.locator('.feedback-cta-card');
    if (await feedback.count()) {
      const boxWa = await card.boundingBox();
      const boxFb = await feedback.boundingBox();
      if (boxWa && boxFb) {
        await page.screenshot({
          path: path.join(OUT, 'card-whatsapp-contexto.png'),
          clip: {
            x: Math.max(0, boxWa.x - 12),
            y: Math.max(0, boxWa.y - 16),
            width: Math.max(boxWa.width, boxFb.width) + 24,
            height: (boxFb.y + boxFb.height) - boxWa.y + 32,
          },
        });
      }
    }

    // Print em mobile (o card precisa continuar legivel/clickavel)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await card.screenshot({ path: path.join(OUT, 'card-whatsapp-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

  check('sem erro de JS no console', erros.length === 0, erros.slice(0, 3).join(' | '));

  await browser.close();

  const falhou = results.filter((r) => !r.ok);
  console.log(`\n${results.length - falhou.length}/${results.length} checks OK`);
  console.log(`prints em: ${OUT}`);
  process.exit(falhou.length ? 1 : 0);
})().catch((e) => {
  console.error('erro no QA:', e);
  process.exit(1);
});
