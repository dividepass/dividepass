const https = require('https');

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', ...options },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function main() {
  const bundleUrl = 'https://www.dividepass.com/assets/index-BbckH7Dr.js';
  console.log('Fetching fresh production bundle:', bundleUrl);
  const r = await fetchUrl(bundleUrl);
  console.log('Status:', r.status, 'Size:', Math.round(r.data.length/1024), 'KB');
  
  const bundle = r.data.toString('utf8');
  
  console.log('\nSavingsService markers:');
  ['hasValidData', 'totalOfficialMonthly', 'subscriptionItems', 'isEligible', 'getBillingLabel'].forEach(c => {
    console.log(' ', c + ':', bundle.includes(c) ? 'YES' : 'NO');
  });
  
  console.log('\nApp checks:');
  console.log(' economia:', bundle.includes('economia') ? 'YES' : 'NO');
  console.log(' Supabase:', bundle.includes('lasoouwboxspstqvjbsv') ? 'YES' : 'NO');
  
  console.log('\nBuild marker (window.__BUILD_MARKER__):');
  console.log(' DIVIDEPASS_v20260825_FIXED:', bundle.includes('DIVIDEPASS_v20260825_FIXED') ? 'YES - NEW CODE!' : 'NO - OLD CODE');
  console.log(' build fix for TDZ:', bundle.includes('build fix for TDZ') ? 'YES - NEW CODE!' : 'NO - OLD CODE');
}

main().catch(e => console.error('Error:', e.message));
