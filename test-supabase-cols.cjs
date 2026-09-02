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
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + (token || ANON_KEY) }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: data.substring(0, 300) }); }
      });
    });
    req.on('error', e => resolve({ status: 'ERROR', data: e.message }));
    req.end();
  });
}

async function main() {
  // Get token
  const ts = Date.now();
  const signup = await new Promise((resolve) => {
    const data = JSON.stringify({ email: `cols${ts}@t.com`, password: 'TestPass123!', email_confirm: true });
    const url = new URL(SUPABASE_URL + '/auth/v1/signup');
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Content-Length': Buffer.byteLength(data) }
    }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); });
    req.write(data); req.end();
  });
  const token = signup.access_token;
  console.log('Token obtained');

  const tests = [
    // Home.jsx exact query
    { name: 'Home.jsx user_subscriptions', url: '/rest/v1/user_subscriptions?select=id,user_id,amount,billing_cycle,custom_months,service:service_id(official_price)&status=eq.active&limit=1' },
    { name: 'Home.jsx payments', url: '/rest/v1/payments?select=id,user_id,amount,official_price,paid_amount,billing_cycle,custom_months,status,payment_type,created_at&status=eq.paid&payment_type=eq.subscription&limit=1' },
    // useAppData queries
    { name: 'useAppData streaming_services', url: '/rest/v1/streaming_services?select=id,name&status=eq.active&limit=1' },
    { name: 'useAppData groups', url: "/rest/v1/groups?select=id,name&status=eq.open&in=status.(open,forming)&limit=1" },
    { name: 'useAppData user_subscriptions (select *)', url: '/rest/v1/user_subscriptions?select=*&status=eq.active&limit=1' },
    { name: 'useAppData service_plans', url: '/rest/v1/service_plans?select=id,name&is_active=eq.true&limit=1' },
    // savings.js queries
    { name: 'savings user_subscriptions (plan nested)', url: '/rest/v1/user_subscriptions?select=id,amount,billing_cycle,plan:plan_id(official_price),service:service_id(name)&status=eq.active&limit=1' },
  ];

  for (const test of tests) {
    const r = await query(test.url, token);
    const status = r.status;
    const dataStr = JSON.stringify(r.data).substring(0, 150);
    const icon = status >= 400 ? 'FAIL' : 'OK';
    console.log(`[${icon}] [${status}] ${test.name}: ${dataStr}`);
  }
}

main().catch(console.error);
