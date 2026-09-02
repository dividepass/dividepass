const https = require('https');
const http = require('http');

function fetch(url, redirects = 0) {
  if (redirects > 5) { console.log('Too many redirects'); return; }
  const mod = url.startsWith('https') ? https : http;
  mod.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400) {
      const loc = res.headers.location;
      console.log('Redirect', res.statusCode, '->', loc);
      const nextUrl = loc.startsWith('http') ? loc : new URL(loc, url).href;
      fetch(nextUrl, redirects+1);
    } else {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log('Final: status=' + res.statusCode + ' type=' + res.headers['content-type'] + ' size=' + data.length);
        const markers = data.match(/DIVIDEPASS_[^\s"'<>]+/g);
        console.log('Markers:', markers || 'none');
        if (data.includes('<!doctype')) {
          console.log('IS HTML - CDN may be caching old version');
        } else if (data.length > 100000) {
          console.log('Looks like JS bundle - GOOD');
        }
      });
    }
  }).on('error', e => console.error(e.message));
}

// Try direct deploy URL
console.log('=== Direct deploy URL ===');
fetch('https://dividepass-lntr30klj-byefit.vercel.app/assets/index-l7teEp9q.js');
