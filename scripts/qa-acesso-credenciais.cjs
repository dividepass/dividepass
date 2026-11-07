/* QA da TELA DE CREDENCIAIS (o "Acesso Negado" da Carol).
 *
 * CASO REAL (02/11/2026): a cliente Carolina (carolinasantos0594@gmail.com)
 * estava com a assinatura ATIVA (Netflix, R$ 59,40, semestral, proxima
 * cobranca em 26/01/2027), o vinculo no grupo ATIVO e o espelho do grupo
 * sincronizado — e ainda assim a tela respondia "Acesso Negado: seu acesso
 * ao Netflix foi encerrado, sua assinatura foi cancelada ou voce saiu do
 * grupo". O aviso era além disso ERRADO: acusava a cliente de algo que nao
 * tinha acontecido.
 *
 * Este script reproduz os cenarios que fazem a tela negar o acesso e confere
 * que a pessoa que PAGOU sempre entra:
 *
 *   A) Pagou, tudo em dia ...................... ENTRA (credencial visivel)
 *   B) Espelho legado + pagamento ativo ........ ENTRA (o espelho nao manda)
 *   C) Falha na consulta (rede/banco) ........... "Nao foi possivel verificar"
 *                                               + "Tentar de novo"
 *                                               (NAO e "Acesso Negado")
 *   D) O link aponta para outro grupo .......... "Voce nao tem assinatura
 *                                               ativa do X neste grupo"
 *                                               + botao "Abrir meu grupo"
 *   E) Assinatura cancelada de verdade ........ "Pague de novo para reativar"
 *
 * NADA e gravado no banco: todas as respostas do PostgREST sao MOCKADAS.
 * A unica coisa real e a criacao da conta de QA (descartada no final).
 *
 * Uso: node scripts/qa-acesso-credenciais.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'qa-out');
const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:5173';

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

/* ── fixtures ───────────────────────────────────────────────────────────── */
const SERVICE = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Netflix', slug: 'netflix', full_name: 'Netflix',
  status: 'active', color: '#e50914', icon: 'N',
};
const DONO = { id: '11111111-1111-1111-1111-111111111111', name: 'Dono QA', role: 'admin', avatar_url: null };

function grupo(id, nome) {
  return {
    id, name: nome, slug: nome.toLowerCase().replace(/\s+/g, '-'),
    status: 'open', visibility: 'public', service_id: SERVICE.id,
    owner_id: DONO.id, price_per_slot: 25.9, member_count: 4,
    service: SERVICE, members: [], credential: [], profiles: [], owner: DONO,
  };
}
const MEU_GRUPO = grupo('aaaaaaaa-0000-0000-0000-000000000001', 'Netflix QA');
const OUTRO_GRUPO = grupo('aaaaaaaa-0000-0000-0000-000000000002', 'Netflix QA Antigo');

const FUTURO = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

function assinatura(over = {}) {
  return {
    id: 'sub-qa-1', user_id: 'qa-user', group_id: MEU_GRUPO.id, service_id: SERVICE.id,
    status: 'active', amount: 25.9, billing_cycle: 'monthly',
    next_charge_at: FUTURO, renewal_due_at: FUTURO, expires_at: FUTURO.slice(0, 10),
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    group: MEU_GRUPO, service: SERVICE,
    ...over,
  };
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });
}

/**
 * Mock do PostgREST. `cenario` define o que o banco "devolve":
 *   subsDoGrupo  -> linhas de user_subscriptions do grupo do link
 *   minhasSubs    -> linhas de user_subscriptions do dashboard
 *   membro       -> linha de group_members (ou null = sem vinculo)
 *   erroConsulta -> true = group_members responde 500
 */
function instalarMock(page, cenario) {
  return page.route('**/rest/v1/**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const wantsObject = (request.headers().accept || '').includes('vnd.pgrst.object');

    if (url.includes('/rest/v1/user_subscriptions')) {
      if (method !== 'GET') return json(route, []);
      // a tela de credenciais filtra por group_id; o dashboard, nao
      const porGrupo = url.includes('group_id=eq.');
      const rows = porGrupo ? (cenario.subsDoGrupo || []) : (cenario.minhasSubs || []);
      return json(route, wantsObject ? (rows[0] || null) : rows);
    }
    if (url.includes('/rest/v1/group_members')) {
      if (method !== 'GET') return json(route, []);
      if (cenario.erroConsulta) return json(route, { message: 'falha simulada' }, 500);
      const rows = cenario.membro ? [cenario.membro] : [];
      return json(route, wantsObject ? (rows[0] || null) : rows);
    }
    if (url.includes('/rest/v1/groups')) {
      if (method !== 'GET') return json(route, []);
      const rows = cenario.grupos || [MEU_GRUPO, OUTRO_GRUPO];
      return json(route, wantsObject ? (rows[0] || null) : rows);
    }
    if (url.includes('/rest/v1/streaming_services')) return json(route, [SERVICE]);
    if (url.includes('/rest/v1/service_plans')) return json(route, []);
    if (url.includes('/rest/v1/announcements')) return json(route, []);
    if (url.includes('/rest/v1/group_credentials')) return json(route, []);
    if (url.includes('/rest/v1/group_profiles')) return json(route, []);
    if (url.includes('/rest/v1/platform_events')) return json(route, []);
    if (url.includes('/rest/v1/users')) return json(route, wantsObject ? cenario.perfil : [cenario.perfil]);
    return route.continue();
  });
}

const textoDaTela = async (page) => {
  const denied = page.locator('.access-denied');
  if (await denied.count()) return (await denied.innerText()).replace(/\s+/g, ' ').trim();
  const page1 = page.locator('.credentials-page');
  return (await page1.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
};

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  /* sessao de QA (conta descartavel) */
  const email = `qa.acesso.${Date.now()}@dividepass.com`;
  const signup = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'QaDividePass123!', data: { name: 'QA Acesso' } }),
  });
  const signupBody = await signup.json().catch(() => ({}));
  if (!signupBody.access_token) {
    console.error('sem sessao de QA:', signup.status, JSON.stringify(signupBody).slice(0, 200));
    process.exit(1);
  }
  const accessToken = signupBody.access_token;
  const userId = signupBody.user.id;

  const perfil = {
    id: userId, name: 'QA Acesso', email, role: 'user', status: 'active',
    email_verified: true, avatar_url: null, created_at: '2026-01-01T00:00:00Z',
    onboarding_started_at: '2026-01-01T00:00:05Z',
    onboarding_completed_at: '2026-01-01T00:00:10Z',
    onboarding_step: 'concluido',
  };

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value);
    window.sessionStorage.setItem('dp_push_gate_skipped', '1');
  }, [SESSION_KEY, JSON.stringify({
    access_token: accessToken, token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: signupBody.refresh_token, user: signupBody.user,
  })]);

  const consoleErrors = [];
  // No cenario C a consulta responde 500 DE PROPÓSITO — o erro do console
  // dele é esperado e não conta como falha.
  let erroSimulado = false;
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (erroSimulado && /500|Internal Server Error|Erro ao verificar assinatura\/membro/i.test(m.text())) return;
    consoleErrors.push(m.text());
  });

  const abrir = async (cenario, groupId) => {
    await page.unroute('**/rest/v1/**');
    await instalarMock(page, { ...cenario, perfil });
    await page.goto(`${BASE_URL}/dashboard/credentials/netflix?group=${groupId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    return textoDaTela(page);
  };

  /* ── A) pagou e está em dia: tem que entrar ─────────────────────────── */
  {
    const tela = await abrir({
      minhasSubs: [assinatura()],
      subsDoGrupo: [assinatura()],
      membro: { user_id: userId, status: 'active', payment_status: 'active', subscription_deadline: FUTURO },
      grupos: [MEU_GRUPO],
    }, MEU_GRUPO.id);

    check('A) quem pagou e esta em dia ENTRA (sem "Acesso Negado")',
      !/Acesso Negado/i.test(tela), tela.slice(0, 160));
    check('A) a tela mostra a credencial do grupo',
      /Credenciais/i.test(tela) && !/Verificando acesso/i.test(tela), tela.slice(0, 160));
    await page.screenshot({ path: path.join(OUT, 'qa-acesso-a-pagou-entra.png') });
  }

  /* ── B) espelho legado (status antigo) + pagamento ativo: tem que entrar */
  {
    const tela = await abrir({
      minhasSubs: [assinatura()],
      subsDoGrupo: [],                       // assinatura nao visivel para ela
      membro: {                              // espelho defasado, mas PAGO
        user_id: userId, status: 'cancelled', payment_status: 'active',
        subscription_deadline: FUTURO,
      },
      grupos: [MEU_GRUPO],
    }, MEU_GRUPO.id);

    check('B) pagamento ativo + prazo vigente ENTRA mesmo com o espelho legado',
      !/Acesso Negado/i.test(tela), tela.slice(0, 160));
    await page.screenshot({ path: path.join(OUT, 'qa-acesso-b-espelho-legado.png') });
  }

  /* ── C) erro na consulta: nao pode ser "Acesso Negado" ──────────────── */
  {
    erroSimulado = true;
    const tela = await abrir({
      minhasSubs: [assinatura()],
      subsDoGrupo: [assinatura()],
      membro: { user_id: userId, status: 'active', payment_status: 'active', subscription_deadline: FUTURO },
      erroConsulta: true,
      grupos: [MEU_GRUPO],
    }, MEU_GRUPO.id);

    check('C) erro na consulta NAO vira "Acesso Negado"',
      !/Acesso Negado/i.test(tela), tela.slice(0, 200));
    check('C) erro na consulta mostra "Nao foi possivel verificar"',
      /N[ãa]o foi poss[íi]vel verificar/i.test(tela), tela.slice(0, 200));
    check('C) erro na consulta oferece "Tentar de novo"',
      await page.locator('button:has-text("Tentar de novo")').count() === 1);
    await page.screenshot({ path: path.join(OUT, 'qa-acesso-c-erro-consulta.png') });
    erroSimulado = false;
  }

  /* ── D) o link aponta para um grupo que nao e dela ───────────────────── */
  {
    const tela = await abrir({
      minhasSubs: [assinatura()],             // ela tem assinatura do MEU grupo
      subsDoGrupo: [],                       // mas o link aponta para OUTRO
      membro: null,                          // e nao e membro do outro
      grupos: [MEU_GRUPO, OUTRO_GRUPO],
    }, OUTRO_GRUPO.id);

    check('D) grupo do link que nao e dela nao acusa "assinatura cancelada"',
      !/sua assinatura foi cancelada/i.test(tela), tela.slice(0, 200));
    check('D) aviso correto: "nao tem assinatura ativa ... neste grupo"',
      /n[ãa]o tem assinatura ativa/i.test(tela), tela.slice(0, 200));
    check('D) oferece o botao "Abrir meu grupo"',
      await page.locator('a:has-text("Abrir meu grupo")').count() === 1);
    await page.screenshot({ path: path.join(OUT, 'qa-acesso-d-outro-grupo.png') });
  }

  /* ── F) pagou, mas a data "paga até" não foi gravada no vínculo ─────── */
  {
    const tela = await abrir({
      minhasSubs: [assinatura()],
      subsDoGrupo: [],
      membro: {                              // pago, mas sem prazo gravado
        user_id: userId, status: 'active', payment_status: 'active',
        subscription_deadline: null,
      },
      grupos: [MEU_GRUPO],
    }, MEU_GRUPO.id);

    check('F) pagamento ativo sem prazo gravado ENTRA (falta de dado, nao de pagamento)',
      !/Acesso Negado/i.test(tela), tela.slice(0, 160));
    await page.screenshot({ path: path.join(OUT, 'qa-acesso-f-sem-prazo.png') });
  }

  /* ── E) assinatura cancelada de verdade: tem que pedir para renovar ──── */
  {
    const tela = await abrir({
      minhasSubs: [assinatura({ status: 'cancelled' })],
      subsDoGrupo: [assinatura({ status: 'cancelled' })],
      membro: { user_id: userId, status: 'cancelled', payment_status: 'cancelled', subscription_deadline: null },
      grupos: [MEU_GRUPO],
    }, MEU_GRUPO.id);

    check('E) assinatura cancelada mostra "Pague de novo para reativar"',
      /Pague de novo para reativar/i.test(tela), tela.slice(0, 200));
    check('E) assinatura cancelada oferece "Renovar assinatura"',
      await page.locator('button:has-text("Renovar assinatura")').count() === 1);
    await page.screenshot({ path: path.join(OUT, 'qa-acesso-e-cancelada.png') });
  }

  const relevantes = consoleErrors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e));
  check('sem erro de console', relevantes.length === 0, relevantes.slice(0, 2).join(' | '));

  await browser.close();

  /* apaga a conta de QA */
  try {
    const r = await fetch(`${BASE}/functions/v1/delete-account`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    console.log('conta de QA apagada:', r.status);
  } catch (e) {
    console.log('conta de QA nao apagada:', e.message);
  }

  const falhas = results.filter((r) => !r.ok).length;
  console.log(`\n=== ${results.length - falhas}/${results.length} checks OK ===`);
  if (falhas) process.exit(1);
})();
