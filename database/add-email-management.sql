-- ============================================================================
-- GESTÃO DE E-MAIL — TABELA DE TRILHA + CONFIGURAÇÃO
-- ============================================================================
-- Data: 2026-10-27
--
-- O QUE MUDA
-- ----------
-- A tabela `email_logs` já existia (usada pelo aviso de pagamento para o
-- admin), mas era rasa demais para sustentar a gestão de e-mail do cliente:
--
--  1) `user_id` — A COLUNA NÃO EXISTIA, e três lugares já a usavam:
--       - `supabase/functions/delete-account/index.ts`
--       - `supabase/functions/admin-delete-user/index.ts`
--       - `database/cleanup-contas-automacao*.sql`
--     Ou seja: ao apagar uma conta, o `DELETE ... WHERE user_id = ...` estourava
--     erro de coluna inexistente. Agora a coluna existe e o vínculo é real.
--
--  2) `status` + `error` — antes não dava para saber se o e-mail SAIU ou só
--     foi registrado. `sent` | `sending` | `failed` | `skipped`.
--
--  3) `dedup_key` — A BASE DA IDEMPOTÊNCIA. É uma chave única por evento
--     lógico (ex.: `renewal_reminder:<assinatura>:<data de vencimento>`).
--     O índice UNIQUE faz o banco recusar a segunda tentativa — dois jobs
--     rodando ao mesmo tempo não conseguem enviar o mesmo e-mail duas vezes.
--
-- COMO APLICAR
-- ------------
-- No SQL Editor do Supabase (roda como postgres). É seguro rodar mais de uma
-- vez: tudo é idempotente.
--
-- ⚠️ ORDEM DE PUBLICAÇÃO
--    1) ESTE SQL
--    2) as edge functions novas (send-lifecycle-emails, send-welcome-email)
--    3) o front (Vercel)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Colunas que faltavam em `email_logs`
-- ----------------------------------------------------------------------------
ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent';

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS error TEXT;

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS dedup_key TEXT;

COMMENT ON COLUMN public.email_logs.user_id IS
  'Dono do e-mail. Vincula a linha a um usuario (ON DELETE CASCADE).';
COMMENT ON COLUMN public.email_logs.status IS
  'sent (saiu) | sending (reservado, envio em andamento) | failed (falhou, pode retententar) | skipped (existente, nao reenviado).';
COMMENT ON COLUMN public.email_logs.dedup_key IS
  'Chave unica do evento logico. Garante que o mesmo evento nao gere dois e-mails.';

-- ----------------------------------------------------------------------------
-- 2) Chave estrangeira do dono
--
--    ON DELETE CASCADE: apagar a conta apaga a trilha de e-mail junto, e o
--    `delete-account`/`admin-delete-user` param de carregar essa coluna.
--
--    `NOT VALID` + `VALIDATE` evita lock longo numa tabela grande e ainda
--    garante o índice validado no fim.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_logs_user_id_fkey'
      AND conrelid = 'public.email_logs'::regclass
  ) THEN
    ALTER TABLE public.email_logs
      ADD CONSTRAINT email_logs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.email_logs
  VALIDATE CONSTRAINT email_logs_user_id_fkey;

-- ----------------------------------------------------------------------------
-- 3) Índice UNIQUE do dedup — o heart da idempotência
--
--    NULL não conflita com NULL no Postgres, então as linhas antigas (sem
--    dedup_key) convivem com o índice sem erro.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_logs_dedup_key
  ON public.email_logs (dedup_key)
  WHERE dedup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_logs_user_id
  ON public.email_logs (user_id)
  WHERE user_id IS NOT NULL;

-- Índice do painel: log por tipo, do mais novo para o mais antigo.
CREATE INDEX IF NOT EXISTS idx_email_logs_event_created
  ON public.email_logs (event_type, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4) Backfill: as linhas antigas (sem user_id) viram 'sent'
-- ----------------------------------------------------------------------------
UPDATE public.email_logs
   SET status = 'sent'
 WHERE status IS NULL;

-- ----------------------------------------------------------------------------
-- 5) Configuração da gestão de e-mail
--
--    Tudo em `app_settings` para o admin ajustar sem novo deploy.
--    `'false'`/'0'/'off' = desligado; qualquer outro valor = ligado.
-- ----------------------------------------------------------------------------
INSERT INTO app_settings (key, value) VALUES
  ('email_welcome_enabled',            'true'),
  ('email_subscription_enabled',       'true'),
  ('email_renewal_reminder_enabled',   'true'),
  ('email_overdue_enabled',            'true'),
  ('email_payment_failed_enabled',     'true'),
  ('email_cancelled_enabled',          'true'),
  ('email_renewal_reminder_days',      '3'),
  ('email_overdue_repeat_days',        '3'),
  ('email_from_name',                  'DividePass'),
  ('email_unsubscribe_note',           'Você recebe este e-mail porque tem uma conta ativa no DividePass.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ----------------------------------------------------------------------------
-- 6) Permissões
--
--    O service_role (edge functions) ignora RLS, então consegue inserir e
--    atualizar. O `authenticated` NÃO insere: só o admin lê.
-- ----------------------------------------------------------------------------
GRANT INSERT, UPDATE ON public.email_logs TO service_role;

COMMIT;

-- ============================================================================
-- CONFERENCIA
-- ============================================================================
--
-- As colunas novas existem?
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'email_logs'
-- ORDER BY ordinal_position;
--
-- A configuração foi gravada?
--
-- SELECT key, value FROM app_settings WHERE key LIKE 'email_%' ORDER BY key;
--
-- (O dedup_key deve aparecer como NULL nas linhas antigas — é o esperado.)
-- ============================================================================
