-- ============================================================
-- FUNÇÃO: log de eventos de um usuário (usada na aba "Logs de Eventos"
-- da ficha do usuário em /admin/users/[id])
-- ============================================================
-- O `metadata` chega no banco em DOIS formatos:
--   - objeto jsonb  -> edge functions que gravam o objeto direto
--   - texto jsonb   -> o front envia JSON.stringify(metadata)
--
-- Por isso `metadata->>'user_id'` não serve: nas linhas de texto o
-- Postgres falha com "cannot extract field from a scalar value" e a
-- consulta INTEIRA cai (mesmo que a linha problemática não seja a do
-- usuário procurado). A função abaixo lê os dois formatos.
--
-- A função é SECURITY DEFINER porque a RLS de platform_events só deixa
-- o admin passar — mas o admin é conferido dentro da própria função.

CREATE OR REPLACE FUNCTION public.admin_user_events(
    p_user_id UUID,
    p_since   TIMESTAMPTZ DEFAULT NULL,
    p_limit   INTEGER DEFAULT 500
)
RETURNS SETOF platform_events
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'somente admin pode ler o log de eventos'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH normalizado AS (
        SELECT
            e.id,
            e.event_type,
            e.title,
            e.message,
            e.metadata,
            e.created_by,
            e.created_at,
            CASE
                WHEN jsonb_typeof(e.metadata) = 'object'
                    THEN e.metadata ->> 'user_id'
                WHEN jsonb_typeof(e.metadata) = 'string'
                    THEN substring(e.metadata #>> '{}' from '"user_id"\s*:\s*"([^"]*)"')
                ELSE NULL
            END AS meta_user_id
        FROM public.platform_events e
        WHERE p_since IS NULL OR e.created_at >= p_since
    )
    SELECT n.id, n.event_type, n.title, n.message, n.metadata, n.created_by, n.created_at
    FROM normalizado n
    WHERE n.created_by = p_user_id
       OR n.meta_user_id = p_user_id::text
    ORDER BY n.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_user_events(UUID, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_events(UUID, TIMESTAMPTZ, INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_user_events(UUID, TIMESTAMPTZ, INTEGER) IS
    'Log de eventos de um usuario (admin). Le o metadata nos dois formatos: objeto jsonb e texto jsonb.';

-- O filtro por autor é o caminho mais usado da ficha do usuario.
CREATE INDEX IF NOT EXISTS idx_platform_events_created_by ON platform_events(created_by);

-- Faz o PostgREST enxergar a função nova sem precisar reiniciar nada.
NOTIFY pgrst, 'reload schema';
