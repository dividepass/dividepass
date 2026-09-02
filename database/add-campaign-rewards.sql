-- ============================================================
-- Tabela: campaign_rewards
-- Elegibilidade individual por campanha de cupom genérico.
-- Exemplo: campanha AVALIE5 — todos usam o mesmo código,
-- mas só usuários elegíveis podem usar.
-- ============================================================

CREATE TABLE IF NOT EXISTS campaign_rewards (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  campaign    TEXT        NOT NULL,   -- ex: 'AVALIE5'
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  earned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,   -- 30 dias após gained
  status      TEXT        NOT NULL DEFAULT 'available'
               CHECK (status IN ('available', 'used', 'expired')),
  CONSTRAINT campaign_rewards_user_campaign_uniq
    UNIQUE (campaign, user_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_rewards_campaign
  ON campaign_rewards(campaign);

CREATE INDEX IF NOT EXISTS idx_campaign_rewards_user
  ON campaign_rewards(user_id);

CREATE INDEX IF NOT EXISTS idx_campaign_rewards_available
  ON campaign_rewards(user_id, status)
  WHERE status = 'available';

COMMENT ON TABLE campaign_rewards IS
  'Elegibilidade individual por campanha. Um mesmo código de cupom
   pode ser usado por múltiplos usuários, mas cada um tem sua própria
   linha com status e expiração.';
