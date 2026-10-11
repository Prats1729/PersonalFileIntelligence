-- Migration: 009_add_files_summary_and_chunks.sql
-- Description: Add summary, summary_status, summary_retry_count to files table,
-- and create file_chunks table with full-text search tsvector for RAG retrieval.

ALTER TABLE files ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS summary_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE files ADD COLUMN IF NOT EXISTS summary_retry_count INT DEFAULT 0;

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
