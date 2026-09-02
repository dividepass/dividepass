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
  
  console.log('Prod bundle size:', bundle.length);
  
  // Check for dynamic imports
  console.log('\nDynamic imports:');
  const importMatches = [...bundle.matchAll(/import\(([^)]+)\)/g)];
  importMatches.forEach(m => {
    const snippet = bundle.substring(Math.max(0, m.index - 50), m.index + m[0].length + 50);
    console.log(`  pos ${m.index}: ${snippet}`);
  });
  
  // Check for module preloading
  console.log('\nModule preload patterns:');
  if (bundle.includes('modulepreload')) {
    console.log('  Found modulepreload!');
    const preloadIdx = bundle.indexOf('modulepreload');
    console.log('  Context:', bundle.substring(Math.max(0, preloadIdx - 100), preloadIdx + 200));
  }
  
  // Check for chunks in the bundle
  console.log('\nChunk references:');
  const chunkRefs = bundle.match(/"chunk-[^"]+"/g);
  if (chunkRefs) {
    console.log('  Found:', [...new Set(chunkRefs)]);
  } else {
    console.log('  NONE');
  }
  
  // Check for rolldown runtime
  console.log('\nRolldown:');
  console.log('  rolldown/runtime.js:', bundle.includes('rolldown/runtime.js') ? 'YES' : 'NO');
  console.log('  rolldown:', bundle.includes('rolldown') ? 'YES' : 'NO');
  console.log('  __toESM:', bundle.includes('__toESM') ? 'YES' : 'NO');
  console.log('  __esExports:', bundle.includes('__esExports') ? 'YES' : 'NO');
  
  // Check for the critical savingsService
  console.log('\nSavingsService:');
  console.log('  calculateUserSavings:', bundle.includes('calculateUserSavings') ? 'YES' : 'NO');
  console.log('  hasValidData:', bundle.includes('hasValidData') ? 'YES' : 'NO');
  console.log('  seenIds:', bundle.includes('seenIds') ? 'YES' : 'NO');
}

main().catch(e => console.error('Error:', e.message));
