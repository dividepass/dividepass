const { chromium } = require('playwright');

async function test() {
  console.log('Starting browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  const failedRequests = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push('[CONSOLE] ' + msg.text());
    }
  });
  page.on('pageerror', err => {
    errors.push('[PAGE ERROR] ' + err.message);
  });
  page.on('requestfailed', req => {
    failedRequests.push(req.url() + ' | ' + req.failure().errorText);
  });
  page.on('response', async resp => {
    if (resp.status() >= 400) {
      failedRequests.push('HTTP ' + resp.status() + ': ' + resp.url());
    }
  });

  try {
    // 1. Go to login page
    console.log('1. Loading login page...');
    await page.goto('https://www.dividepass.com/login', { waitUntil: 'networkidle', timeout: 20000 });
    console.log('   URL:', page.url());

    // 2. Test Supabase auth directly via API
    console.log('\n2. Testing Supabase auth directly...');
    const authTest = await context.request.post('https://lasoouwboxspstqvjbsv.supabase.co/auth/v1/token?grant_type=password', {
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc29vdXdib3hzcHN0cXZqYnN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2Mjk0OTksImV4cCI6MjA5NzIwNTQ5OX0.BZLBNZ0Mw4NxnEw06y-c9zMNmfGB0N6IXJxZI-_VXSs'
      },
      data: JSON.stringify({ email: 'test@test.com', password: 'wrongpassword123' })
    });
    console.log('   Auth test (wrong creds) status:', authTest.status());
    const authText = await authTest.text();
    console.log('   Auth response:', authText.substring(0, 200));

    // 3. Try to sign up a test user
    console.log('\n3. Trying to create test user...');
    const signupRes = await context.request.post('https://lasoouwboxspstqvjbsv.supabase.co/auth/v1/signup', {
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc29vdXdib3hzcHN0cXZqYnN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2Mjk0OTksImV4cCI6MjA5NzIwNTQ5OX0.BZLBNZ0Mw4NxnEw06y-c9zMNmfGB0N6IXJxZI-_VXSs'
      },
      data: JSON.stringify({ 
        email: 'test-bot-' + Date.now() + '@test.com', 
        password: 'TestPass123!',
        email_confirm: true 
      })
    });
    console.log('   Signup status:', signupRes.status());
    const signupText = await signupRes.text();
    console.log('   Signup response:', signupText.substring(0, 300));

    // 4. Try to login with the test user
    if (signupRes.status() === 200) {
      const signupData = JSON.parse(signupText);
      if (signupData.id || signupData.user) {
        console.log('\n4. Trying to login with test user...');
        const loginRes = await context.request.post('https://lasoouwboxspstqvjbsv.supabase.co/auth/v1/token?grant_type=password', {
          headers: {
            'Content-Type': 'application/json',
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc29vdXdib3hzcHN0cXZqYnN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2Mjk0OTksImV4cCI6MjA5NzIwNTQ5OX0.BZLBNZ0Mw4NxnEw06y-c9zMNmfGB0N6IXJxZI-_VXSs'
          },
          data: JSON.stringify({ 
            email: signupData.user?.email || 'test@test.com', 
            password: 'TestPass123!' 
          })
        });
        console.log('   Login status:', loginRes.status());
        const loginText = await loginRes.text();
        console.log('   Login response:', loginText.substring(0, 300));
        
        if (loginRes.status() === 200) {
          const loginData = JSON.parse(loginText);
          const accessToken = loginData.access_token;
          console.log('\n5. Got access token! Testing dashboard access...');
          
          // Navigate to home first
          await page.goto('https://www.dividepass.com', { waitUntil: 'networkidle', timeout: 15000 });
          
          // Set the auth token in localStorage
          await page.evaluate((token) => {
            localStorage.setItem('sb-access-token', token);
            localStorage.setItem('sb-refresh-token', token);
          }, accessToken);
          
          // Try to access dashboard
          console.log('6. Navigating to /dashboard...');
          await page.goto('https://www.dividepass.com/dashboard', { waitUntil: 'networkidle', timeout: 20000 });
          console.log('   Dashboard URL:', page.url());
          console.log('   Dashboard title:', await page.title());
          
          const dashText = await page.textContent('body');
          console.log('   Dashboard body preview:', dashText.substring(0, 300).replace(/\s+/g, ' '));
          
          if (errors.length > 0) {
            console.log('\n   Dashboard console errors:');
            errors.forEach(e => console.log('   ', e));
          } else {
            console.log('\n   No console errors on dashboard!');
          }
        }
      }
    }

  } catch (err) {
    console.error('TEST ERROR:', err.message);
  } finally {
    console.log('\n=== SUMMARY ===');
    console.log('Failed requests:');
    failedRequests.forEach(r => console.log(' ', r));
    console.log('\nConsole errors:');
    errors.forEach(e => console.log(' ', e));
    await browser.close();
  }
}

test().catch(console.error);
