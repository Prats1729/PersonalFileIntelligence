import { query } from "../db/index.js";

// Fetch user by ID to get the refresh token
export async function getUserById(userId) {
  const res = await query("SELECT id, google_refresh_token FROM users WHERE id = $1", [userId]);
  return res.rows[0];
}

// Save the uploaded file metadata to the database
export async function saveFileRecord(userId, driveMetadata, file, contextNote) {
  const insertSql = `
    INSERT INTO files (user_id, drive_file_id, original_name, mime_type, size_bytes, context_note)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, drive_file_id, original_name, mime_type, size_bytes, context_note, created_at;
  `;
  const result = await query(insertSql, [
    userId,
    driveMetadata.id,
    file.originalname,
    file.mimetype,
    file.size,
    contextNote || null
  ]);
  return result.rows[0];
}

// Optional: get files for a user
export async function getFilesByUser(userId) {
  const res = await query("SELECT * FROM files WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  return res.rows;
}
