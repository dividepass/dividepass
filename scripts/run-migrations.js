/* eslint-disable no-undef */
const https = require('https');
const fs = require('fs');

const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PROJECT_URL = 'https://lasoouwboxspstqvjbsv.supabase.co';

function execSQL(sql) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query: sql });
    const url = new URL(PROJECT_URL);
    const options = {
      hostname: url.hostname,
      path: '/rest/v1/rpc/exec_sql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const sqlFiles = [
    'database/add-group-slug.sql',
    'database/add-service-slug.sql',
    'database/add-group-interest.sql'
  ];

  for (const file of sqlFiles) {
    console.log(`\n=== Rodando ${file} ===`);
    const sql = fs.readFileSync(file, 'utf8');

    // Tenta criar a funcao exec_sql primeiro (na primeira chamada)
    if (file === sqlFiles[0]) {
      const createFn = `CREATE OR REPLACE FUNCTION exec_sql(query TEXT) RETURNS TEXT AS $fn$ BEGIN EXECUTE query; RETURN 'OK'; END; $fn$ LANGUAGE plpgsql SECURITY DEFINER;`;
      const fnResult = await execSQL(createFn);
      console.log('Create exec_sql function:', fnResult.status, fnResult.body);
      if (fnResult.status !== 200 && fnResult.status !== 204) {
        console.log('Funcao exec_sql nao existe ainda. Tentando via Management API...');
      }
    }

    const result = await execSQL(sql);
    console.log(`Result: ${result.status}`, result.body);
  }

  console.log('\n=== Pronto! ===');
}

main().catch(console.error);
