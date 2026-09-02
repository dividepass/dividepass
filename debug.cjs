const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function main() {
  console.log('=== Testing asset serving with vercel.json /(.*) ===\n');
  
  const tests = [
    '/',
    '/login',
    '/assets/index-CJeFyFbr.css',
    '/logo.png',
    '/manifest.webmanifest',
  ];
  
  for (const path of tests) {
    const url = 'https://www.dividepass.com' + path;
    const r = await fetchUrl(url);
    const content = r.data.toString('utf8').substring(0, 100).replace(/\n/g, ' ');
    const isHtml = content.startsWith('<!doctype') || content.startsWith('<html');
    console.log(`${r.status} ${path} - ${r.headers['content-type'] || '?'} - ${isHtml ? 'HTML' : 'NOT HTML'} - ${r.data.length}b`);
  }
}

main().catch(e => console.error('Error:', e.message));
