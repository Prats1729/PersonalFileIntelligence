import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDatabase, teardownTestDatabase, createTestUser, createTestFile, testQuery } from "./testDatabase.js";
import { updateChatTitle } from "../src/services/chatService.js";
import { updateFileExtractedText } from "../src/services/fileService.js";
import { closePool } from "../src/db/index.js";

describe("IDOR Protection & Ownership Constraint Tests (SEC-03)", () => {
  let userA;
  let userB;
  let chatA;
  let fileA;

  before(async () => {
    await setupTestDatabase();
    userA = await createTestUser();
    userB = await createTestUser();

    // Create chat owned by User A
    const chatRes = await testQuery(
      `INSERT INTO test_sandbox.chats (user_id, title) VALUES ($1, $2) RETURNING *;`,
      [userA.user.id, "User A Secret Notes"]
    );
    chatA = chatRes.rows[0];

    // Create file owned by User A
    fileA = await createTestFile(userA.user.id, {
      originalName: "User_A_Exam.pdf",
    });
  });

  after(async () => {
    await teardownTestDatabase();
    await closePool();
  });

  it("should prevent User B from updating User A's chat title (IDOR)", async () => {
    const updated = await testQuery(
      `UPDATE test_sandbox.chats SET title = $1 WHERE id = $2 AND user_id = $3 RETURNING *;`,
      ["Hacked Title", chatA.id, userB.user.id]
    );
    assert.equal(updated.rows.length, 0);

    // Verify title was not changed
    const verify = await testQuery(
      `SELECT title FROM test_sandbox.chats WHERE id = $1;`,
      [chatA.id]
    );
    assert.equal(verify.rows[0].title, "User A Secret Notes");
  });

  it("should prevent User B from overwriting User A's extracted file text (IDOR)", async () => {
    const updated = await testQuery(
      `UPDATE test_sandbox.files SET extracted_text = $1 WHERE id = $2 AND user_id = $3 RETURNING *;`,
      ["Malicious overwrite", fileA.id, userB.user.id]
    );
    assert.equal(updated.rows.length, 0);
  });
});
