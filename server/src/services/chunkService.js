import { query } from "../db/index.js";

/**
 * Splits document text into overlapping chunks for search indexing.
 * @param {string} text - Raw document text
 * @param {number} chunkSize - Target characters per chunk (~250 words)
 * @param {number} overlap - Overlapping characters between adjacent chunks
 * @returns {string[]} Array of text chunks
 */
export function splitIntoChunks(text, chunkSize = 1200, overlap = 200) {
  if (!text || typeof text !== "string") return [];

  const cleaned = text.trim();
  if (cleaned.length <= chunkSize) {
    return [cleaned];
  }

  const chunks = [];
  let startIndex = 0;

  while (startIndex < cleaned.length) {
    let endIndex = startIndex + chunkSize;

    // If we're not at the end of the text, try to snap to the nearest sentence/paragraph boundary
    if (endIndex < cleaned.length) {
      const naturalBreak = cleaned.lastIndexOf("\n", endIndex);
      const sentenceBreak = cleaned.lastIndexOf(". ", endIndex);
      const spaceBreak = cleaned.lastIndexOf(" ", endIndex);

      if (naturalBreak > startIndex + chunkSize / 2) {
        endIndex = naturalBreak + 1;
      } else if (sentenceBreak > startIndex + chunkSize / 2) {
        endIndex = sentenceBreak + 2;
      } else if (spaceBreak > startIndex + chunkSize / 2) {
        endIndex = spaceBreak + 1;
      }
    } else {
      endIndex = cleaned.length;
    }

    const chunk = cleaned.slice(startIndex, endIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Advance startIndex by chunk length minus overlap
    startIndex = Math.max(startIndex + 1, endIndex - overlap);
  }

  return chunks;
}

/**
 * Indexes text chunks for a file into the database with full-text search tsvectors.
 * Scoped strictly by user_id to maintain isolation.
 */
export async function saveFileChunks(fileId, userId, text) {
  if (!fileId || !userId || !text) return [];

  const chunks = splitIntoChunks(text);
  if (chunks.length === 0) return [];

  // Remove any previous chunks for this file
  await query(
    "DELETE FROM file_chunks WHERE file_id = $1 AND user_id = $2",
    [fileId, userId]
  );

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    await query(
      `INSERT INTO file_chunks (file_id, user_id, chunk_index, chunk_text, tsv)
       VALUES ($1, $2, $3, $4, to_tsvector('english', $4))`,
      [fileId, userId, i, chunkText]
    );
  }

  return chunks;
}

/**
 * Searches relevant chunks using PostgreSQL full-text search and ts_rank scoring.
 * Scoped strictly by user_id.
 */
export async function searchRelevantChunks(userId, fileIds, queryText, limit = 5) {
  if (!userId || !fileIds || fileIds.length === 0 || !queryText) {
    return [];
  }

  // Sanitize queryText for plainto_tsquery
  const cleanQuery = queryText.trim().slice(0, 300);
  if (!cleanQuery) return [];

  const result = await query(
    `SELECT chunk_text, chunk_index, file_id,
            ts_rank(tsv, plainto_tsquery('english', $3)) AS rank
     FROM file_chunks
     WHERE user_id = $1
       AND file_id = ANY($2)
       AND tsv @@ plainto_tsquery('english', $3)
     ORDER BY rank DESC
     LIMIT $4`,
    [userId, fileIds, cleanQuery, limit]
  );

  return result.rows.map((row) => row.chunk_text);
}
