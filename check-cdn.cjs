const https = require('https');

function fetch(url, redirects = 0) {
  if (redirects > 10) { console.log('Too many redirects'); return; }
  https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      const loc = res.headers.location;
      console.log('HTTP ' + res.statusCode + ' -> ' + loc.substring(0, 120));
      const nextUrl = loc.startsWith('http') ? loc : new URL(loc, url).href;
      fetch(nextUrl, redirects+1);
    } else {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log('Final: HTTP ' + res.statusCode + ' type=' + res.headers['content-type'] + ' size=' + data.length);
        console.log('Cache-Control:', res.headers['cache-control']);
        // Find ALL script src tags
        const scripts = data.match(/src="([^"]*)"/g) || [];
        scripts.forEach(s => console.log('Script:', s));
        // Show first 800 chars
        console.log('HTML preview:', data.substring(0, 800));
      });
    }
  }).on('error', e => console.error(e.message));
}

fetch('https://www.dividepass.com');
