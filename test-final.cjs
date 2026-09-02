const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('[ERR] ' + msg.text());
  });
  page.on('pageerror', err => {
    errors.push('[PAGE ERR] ' + err.message);
  });

  try {
    // Create test user
    const ts = Date.now();
    const signupRes = await context.request.post('https://lasoouwboxspstqvjbsv.supabase.co/auth/v1/signup', {
      headers: { 'Content-Type': 'application/json', 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc29vdXdib3hzcHN0cXZqYnN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2Mjk0OTksImV4cCI6MjA5NzIwNTQ5OX0.BZLBNZ0Mw4NxnEw06y-c9zMNmfGB0N6IXJxZI-_VXSs' },
      data: JSON.stringify({ email: `test${ts}@t.com`, password: 'TestPass123!', email_confirm: true })
    });
    const signup = JSON.parse(await signupRes.text());
    console.log('User created:', !!signup.access_token);

    // Login via form
    await page.goto('https://www.dividepass.com/login', { waitUntil: 'networkidle', timeout: 20000 });
    await page.fill('input[type="email"]', `test${ts}@t.com`);
    await page.fill('input[type="password"]', 'TestPass123!');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);

    console.log('URL after login:', page.url());

    if (page.url().includes('/dashboard')) {
      const body = await page.textContent('body');
      const isError = body.includes('Algo deu errado') || body.includes('erro');
      console.log('On dashboard:', !isError ? 'YES - WORKING!' : 'ERROR PAGE');
      console.log('Body preview:', body.substring(0, 200).replace(/\s+/g, ' '));

      if (isError) {
        const tdzError = errors.find(e => e.includes('before initialization') || e.includes('TDZ'));
        if (tdzError) console.log('TDZ ERROR:', tdzError.substring(0, 200));
      }
    } else {
      console.log('NOT on dashboard:', page.url());
    }

    console.log('\nErrors:', errors.filter(e => e.includes('before init') || e.includes('PAGE ERR')));
    console.log('All errors count:', errors.length);

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);
