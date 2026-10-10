-- Migration: 007_add_extracted_text_and_status.sql
-- Description: Add extracted_text and status columns to files table if not existing

ALTER TABLE files ADD COLUMN IF NOT EXISTS extracted_text TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ready';

CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
