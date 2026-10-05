-- Suporte a e-mails de confirmação que exigem clique (ex.: "Sim, fui eu" da Netflix)
-- Nesses casos não existe código numérico: a URL da ação é entregue ao usuário.

ALTER TABLE verification_pins
  ADD COLUMN IF NOT EXISTS manual_action_url text,
  ADD COLUMN IF NOT EXISTS manual_action_label text,
  ADD COLUMN IF NOT EXISTS manual_action_note text,
  ADD COLUMN IF NOT EXISTS manual_action_details jsonb;

-- E-mails de confirmação não têm código numérico (code = NULL)
ALTER TABLE verification_pins ALTER COLUMN code DROP NOT NULL;

-- Índice parcial: só linhas que realmente têm ação manual
CREATE INDEX IF NOT EXISTS verification_pins_manual_action_idx
  ON verification_pins (group_id, created_at DESC)
  WHERE manual_action_url IS NOT NULL;

COMMENT ON COLUMN verification_pins.manual_action_url IS
  'URL de confirmação/ativação que o usuário precisa abrir (link de uso único)';
COMMENT ON COLUMN verification_pins.manual_action_label IS
  'Texto do botão exibido no front (ex.: "Abrir e confirmar")';
COMMENT ON COLUMN verification_pins.manual_action_note IS
  'Instrução curta exibida abaixo do botão';
COMMENT ON COLUMN verification_pins.manual_action_details IS
  'Detalhes do pedido exibidos no cartão: { requester, device, when }';