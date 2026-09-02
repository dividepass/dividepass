-- Add missing category column to support_tickets
ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'general';
