-- ============================================================================
-- EXECUTAR NO SQL EDITOR DO SUPABASE — projeto lasoouwboxspstqvjbsv
-- ============================================================================
-- Data: 06/11/2026
-- Motivo: a WOOVI tem DUAS contas — a de teste (api.woovi-sandbox.com) e a
-- real (api.woovi.com) — e cada uma tem o seu AppID. O AppID de uma é
-- RECUSADO pela outra com `401 appID inválido`.
--
-- O projeto guardava UM AppID só (`woovi_app_id`) e trocava apenas a URL da
-- API. Efeito: com o ambiente em "produção", a API real recebia o AppID do
-- sandbox e recusava TODA requisição — com um erro ("appID inválido") que não
-- dá nenhuma pista de que o problema era o par (AppID, URL) errado.
--
-- O QUE ESTE ARQUIVO FAZ (tudo idempotente)
-- -----------------------------------------
--   1. Cria a chave `woovi_app_id_sandbox`, MIGRANDO para ela o valor que
--      hoje está em `woovi_app_id` (que sempre guardou o AppID de TESTE).
--      Se a chave nova já existir, o valor dela é PRESERVADO.
--
--   2. Cria a chave `woovi_app_id_production`, vazia. O AppID real é
--      cadastrado no painel (Admin → Configurações → Credenciais → Woovi →
--      "AppID de Produção"). Não existe valor padrão possível: cada conta
--      Woovi tem o seu.
--
--   3. NÃO mexe em nenhuma policy. As chaves novas são credenciais: só o
--      admin (policy "Admins gerenciam configurações", que é `is_admin()`)
--      consegue ler ou gravar. O usuário logado e o visitante continuam sem
--      acesso a elas.
--
-- A CHAVE LEGADA `woovi_app_id`
-- -----------------------------
-- Ela continua existindo e continua sendo gravada pelo painel (= o AppID do
-- sandbox), porque o script que cadastra o webhook da Woovi ainda a lê. O
-- backend usa a chave nova quando ela existe e cai na legada só como
-- reserva do ambiente de teste.
--
-- DEPOIS DE RODAR
-- ---------------
--   Painel admin (dividepass.com/admin/settings) → Credenciais → Woovi:
--     - "AppID do Sandbox"  → já vem preenchido com o valor migrado;
--     - "AppID de Produção" → cole aqui o AppID da conta real
--       (Woovi → API/Plugins → Nova API/Plugin);
--     - clique em "Testar" em cada um: o painel chama a API da Woovi e diz
--       se a credencial foi aceita.
--
-- COMO EXECUTAR
-- -------------
--   Dashboard → SQL Editor → New query → cole o arquivo INTEIRO → Run.
--   Se aparecer "Potential issue detected — destructive operations", clique
--   em "Run query".
--
-- PODE RODAR DE NOVO: nada é duplicado e nenhum valor configurado é
-- sobrescrito.
-- ============================================================================


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Sandbox: nasce com o valor legado (o AppID de teste que já existia)
-- ───────────────────────────────────────────────────────────────────────────
-- O `WHERE NOT EXISTS` garante que, se o admin já configurou o AppID do
-- sandbox pelo painel, rodar a migration NÃO sobrescreve a escolha dele.
INSERT INTO public.app_settings (key, value)
SELECT
  'woovi_app_id_sandbox',
  COALESCE(
    (SELECT value FROM public.app_settings WHERE key = 'woovi_app_id'),
    ''
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_settings WHERE key = 'woovi_app_id_sandbox'
);


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Produção: nasce vazia (o AppID real é cadastrado no painel)
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value)
SELECT 'woovi_app_id_production', ''
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_settings WHERE key = 'woovi_app_id_production'
);


-- ───────────────────────────────────────────────────────────────────────────
-- 3. A chave legada passa a espelhar o sandbox
-- ───────────────────────────────────────────────────────────────────────────
-- O script `configurar-webhook-woovi.mjs` e a reserva do backend leem
-- `woovi_app_id`. Mantê-la igual ao AppID do sandbox evita que alguém
-- edite o campo novo e o script use um AppID velho.
UPDATE public.app_settings
SET value = (SELECT value FROM public.app_settings WHERE key = 'woovi_app_id_sandbox')
WHERE key = 'woovi_app_id';


-- ───────────────────────────────────────────────────────────────────────────
-- Verificação
-- ───────────────────────────────────────────────────────────────────────────
-- Deve mostrar 3 linhas: o sandbox (com o AppID migrado), a produção
-- (vazio, até o admin cadastrar) e a legada (espelhando o sandbox).
SELECT key,
       CASE WHEN value = '' THEN '(vazio)' ELSE left(value, 12) || '...' END AS valor
FROM public.app_settings
WHERE key LIKE 'woovi_app_id%'
ORDER BY key;

-- O ambiente de operação NÃO pode ter mudado:
SELECT key, value FROM public.app_settings WHERE key = 'ambiente';

-- As credenciais NÃO podem ter vazado para o usuário logado nem para o
-- visitante. Este SELECT tem que voltar VAZIO:
-- SET ROLE authenticated;
-- SELECT key FROM public.app_settings WHERE key LIKE 'woovi_app_id%';
-- RESET ROLE;
--
-- SET ROLE anon;
-- SELECT key FROM public.app_settings WHERE key LIKE 'woovi_app_id%';
-- RESET ROLE;
