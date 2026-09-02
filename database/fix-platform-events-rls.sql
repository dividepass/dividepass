-- Fix: allow authenticated users to insert platform_events
-- (frontend code like SubscriptionManage, CreateGroup, ManageGroup inserts events client-side)

DROP POLICY IF EXISTS "Service role can insert platform_events" ON platform_events;

CREATE POLICY "Authenticated can insert platform_events"
    ON platform_events FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Service role can insert platform_events"
    ON platform_events FOR INSERT
    TO service_role
    WITH CHECK (true);
