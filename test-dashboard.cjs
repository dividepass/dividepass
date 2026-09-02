const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  const failedReqs = [];

  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('[ERR] ' + msg.text());
  });
  page.on('pageerror', err => {
    errors.push('[PAGE ERR] ' + err.message);
  });
  page.on('response', async resp => {
    if (resp.status() >= 400 && resp.url().includes('supabase')) {
      failedReqs.push('HTTP ' + resp.status() + ': ' + resp.url().replace('https://lasoouwboxspstqvjbsv.supabase.co', ''));
    }
  });

  try {
    // 1. Create test user
    console.log('1. Creating test user...');
    const ts = Date.now();
    const signupRes = await context.request.post('https://lasoouwboxspstqvjbsv.supabase.co/auth/v1/signup', {
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc29vdXdib3hzcHN0cXZqYnN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2Mjk0OTksImV4cCI6MjA5NzIwNTQ5OX0.BZLBNZ0Mw4NxnEw06y-c9zMNmfGB0N6IXJxZI-_VXSs'
      },
      data: JSON.stringify({ email: `dash${ts}@t.com`, password: 'TestPass123!', email_confirm: true })
    });
    const signup = JSON.parse(await signupRes.text());
    const token = signup.access_token;
    const userId = signup.user?.id;
    console.log('   User:', userId, '| Token:', token ? 'YES' : 'NO');

    // 2. Navigate to login and fill form
    console.log('2. Filling login form...');
    await page.goto('https://www.dividepass.com/login', { waitUntil: 'networkidle', timeout: 20000 });

    await page.fill('input[type="email"]', `dash${ts}@t.com`);
    await page.fill('input[type="password"]', 'TestPass123!');
    console.log('   Form filled');

    // 3. Click login button
    console.log('3. Clicking login...');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);
    console.log('   URL after login:', page.url());

    // 4. Check if on dashboard
    const url = page.url();
    if (url.includes('/dashboard')) {
      console.log('4. SUCCESS! On dashboard!');
      const body = await page.textContent('body');
      console.log('   Body preview:', body.substring(0, 300).replace(/\s+/g, ' '));

      // Check for TDZ error
      const tdzError = errors.find(e => e.includes('Cannot access') || e.includes('TDZ') || e.includes('before initialization'));
      if (tdzError) {
        console.log('   TDZ ERROR:', tdzError);
      } else {
        console.log('   No TDZ error!');
      }

      // Check page errors
      const pageErrors = errors.filter(e => e.includes('PAGE ERR'));
      if (pageErrors.length > 0) {
        console.log('   Page errors:', pageErrors);
      } else {
        console.log('   No page errors!');
      }

    } else {
      console.log('4. NOT on dashboard. Body preview:', (await page.textContent('body')).substring(0, 200).replace(/\s+/g, ' '));
      console.log('   Errors:', errors);
    }

  } catch (err) {
    console.error('TEST ERROR:', err.message);
  } finally {
    console.log('\n=== Failed Supabase requests ===');
    failedReqs.forEach(r => console.log(' ', r));
    console.log('\n=== Console errors ===');
    errors.forEach(e => console.log(' ', e));
    await browser.close();
  }
}

test().catch(console.error);
