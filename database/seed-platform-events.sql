-- Popula platform_events com dados historicos
-- Usuarios cadastrados
INSERT INTO platform_events (event_type, title, message, metadata, created_by, created_at)
SELECT 
    'user_registered',
    'Usuario cadastrado',
    COALESCE(u.name, 'Sem nome') || ' (' || u.email || ') se cadastrou.',
    jsonb_build_object('user_id', u.id, 'email', u.email),
    u.id,
    u.created_at
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM platform_events pe 
    WHERE pe.event_type = 'user_registered' 
    AND pe.created_by = u.id
);

-- Grupos criados/aprovados
INSERT INTO platform_events (event_type, title, message, metadata, created_by, created_at)
SELECT
    CASE WHEN g.approval_status = 'approved' THEN 'group_approved' 
         WHEN g.approval_status = 'rejected' THEN 'group_rejected'
         ELSE 'group_created' END,
    CASE WHEN g.approval_status = 'approved' THEN 'Grupo aprovado'
         WHEN g.approval_status = 'rejected' THEN 'Grupo recusado'
         ELSE 'Grupo criado' END,
    g.name || ' foi criado por ' || COALESCE(u.name, 'desconhecido') || '.',
    jsonb_build_object('group_id', g.id, 'group_name', g.name, 'approval_status', COALESCE(g.approval_status, 'approved')),
    g.owner_id,
    g.created_at
FROM groups g
LEFT JOIN users u ON u.id = g.owner_id
WHERE NOT EXISTS (
    SELECT 1 FROM platform_events pe
    WHERE pe.event_type IN ('group_created', 'group_approved', 'group_rejected')
    AND (pe.metadata->>'group_id')::uuid = g.id
);

-- Membros ingressaram
INSERT INTO platform_events (event_type, title, message, metadata, created_by, created_at)
SELECT
    'member_joined',
    'Membro ingressou',
    COALESCE(u.name, 'Usuario') || ' ingressou no grupo "' || COALESCE(g.name, 'Grupo') || '".',
    jsonb_build_object('user_id', gm.user_id, 'group_id', gm.group_id, 'amount', 0),
    gm.user_id,
    gm.joined_at
FROM group_members gm
LEFT JOIN users u ON u.id = gm.user_id
LEFT JOIN groups g ON g.id = gm.group_id
WHERE gm.joined_at IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM platform_events pe
    WHERE pe.event_type = 'member_joined'
    AND (pe.metadata->>'user_id')::uuid = gm.user_id
    AND (pe.metadata->>'group_id')::uuid = gm.group_id
);
