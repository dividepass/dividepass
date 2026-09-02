const https = require('https');
const fs = require('fs');

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
  // Get production bundle
  const htmlRes = await fetchUrl('https://www.dividepass.com/');
  const html = htmlRes.toString('utf8');
  const jsMatch = html.match(/type="module"[^>]*src="([^"]+)"/);
  const jsUrl = 'https://www.dividepass.com' + jsMatch[1];
  console.log('Bundle:', jsMatch[1], '\n');
  
  const jsRes = await fetchUrl(jsUrl);
  const bundle = jsRes.toString('utf8');
  
  // The error is at position 80771 in chunk 63
  // Let's look around position 80771
  const pos = 80771;
  const context = bundle.substring(Math.max(0, pos - 200), pos + 200);
  console.log('Context around position', pos, ':');
  console.log(context);
  console.log('\n---\n');
  
  // Also check what module is at position 80771
  // Find the function name around that position
  const before = bundle.substring(Math.max(0, pos - 500), pos);
  console.log('500 chars before crash position:');
  console.log(before.substring(before.length - 300));
  
  // Check for the specific error: "Cannot access 'U' before initialization"
  // In minified code, 'U' is likely a short variable name
  // Let's find patterns that could cause this
  console.log('\n---\nSearching for TDZ-prone patterns...');
  
  // Look for pattern: variable used before being defined
  // This is hard in minified code, but let's try to find the 'U' variable
  const lines = bundle.split('\n');
  let charCount = 0;
  for (const line of lines) {
    charCount += line.length + 1;
    if (charCount > pos) {
      console.log('Line containing crash:', line.substring(0, 500));
      break;
    }
  }
}

main().catch(e => console.error('Error:', e.message));
