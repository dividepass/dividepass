const https = require('https');

const SUPABASE_URL = 'https://lasoouwboxspstqvjbsv.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc29vdXdib3hzcHN0cXZqYnN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2Mjk0OTksImV4cCI6MjA5NzIwNTQ5OX0.BZLBNZ0Mw4NxnEw06y-c9zMNmfGB0N6IXJxZI-_VXSs';

function query(path, token = null) {
  return new Promise((resolve) => {
    const url = new URL(SUPABASE_URL + path);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + (token || ANON_KEY)
      }
    };
    
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data.substring(0, 300) });
        }
      });
    });
    req.on('error', e => resolve({ status: 'ERROR', data: e.message }));
    req.end();
  });
}

async function main() {
  // First get a user token
  console.log('=== Getting test user token ===');
  const ts = Date.now();
  const signup = await new Promise((resolve) => {
    const data = JSON.stringify({ email: `dbg${ts}@t.com`, password: 'TestPass123!', email_confirm: true });
    const url = new URL(SUPABASE_URL + '/auth/v1/signup');
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d) }));
    });
    req.write(data); req.end();
  });
  console.log('Signup:', signup.status, signup.data.user?.id || signup.data.msg || JSON.stringify(signup.data).substring(0, 100));
  
  const token = signup.data.access_token;
  const userId = signup.data.user?.id;

  console.log('\n=== Testing streaming_services (no auth) ===');
  const s1 = await query('/rest/v1/streaming_services?select=id,name,official_price&limit=1');
  console.log('[' + s1.status + ']', JSON.stringify(s1.data).substring(0, 300));

  console.log('\n=== Testing user_subscriptions with nested official_price (no auth) ===');
  const s2 = await query("/rest/v1/user_subscriptions?select=id,amount,billing_cycle,service:service_id(official_price)&status=eq.active&limit=1");
  console.log('[' + s2.status + ']', JSON.stringify(s2.data).substring(0, 300));

  console.log('\n=== Testing user_subscriptions with nested official_price (with user token) ===');
  const s3 = await query("/rest/v1/user_subscriptions?select=id,amount,billing_cycle,service:service_id(official_price)&status=eq.active&limit=1", token);
  console.log('[' + s3.status + ']', JSON.stringify(s3.data).substring(0, 300));

  console.log('\n=== Testing service_plans (no auth) ===');
  const s4 = await query('/rest/v1/service_plans?select=id,name&limit=1');
  console.log('[' + s4.status + ']', JSON.stringify(s4.data).substring(0, 300));

  console.log('\n=== Testing user_subscriptions with plan_id column (with user token) ===');
  const s5 = await query('/rest/v1/user_subscriptions?select=id,plan_id&limit=1', token);
  console.log('[' + s5.status + ']', JSON.stringify(s5.data).substring(0, 300));

  console.log('\n=== Testing the exact user_subscriptions query from AppDataProvider ===');
  const exactQuery = `/rest/v1/user_subscriptions?select=id,user_id,amount,billing_cycle,custom_months,service:service_id(official_price)&status=eq.active&user_id=eq.${userId}`;
  const s6 = await query(exactQuery, token);
  console.log('[' + s6.status + ']', JSON.stringify(s6.data).substring(0, 400));

  console.log('\n=== Testing user_subscriptions plain (with user token) ===');
  const s7 = await query('/rest/v1/user_subscriptions?select=id,user_id,amount&limit=1', token);
  console.log('[' + s7.status + ']', JSON.stringify(s7.data).substring(0, 300));

  console.log('\n=== Testing groups table (with user token) ===');
  const s8 = await query('/rest/v1/groups?select=id,name&limit=1', token);
  console.log('[' + s8.status + ']', JSON.stringify(s8.data).substring(0, 300));

  console.log('\n=== Testing payments table (with user token) ===');
  const s9 = await query('/rest/v1/payments?select=id,amount&limit=1', token);
  console.log('[' + s9.status + ']', JSON.stringify(s9.data).substring(0, 300));
}

main().catch(console.error);
