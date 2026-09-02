const https = require('https');
const url = 'https://dividepass-ljb08i0p5-byefit.vercel.app/';
https.get(url, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const scriptMatch = data.match(/assets\/index-[^"]+\.js/);
    console.log('Script:', scriptMatch ? scriptMatch[0] : 'not found');
    // Check if it has the new code by looking for a signature
    console.log('Has script tag:', data.includes('script'));
  });
}).on('error', e => console.error('Error:', e.message));
