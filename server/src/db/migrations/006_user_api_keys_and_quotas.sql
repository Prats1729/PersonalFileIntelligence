-- Migration: 006_user_api_keys_and_quotas.sql
-- Description: Create tables for user-provided API keys (BYOK) and daily AI usage quota tracking

CREATE TABLE IF NOT EXISTS user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  encrypted_key TEXT NOT NULL,
  iv VARCHAR(64) NOT NULL,
  tag VARCHAR(64) NOT NULL,
  masked_key VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_user_provider UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS user_daily_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ai_call_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_user_daily_usage UNIQUE(user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_daily_usage_lookup ON user_daily_usage(user_id, usage_date);
