-- Migration 005: Query Optimization Indexes
-- Indexes for rapid deduplication, folder scoping, favorites, and chat retrieval

-- Composite index for O(1) deduplication checking
CREATE INDEX IF NOT EXISTS idx_files_user_dedup 
ON files(user_id, original_name, size_bytes);

-- Composite index for collection/folder scoped queries
CREATE INDEX IF NOT EXISTS idx_files_user_folder 
ON files(user_id, ai_result_folder);

-- Index for favorites filtering
CREATE INDEX IF NOT EXISTS idx_files_user_favorite 
ON files(user_id, is_favorite);

-- Chat and message retrieval performance
CREATE INDEX IF NOT EXISTS idx_chats_user_updated 
ON chats(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_chat_created 
ON messages(chat_id, created_at ASC);
