-- =============================================================================
-- DividePass — schema de TESTE do fluxo novo de onboarding
-- =============================================================================
-- Recria, num banco descartável, as DUAS tabelas que o onboarding usa, com o
-- mesmo DDL de produção. Serve para testar a migration
-- database/EXECUTAR-2026-11-02-onboarding-novo-fluxo.sql sem tocar em nada
-- real.
--
-- Uso (WSL, Postgres local):
--   wsl -e bash -c "su postgres -c 'dropdb --if-exists qa_onboarding_test'"
--   wsl -e bash -c "su postgres -c 'createdb qa_onboarding_test'"
--   wsl -e bash -c "su postgres -c 'psql -v ON_ERROR_STOP=1 -d qa_onboarding_test \
--     -f /mnt/c/Users/GABRIEL/Documents/DividePass/scripts/test-onboarding-novo-fluxo-schema.sql'"
--   wsl -e bash -c "su postgres -c 'psql -v ON_ERROR_STOP=1 -d qa_onboarding_test \
--     -f /mnt/c/Users/GABRIEL/Documents/DividePass/database/EXECUTAR-2026-11-02-onboarding-novo-fluxo.sql'"
-- =============================================================================

DROP TABLE IF EXISTS public.user_onboarding_interests;
DROP TABLE IF EXISTS public.user_onboarding_profiles;

-- Papéis do Supabase: a produção tem `anon` e `authenticated`. O banco de
-- teste precisa deles para que os GRANT da migration sejam exercitados de
-- verdade (e não pulados pelo guard).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

-- Usuário "fake" para satisfazer a FK (em produção é auth.users).
CREATE TABLE IF NOT EXISTS auth_fake_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
INSERT INTO auth_fake_users DEFAULT VALUES;

CREATE TABLE public.user_onboarding_profiles (
  user_id                  uuid PRIMARY KEY,
  subscriptions_count_band text,
  monthly_spend_band       text,
  already_shares           boolean,
  shares_with              text[] DEFAULT '{}'::text[],
  main_barrier             text,
  main_barrier_other       text,
  group_interest           text,
  would_recommend          text,
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE public.user_onboarding_interests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  platform_id   uuid,
  platform_name text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('current', 'interested')),
  is_custom     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kind, platform_name)
);

-- Coluna extra de teste: prova que o CHECK antigo realmente barra valor novo.
-- (a migration precisa trocar esse CHECK)
