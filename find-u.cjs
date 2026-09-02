const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function main() {
  const htmlRes = await fetchUrl('https://www.dividepass.com/');
  const html = htmlRes.toString('utf8');
  const jsMatch = html.match(/type="module"[^>]*src="([^"]+)"/);
  const jsUrl = 'https://www.dividepass.com' + jsMatch[1];
  
  const jsRes = await fetchUrl(jsUrl);
  const bundle = jsRes.toString('utf8');
  
  console.log('Bundle size:', bundle.length);
  
  // The error is "Cannot access 'U' before initialization"
  // In minified code, 'U' is likely a very short variable
  // Find ALL occurrences of standalone 'U' that look like TDZ-prone accesses
  // Pattern: U appears after operators, not as part of longer names
  
  // First, let's find the actual error text in the bundle
  if (bundle.includes('before initialization')) {
    console.log('FOUND: "before initialization" text in bundle');
    // Find where it appears
    const idx = bundle.indexOf('before initialization');
    console.log('Position:', idx);
    console.log('Context:', bundle.substring(Math.max(0, idx - 200), idx + 200));
  } else {
    console.log('"before initialization" NOT in bundle (runtime-generated error)');
  }
  
  // Find 'U' near the crash position 80771
  // Look for patterns like: operator U, (U, [U, =U, U)
  console.log('\n=== All standalone U near crash (pos 80771) ===');
  const searchWindow = bundle.substring(Math.max(0, 80000), 82000);
  
  // Find all U occurrences
  for (let i = 0; i < searchWindow.length; i++) {
    const char = searchWindow[i];
    if (char === 'U') {
      const before = searchWindow[i - 1] || ' ';
      const after = searchWindow[i + 1] || ' ';
      const absPos = 80000 + i;
      if (!/[a-zA-Z0-9_$]/.test(before) && !/[a-zA-Z0-9_$]/.test(after)) {
        const snippet = bundle.substring(Math.max(0, absPos - 30), absPos + 30);
        console.log(`  pos ${absPos}: ...${snippet}...`);
      }
    }
  }
  
  // Check the first 200 chars of the bundle to see module initialization
  console.log('\n=== Bundle first 500 chars ===');
  console.log(bundle.substring(0, 500));
}

main().catch(e => console.error('Error:', e.message));
