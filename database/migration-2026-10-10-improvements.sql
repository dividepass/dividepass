-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — migration consolidada (rodar UMA VEZ no SQL Editor)
--
-- Cobre todas as 8 fases:
--   Fase 0  lead_source, avatar_url, arquivamento de tickets
--   Fase 1  colunas de suporte (archived) usadas por dashboard/aba/lista
--   Fase 2  lead_source + lead_source_other (origem do cadastro em etapas)
--   Fase 3  testimonials.avatar_url (avatar desnormalizado)
--
-- Tudo é idempotente: pode rodar mais de uma vez sem quebrar.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ORIGEM DO CADASTRO (Etapa 4 do /register)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS lead_source text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS lead_source_other text;

COMMENT ON COLUMN public.users.lead_source IS
  'Como o usuario conheceu a plataforma (Instagram, Google, Indicacao, Facebook, TikTok, YouTube, WhatsApp, LinkedIn, ChatGPT, Outro)';
COMMENT ON COLUMN public.users.lead_source_other IS
  'Texto digitado quando lead_source = Outro';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. AVATAR NO DEPOIMENTO
--
-- public.users NÃO tem política de SELECT para visitante anônimo (só existe
-- "auth.role() = authenticated"), então a home pública não consegue ler
-- users.avatar_url. Por isso o avatar é copiado para testimonials, que já é
-- publicamente legível para os depoimentos aprovados.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.testimonials ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.testimonials.avatar_url IS
  'Copia do avatar no momento da criacao do depoimento (users.avatar_url)';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. ARQUIVAMENTO DE TICKETS
--
-- Coluna boolean separada em vez de um novo valor em status: arquivar é
-- ortogonal ao andamento. Um ticket aberto pode ser arquivado e sair da fila,
-- e um fechado também, sem perder a informação de como estava.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.support_tickets.archived IS
  'true = arquivado, some da listagem padrao do admin e das contagens';
COMMENT ON COLUMN public.support_tickets.archived_at IS
  'Data em que o ticket foi arquivado';
COMMENT ON COLUMN public.support_tickets.archived_by IS
  'Admin que arquivou o ticket';

-- A listagem padrão sempre filtra archived = false, então um índice parcial
-- cobre exatamente esse acesso.
CREATE INDEX IF NOT EXISTS support_tickets_archived_idx
  ON public.support_tickets (created_at DESC)
  WHERE archived = false;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. BACKFILL DOS DEPOIMENTOS JÁ EXISTENTES
-- Idempotente: só escreve onde ainda não há avatar.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.testimonials t
SET avatar_url = u.avatar_url
FROM public.users u
WHERE u.id = t.user_id
  AND u.avatar_url IS NOT NULL
  AND u.avatar_url <> ''
  AND (t.avatar_url IS NULL OR t.avatar_url = '');


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. TRIGGER DE SINCRONIZAÇÃO auth.users -> public.users
--
-- Reescrito por inteiro para incluir lead_source/lead_source_other. O padrão
-- de COALESCE preserva o valor já existente quando o metadata vem vazio
-- (ex.: usuário criado por seed antes desta migration).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- Atualiza usuário existente pelo email (caso tenha sido criado via seed)
    UPDATE public.users
    SET
        id = NEW.id,
        name = COALESCE(NEW.raw_user_meta_data->>'name', public.users.name, NEW.email),
        phone = COALESCE(NEW.raw_user_meta_data->>'phone', public.users.phone),
        lead_source = COALESCE(NEW.raw_user_meta_data->>'lead_source', public.users.lead_source),
        lead_source_other = COALESCE(NULLIF(NEW.raw_user_meta_data->>'lead_source_other', ''), public.users.lead_source_other),
        marketing_source = COALESCE(NEW.raw_user_meta_data->>'ga_source', public.users.marketing_source),
        marketing_gclid = COALESCE(NEW.raw_user_meta_data->>'ga_gclid', public.users.marketing_gclid),
        marketing_utm_source = COALESCE(NEW.raw_user_meta_data->>'ga_utm_source', public.users.marketing_utm_source),
        marketing_utm_medium = COALESCE(NEW.raw_user_meta_data->>'ga_utm_medium', public.users.marketing_utm_medium),
        marketing_utm_campaign = COALESCE(NEW.raw_user_meta_data->>'ga_utm_campaign', public.users.marketing_utm_campaign),
        marketing_utm_term = COALESCE(NEW.raw_user_meta_data->>'ga_utm_term', public.users.marketing_utm_term),
        marketing_utm_content = COALESCE(NEW.raw_user_meta_data->>'ga_utm_content', public.users.marketing_utm_content),
        marketing_captured_at = COALESCE(NULLIF(NEW.raw_user_meta_data->>'ga_captured_at', '')::timestamptz, public.users.marketing_captured_at),
        password_hash = 'auth-managed',
        email_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, FALSE),
        updated_at = NOW()
    WHERE public.users.email = NEW.email;

    -- Se não encontrou pelo email, insere novo
    IF NOT FOUND THEN
        INSERT INTO public.users (
            id,
            name,
            email,
            phone,
            lead_source,
            lead_source_other,
            marketing_source,
            marketing_gclid,
            marketing_utm_source,
            marketing_utm_medium,
            marketing_utm_campaign,
            marketing_utm_term,
            marketing_utm_content,
            marketing_captured_at,
            password_hash,
            role,
            status,
            email_verified,
            created_at,
            updated_at
        )
        VALUES (
            NEW.id,
            COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
            NEW.email,
            NEW.raw_user_meta_data->>'phone',
            NEW.raw_user_meta_data->>'lead_source',
            NULLIF(NEW.raw_user_meta_data->>'lead_source_other', ''),
            NEW.raw_user_meta_data->>'ga_source',
            NEW.raw_user_meta_data->>'ga_gclid',
            NEW.raw_user_meta_data->>'ga_utm_source',
            NEW.raw_user_meta_data->>'ga_utm_medium',
            NEW.raw_user_meta_data->>'ga_utm_campaign',
            NEW.raw_user_meta_data->>'ga_utm_term',
            NEW.raw_user_meta_data->>'ga_utm_content',
            NULLIF(NEW.raw_user_meta_data->>'ga_captured_at', '')::timestamptz,
            'auth-managed',
            CASE
                WHEN NEW.email = 'admin@dividepass.com' THEN 'admin'::user_role
                ELSE 'user'::user_role
            END,
            'active',
            COALESCE(NEW.email_confirmed_at IS NOT NULL, FALSE),
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            email_verified = EXCLUDED.email_verified,
            updated_at = NOW();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. VERIFICAÇÃO (rode depois para conferir que deu certo)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    col text;
BEGIN
    FOREACH col IN ARRAY ARRAY[
        'users.lead_source',
        'users.lead_source_other',
        'testimonials.avatar_url',
        'support_tickets.archived',
        'support_tickets.archived_at',
        'support_tickets.archived_by'
    ] LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = split_part(col, '.', 1)
              AND column_name  = split_part(col, '.', 2)
        ) THEN
            RAISE NOTICE 'OK   %', col;
        ELSE
            RAISE WARNING 'FALTOU %', col;
        END IF;
    END LOOP;
END $$;

SELECT 'depoimentos com avatar' AS metrica, count(*)::text AS valor
FROM public.testimonials WHERE avatar_url IS NOT NULL
UNION ALL
SELECT 'tickets arquivados', count(*)::text
FROM public.support_tickets WHERE archived = true
UNION ALL
SELECT 'usuarios com lead_source', count(*)::text
FROM public.users WHERE lead_source IS NOT NULL;