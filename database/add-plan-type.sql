-- ============================================
-- PLAN TYPE FOR GROUPS
-- ============================================

ALTER TABLE groups ADD COLUMN IF NOT EXISTS plan_type VARCHAR(50) DEFAULT NULL;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS plan_type_custom VARCHAR(100) DEFAULT NULL;
