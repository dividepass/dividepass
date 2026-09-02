const { chromium } = require('playwright');

async function test() {
  console.log('Starting browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push('[CONSOLE ERROR] ' + msg.text());
    }
  });
  page.on('pageerror', err => {
    errors.push('[PAGE ERROR] ' + err.message);
  });

  try {
    // 1. Go to home page
    console.log('1. Loading home page...');
    await page.goto('https://www.dividepass.com', { waitUntil: 'networkidle', timeout: 15000 });
    console.log('   Home loaded. URL:', page.url());
    console.log('   Title:', await page.title());

    // 2. Check for console errors on home
    console.log('   Console errors so far:', errors.length);
    errors.forEach(e => console.log('   ', e));

    // 3. Navigate to login
    console.log('2. Navigating to /login...');
    await page.goto('https://www.dividepass.com/login', { waitUntil: 'networkidle', timeout: 15000 });
    console.log('   Login page loaded. URL:', page.url());

    // 4. Check if login form exists
    const emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    const passwordInput = await page.$('input[type="password"]');
    console.log('   Email input found:', !!emailInput);
    console.log('   Password input found:', !!passwordInput);

    // 5. Check console errors on login page
    console.log('   Console errors on login:', errors.length);
    errors.forEach(e => console.log('   ', e));

    // 6. Try to get page content for debugging
    const bodyText = await page.textContent('body');
    console.log('   Page body preview:', bodyText.substring(0, 300).replace(/\s+/g, ' '));

  } catch (err) {
    console.error('TEST ERROR:', err.message);
  } finally {
    console.log('\nAll console errors:');
    if (errors.length === 0) {
      console.log('  (none)');
    } else {
      errors.forEach(e => console.log(' ', e));
    }
    await browser.close();
  }
}

test().catch(console.error);
