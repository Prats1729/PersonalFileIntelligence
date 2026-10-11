-- Migration: 009_add_files_summary_and_chunks.sql
-- Description: Add summary, summary_status, summary_retry_count, summary_started_at to files table,
-- and create file_chunks table with full-text search tsvector for RAG retrieval.
-- Legacy files start as 'skipped' so startup sweep avoids mass-summarizing on boot.

ALTER TABLE files ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS summary_status VARCHAR(20) DEFAULT 'skipped';
ALTER TABLE files ADD COLUMN IF NOT EXISTS summary_retry_count INT DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS summary_started_at TIMESTAMP WITH TIME ZONE;

-- Mark pre-existing legacy files as 'skipped' if summary has not been computed yet
UPDATE files
SET summary_status = 'skipped'
WHERE summary IS NULL AND (summary_status IS NULL OR summary_status = 'pending');

CREATE TABLE IF NOT EXISTS file_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  chunk_text TEXT NOT NULL,
  tsv TSVECTOR,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_chunks_file_id ON file_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_file_chunks_user_id ON file_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_file_chunks_tsv ON file_chunks USING GIN(tsv);
CREATE INDEX IF NOT EXISTS idx_files_summary_sweep ON files(summary_status, summary_retry_count) WHERE summary IS NULL;
