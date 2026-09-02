-- ============================================================
-- FIX: ANNOUNCEMENTS SYSTEM
-- ============================================================
-- Alters the announcements table to support targeted announcements
-- and creates user_announcement_views for tracking dismissals.
-- ============================================================

-- 1. Add target_user_id (NULL = global, UUID = targeted to specific user)
ALTER TABLE announcements
ADD COLUMN IF NOT EXISTS target_user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- 2. Add is_active column (replaces status-based active check for simpler queries)
ALTER TABLE announcements
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- 3. Create user_announcement_views to track which users dismissed which announcements
CREATE TABLE IF NOT EXISTS user_announcement_views (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(announcement_id, user_id)
);

-- 4. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_announcements_target ON announcements(target_user_id);
CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_announcement_views_announcement ON user_announcement_views(announcement_id);
CREATE INDEX IF NOT EXISTS idx_user_announcement_views_user ON user_announcement_views(user_id);

-- 5. RLS policies for announcements
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_announcement_views ENABLE ROW LEVEL SECURITY;

-- Admins can do everything with announcements
CREATE POLICY "Admins can manage announcements"
    ON announcements
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

-- Anyone can read active announcements (global or targeted to them)
CREATE POLICY "Users can view active announcements"
    ON announcements
    FOR SELECT
    USING (
        is_active = TRUE
        AND (
            target_user_id IS NULL
            OR target_user_id = auth.uid()
        )
    );

-- Users can insert their own view records
CREATE POLICY "Users can mark announcements as viewed"
    ON user_announcement_views
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Users can read their own view records
CREATE POLICY "Users can view their own view records"
    ON user_announcement_views
    FOR SELECT
    USING (user_id = auth.uid());

-- Admins can read all view records (for analytics)
CREATE POLICY "Admins can view all announcement views"
    ON user_announcement_views
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

-- 6. Migrate existing seed announcements: set is_active based on status
UPDATE announcements
SET is_active = (status = 'published');
