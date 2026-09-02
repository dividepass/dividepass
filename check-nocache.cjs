const https = require('https');
const opts = {
  hostname: 'www.dividepass.com',
  headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
};
https.get(opts, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const match = data.match(/src="([^"]*index-[^"]+\.js)"/);
    console.log('With no-cache header, script:', match ? match[1] : 'none');
    console.log('Cache-Control header:', res.headers['cache-control']);
    // Also check x-vercel-cache
    console.log('x-vercel-cache:', res.headers['x-vercel-cache'] || 'none');
    console.log('x-cache:', res.headers['x-cache'] || 'none');
    console.log('cdn-cache:', res.headers['cdn-cache'] || 'none');
  });
}).on('error', e => console.error(e.message));
