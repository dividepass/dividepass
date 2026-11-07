-- ============================================================================
-- EXECUTAR NO SQL EDITOR DO SUPABASE — projeto lasoouwboxspstqvjbsv
-- ============================================================================
-- Data: 01/11/2026
-- Motivo: o link do Grupo VIP do WhatsApp estava FIXO no bundle (src/lib/
-- siteLinks.js). Convite de grupo expira quando o grupo fica sem atividade,
-- então toda vez que o link morria era preciso mexer no código e fazer deploy.
--
-- O QUE ESTE ARQUIVO FAZ (tudo idempotente)
-- ---------------------------------------------------
--   1. Cria a configuração `whatsapp_vip_url` (o link do convite).
--
--   2. Libera a LEITURA dessa chave para visitanteSEM LOGIN (role `anon`) —
--      é o que permite a home, o rodapé e as páginas de plataforma usarem o
--      link sem autenticação. A policy é restrita aESSA chave: nenhuma outra
--      configuração (senhas SMTP, tokens de gateway, segredos) fica exposta.
--
--   3. Inclui a chave na policy dos usuários logados, para o painel do
--      cliente também ler o mesmo valor.
--
-- COMO USAR DEPOIS
-- -----------------
--   Painel admin (dividepass.com/admin/settings) → "Grupo VIP no WhatsApp" →
--   cole o link novo (ou só o código) → "Salvar Configurações".
--   O site inteiro (home, rodapé, painel do usuário) passa a usar o link novo
--   no próximo carregamento — sem deploy.
--
-- COMO EXECUTAR
-- -------------
--   Dashboard → SQL Editor → New query → cole o arquivo INTEIRO → Run.
--   Se aparecer "Potential issue detected — destructive operations", clique
--   em "Run query".
--
-- PODE RODAR DE NOVO: nada é duplicado e o link que o admin já tiver
-- cadastrado NÃO é sobrescrito (o ON CONFLICT só insere se a chave ainda
-- não existir).
-- ============================================================================


-- ───────────────────────────────────────────────────────────────────────────
-- 1. A configuração
-- ───────────────────────────────────────────────────────────────────────────
-- O valor inicial é o convite atual. Depois que o script rodar, o lugar
-- oficial para trocar o link é o painel admin (que grava por cima deste).
INSERT INTO public.app_settings (key, value)
VALUES ('whatsapp_vip_url', 'https://chat.whatsapp.com/Cp1mVj7dJuOEiDwYe2oEeR')
ON CONFLICT (key) DO NOTHING;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Leitura pública APENAS do link do grupo
-- ───────────────────────────────────────────────────────────────────────────
-- `anon` = visitante sem login (a landing). O `USING (key = ...)` garante
-- que a policy só enxerga ESSA linha — as credenciais do app_settings
-- continuam restritas ao admin.
DROP POLICY IF EXISTS "Anon le link do grupo VIP" ON public.app_settings;
CREATE POLICY "Anon le link do grupo VIP"
  ON public.app_settings
  FOR SELECT
  TO anon
  USING (key = 'whatsapp_vip_url');

-- Sem isso o PostgREST nega a leitura do role `anon` mesmo com a policy
-- acima (o GRANT padrão do Supabase nem sempre cobre tabelas criadas
-- depois por migration).
GRANT SELECT ON public.app_settings TO anon;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Usuários logados leem a mesma chave
-- ───────────────────────────────────────────────────────────────────────────
-- Recria a policy de settings públicas com a chave do grupo incluída.
-- As demais chaves continuam admin-only.
DROP POLICY IF EXISTS "Usuarios leem settings publicas" ON public.app_settings;
CREATE POLICY "Usuarios leem settings publicas"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (key IN ('active_gateway', 'default_entrance_fee', 'whatsapp_vip_url'));


-- ───────────────────────────────────────────────────────────────────────────
-- Verificação
-- ───────────────────────────────────────────────────────────────────────────
-- Deve aparecer a linha com o link do convite:
SELECT key, value FROM public.app_settings WHERE key = 'whatsapp_vip_url';

-- O que o visitante (anon) consegue ler de app_settings: só esta linha.
-- Se aparecer qualquer outra (smtp_host, gateway_fee_percent, etc.), o RLS
-- está aberto demais — não siga para a frente.
--
-- SET ROLE anon;
-- SELECT key FROM public.app_settings;
-- RESET ROLE;
