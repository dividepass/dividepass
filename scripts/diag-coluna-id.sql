-- Diagnóstico: por que o bloco de conversão roda duas vezes?
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'sponsored_offers'
  AND column_name = 'id';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'sponsored_offers'
       AND data_type = 'uuid'
  ) THEN
    RAISE NOTICE 'RESULTADO: ainda e uuid -> converteria';
  ELSE
    RAISE NOTICE 'RESULTADO: ja e text -> nao converte';
  END IF;
END $$;
