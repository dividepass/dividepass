const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const responses = [];
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('supabase.co')) {
      const status = resp.status();
      let body = '';
      try { body = await resp.text(); } catch {}
      responses.push({ url: url.replace('https://lasoouwboxspstqvjbsv.supabase.co', ''), status, body: body.substring(0, 200) });
    }
  });

  try {
    // First signup to get token
    console.log('Creating test user...');
    const ts = Date.now();
    const signupRes = await context.request.post('https://lasoouwboxspstqvjbsv.supabase.co/auth/v1/signup', {
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc29vdXdib3hzcHN0cXZqYnN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2Mjk0OTksImV4cCI6MjA5NzIwNTQ5OX0.BZLBNZ0Mw4NxnEw06y-c9zMNmfGB0N6IXJxZI-_VXSs'
      },
      data: JSON.stringify({ email: `debug-${ts}@test.com`, password: 'TestPass123!', email_confirm: true })
    });
    const signupData = JSON.parse(await signupRes.text());
    const token = signupData.access_token;
    const userId = signupData.user?.id;
    console.log('User created:', userId, '| Token:', token ? 'YES' : 'NO');

    // Set localStorage with token
    await page.goto('https://www.dividepass.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(({ token, userId }) => {
      localStorage.setItem('sb-access-token', token);
      localStorage.setItem('sb-refresh-token', token);
      localStorage.setItem('dividepass-user-id', userId);
    }, { token, userId });

    // Now navigate to dashboard and capture all Supabase responses
    console.log('\nNavigating to dashboard...');
    responses.length = 0;
    await page.goto('https://www.dividepass.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(5000);

    console.log('\nAll Supabase responses:');
    responses.forEach(r => {
      console.log('  [' + r.status + '] ' + r.url);
      if (r.status >= 400) {
        console.log('     BODY: ' + r.body);
      }
    });

    console.log('\nCurrent URL:', page.url());
    const body = await page.textContent('body');
    console.log('Body preview:', body.substring(0, 200).replace(/\s+/g, ' '));

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);
