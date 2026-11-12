/**
 * Confere o bundle que está SERVIDO em produção (dividepass.com) depois da
 * mudança que tirou o nome dos gateways da tela de checkout.
 *
 * Marcadores:
 *   - o mapa `{mercadopago:"Mercado Pago", ...}` só existia para Mostrar o
 *     nome do gateway no botão/resumo → se ainda estiver no bundle, é o build
 *     ANTIGO;
 *   - "Renovação de R$ ... via X" também era o texto antigo.
 *
 * uso: node scripts/conferir-bundle-gateway.mjs
 */
const URL_SITE = process.env.SITE_URL || 'https://dividepass.com';

const html = await (await fetch(URL_SITE, { cache: 'no-store' })).text();
const scripts = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
if (!scripts.length) {
  console.log('NAO ACHOU script em', URL_SITE);
  process.exit(1);
}
console.log('scripts no index:', scripts.join(', '));

const maiores = [];
for (const src of scripts) {
  const txt = await (await fetch(new URL(src, URL_SITE), { cache: 'no-store' })).text();
  maiores.push({ src, txt });
}
maiores.sort((a, b) => b.txt.length - a.txt.length);
const principal = maiores[0];

const tem = (txt, alvo) => txt.includes(alvo);
const linhas = [
  ['mapa de nomes de gateway (mercadopago:"Mercado Pago")', tem(principal.txt, 'mercadopago:"Mercado Pago"')],
  ['resumo antigo "recorrente mensal via "', tem(principal.txt, 'recorrente mensal via ')],
  ['resumo novo "Pagamento recorrente mensal."', tem(principal.txt, 'Pagamento recorrente mensal.')],
  ['resumo novo "Pagamento único."', tem(principal.txt, 'Pagamento único.')],
  ['botao novo "Pagar agora"', tem(principal.txt, 'Pagar agora')],
  ['renovacao=1 (modo renovacao)', tem(principal.txt, 'renovacao=1')],
];

let ok = true;
for (const [nome, presente] of linhas) {
  const okLine = !presente || /novo|Pagar agora|renovacao=1/.test(nome);
  if (!okLine) ok = false;
  console.log(`${presente ? 'PRESENTE' : 'ausente '}  ${nome}`);
}

const temNome = linhas[0][1] || linhas[1][1];
console.log('\nRESULTADO:', temNome ? 'bundle ANTIGO (nome do gateway ainda aparece)' : 'bundle NOVO (sem nome de gateway)');
process.exit(temNome ? 1 : 0);
