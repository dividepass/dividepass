const https = require('https');

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc29vdXdib3hzcHN0cXZqYnN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2Mjk0OTksImV4cCI6MjA5NzIwNTQ5OX0.BZLBNZ0Mw4NxnEw06y-c9zMNmfGB0N6IXJxZI-_VXSs',
        ...headers
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, data: d }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  // Test auth health
  console.log('=== Testing Supabase Auth ===\n');
  
  const healthRes = await post(
    'https://lasoouwboxspstqvjbsv.supabase.co/auth/v1/health',
    {}
  );
  console.log('Auth health:', healthRes.status, '-', healthRes.data);
  
  // Test with a fake login to see what error we get
  const loginRes = await post(
    'https://lasoouwboxspstqvjbsv.supabase.co/auth/v1/token?grant_type=password',
    { email: 'test@test.com', password: 'test123' }
  );
  console.log('\nLogin test (fake):', loginRes.status, '-', loginRes.data);
  
  // Try to check if project exists
  const projectRes = await post(
    'https://lasoouwboxspstqvjbsv.supabase.co/rest/v1/users?select=id,email&limit=5',
    {},
    { 'Prefer': 'count=none' }
  );
  console.log('\nUsers query:', projectRes.status);
}

main().catch(e => console.error('Error:', e.message));
