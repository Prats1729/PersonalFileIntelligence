-- Migration: 008_byok_key_version.sql
-- Description: Add key_version metadata to user_api_keys for cryptographic rotation support

ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS key_version INT DEFAULT 1;
