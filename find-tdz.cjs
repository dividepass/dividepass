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
  
  // The error is at position 80771 in the source map
  // Let's look around that area
  const pos = 80771;
  const context = bundle.substring(Math.max(0, pos - 300), pos + 300);
  console.log('Context around position', pos, ':\n');
  console.log('BEFORE:', context.substring(0, 200));
  console.log('>>>CRASH HERE<<<');
  console.log('AFTER:', context.substring(200));
  
  // Look for the 'U' variable - find all occurrences of 'U' near the crash
  const nearCrash = bundle.substring(Math.max(0, pos - 1000), pos + 1000);
  const uMatches = nearCrash.match(/[\s,]U[\s,;=\)\(]/g);
  console.log('\n\nVariable U near crash:', uMatches);
  
  // Try to find what function 'af' is
  // Look for the function definition near position 80771
  const beforeCrash = bundle.substring(Math.max(0, pos - 5000), pos);
  // Find the last function definition before the crash
  const funcDefs = [...beforeCrash.matchAll(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g)];
  if (funcDefs.length > 0) {
    const lastFunc = funcDefs[funcDefs.length - 1];
    console.log('\nLast function before crash:', lastFunc[1], 'at offset', lastFunc.index);
  }
  
  // Check what's imported at the top of the bundle (module initialization)
  console.log('\n\nBundle header (first 2000 chars):');
  console.log(bundle.substring(0, 2000));
}

main().catch(e => console.error('Error:', e.message));
