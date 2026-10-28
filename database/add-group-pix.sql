-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — Chave PIX do grupo (2026-10-27)
-- Rodar no SQL Editor do Supabase (dashboard) ou via `supabase db push`.
-- Idempotente: pode rodar mais de uma vez.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUE
--
-- O wizard de criação de grupo (src/pages/user/CreateGroup.jsx) termina com a
-- etapa "Pagamento", onde o criador informa:
--
--   • a chave PIX para transferir o valor
--   • a Taxa de Adesão  -> groups.entrance_fee / groups.has_entrance_fee
--   • o valor por transação -> groups.price_per_slot
--
-- As duas últimas já existem em produção. A chave PIX NÃO: a tabela public.groups
-- não tem coluna para ela (verificado em produção em 2026-10-27 — o filtro
-- `groups?select=id&pix_key=eq.x` devolve "column groups.pix_key does not exist").
--
-- ENQUANTO ESSA MIGRATION NÃO RODAR
--
-- O front detecta a ausência da coluna e mostra um aviso na etapa de Pagamento:
-- a chave digitada é aceita na tela, mas não é gravada. Nada trava — o grupo
-- é criado normalmente.
--
-- ───────────────────────────────────────────────────────────────────────────
-- 1) Colunas da chave PIX
-- ───────────────────────────────────────────────────────────────────────────
-- pix_key  -> a chave em si (CPF, CNPJ, e-mail, telefone ou chave aleatória)
-- pix_type -> o tipo da chave: cpf | cnpj | email | phone | random
--
-- TEXT (e não VARCHAR) porque chave aleatória de PIX tem 32 caracteres com
-- hifen (ex.: 123e4567-89ab-12cd-34ef-567890123456) e o type não casa com
-- VARCHAR(20) em nenhum caso real.
--
-- Nullable de proposito: os grupos ja existentes ficam com NULL e continuam
-- funcionando (a coluna nova entra com DEFAULT NULL).

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS pix_key TEXT,
  ADD COLUMN IF NOT EXISTS pix_type VARCHAR(20);

COMMENT ON COLUMN public.groups.pix_key IS
  'Chave PIX para onde o membro transfere o valor do grupo (cpf|cnpj|email|phone|random em pix_type).';
COMMENT ON COLUMN public.groups.pix_type IS
  'Tipo da chave PIX: cpf | cnpj | email | phone | random.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Indices uteis
-- ───────────────────────────────────────────────────────────────────────────
-- O admin pode filtrar grupos por chave PIX. Indice parcial: so os grupos
-- que realmente tem chave entram.
CREATE INDEX IF NOT EXISTS idx_groups_pix_key
  ON public.groups (pix_key)
  WHERE pix_key IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Bucket de fotos do grupo (group-covers)
-- ───────────────────────────────────────────────────────────────────────────
-- O bucket JA EXISTE em producao (upload funciona — validado em 2026-10-27).
-- Esta secao é só uma garantia para ambiente novo: se o bucket não existir,
-- o upload da foto do grupo falha e o cadastro do grupo não pode ser
-- concluído com foto.

INSERT INTO storage.buckets (id, name, public)
VALUES ('group-covers', 'group-covers', true)
ON CONFLICT (id) DO NOTHING;

-- Leitura publica da foto (a capa aparece no catalogo e nos cards).
DROP POLICY IF EXISTS "Public read group covers" ON storage.objects;
CREATE POLICY "Public read group covers"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'group-covers');

-- O dono do grupo sobe a propria foto.
DROP POLICY IF EXISTS "Owners upload group covers" ON storage.objects;
CREATE POLICY "Owners upload group covers"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'group-covers'
    AND (storage.foldername(name))[1] IS NOT NULL
  );

DROP POLICY IF EXISTS "Owners update group covers" ON storage.objects;
CREATE POLICY "Owners update group covers"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'group-covers')
  WITH CHECK (bucket_id = 'group-covers');

-- ───────────────────────────────────────────────────────────────────────────
-- Verificacao
-- ───────────────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name = 'groups'
--    AND column_name IN ('pix_key', 'pix_type');
--
-- Depois de aplicar, recarregue /dashboard/my-groups/create: o aviso amber
-- "a coluna pix_key ainda nao existe no banco" some e a chave passa a ser
-- gravada em public.groups.
