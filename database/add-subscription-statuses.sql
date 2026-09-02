-- Add new payment_flow_status values
ALTER TYPE payment_flow_status ADD VALUE IF NOT EXISTS 'first_attempt' BEFORE 'awaiting_entrance';
ALTER TYPE payment_flow_status ADD VALUE IF NOT EXISTS 'overdue' AFTER 'expired';

-- Function: auto-update subscription statuses based on dates
CREATE OR REPLACE FUNCTION update_subscription_statuses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. first_attempt → overdue: user tried to pay but invoice date passed (no successful payment)
  UPDATE group_members
  SET payment_status = 'overdue',
      updated_at = NOW()
  WHERE payment_status = 'first_attempt'
    AND created_at < NOW() - INTERVAL '7 days'
    AND NOT EXISTS (
      SELECT 1 FROM payments p
      WHERE p.user_id = group_members.user_id
        AND p.group_id = group_members.group_id
        AND p.status = 'paid'
    );

  -- 2. awaiting_subscription → overdue: subscription deadline passed
  UPDATE group_members
  SET payment_status = 'overdue',
      updated_at = NOW()
  WHERE payment_status = 'awaiting_subscription'
    AND subscription_deadline IS NOT NULL
    AND subscription_deadline < NOW();

  -- 3. active → overdue: subscription expired (deadline passed)
  UPDATE group_members
  SET payment_status = 'overdue',
      updated_at = NOW()
  WHERE payment_status = 'active'
    AND subscription_deadline IS NOT NULL
    AND subscription_deadline < NOW();

  -- 4. overdue → cancelled: more than 3 months overdue
  UPDATE group_members
  SET payment_status = 'cancelled',
      status = 'cancelled',
      left_at = NOW(),
      updated_at = NOW()
  WHERE payment_status = 'overdue'
    AND updated_at < NOW() - INTERVAL '3 months';

  -- 5. Also update user_subscriptions status accordingly
  UPDATE user_subscriptions us
  SET status = gm.payment_status::text::subscription_status
  FROM group_members gm
  WHERE us.user_id = gm.user_id
    AND us.group_id = gm.group_id
    AND gm.payment_status IN ('overdue', 'cancelled')
    AND us.status != gm.payment_status::text::subscription_status;
END;
$$;
