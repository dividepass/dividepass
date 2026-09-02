-- Migration: Add custom_cycle_days column for day-based billing cycles
-- Run this migration to support billing cycles in days

-- Add custom_cycle_days to groups
ALTER TABLE groups ADD COLUMN IF NOT EXISTS custom_cycle_days INTEGER;

-- Add custom_cycle_days to user_subscriptions
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS custom_cycle_days INTEGER;

-- Note: No CHECK constraint changes needed — billing_cycle already accepts 'custom'
-- The 'custom' cycle type is reused: if custom_cycle_days is set, it's a day-based cycle;
-- if custom_cycle_months is set, it's a month-based cycle.
