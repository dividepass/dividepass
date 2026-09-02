const https = require('https');

https.get('https://dividepass-lntr30klj-byefit.vercel.app', (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const match = data.match(/src="([^"]*index-[^"]+\.js)"/);
    console.log('Latest deploy HTML script:', match ? match[1] : 'none');
    console.log('HTML size:', data.length);
    if (!match) {
      const match2 = data.match(/src='([^']*index-[^']+\.js)'/);
      console.log('Alt match:', match2 ? match2[1] : 'none');
    }
  });
}).on('error', e => console.error(e.message));

// Also check what the OLD deploy (o6aw29jsm) has
https.get('https://dividepass-o6aw29jsm-byefit.vercel.app', (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const match = data.match(/src="([^"]*index-[^"]+\.js)"/);
    console.log('OLD deploy HTML script:', match ? match[1] : 'none');
  });
}).on('error', e => console.error(e.message));
