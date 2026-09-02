const https = require('https');

const SUPABASE_URL = 'https://lasoouwboxspstqvjbsv.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhc29vdXdib3hzcHN0cXZqYnN2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYyOTQ5OSwiZXhwIjoyMDk3MjA1NDk5fQ.WP9X4V4eGJZt0lM7e5sLqKJz0b7dLZJvXxQkR2kZ2vE';

function query(path, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const url = new URL(SUPABASE_URL + path);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/json'
      }
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('=== Testing streaming_services columns ===');
  const cols = await query('/rest/v1/?select=column_name&schema=public&table=eq.streaming_services&information_schema.columns.order=ordinal_position');
  console.log('Status:', cols.status);
  if (cols.data?.columns) {
    cols.data.columns.forEach(c => console.log('  Column:', c.column_name));
  } else if (cols.data?.message) {
    console.log('Error:', cols.data.message);
  } else if (typeof cols.data === 'object') {
    console.log(JSON.stringify(cols.data, null, 2).substring(0, 500));
  }

  console.log('\n=== Testing streaming_services data ===');
  const services = await query('/rest/v1/streaming_services?select=id,name,official_price,default_plan_id&limit=3');
  console.log('Status:', services.status);
  console.log('Data:', JSON.stringify(services.data, null, 2).substring(0, 500));

  console.log('\n=== Testing user_subscriptions columns ===');
  const subsCols = await query('/rest/v1/?select=column_name&schema=public&table=eq.user_subscriptions');
  console.log('Status:', subsCols.status);
  if (subsCols.data?.columns) {
    subsCols.data.columns.forEach(c => console.log('  Column:', c.column_name));
  }

  console.log('\n=== Testing service_plans table ===');
  const plans = await query('/rest/v1/service_plans?select=id,name&limit=3');
  console.log('Status:', plans.status);
  console.log('Data:', JSON.stringify(plans.data, null, 2).substring(0, 500));

  console.log('\n=== Testing user_subscriptions with plan_id ===');
  const subs = await query('/rest/v1/user_subscriptions?select=id,plan_id&limit=1');
  console.log('Status:', subs.status);
  console.log('Data:', JSON.stringify(subs.data, null, 2).substring(0, 300));

  console.log('\n=== Testing the exact failing query ===');
  const failing = await query("/rest/v1/user_subscriptions?select=id,user_id,amount,billing_cycle,custom_months,service:service_id(official_price)&status=eq.active&limit=1");
  console.log('Status:', failing.status);
  console.log('Data:', JSON.stringify(failing.data, null, 2).substring(0, 500));
}

main().catch(console.error);
