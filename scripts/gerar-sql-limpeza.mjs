/**
 * Gera database/cleanup-contas-automacao.sql a partir do CSV da auditoria.
 * Só escreve o arquivo — NÃO executa nada no banco.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const csv = path.join(ROOT, "logs", "usuarios-producao.csv");
const out = path.join(ROOT, "database", "cleanup-contas-automacao.sql");

const rows = fs.readFileSync(csv, "utf8").trim().split("\n").slice(1).map((line) => {
  const cols = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) { cols.push(cur); cur = ""; }
    else cur += ch;
  }
  cols.push(cur);
  const [id, nome, email, role, status, email_verified, criado_em, ultimo_login, classificacao, vinculos] = cols;
  return { id, nome, email, role, status, email_verified, criado_em, ultimo_login, classificacao, vinculos };
});

/** Escopo pedido pelo usuário: exatamente estas 10 famílias. */
const FAMILIAS = [
  /^tags\.check\.\d+@gmail\.com$/i,
  /^wizard\.e2e\.\d+@gmail\.com$/i,
  /^visual\.check\.\d+@gmail\.com$/i,
  /^teste\.email\.code\.\d+@gmail\.com$/i,
  /^nocol\.\d+@gmail\.com$/i,
  /^wizard\.probe\.\d+@gmail\.com$/i,
  /^(test|dbg|dash)\d+@t\.com$/i,
  /^(rendercheck|fadecheck)-\d+@divteste\.com$/i,
  /^shot\.\d+@gmail\.com$/i,
  /^hunt[a-z0-9]+@maxxspace\.com$/i,
];

const assinatura = (r) => r.nome === r.email;
const hunt = (r) => /^hunt[a-z0-9]*@maxxspace\.com$/i.test(r.email);
const aliasUsuario = (r) => /^gwmorata\+\d+@gmail\.com$/i.test(r.email);
const suspectas = (r) => ["leo1leonardo123@gmail.com", "rodox85@yahoo.com.br"].includes(r.email);

const alvo = rows.filter((r) => FAMILIAS.some((re) => re.test(r.email)));
const revisao = rows.filter((r) => aliasUsuario(r) || suspectas(r));

const linhas = [];
linhas.push("-- ############################################################################");
linhas.push("-- # VERSAO v3 - 2026-10-27 18:45 (DividePass / lasoouwboxspstqvjbsv)");
linhas.push("-- #");
linhas.push("-- # 1) NAO usa split_part e NAO usa 'item text[]'.");
linhas.push("-- # 2) Define claims de admin na transacao (SET LOCAL request.jwt.claims),");
linhas.push("-- #    senao o trigger guard_group_privileged_fields barra groups.owner_id.");
linhas.push("-- # 3) Se voce esta lendo esta linha, e a versao certa.");
linhas.push("-- #    No editor do Supabase: clique no codigo, Ctrl+A, Ctrl+V, Run.");
linhas.push("-- ############################################################################");
linhas.push("-- ============================================================================");
linhas.push("-- LIMPEZA DAS CONTAS CRIADAS POR AUTOMAÇÃO (scripts/agentes de teste da IA)");
linhas.push("-- Gerado a partir de logs/usuarios-producao.csv (auditoria de 2026-10-27).");
linhas.push("--");
linhas.push(`-- Total de contas no alvo: ${alvo.length}`);
linhas.push("-- Escopo: as 10 famílias listadas (tags.check, wizard.e2e, visual.check,");
linhas.push("-- teste.email.code, nocol, wizard.probe, test/dbg/dash@t.com,");
linhas.push("-- rendercheck/fadecheck@divteste, shot, hunt*@maxxspace.com).");
linhas.push("-- Fora do escopo (não apagados): gwmorata+N@gmail.com, rodox85, leo1leonardo123.");
linhas.push("--");
linhas.push("-- IMPORTANTE: rode a parte 1 (conferência) e confira o resultado antes da parte 2.");
linhas.push("-- Nenhuma conta listada tem vínculo visível com grupo, pagamento ou wallet.");
linhas.push("-- ============================================================================");
linhas.push("");
linhas.push("-- ---------------------------------------------------------------------------");
linhas.push("-- 1) CONFERÊNCIA (somente leitura)");
linhas.push("-- ---------------------------------------------------------------------------");
linhas.push("SELECT email, name, created_at, status");
linhas.push("  FROM public.users");
linhas.push(" WHERE email IN (");
alvo.forEach((r, i) => linhas.push(`    '${r.email}'${i < alvo.length - 1 ? "," : ""}`));
linhas.push("  )");
linhas.push(" ORDER BY created_at;");
linhas.push("");
linhas.push("-- Quantas linhas de public.users ficariam (antes = total da tabela):");
linhas.push("SELECT (SELECT count(*) FROM public.users) AS antes,");
linhas.push("       (SELECT count(*) FROM public.users WHERE email IN (");
alvo.forEach((r, i) => linhas.push(`         '${r.email}'${i < alvo.length - 1 ? "," : ""}`));
linhas.push("       )) AS a_remover;");
linhas.push("");
linhas.push("-- ---------------------------------------------------------------------------");
linhas.push("-- 2) LIMPEZA (mesma ordem da edge function delete-account)");
linhas.push("-- ---------------------------------------------------------------------------");
linhas.push("BEGIN;");
linhas.push("");
linhas.push("-- 1.9) SESSION DE ADMIN");
linhas.push("--      is_admin() le o JWT (app_metadata.role=admin OU public.users.role=admin do");
linhas.push("--      auth.uid()). No SQL Editor nao ha JWT, entao o trigger");
linhas.push("--      guard_group_privileged_fields barra mexer em groups.owner_id.");
linhas.push("--      Estas claims simulam a sessao de admin (so valem dentro desta transacao).");
linhas.push("SET LOCAL request.jwt.claims = '{\"role\":\"service_role\",\"app_metadata\":{\"role\":\"admin\"}}';");
linhas.push("");
linhas.push("-- 2.1) Monta a lista de IDs alvo");
linhas.push("CREATE TEMP TABLE _limpeza_ids AS");
linhas.push("  SELECT id FROM public.users WHERE email IN (");
alvo.forEach((r, i) => linhas.push(`    '${r.email}'${i < alvo.length - 1 ? "," : ""}`));
linhas.push("  );");
linhas.push("");
linhas.push("-- 2.2) Dependências");
linhas.push("--      Tabelas com ON DELETE CASCADE/SET NULL são resolvidas pelo próprio FK.");
linhas.push("--      As com NO ACTION/RESTRICT bloqueiam a exclusão — são limpas aqui,");
linhas.push("--      discovers dinamicamente (foi o que travou a conta 'dash*').");
linhas.push("DO $$");
linhas.push("DECLARE r record; n integer;");
linhas.push("BEGIN");
linhas.push("  FOR r IN");
linhas.push("    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col");
linhas.push("      FROM pg_constraint c");
linhas.push("      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true");
linhas.push("      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum");
linhas.push("     WHERE c.contype = 'f'");
linhas.push("       AND c.confrelid = 'public.users'::regclass");
linhas.push("       AND c.confdeltype IN ('a','r')");
linhas.push("       AND array_length(c.conkey, 1) = 1");
linhas.push("  LOOP");
linhas.push("    BEGIN");
linhas.push("      EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', r.tbl, r.col)");
linhas.push("        USING ARRAY(SELECT id FROM _limpeza_ids);");
linhas.push("      GET DIAGNOSTICS n = ROW_COUNT;");
linhas.push("      RAISE NOTICE 'limpo % -> % linha(s)', r.tbl, n;");
linhas.push("    EXCEPTION WHEN OTHERS THEN");
linhas.push("      RAISE WARNING 'falhou ao limpar %: %', r.tbl, SQLERRM;");
linhas.push("    END;");
linhas.push("  END LOOP;");
linhas.push("END $$;");
linhas.push("");
linhas.push("-- 2.2.1) Tabelas conhecidas — DELETE condicional (ignora tabela ausente)");
linhas.push("--      Dois arrays paralelos: sem split_part, sem parse de texto.");
linhas.push("DO $$");
linhas.push("DECLARE");
linhas.push("  tbls text[] := ARRAY[");
const deps = [
  ["public.group_members", "user_id"],
  ["public.user_subscriptions", "user_id"],
  ["public.payments", "user_id"],
  ["public.invoices", "user_id"],
  ["public.password_resets", "user_id"],
  ["public.notifications", "user_id"],
  ["public.wallet_transactions", "user_id"],
  ["public.user_wallets", "user_id"],
  ["public.activity_logs", "user_id"],
  ["public.email_logs", "user_id"],
  ["public.payment_attempts", "user_id"],
  ["public.push_subscriptions", "user_id"],
  ["public.group_interest", "user_id"],
  ["public.group_messages", "user_id"],
  ["public.announcement_reads", "user_id"],
  ["public.support_tickets", "user_id"],
  ["public.user_feedback", "user_id"],
  ["public.user_card_metadata", "user_id"],
  ["public.campaign_rewards", "user_id"],
  ["public.user_referral_codes", "user_id"],
  ["public.referrals", "referrer_id"],
  ["public.referrals", "invitee_id"],
  ["public.wallet_withdrawals", "user_id"],
  ["public.wallet_withdrawals", "processed_by"],
  ["public.group_applications", "user_id"],
  ["public.group_applications", "reviewed_by"],
  ["public.custom_charges", "created_by"],
  ["public.custom_charge_logs", "admin_id"],
  ["public.platform_events", "created_by"],
  ["public.service_plans", "created_by"],
  ["public.group_credentials", "assigned_to"],
  ["public.group_profiles", "assigned_to"],
  ["public.billing_cycles", "created_by"],
  ["public.credentials", "assigned_to"],
];
deps.forEach(([t], i) => linhas.push(`    '${t}'${i < deps.length - 1 ? "," : ""}`));
linhas.push("  ];");
linhas.push("  cols text[] := ARRAY[");
deps.forEach(([, c], i) => linhas.push(`    '${c}'${i < deps.length - 1 ? "," : ""}`));
linhas.push("  ];");
linhas.push("  i integer; tbl text; col text; n integer; cnt integer;");
linhas.push("BEGIN");
linhas.push("  FOR i IN 1..coalesce(array_length(tbls, 1), 0) LOOP");
linhas.push("    tbl := tbls[i];");
linhas.push("    col := cols[i];");
linhas.push("    IF to_regclass(tbl) IS NOT NULL THEN");
linhas.push("      BEGIN");
linhas.push("        EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', tbl, col)");
linhas.push("          USING ARRAY(SELECT id FROM _limpeza_ids);");
linhas.push("        GET DIAGNOSTICS n = ROW_COUNT;");
linhas.push("        IF n > 0 THEN RAISE NOTICE 'limpo % -> % linha(s)', tbl, n; END IF;");
linhas.push("      EXCEPTION WHEN OTHERS THEN");
linhas.push("        RAISE WARNING 'falhou ao limpar %: %', tbl, SQLERRM;");
linhas.push("      END;");
linhas.push("    ELSE");
linhas.push("      RAISE NOTICE 'tabela ausente (ignorada): %', tbl;");
linhas.push("    END IF;");
linhas.push("  END LOOP;");
linhas.push("  -- owner_id / target_user_id usam ON DELETE SET NULL; garantimos por seguranca");
linhas.push("  IF to_regclass('public.groups') IS NOT NULL THEN");
linhas.push("    BEGIN");
linhas.push("      UPDATE public.groups SET owner_id = NULL WHERE owner_id IN (SELECT id FROM _limpeza_ids);");
linhas.push("    EXCEPTION WHEN OTHERS THEN");
linhas.push("      RAISE WARNING 'nao consegui liberar groups.owner_id: %', SQLERRM;");
linhas.push("    END;");
linhas.push("    EXECUTE 'SELECT count(*) FROM public.groups WHERE owner_id = ANY($1)' INTO cnt");
linhas.push("      USING ARRAY(SELECT id FROM _limpeza_ids);");
linhas.push("    IF cnt > 0 THEN");
linhas.push("      RAISE WARNING 'ainda % grupo(s) com owner_id de uma conta do alvo', cnt;");
linhas.push("    ELSE");
linhas.push("      RAISE NOTICE 'groups.owner_id: nenhum grupo preso as contas do alvo';");
linhas.push("    END IF;");
linhas.push("  END IF;");
linhas.push("  IF to_regclass('public.announcements') IS NOT NULL THEN");
linhas.push("    BEGIN");
linhas.push("      UPDATE public.announcements SET target_user_id = NULL WHERE target_user_id IN (SELECT id FROM _limpeza_ids);");
linhas.push("    EXCEPTION WHEN OTHERS THEN");
linhas.push("      RAISE WARNING 'nao consegui liberar announcements.target_user_id: %', SQLERRM;");
linhas.push("    END;");
linhas.push("  END IF;");
linhas.push("END $$;");
linhas.push("");
linhas.push("-- 2.2.2) Diagnóstico: alguma FK sem CASCADE ainda segura as contas?");
linhas.push("DO $$");
linhas.push("DECLARE r record; cnt integer;");
linhas.push("BEGIN");
linhas.push("  FOR r IN");
linhas.push("    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col");
linhas.push("      FROM pg_constraint c");
linhas.push("      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true");
linhas.push("      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum");
linhas.push("     WHERE c.contype = 'f'");
linhas.push("       AND c.confrelid = 'public.users'::regclass");
linhas.push("       AND c.confdeltype IN ('a','r')");
linhas.push("       AND array_length(c.conkey, 1) = 1");
linhas.push("  LOOP");
linhas.push("    BEGIN");
linhas.push("      EXECUTE format('SELECT count(*) FROM %s WHERE %I = ANY($1)', r.tbl, r.col)");
linhas.push("        INTO cnt USING ARRAY(SELECT id FROM _limpeza_ids);");
linhas.push("      IF cnt > 0 THEN");
linhas.push("        RAISE WARNING 'AINDA BLOQUEADO: %.% -> % linha(s)', r.tbl, r.col, cnt;");
linhas.push("      END IF;");
linhas.push("    EXCEPTION WHEN OTHERS THEN");
linhas.push("      RAISE WARNING 'nao consegui checar %: %', r.tbl, SQLERRM;");
linhas.push("    END;");
linhas.push("  END LOOP;");
linhas.push("END $$;");
linhas.push("");
linhas.push("-- 2.3) Perfil (public.users). O trigger de auth-sync recria a linha se a");
linhas.push("--       conta auth ainda existir, então apague o auth logo em seguida.");
linhas.push("DELETE FROM public.users WHERE id IN (SELECT id FROM _limpeza_ids);");
linhas.push("");
linhas.push("-- 2.4) Autenticação (auth.users). Precisa de service_role / SQL do dashboard.");
linhas.push("--       No SQL Editor do Supabase isso roda como postgres, então funciona.");
linhas.push("DELETE FROM auth.users WHERE id IN (SELECT id FROM _limpeza_ids);");
linhas.push("");
linhas.push("DROP TABLE _limpeza_ids;");
linhas.push("");
linhas.push("COMMIT;");
linhas.push("");
linhas.push("-- ---------------------------------------------------------------------------");
linhas.push("-- 3) CONFERÊNCIA FINAL");
linhas.push("-- ---------------------------------------------------------------------------");
linhas.push("SELECT count(*) AS restantes_no_escopo");
linhas.push("  FROM public.users");
linhas.push(" WHERE email IN (");
alvo.forEach((r, i) => linhas.push(`    '${r.email}'${i < alvo.length - 1 ? "," : ""}`));
linhas.push("  );");
linhas.push("");
linhas.push("-- Checagem ampla (informativa): sobrou alguma conta com nome = e-mail?");
linhas.push("SELECT count(*) AS restantes_nome_igual_email");
linhas.push("  FROM public.users");
linhas.push(" WHERE name = email;");
linhas.push("");
linhas.push("-- ---------------------------------------------------------------------------");
linhas.push("-- 4) FORA DO ESCOPO (não apagadas — revisar depois)");
linhas.push("-- ---------------------------------------------------------------------------");
revisao.forEach((r) => linhas.push(`-- ${r.email}  |  nome="${r.nome}"  |  criado em ${r.criado_em}`));
linhas.push("");

fs.writeFileSync(out, `${linhas.join("\n")}`, "utf8");
const v2 = path.join(ROOT, "database", "cleanup-contas-automacao-v2.sql");
fs.writeFileSync(v2, `${linhas.join("\n")}`, "utf8");
const v3 = path.join(ROOT, "database", "cleanup-contas-automacao-v3.sql");
fs.writeFileSync(v3, `${linhas.join("\n")}`, "utf8");
console.log(`SQL gerado: ${out}`);
console.log(`SQL gerado: ${v2}`);
console.log(`SQL gerado: ${v3}`);
console.log(`contas no alvo: ${alvo.length}`);
console.log(`para revisar: ${revisao.map((r) => r.email).join(", ")}`);
