-- Migration: 010_add_pdf_page_pipeline.sql
-- Description: Add per-page OCR tracking columns, content hash caching, and file_pages table.
-- Ensures safe per-page classification, figure detection, resumable processing, and fast retrieval.

ALTER TABLE files ADD COLUMN IF NOT EXISTS ocr_status VARCHAR(20) DEFAULT 'done';
ALTER TABLE files ADD COLUMN IF NOT EXISTS pages_total INTEGER;
ALTER TABLE files ADD COLUMN IF NOT EXISTS pages_done INTEGER DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
ALTER TABLE files ADD COLUMN IF NOT EXISTS ocr_started_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE files ADD COLUMN IF NOT EXISTS ocr_note TEXT;

-- Existing completed files default to ocr_status = 'done' if they already have extracted_text
UPDATE files
SET ocr_status = 'done'
WHERE ocr_status IS NULL OR (extracted_text IS NOT NULL AND ocr_status = 'pending');

CREATE TABLE IF NOT EXISTS file_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  text TEXT DEFAULT '',
  visual_description TEXT,
  source VARCHAR(20) NOT NULL DEFAULT 'digital', -- 'digital', 'ocr', 'figure', 'empty'
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'done', 'failed'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_file_pages_file_page UNIQUE (file_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(user_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_files_ocr_status ON files(ocr_status);
CREATE INDEX IF NOT EXISTS idx_file_pages_file_page ON file_pages(file_id, page_number);
CREATE INDEX IF NOT EXISTS idx_file_pages_status ON file_pages(status);
CREATE INDEX IF NOT EXISTS idx_file_pages_user_id ON file_pages(user_id);
