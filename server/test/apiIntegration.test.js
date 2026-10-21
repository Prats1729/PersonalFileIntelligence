import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDatabase, teardownTestDatabase, createTestUser, createTestFile, testQuery } from "./testDatabase.js";
import { encryptApiKey, decryptApiKey } from "../src/utils/crypto.js";
import { closePool } from "../src/db/index.js";

describe("API & Database Integration Tests (Isolated Sandbox)", () => {
  let testUser;

  before(async () => {
    await setupTestDatabase();
    testUser = await createTestUser();
  });

  after(async () => {
    await teardownTestDatabase();
    await closePool();
  });

  describe("Authentication & Session Verification", () => {
    it("should create user and produce a valid JWT session token", () => {
      assert.ok(testUser.user.id);
      assert.ok(testUser.sessionToken);
      assert.ok(testUser.cookie.startsWith("session_token="));
    });

    it("should query user from database using parameterized query", async () => {
      const res = await testQuery("SELECT id, email, name FROM users WHERE id = $1", [testUser.user.id]);
      assert.equal(res.rows.length, 1);
      assert.equal(res.rows[0].email, testUser.user.email);
    });
  });

  describe("BYOK Key Storage & Encryption at Rest", () => {
    it("should encrypt and store API key with GCM auth tag in user_api_keys", async () => {
      const rawKey = "sk-or-v1-secret-test-key-9876543210";
      const { encryptedKey, iv, tag } = encryptApiKey(rawKey);

      const res = await testQuery(
        `INSERT INTO user_api_keys (user_id, provider, encrypted_key, iv, tag, masked_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING provider, masked_key, encrypted_key, iv, tag;`,
        [testUser.user.id, "openrouter", encryptedKey, iv, tag, "sk-or-••••••••3210"]
      );

      assert.equal(res.rows.length, 1);
      const row = res.rows[0];
      assert.equal(row.provider, "openrouter");
      assert.notEqual(row.encrypted_key, rawKey);

      // Verify decryption recovers original key
      const decrypted = decryptApiKey(row.encrypted_key, row.iv, row.tag);
      assert.equal(decrypted, rawKey);
    });

    it("should prevent duplicate keys for same provider per user via unique constraint", async () => {
      const { encryptedKey, iv, tag } = encryptApiKey("sk-or-v1-duplicate-key-test-1234");
      await assert.rejects(async () => {
        await testQuery(
          `INSERT INTO user_api_keys (user_id, provider, encrypted_key, iv, tag, masked_key)
           VALUES ($1, $2, $3, $4, $5, $6);`,
          [testUser.user.id, "openrouter", encryptedKey, iv, tag, "sk-or-••••••••1234"]
        );
      }, /duplicate key value violates unique constraint/);
    });
  });

  describe("File Operations, Dedup, and Favorites", () => {
    let testFile;

    it("should create and query files for a user", async () => {
      testFile = await createTestFile(testUser.user.id, {
        originalName: "Algorithms_Lecture_1.pdf",
        sizeBytes: 20480,
        folder: "Algorithms",
      });

      assert.ok(testFile.id);
      assert.equal(testFile.original_name, "Algorithms_Lecture_1.pdf");
      assert.equal(testFile.ai_result_folder, "Algorithms");
    });

    it("should detect deduplication matching filename and size", async () => {
      const existing = await testQuery(
        "SELECT id, original_name, size_bytes FROM files WHERE user_id = $1 AND original_name = $2 AND size_bytes = $3",
        [testUser.user.id, "Algorithms_Lecture_1.pdf", 20480]
      );
      assert.equal(existing.rows.length, 1);
      assert.equal(existing.rows[0].id, testFile.id);
    });

    it("should toggle favorite status safely", async () => {
      const updateRes = await testQuery(
        `UPDATE files SET is_favorite = NOT COALESCE(is_favorite, false)
         WHERE id = $1 AND user_id = $2
         RETURNING is_favorite;`,
        [testFile.id, testUser.user.id]
      );
      assert.equal(updateRes.rows[0].is_favorite, true);

      // Toggle back
      const untoggleRes = await testQuery(
        `UPDATE files SET is_favorite = NOT COALESCE(is_favorite, false)
         WHERE id = $1 AND user_id = $2
         RETURNING is_favorite;`,
        [testFile.id, testUser.user.id]
      );
      assert.equal(untoggleRes.rows[0].is_favorite, false);
    });

    it("should enforce user ownership on file context notes", async () => {
      const otherUser = await createTestUser();
      // Attempting to update testUser's file with otherUser's ID should affect 0 rows
      const unauthorizedUpdate = await testQuery(
        `UPDATE files SET context_note = 'Hacked note'
         WHERE id = $1 AND user_id = $2
         RETURNING *;`,
        [testFile.id, otherUser.user.id]
      );
      assert.equal(unauthorizedUpdate.rows.length, 0);
    });
  });

  describe("Chat History & Cascade Isolation", () => {
    it("should create a chat and insert messages", async () => {
      const chatRes = await testQuery(
        "INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING *;",
        [testUser.user.id, "Binary Search Tree Discussion"]
      );
      const chat = chatRes.rows[0];
      assert.ok(chat.id);

      const msgRes = await testQuery(
        "INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3) RETURNING *;",
        [chat.id, "user", "Explain AVL tree rotation balance factor."]
      );
      assert.equal(msgRes.rows[0].role, "user");

      const msgs = await testQuery(
        "SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC;",
        [chat.id]
      );
      assert.equal(msgs.rows.length, 1);
    });
  });

  describe("Daily Free AI Quota Enforcement", () => {
    it("should record and track usage count in user_daily_usage", async () => {
      const quotaUser = await createTestUser();
      const insertQuota = await testQuery(
        `INSERT INTO user_daily_usage (user_id, usage_date, ai_call_count)
         VALUES ($1, CURRENT_DATE, 1)
         ON CONFLICT (user_id, usage_date)
         DO UPDATE SET ai_call_count = user_daily_usage.ai_call_count + 1
         RETURNING ai_call_count;`,
        [quotaUser.user.id]
      );
      assert.equal(insertQuota.rows[0].ai_call_count, 1);

      // Increment again
      const incrementRes = await testQuery(
        `INSERT INTO user_daily_usage (user_id, usage_date, ai_call_count)
         VALUES ($1, CURRENT_DATE, 1)
         ON CONFLICT (user_id, usage_date)
         DO UPDATE SET ai_call_count = user_daily_usage.ai_call_count + 1
         RETURNING ai_call_count;`,
        [quotaUser.user.id]
      );
      assert.equal(incrementRes.rows[0].ai_call_count, 2);
    });
  });
});
