/**
 * Cria (ou recria) a conta ÚNICA de QA em produção.
 *
 *   node scripts/criar-conta-qa.mjs
 *
 * A conta serve para todas as sondagens — não crie uma nova a cada teste.
 * Credenciais em scripts/lib/conta-qa.mjs.
 */
import { QA_USER, getSessaoQa } from './lib/conta-qa.mjs';

try {
  const sessao = await getSessaoQa();
  const res = await fetch(`${sessao.url}/rest/v1/users?select=id,email,name,created_at&email=eq.${encodeURIComponent(QA_USER.email)}`, {
    headers: { apikey: sessao.anon, Authorization: `Bearer ${sessao.token}` },
  });
  const rows = await res.json().catch(() => []);
  console.log(`Conta QA pronta: ${QA_USER.email}`);
  console.log(`Senha:            ${QA_USER.password}`);
  console.log(`Perfil:           ${Array.isArray(rows) && rows[0] ? `id=${rows[0].id} criado=${String(rows[0].created_at).slice(0, 19)}` : '(perfil ainda nao sincronizado)'}`);
} catch (err) {
  console.error('Falha ao preparar a conta QA:', err.message);
  process.exit(1);
}
