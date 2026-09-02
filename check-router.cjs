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
  
  console.log('Bundle size:', bundle.length, 'bytes\n');
  
  // Find ALL chunk references
  const chunkRefs = bundle.match(/"chunk-[^"]+"/g);
  if (chunkRefs) {
    const unique = [...new Set(chunkRefs)];
    console.log('Chunks found:', unique.length);
    unique.forEach(c => console.log(' ', c));
  } else {
    console.log('No chunks found');
  }
  
  // Check for react-router development chunk
  if (bundle.includes('chunk-6CSD65Y2')) {
    console.log('\nWARNING: react-router development chunk found!');
  }
  
  // Check for any module that's loaded dynamically
  if (bundle.includes('__toESM')) {
    const toEsmMatches = bundle.match(/__toESM/g);
    console.log('\n__toESM calls:', toEsmMatches ? toEsmMatches.length : 0);
  }
  
  // Check for import.meta.url which indicates dynamic imports
  if (bundle.includes('import.meta.url')) {
    console.log('import.meta.url found - indicates dynamic imports');
  }
  
  // Check for the rolldown runtime
  if (bundle.includes('rolldown/runtime')) {
    console.log('rolldown runtime found');
  }
}

main().catch(e => console.error('Error:', e.message));
