const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, data: Buffer.concat(chunks) });
      });
    }).on('error', reject);
  });
}

async function main() {
  // Try to fetch the new bundle from the new deployment via Vercel API
  // The new deployment has id dpl_BmjgffnztK9tQFFkDAp5eqvktaGf
  // Let's try to get the file list from the API
  
  const apiToken = 'REDACTED';
  
  // Get deployment file list
  const deployRes = await fetchUrl(
    `https://api.vercel.com/v13/deployments/dpl_BmjgffnztK9tQFFkDAp5eqvktaGf?teamId=byefit`,
  );
  
  console.log('Deploy API status:', deployRes.status);
  const deployData = JSON.parse(deployRes.data.toString('utf8'));
  console.log('Deployment status:', deployData.status);
  console.log('Ready?', deployData.ready);
  
  // Try to get files from the deployment
  const filesRes = await fetchUrl(
    `https://api.vercel.com/v6/deployments/dpl_BmjgffnztK9tQFFkDAp5eqvktaGf/files?teamId=byefit`
  );
  console.log('\nFiles API status:', filesRes.status);
  
  // Let's try accessing the new bundle directly
  // Try with the deployment URL pattern: https://[id].vercel.app/assets/index-lGWbrukA.js
  const newBundleUrl = `https://dividepass-lzsrkvugb-byefit.vercel.app/assets/index-lGWbrukA.js`;
  console.log('\nTrying new bundle:', newBundleUrl);
  
  try {
    const r = await fetchUrl(newBundleUrl);
    console.log('Status:', r.status, 'Size:', r.data.length);
    if (r.data.length > 100) {
      const js = r.data.toString('utf8');
      const funcs = ['calculateUserSavings', 'getSavingsSummary'];
      funcs.forEach(f => console.log(f + ':', js.includes(f) ? 'YES ✓' : 'NO ✗'));
    }
  } catch(e) {
    console.log('Error:', e.message);
  }
}

main().catch(e => console.error('Error:', e.message));
