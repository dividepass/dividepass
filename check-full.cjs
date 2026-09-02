const https = require('https');

// Check the HTML served by the domain
function checkHtml() {
  https.get('https://www.dividepass.com', (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      const match = data.match(/src="([^"]*index-[^"]+\.js)"/);
      console.log('HTML script ref:', match ? match[1] : 'none');
      console.log('x-vercel-cache:', res.headers['x-vercel-cache']);

      // Check if this bundle has the new marker
      if (match) {
        const bundleUrl = 'https://www.dividepass.com' + match[1];
        https.get(bundleUrl, (res2) => {
          let bdata = '';
          res2.on('data', c => bdata += c);
          res2.on('end', () => {
            const hasMarker = bdata.includes('DIVIDEPASS_v20260825_FIXED');
            const size = bdata.length;
            console.log('Bundle size:', size, '| has new marker:', hasMarker);
            if (hasMarker) {
              console.log('SUCCESS: New code is being served!');
            } else {
              console.log('WARNING: Still serving old code');
            }
          });
        }).on('error', e => console.error(e.message));
      }
    });
  }).on('error', e => console.error(e.message));
}

checkHtml();
