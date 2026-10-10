import { pool, query } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { generateAppToken } from "../src/services/authService.js";
import { randomUUID } from "node:crypto";

export const TEST_SCHEMA = "test_sandbox";

/**
 * Initializes the isolated test schema and runs all migrations inside it.
 * This guarantees zero impact on the live database.
 */
export async function setupTestDatabase() {
  await query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`);
  await runMigrations(TEST_SCHEMA);
}

/**
 * Cleans up all test data within the isolated test schema.
 */
export async function teardownTestDatabase() {
  await query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE;`);
}

/**
 * Executes a query scoped to the isolated test schema.
 */
export async function testQuery(text, params = []) {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${TEST_SCHEMA};`);
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

/**
 * Creates a mock test user in the isolated test schema.
 */
export async function createTestUser(customData = {}) {
  const id = customData.id || randomUUID();
  const googleId = customData.googleId || `google-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const email = customData.email || `test-${Date.now()}@example.com`;
  const name = customData.name || "Test Student";
  const avatarUrl = customData.avatarUrl || "https://example.com/avatar.png";
  const fakeRefreshToken = customData.googleRefreshToken || "mock_google_refresh_token_xyz_123";

  const res = await testQuery(
    `INSERT INTO users (id, google_id, email, name, avatar_url, google_refresh_token)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, google_id, email, name, avatar_url, created_at;`,
    [id, googleId, email, name, avatarUrl, fakeRefreshToken]
  );

  const user = res.rows[0];
  const sessionToken = generateAppToken(user.id);
  const cookie = `session_token=${sessionToken}`;

  return { user, sessionToken, cookie };
}

/**
 * Creates a mock file record in the isolated test schema.
 */
export async function createTestFile(userId, overrides = {}) {
  const id = overrides.id || randomUUID();
  const driveFileId = overrides.driveFileId || `drive-${Date.now()}`;
  const originalName = overrides.originalName || "test-lecture.pdf";
  const mimeType = overrides.mimeType || "application/pdf";
  const sizeBytes = overrides.sizeBytes || 10240;
  const contextNote = overrides.contextNote || "Exam prep";
  const folder = overrides.folder || "Computer Science";
  const extractedText = overrides.extractedText || "Sample academic document extracted text.";
  const status = overrides.status || "ready";

  const res = await testQuery(
    `INSERT INTO files (id, user_id, drive_file_id, original_name, mime_type, size_bytes, context_note, ai_result_folder, extracted_text, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *;`,
    [id, userId, driveFileId, originalName, mimeType, sizeBytes, contextNote, folder, extractedText, status]
  );

  return res.rows[0];
}
