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
  // Get the production bundle that has the error
  const htmlRes = await fetchUrl('https://www.dividepass.com/');
  const html = htmlRes.toString('utf8');
  const jsMatch = html.match(/type="module"[^>]*src="([^"]+)"/);
  const jsUrl = 'https://www.dividepass.com' + jsMatch[1];
  
  const jsRes = await fetchUrl(jsUrl);
  const bundle = jsRes.toString('utf8');
  
  // The crash is at position 80771
  const crashPos = 80771;
  
  // Get a larger context
  console.log('=== Context around crash position', crashPos, '===\n');
  const context = bundle.substring(Math.max(0, crashPos - 500), crashPos + 500);
  console.log(context);
  
  // Find what module 'U' might be - look for it near the crash
  // The TDZ error 'Cannot access U before initialization' means U is a const/let
  console.log('\n=== Looking for U near crash ===');
  const nearCrash = bundle.substring(Math.max(0, crashPos - 2000), crashPos + 2000);
  
  // Find all 'U' references that look like variable accesses (not part of other words)
  const uPattern = /[=\(\)\[\]\+\-\*\/\s,]U[=\(\)\[\]\+\-\*\/\s,;]/g;
  const matches = [...nearCrash.matchAll(uPattern)];
  matches.forEach(m => {
    const absPos = Math.max(0, crashPos - 2000) + m.index;
    const snippet = bundle.substring(Math.max(0, absPos - 30), absPos + 30);
    console.log(`  pos ${absPos}: ...${snippet}...`);
  });
  
  // Look for module-level const/let declarations near crash
  console.log('\n=== Module-level declarations near crash ===');
  const beforeCrash = bundle.substring(Math.max(0, crashPos - 10000), crashPos);
  // Find const/let declarations
  const declarations = [...beforeCrash.matchAll(/(?:const|let)\s+(\w+)\s*=/g)];
  const recent = declarations.slice(-20);
  recent.forEach(d => {
    console.log(`  const/let ${d[1]} at offset ${d.index}`);
  });
}

main().catch(e => console.error('Error:', e.message));
