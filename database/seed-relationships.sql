-- Reinserir relacionamentos com IDs corretos do Supabase Auth
DO $$
DECLARE
    admin_id UUID := '6b75cf33-d7da-49b6-b66a-79392e762381';
    joao_id UUID := '90fa0787-6370-4618-8ecb-423ae3ce7bfa';
    maria_id UUID := '9028d12d-95cf-4df1-bed4-e69fe20fecf8';
    pedro_id UUID := '2fe1ccb5-30cf-4963-a36f-62ed8c496dd4';
    ana_id UUID := '1d9585b8-ba10-43d1-8d49-2c1ad977c374';
    carlos_id UUID := '2149238f-b579-48cd-88dd-9d9f4871eaf1';
BEGIN
    -- Atualiza admin para role admin
    UPDATE public.users SET role = 'admin' WHERE id = admin_id;

    -- Membros dos Grupos
    INSERT INTO group_members (group_id, user_id, profile_name, status, joined_at)
    VALUES
        -- Netflix Grupo A (cheio)
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', joao_id, 'Tela 1', 'active', NOW() - INTERVAL '30 days'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', maria_id, 'Tela 2', 'active', NOW() - INTERVAL '25 days'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', pedro_id, 'Tela 3', 'active', NOW() - INTERVAL '20 days'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ana_id, 'Tela 4', 'active', NOW() - INTERVAL '15 days'),

        -- Netflix Grupo B
        ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', carlos_id, 'Tela 1', 'active', NOW() - INTERVAL '10 days'),

        -- Spotify Família 1
        ('cccccccc-cccc-cccc-cccc-cccccccccccc', joao_id, 'João', 'active', NOW() - INTERVAL '45 days'),
        ('cccccccc-cccc-cccc-cccc-cccccccccccc', carlos_id, 'Carlos', 'active', NOW() - INTERVAL '30 days'),

        -- Prime Grupo 1
        ('ffffffff-ffff-ffff-ffff-ffffffffffff', joao_id, 'Perfil 1', 'active', NOW() - INTERVAL '15 days');

    -- Assinaturas dos Usuários
    INSERT INTO user_subscriptions (user_id, group_id, service_id, status, started_at, expires_at)
    VALUES
        (joao_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active', '2026-06-01', '2026-07-01'),
        (joao_id, 'cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'active', '2026-05-15', '2026-07-15'),
        (joao_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff', '55555555-5555-5555-5555-555555555555', 'active', '2026-06-10', '2026-07-10'),
        (maria_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active', '2026-06-01', '2026-07-01'),
        (pedro_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active', '2026-06-01', '2026-07-01'),
        (ana_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active', '2026-06-01', '2026-07-01'),
        (carlos_id, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'active', '2026-06-10', '2026-07-10'),
        (carlos_id, 'cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'active', '2026-05-15', '2026-07-15');

    -- Pagamentos
    INSERT INTO payments (user_id, amount, method, status, transaction_code, paid_at, created_at)
    VALUES
        (joao_id, 12.90, 'pix', 'paid', 'PIX123456', NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days'),
        (joao_id, 8.90, 'pix', 'paid', 'PIX789012', NOW() - INTERVAL '45 days', NOW() - INTERVAL '45 days'),
        (joao_id, 10.90, 'credit_card', 'paid', 'CARD345678', NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days');

    -- Faturas
    INSERT INTO invoices (user_id, amount, due_date, status, paid_at)
    VALUES
        (joao_id, 45.90, '2026-07-15', 'pending', NULL),
        (joao_id, 45.90, '2026-06-15', 'paid', NOW() - INTERVAL '30 days'),
        (joao_id, 45.90, '2026-05-15', 'paid', NOW() - INTERVAL '60 days');

    -- Tickets de Suporte
    INSERT INTO support_tickets (user_id, subject, message, status, priority)
    VALUES
        (joao_id, 'Senha da Netflix não funciona', 'A senha fornecida está dando erro de login.', 'open', 'high'),
        (maria_id, 'Dúvida sobre renovação', 'Quando será cobrado novamente?', 'resolved', 'medium');

    -- Logs de Atividade
    INSERT INTO activity_logs (user_id, action, entity_type, entity_id, description)
    VALUES
        (maria_id, 'create', 'user', maria_id, 'Novo usuário se cadastrou'),
        (joao_id, 'payment', 'payment', NULL, 'Pagamento confirmado (Pix)'),
        (NULL, 'update', 'subscription', NULL, 'Assinatura Netflix #04 vence em 2 dias');

    -- Códigos PIN
    INSERT INTO verification_pins (group_id, code, source_email, used, created_at)
    VALUES
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '123456', 'netflix@account.com', FALSE, NOW() - INTERVAL '5 minutes');
END $$;
