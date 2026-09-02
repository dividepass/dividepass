const fs = require('fs');

function analyzeBundle(path) {
  const bundle = fs.readFileSync(path, 'utf8');
  console.log('=== Bundle Analysis ===');
  console.log('Size:', bundle.length, 'bytes');
  
  // Bundler detection
  const isRolldown = bundle.includes('rolldown/runtime.js') || bundle.includes('rolldown');
  const isEsbuild = bundle.includes('__esModule') || bundle.includes('/* @__PURE__ */');
  console.log('Rolldown:', isRolldown ? 'YES' : 'NO');
  console.log('esbuild markers:', isEsbuild ? 'YES' : 'NO');
  
  // Check for chunks
  const chunkMatches = bundle.match(/"chunk-[^"]+"/g);
  const chunks = chunkMatches ? [...new Set(chunkMatches)] : [];
  console.log('Chunks:', chunks.length > 0 ? chunks : 'NONE');
  
  // Check for dynamic imports
  console.log('Dynamic import():', bundle.includes('import(') ? 'YES' : 'NO');
  console.log('import.meta.url:', bundle.includes('import.meta.url') ? 'YES' : 'NO');
  
  // Check for module interop helpers
  console.log('\nModule helpers:');
  console.log('  __toESM:', bundle.includes('__toESM') ? 'YES' : 'NO');
  console.log('  __esExports:', bundle.includes('__esExports') ? 'YES' : 'NO');
  console.log('  __commonJSMin:', bundle.includes('__commonJSMin') ? 'YES' : 'NO');
  
  // Check for savingsService
  console.log('\nSavingsService:');
  console.log('  calculateUserSavings:', bundle.includes('calculateUserSavings') ? 'YES' : 'NO');
  console.log('  getSavingsSummary:', bundle.includes('getSavingsSummary') ? 'YES' : 'NO');
  console.log('  getAdminAlerts:', bundle.includes('getAdminAlerts') ? 'YES' : 'NO');
  console.log('  hasValidData:', bundle.includes('hasValidData') ? 'YES' : 'NO');
  console.log('  seenIds:', bundle.includes('seenIds') ? 'YES' : 'NO');
  console.log('  normalizeToMonthly:', bundle.includes('normalizeToMonthly') ? 'YES' : 'NO');
  
  // Check for UserDashboard
  console.log('\nUserDashboard:');
  console.log('  SavingsServiceRow:', bundle.includes('SavingsServiceRow') ? 'YES' : 'NO');
  console.log('  savingsData:', bundle.includes('savingsData') ? 'YES' : 'NO');
  console.log('  showAllSavings:', bundle.includes('showAllSavings') ? 'YES' : 'NO');
  
  // Check for the build marker
  console.log('\nBuild marker:');
  console.log('  DIVIDEPASS_v20260825_FIXED:', bundle.includes('DIVIDEPASS_v20260825_FIXED') ? 'YES' : 'NO');
  console.log('  build fix for TDZ:', bundle.includes('build fix for TDZ') ? 'YES' : 'NO');
  
  // Check first 200 chars
  console.log('\nFirst 500 chars:');
  console.log(bundle.substring(0, 500));
  
  // Check for the rolldown comment at start
  const rolldownRegion = bundle.substring(0, 200);
  if (rolldownRegion.includes('#region')) {
    console.log('\nHas rolldown region comment at start: YES');
    console.log(rolldownRegion);
  }
}

console.log('=== LOCAL BUNDLE ===');
analyzeBundle('C:\\Users\\GABRIEL\\Documents\\DividePass\\dist\\assets\\index-BQLJ9ADd.js');
