/**
 * QA — teto de preco dos planos da plataforma (por pessoa).
 *
 * Roda a MATEMATICA REAL do app (src/lib/platformPlanPricing.js) contra os
 * planos que estao no banco de producao e confere:
 *   1) o valor sugerido do plano cabe dentro da propria faixa [min, max];
 *   2) o total sugerido (sugestao x vagas) cabe no total da faixa;
 *   3) o preco por pessoa de um total dentro da faixa PASSA na validacao;
 *   4) um preco por pessoa fora da faixa e BLOQUEADO.
 *
 * Uso: node scripts/qa-teto-planos.mjs
 */

import { readFileSync } from 'node:fs';
import {
  planSlotRange, planTotalRange, slotPriceOutOfRange, suggestedGroupTotal, pricePerSlot,
} from '../src/lib/platformPlanPricing.js';

const env = {};
readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .forEach((line) => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const [plans, services] = await Promise.all([
  fetch(`${url}/rest/v1/service_plans?select=id,name,service_id,official_price,min_price,max_price,suggested_price,max_members,max_screens,is_active`, { headers })
    .then((r) => r.json()),
  fetch(`${url}/rest/v1/streaming_services?select=id,name,max_group_size`, { headers })
    .then((r) => r.json()),
]);

const serviceById = new Map(services.map((s) => [s.id, s]));
let failures = 0;
let checked = 0;

const brl = (v) => `R$ ${(parseFloat(v) || 0).toFixed(2).replace('.', ',')}`;

for (const plan of plans.filter((p) => p.is_active)) {
  const range = planSlotRange(plan);
  if (!range.min && !range.max) continue; // plano sem teto: nada a conferir

  checked += 1;
  const service = serviceById.get(plan.service_id);
  const slots = plan.max_members || service?.max_group_size || 4;
  const platform = service?.name || plan.service_id.slice(0, 6);

  const problems = [];

  /* 1) o valor sugerido precisa caber na propria faixa */
  if (range.suggested) {
    const chk = slotPriceOutOfRange(plan, range.suggested);
    if (chk.outOfRange) {
      problems.push(`sugerido ${brl(range.suggested)} fora da faixa [${brl(range.min)}, ${brl(range.max)}]`);
    }
  }

  /* 2) o total sugerido (sugestao x vagas) tem que caber no total da faixa */
  const total = suggestedGroupTotal(plan, slots);
  const totalRange = planTotalRange(plan, slots);
  const perSlot = pricePerSlot(total, slots);
  if (perSlot > 0) {
    const chk = slotPriceOutOfRange(plan, perSlot);
    if (chk.outOfRange) {
      problems.push(`total sugerido ${brl(total)} (${brl(perSlot)}/pessoa em ${slots} vagas) fora da faixa`);
    }
    if (totalRange.min && total < totalRange.min) {
      problems.push(`total ${brl(total)} abaixo do total minimo ${brl(totalRange.min)}`);
    }
    if (totalRange.max && total > totalRange.max) {
      problems.push(`total ${brl(total)} acima do total maximo ${brl(totalRange.max)}`);
    }
  }

  /* 3) um preco dentro da faixa passa */
  if (range.min) {
    const ok = slotPriceOutOfRange(plan, range.min);
    if (ok.outOfRange) problems.push(`o proprio minimo ${brl(range.min)} foi bloqueado`);
  }
  if (range.max) {
    const ok = slotPriceOutOfRange(plan, range.max);
    if (ok.outOfRange) problems.push(`o proprio maximo ${brl(range.max)} foi bloqueado`);
  }

  /* 4) um preco fora da faixa e bloqueado */
  if (range.max) {
    const bad = slotPriceOutOfRange(plan, range.max + 0.01);
    if (!bad.outOfRange) problems.push(`acima do maximo (${brl(range.max + 0.01)}) NAO foi bloqueado`);
  }
  if (range.min) {
    const bad = slotPriceOutOfRange(plan, range.min - 0.01);
    if (!bad.outOfRange) problems.push(`abaixo do minimo (${brl(range.min - 0.01)}) NAO foi bloqueado`);
  }

  if (problems.length) {
    failures += 1;
    console.log(`FALHA  ${platform} / ${plan.name}`);
    problems.forEach((p) => console.log(`       - ${p}`));
  } else {
    console.log(
      `ok     ${platform} / ${plan.name}: faixa ${brl(range.min)}-${brl(range.max)} por pessoa`
      + ` | sugerido ${brl(range.suggested || 0)}`
      + ` | total ${brl(total)} (${brl(perSlot)}/pessoa em ${slots} vagas)`,
    );
  }
}

console.log(`\n${checked} plano(s) com teto conferido — ${failures} falha(s).`);
process.exitCode = failures ? 1 : 0;
