/* QA do form de plataforma:Plans com chave única real, URL por slug e mobile.
   O mock de service_plans IMPÕE a mesma constraint do banco
   (UNIQUE(service_id, plan_key)) — se o app tentar inserir duplicado, o teste falha. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'qa-out');
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const cfg = {};
fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m) cfg[m[1].trim()] = m[2].trim();
});
const BASE = cfg.VITE_SUPABASE_URL;
const ANON = cfg.VITE_SUPABASE_ANON_KEY;
const REF = new URL(BASE).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;

const PLATFORM = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'disney', full_name: 'Disney+', slug: 'disney',
  icon: 'D', icon_url: null, color: '#113CCF', category: 'streaming',
  description: 'Filmes e séries da Disney', official_url: 'https://disneyplus.com',
  official_price: 27.9, max_group_size: 5, status: 'active',
  featured: true, pinned: false, created_at: '2026-01-01T00:00:00Z',
};

const PROFILE = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Admin Teste', email: 'admin.teste@dividepass.com', phone: '(11) 98888-7777',
  role: 'admin', status: 'active', email_verified: true,
  avatar_url: 'https://cdn.dividepass.com/avatar-admin.png',
  created_at: '2026-01-10T12:00:00Z',
  onboarding_started_at: '2026-01-10T12:05:00Z',
  onboarding_completed_at: '2026-01-10T12:10:00Z',
  onboarding_step: 'concluido',
};

const COHORT = [{ id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Ana Souza', email: 'ana@email.com', phone: '(11) 97777-1111', avatar_url: null, created_at: '2026-10-01T10:00:00Z', onboarding_started_at: null, onboarding_completed_at: null, onboarding_step: 'perfil' }];

/* ─────────── "banco" de plataformas (filtra por slug/id/status) ─────────── */
const servicesDb = new Map([[PLATFORM.id, { ...PLATFORM }]]);
let serviceSeq = 0;

function streamingServices(route, request) {
  const url = request.url();
  const method = request.method();
  const body = request.postData() ? JSON.parse(request.postData()) : null;

  if (method === 'GET') {
    const slug = /slug=eq\.([^&]+)/.exec(url)?.[1];
    const id = /id=eq\.([^&]+)/.exec(url)?.[1];
    const status = /status=eq\.([^&]+)/.exec(url)?.[1];
    const category = /category=eq\.([^&]+)/.exec(url)?.[1];
    let rows = [...servicesDb.values()];
    if (slug) rows = rows.filter(r => r.slug === slug);
    else if (id) rows = rows.filter(r => r.id === id);
    if (status) rows = rows.filter(r => r.status === status);
    if (category) rows = rows.filter(r => r.category === category);
    return json(route, rows);
  }
  if (method === 'POST') {
    serviceSeq += 1;
    const row = {
      id: `44444444-4444-4444-4444-4444444444${String(serviceSeq).padStart(2, '0')}`,
      ...body,
      created_at: '2026-10-30T00:00:00Z',
    };
    servicesDb.set(row.id, row);
    return json(route, row, 201);
  }
  if (method === 'PATCH') {
    const id = /id=eq\.([^&]+)/.exec(url)?.[1];
    const current = servicesDb.get(id);
    if (!current) return json(route, { code: 'PGRST116', message: 'not found' }, 404);
    const next = { ...current, ...body };
    servicesDb.set(id, next);
    return json(route, next);
  }
  if (method === 'DELETE') {
    const id = /id=eq\.([^&]+)/.exec(url)?.[1];
    servicesDb.delete(id);
    return json(route, []);
  }
  return json(route, []);
}

/* ─────────── "banco" de planos (com a constraint real) ─────────── */
const plansDb = new Map([
  ['p1', { id: 'p1', service_id: PLATFORM.id, name: 'Padrão', plan_key: 'padrao', billing_cycle: 'monthly', official_price: 27.9, currency: 'BRL', country: 'Brasil', is_active: true, max_members: 4, suggested_price: 29.9, min_price: 19.9, max_price: 34.9, max_screens: 2, quality: 'Full HD (1080p)', details: '1 tela.', is_default: false, sort_order: 0 }],
  ['p2', { id: 'p2', service_id: PLATFORM.id, name: 'Premium', plan_key: 'premium', billing_cycle: 'monthly', official_price: 55.9, currency: 'BRL', country: 'Brasil', is_active: true, max_members: 6, suggested_price: 59.9, min_price: 45, max_price: 70, max_screens: 4, quality: '4K', details: 'Até 4 telas.', is_default: false, sort_order: 1 }],
]);
let planSeq = 2;

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });
}

const DUP = {
  code: '23505',
  details: null,
  hint: null,
  message: 'duplicate key value violates unique constraint "service_plans_service_id_plan_key_key"',
};

async function servicePlans(route, request) {
  const url = request.url();
  const method = request.method();
  const body = request.postData() ? JSON.parse(request.postData()) : null;

  if (method === 'GET') {
    const serviceId = /service_id=eq\.([^&]+)/.exec(url)?.[1];
    const rows = [...plansDb.values()].filter((r) => !serviceId || r.service_id === serviceId);
    return json(route, rows);
  }
  if (method === 'POST') {
    for (const r of plansDb.values()) {
      if (r.service_id === body.service_id && r.plan_key === body.plan_key) {
        return json(route, DUP, 409);
      }
    }
    planSeq += 1;
    const id = `p${planSeq}`;
    const row = { id, ...body };
    plansDb.set(id, row);
    return json(route, row, 201);
  }
  if (method === 'PATCH') {
    const id = /id=eq\.([^&]+)/.exec(url)?.[1];
    const current = plansDb.get(id);
    if (!current) return json(route, { code: 'PGRST116', message: 'not found' }, 404);
    const next = { ...current, ...body };
    for (const [rid, r] of plansDb) {
      if (rid === id) continue;
      if (r.service_id === next.service_id && r.plan_key === next.plan_key) {
        return json(route, DUP, 409);
      }
    }
    plansDb.set(id, next);
    return json(route, next);
  }
  if (method === 'DELETE') {
    const id = /id=eq\.([^&]+)/.exec(url)?.[1];
    plansDb.delete(id);
    return json(route, []);
  }
  return json(route, []);
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const email = `qa.plat.${Date.now()}@dividepass.com`;
  const signup = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'QaDividePass123!', data: { name: 'QA Plataforma' } }),
  });
  const signupBody = await signup.json().catch(() => ({}));
  if (!signupBody.access_token) {
    console.error('sem sessão de QA:', signup.status);
    process.exit(1);
  }
  const accessToken = signupBody.access_token;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value);
  }, [SESSION_KEY, JSON.stringify({
    access_token: accessToken, token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: signupBody.refresh_token, user: signupBody.user,
  })]);

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const wantsObject = (req.headers().accept || '').includes('vnd.pgrst.object');

    if (url.includes('/rest/v1/service_plans')) return servicePlans(route, req);
    if (url.includes('/rest/v1/users')) {
      const data = /id=eq\./.test(url) ? [PROFILE] : COHORT;
      return json(route, wantsObject ? (data[0] || {}) : data);
    }
    if (url.includes('/rest/v1/streaming_services')) return streamingServices(route, req);
    return json(route, []);
  });

  /* ══════════ 1. URL por slug + label ══════════ */
  await page.goto('http://localhost:5178/admin/platforms/disney/edit', { waitUntil: 'networkidle' });
  await page.waitForSelector('.platform-form-card', { timeout: 15000 });

  check('abre pelo slug', page.url().endsWith('/admin/platforms/disney/edit'), page.url());
  const header = await page.locator('.admin-header').innerText();
  check('mostra o slug no cabeçalho (não o uuid)', header.includes('disney') && !header.includes('33333333'), header.replace(/\n/g, ' | '));

  /* ══════════ 2. botão separado de salvar planos ══════════ */
  check('tem botão "Salvar planos"', await page.locator('button:has-text("Salvar planos")').count() === 1);
  check('tem botão de salvar a plataforma', await page.locator('button:has-text("Salvar Alterações")').count() === 1);

  const planCards = await page.locator('.plan-editor-card').count();
  check('lista os 2 planos da plataforma', planCards === 2, `${planCards}`);

  /* ══════════ 3. o bug: salvar 2x + nome repetido ══════════ */
  // adiciona um plano com o MESMO nome de um plano que já existe
  await page.locator('button:has-text("Adicionar plano")').click();
  await page.waitForTimeout(300);
  const newCard = page.locator('.plan-editor-card').nth(2);
  await newCard.locator('input').first().fill('Padrão');
  await newCard.locator('input[type="number"]').first().fill('19.90');

  await page.locator('button:has-text("Salvar planos")').click();
  await page.waitForTimeout(900);
  const erro1 = await page.locator('.gc-note.error').count();
  const ok1 = await page.locator('.gc-note.success').count();
  check('1º save: sem erro de chave duplicada', erro1 === 0, `erros=${erro1} ok=${ok1}`);
  check('1º save: mensagem de sucesso', ok1 === 1);
  check('1º save: banco ficou com 3 planos', plansDb.size === 3, `${plansDb.size}`);

  // SALVAR DE NOVO (era o que quebrava: o plano novo sem id virava INSERT)
  await page.locator('button:has-text("Salvar planos")').click();
  await page.waitForTimeout(900);
  const erro2 = await page.locator('.gc-note.error').count();
  check('2º save: sem erro de chave duplicada', erro2 === 0, `erros=${erro2}`);
  check('2º save: banco continua com 3 planos (não duplicou)', plansDb.size === 3, `${plansDb.size}`);

  // renomear um plano para o nome de outro (troca de nomes)
  await page.locator('.plan-editor-card').nth(0).locator('input').first().fill('Premium');
  await page.locator('button:has-text("Salvar planos")').click();
  await page.waitForTimeout(900);
  const erro3 = await page.locator('.gc-note.error').count();
  check('renomear para o nome de outro: sem erro', erro3 === 0, `erros=${erro3}`);
  check('renomear: banco continua com 3 planos', plansDb.size === 3, `${plansDb.size}`);

  // a chave do plano renomeado tem que ter mudado (e não colidido)
  const chaves = [...plansDb.values()].map(p => p.plan_key).sort();
  check('chaves dos planos são diferentes', new Set(chaves).size === chaves.length, chaves.join(', '));

  await page.screenshot({ path: path.join(OUT, '14-plataforma-planos.png'), fullPage: false });

  /* ══════════ 4. mobile ══════════ */
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value);
  }, [SESSION_KEY, JSON.stringify({
    access_token: accessToken, token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: signupBody.refresh_token, user: signupBody.user,
  })]);
  await mobile.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const wantsObject = (req.headers().accept || '').includes('vnd.pgrst.object');
    if (url.includes('/rest/v1/service_plans')) return servicePlans(route, req);
    if (url.includes('/rest/v1/users')) {
      const data = /id=eq\./.test(url) ? [PROFILE] : COHORT;
      return json(route, wantsObject ? (data[0] || {}) : data);
    }
    if (url.includes('/rest/v1/streaming_services')) return streamingServices(route, req);
    return json(route, []);
  });

  await mobile.goto('http://localhost:5178/admin/platforms/disney/edit', { waitUntil: 'networkidle' });
  await mobile.waitForSelector('.platform-form-card', { timeout: 15000 });

  const backText = await mobile.locator('.back-btn-platform').innerText();
  check('mobile: botão só escreve "Voltar"', backText.trim() === 'Voltar', backText);

  const backBox = await mobile.locator('.back-btn-platform').boundingBox();
  check('mobile: botão do voltar não é gigante', backBox.height < 60 && backBox.width < 220, `${Math.round(backBox.width)}x${Math.round(backBox.height)}`);

  const catScroll = await mobile.locator('.category-selector').evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
    display: getComputedStyle(el).display,
  }));
  check('mobile: categorias com scroll horizontal', catScroll.overflowX === 'auto' && catScroll.scrollWidth > catScroll.clientWidth, JSON.stringify(catScroll));

  const pageHeight = await mobile.evaluate(() => document.documentElement.scrollHeight);
  check('mobile: página bem mais curta que antes (menos scroll)', pageHeight < 9000, `${pageHeight}px`);

  await mobile.screenshot({ path: path.join(OUT, '15-plataforma-mobile.png'), fullPage: false });
  await mobile.evaluate(() => window.scrollTo(0, 900));
  await mobile.waitForTimeout(300);
  await mobile.screenshot({ path: path.join(OUT, '16-plataforma-mobile-categorias.png') });

  /* ══════════ 5. rota /new (rascunho) ══════════ */
  await page.goto('http://localhost:5178/admin/platforms/new', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  check('/new abre com o slug do rascunho na URL', /\/admin\/platforms\/nova-plataforma-[a-z0-9]+\/new$/.test(page.url()), page.url());
  check('/new mostra "Nova Plataforma"', (await page.locator('.admin-header h1').innerText()).includes('Nova Plataforma'));
  check('/new tem o botão "Salvar planos"', await page.locator('button:has-text("Salvar planos")').count() === 1);
  check('/new tem "Descartar rascunho"', await page.locator('button:has-text("Descartar rascunho")').count() === 1);

  const relevant = consoleErrors.filter((e) => !/favicon|ResizeObserver|Failed to load resource/i.test(e));
  check('sem erro de console', relevant.length === 0, relevant.slice(0, 3).join(' | '));

  await browser.close();

  try {
    const del = await fetch(`${BASE}/functions/v1/delete-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: ANON },
      body: JSON.stringify({}),
    });
    console.log(`conta de QA apagada: ${del.status}`);
  } catch (err) {
    console.log('conta de QA não pôde ser apagada:', err.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks OK ===`);
  if (failed.length) {
    console.log('FALHARAM:');
    failed.forEach((f) => console.log(` - ${f.name} ${f.detail}`));
    process.exit(1);
  }
})().catch((err) => {
  console.error('FALHA NO QA:', err);
  process.exit(1);
});
