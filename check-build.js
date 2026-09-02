const { readFileSync } = require('fs');
const sp = readFileSync('src/pages/admin/ServicePlans.jsx', 'utf8');
const sv = readFileSync('src/utils/savings.js', 'utf8');
const ss = readFileSync('src/utils/savingsService.js', 'utf8');

console.log('=== Circular Check ===');
console.log('savingsService -> savings:', ss.includes("from './savings'"));
const hasCircular = sv.includes('savingsService') && /import.*savingsService/.test(sv);
console.log('savings -> savingsService:', hasCircular);

console.log('\n=== checkPriceStaleness ===');
console.log('savings.js exports:', sv.includes('export function checkPriceStaleness'));
console.log('ServicePlans uses:', sp.includes('checkPriceStaleness'));

console.log('\n=== savingsService exports ===');
ss.split('\n').filter(l => l.trim().startsWith('export ')).forEach(l => console.log('  ', l.trim()));

console.log('\n=== savings.js exports (functions) ===');
sv.split('\n').filter(l => l.trim().startsWith('export function')).forEach(l => console.log('  ', l.trim()));

console.log('\n=== savingsService imports ===');
ss.split('\n').filter(l => l.trim().startsWith('import ')).forEach(l => console.log('  ', l.trim()));

console.log('\n=== savings.js imports ===');
sv.split('\n').filter(l => l.trim().startsWith('import ')).forEach(l => console.log('  ', l.trim()));
