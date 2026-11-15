// Confere se o bundle PUBLICADO da function já tem o código novo.
//
// Por que existe: "deployed successfully" NÃO prova que a versão nova foi
// publicada — cada function embute uma CÓPIA dos módulos de `_shared`, e
// quem importa outra function continua rodando a versão antiga até ser
// republicada. A conferência é feita no corpo publicado (vem em bytes:
// decodificar como UTF-8 antes de procurar as marcas).
//
// Uso: node scripts/conferir-bundle-pulse.mjs [nome-da-function]

import fs from 'node:fs';

const PROJETO = 'lasoouwboxspstqvjbsv';

const token = fs.readFileSync('.supabase_token', 'utf8').trim();
const fn = process.argv[2] || 'pulse-admin';

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJETO}/functions/${fn}/body`, {
  headers: { Authorization: `Bearer ${token}` },
});

if (!res.ok) {
  console.error(`Falha ao ler o bundle de ${fn}: HTTP ${res.status}`);
  process.exit(1);
}

const src = Buffer.from(await res.arrayBuffer()).toString('utf8');

const MARCAS = [
  ['rotuloCiclo (rótulo do período)', 'rotuloCiclo'],
  ['custom_cycle_label', 'custom_cycle_label'],
  ['marca "1 dia" (singular)', '1 dia'],
  ['n === 1 ? "dia" : "dias"', /n === 1 \? "dia" : "dias"/],
  ['marcarComoDividePass (troca da marca)', 'marcarComoDividePass'],
  ['resolverDonoAdmin (dono = admin oficial)', 'resolverDonoAdmin'],
  ['admin@dividepass.com', 'admin@dividepass.com'],
];

console.log(`${fn}: ${src.length} bytes publicados`);
for (const [nome, marca] of MARCAS) {
  const ok = marca instanceof RegExp ? marca.test(src) : src.includes(marca);
  console.log(`  ${ok ? 'ok  ' : 'FALTA'} ${nome}`);
}
