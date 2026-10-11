import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupTestDatabase, teardownTestDatabase, createTestUser, createTestFile, testQuery, TEST_SCHEMA } from "./testDatabase.js";
import { env } from "../src/config/env.js";
import { splitIntoChunks, saveFileChunks, searchRelevantChunks } from "../src/services/chunkService.js";
import { processFileSummary, sweepPendingSummaries } from "../src/services/summaryService.js";
import { isOverviewQuery } from "../src/routes/chatRoutes.js";
import { enforceDailyFreeQuota } from "../src/services/keyService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Phase 6: Summaries, Chunking & RAG Retrieval", () => {
  let userA;
  let userB;

  before(async () => {
    await setupTestDatabase();
    const createdA = await createTestUser({ email: "userA-summary@test.com" });
    const createdB = await createTestUser({ email: "userB-summary@test.com" });
    userA = createdA.user;
    userB = createdB.user;
  });

  after(async () => {
    await teardownTestDatabase();
  });

  describe("1. Migration 009 Idempotency", () => {
    it("should safely re-run migration 009 SQL without errors using IF NOT EXISTS", async () => {
      const migrationPath = path.join(
        __dirname,
        "../src/db/migrations/009_add_files_summary_and_chunks.sql"
      );
      const sql = await fs.readFile(migrationPath, "utf-8");

      // Re-running migration SQL must not throw
      await assert.doesNotReject(async () => {
        await testQuery(sql);
      });

      // Verify columns exist on files table
      const colCheck = await testQuery(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'files'
          AND column_name IN ('summary', 'summary_status', 'summary_retry_count');
      `);
      const foundCols = colCheck.rows.map((r) => r.column_name);
      assert.ok(foundCols.includes("summary"));
      assert.ok(foundCols.includes("summary_status"));
      assert.ok(foundCols.includes("summary_retry_count"));

      // Verify file_chunks table exists in the test sandbox schema
      const tableCheck = await testQuery(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = '${TEST_SCHEMA}'
          AND table_name = 'file_chunks';
      `);
      assert.equal(tableCheck.rows.length, 1);
    });
  });

  describe("2. Configurable Page & Character Caps", () => {
    it("should export properly typed and bounded configuration limits", () => {
      assert.equal(typeof env.MAX_PDF_PAGES, "number");
      assert.equal(typeof env.MAX_EXTRACT_CHARS, "number");
      assert.equal(typeof env.PDF_PARSE_TIMEOUT_MS, "number");

      assert.ok(env.MAX_PDF_PAGES >= 100);
      assert.ok(env.MAX_EXTRACT_CHARS >= 400000);
      assert.ok(env.PDF_PARSE_TIMEOUT_MS >= 10000);
    });

    it("should split large document text into natural overlapping chunks", () => {
      const sampleText = Array.from({ length: 50 }, (_, i) => `Paragraph ${i + 1}: High performance computing.`);
      const fullText = sampleText.join("\n\n");

      const chunks = splitIntoChunks(fullText, 200, 50);
      assert.ok(chunks.length > 1);
      assert.ok(chunks[0].includes("Paragraph 1:"));
      // Ensure each chunk contains valid text
      for (const chunk of chunks) {
        assert.ok(chunk.length > 0);
      }
    });
  });

  describe("3. Non-Blocking Summary Failure Leaves Upload Intact", () => {
    it("should mark summary_status = 'failed' and increment retry count without altering original file", async () => {
      const failUser = (await createTestUser({ email: "fail-test@example.com" })).user;
      // Exhaust daily quota so summary generation fails deterministically without network calls
      await enforceDailyFreeQuota(failUser.id, env.DAILY_FREE_AI_QUOTA);

      const file = await createTestFile(failUser.id, {
        originalName: "fail-safe-lecture.pdf",
        extractedText: "Some technical material for summary testing.",
      });

      // Initially null summary
      assert.equal(file.summary, null);

      // Trigger summary processing for this file with exhausted quota
      await processFileSummary(file.id, failUser.id);

      // Verify database state for the file
      const res = await testQuery("SELECT * FROM files WHERE id = $1 AND user_id = $2", [file.id, failUser.id]);
      const updatedFile = res.rows[0];

      // File upload record is intact and never deleted
      assert.ok(updatedFile);
      assert.equal(updatedFile.original_name, "fail-safe-lecture.pdf");
      assert.equal(updatedFile.summary_status, "failed");
      assert.equal(updatedFile.summary_retry_count, 1);
      assert.equal(updatedFile.summary, null);
    });
  });

  describe("4. Retry Sweep Logic for Pending/Failed Summaries", () => {
    it("should attempt to sweep files with retry count below maximum threshold", async () => {
      const retryUser = (await createTestUser({ email: "sweep-retry@example.com" })).user;
      await enforceDailyFreeQuota(retryUser.id, env.DAILY_FREE_AI_QUOTA);

      const fileToRetry = await createTestFile(retryUser.id, {
        originalName: "retry-candidate.pdf",
        extractedText: "Retry candidate text with sufficient length for analysis.",
      });

      await testQuery(
        "UPDATE files SET summary_status = 'failed', summary_retry_count = 1 WHERE id = $1",
        [fileToRetry.id]
      );

      // Run sweep
      await sweepPendingSummaries(3);

      // Check that it was picked up and retry count incremented to 2
      const res = await testQuery("SELECT summary_retry_count FROM files WHERE id = $1", [fileToRetry.id]);
      assert.equal(res.rows[0].summary_retry_count, 2);
    });

    it("should NOT sweep files that have exceeded maximum retry threshold", async () => {
      const exhaustedFile = await createTestFile(userA.id, {
        originalName: "exhausted-candidate.pdf",
        extractedText: "Exhausted retry text with sufficient length.",
      });

      await testQuery(
        "UPDATE files SET summary_status = 'failed', summary_retry_count = 5 WHERE id = $1",
        [exhaustedFile.id]
      );

      // Run sweep with maxRetries = 3
      await sweepPendingSummaries(3);

      const res = await testQuery("SELECT summary_retry_count FROM files WHERE id = $1", [exhaustedFile.id]);
      // Count remains 5 (not picked up)
      assert.equal(res.rows[0].summary_retry_count, 5);
    });
  });

  describe("5. Quota Accounting for AI Calls", () => {
    it("should deduct quota atomically and block when daily limit is exhausted", async () => {
      const quotaUser = (await createTestUser({ email: "quota-check@test.com" })).user;

      // Exhaust quota
      await enforceDailyFreeQuota(quotaUser.id, env.DAILY_FREE_AI_QUOTA);

      // Next attempt to consume quota must reject with QUOTA_EXCEEDED
      await assert.rejects(
        async () => {
          await enforceDailyFreeQuota(quotaUser.id, 1);
        },
        (err) => {
          assert.equal(err.code, "QUOTA_EXCEEDED");
          assert.equal(err.statusCode, 429);
          return true;
        }
      );
    });
  });

  describe("6. Cross-User Isolation in Chunk Storage & Full-Text Search", () => {
    it("should prevent User B from retrieving or searching User A's chunks", async () => {
      const userAFile = await createTestFile(userA.id, {
        originalName: "quantum-cryptography-userA.pdf",
        extractedText: "Quantum key distribution BB84 protocol ensures cryptographic confidentiality.",
      });

      // Save chunks for User A
      await saveFileChunks(userAFile.id, userA.id, userAFile.extracted_text);

      // User A searching own chunks succeeds
      const userAResults = await searchRelevantChunks(userA.id, [userAFile.id], "cryptographic confidentiality", 5);
      assert.ok(userAResults.length > 0);
      assert.ok(userAResults[0].includes("BB84 protocol"));

      // User B searching User A's file MUST return empty array
      const userBResults = await searchRelevantChunks(userB.id, [userAFile.id], "cryptographic confidentiality", 5);
      assert.equal(userBResults.length, 0);

      // Direct DB check: ensure all chunks are tagged with user_id
      const chunkRows = await testQuery("SELECT user_id FROM file_chunks WHERE file_id = $1", [userAFile.id]);
      assert.ok(chunkRows.rows.length > 0);
      for (const row of chunkRows.rows) {
        assert.equal(row.user_id, userA.id);
      }
    });
  });

  describe("7. Full-Text Search Ranking & Overview Routing", () => {
    it("should accurately rank chunks using ts_rank and tsvector", async () => {
      const file = await createTestFile(userA.id, {
        originalName: "systems-lecture.pdf",
      });

      const lectureContent = `
Distributed consensus algorithms ensure state machine replication.
Paxos protocol operates in two phases: prepare-promise and accept-accepted.
Raft achieves equivalent fault tolerance using elected leader and log matching.
PostgreSQL provides MVCC multiversion concurrency control with VACUUM.
B-Tree indexes optimize equality and range lookups in relational storage engines.
      `.trim();

      await saveFileChunks(file.id, userA.id, lectureContent);

      // Query for Paxos consensus
      const paxosChunks = await searchRelevantChunks(userA.id, [file.id], "Paxos consensus protocol", 3);
      assert.ok(paxosChunks.length > 0);
      assert.ok(paxosChunks[0].includes("Paxos protocol operates in two phases"));

      // Query for database indexing
      const indexChunks = await searchRelevantChunks(userA.id, [file.id], "PostgreSQL B-Tree indexes", 3);
      assert.ok(indexChunks.length > 0);
      assert.ok(indexChunks[0].includes("B-Tree indexes"));
    });

    it("should correctly classify overview questions vs specific inquiries", () => {
      assert.equal(isOverviewQuery("/summary"), true);
      assert.equal(isOverviewQuery("/notes"), true);
      assert.equal(isOverviewQuery("Give me a comprehensive summary of this lecture"), true);
      assert.equal(isOverviewQuery("What is this paper about?"), true);
      assert.equal(isOverviewQuery("High-level overview of Chapter 3"), true);
      assert.equal(isOverviewQuery("TLDR for these slides"), true);

      // Specific inquiries must NOT trigger overview mode
      assert.equal(isOverviewQuery("What is the time complexity of Dijkstra algorithm?"), false);
      assert.equal(isOverviewQuery("Explain how two-phase locking prevents dirty reads"), false);
      assert.equal(isOverviewQuery("Write a SQL query for finding top duplicate rows"), false);
    });
  });
});
