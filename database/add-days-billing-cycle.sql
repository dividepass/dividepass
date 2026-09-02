-- Fix: Add 'days' to billing_cycle CHECK constraints

-- Groups table
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_billing_cycle_check;
ALTER TABLE groups ADD CONSTRAINT groups_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual', 'custom', 'days'));

-- User subscriptions table
ALTER TABLE user_subscriptions DROP CONSTRAINT IF EXISTS user_subscriptions_billing_cycle_check;
ALTER TABLE user_subscriptions ADD CONSTRAINT user_subscriptions_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual', 'custom', 'days'));
