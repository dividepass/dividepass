const https = require('https');

function check() {
  https.get('https://www.dividepass.com', (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      const match = data.match(/src="([^"]*index-[^"]+\.js)"/);
      console.log('Script in HTML:', match ? match[1] : 'none');
      console.log('x-vercel-cache:', res.headers['x-vercel-cache']);
      console.log('x-cache:', res.headers['x-cache'] || 'none');

      // Also try without cache
      if (match) {
        const bundleUrl = 'https://www.dividepass.com' + match[1];
        https.get(bundleUrl, (res2) => {
          let bdata = '';
          res2.on('data', c => bdata += c);
          res2.on('end', () => {
            const hasMarker = bdata.includes('DIVIDEPASS_v20260825_FIXED');
            console.log('Bundle has new marker:', hasMarker, '| size:', bdata.length);
          });
        }).on('error', e => console.error('Bundle check error:', e.message));
      }
    });
  }).on('error', e => console.error(e.message));
}

setTimeout(check, 3000);
