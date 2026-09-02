const https = require('https');
const url = 'https://www.dividepass.com/';
https.get(url, (res) => {
  console.log('Production Status:', res.statusCode);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const scriptMatch = data.match(/assets\/index-[^"]+\.js/);
    console.log('Production Script:', scriptMatch ? scriptMatch[0] : 'not found');
    // Check for error boundary text
    if (data.includes('Algo deu errado') || data.includes('Something went wrong')) {
      console.log('WARNING: Error boundary detected in HTML');
    }
  });
}).on('error', e => console.error('Error:', e.message));
