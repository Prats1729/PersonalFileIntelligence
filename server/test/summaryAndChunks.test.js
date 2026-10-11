import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupTestDatabase, teardownTestDatabase, createTestUser, createTestFile, testQuery, TEST_SCHEMA } from "./testDatabase.js";
import { env } from "../src/config/env.js";
import { splitIntoChunks, saveFileChunks, searchRelevantChunks } from "../src/services/chunkService.js";
import { processFileSummary, sweepPendingSummaries, resetStaleProcessingSummaries, lazyBackfillFile } from "../src/services/summaryService.js";
import { updateFileExtractedText, deleteFileRecord } from "../src/services/fileService.js";
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

  describe("1. Migration 009 Idempotency & Schema Validation", () => {
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
        WHERE table_schema = '${TEST_SCHEMA}'
          AND table_name = 'files'
          AND column_name IN ('summary', 'summary_status', 'summary_retry_count', 'summary_started_at');
      `);
      const foundCols = colCheck.rows.map((r) => r.column_name);
      assert.ok(foundCols.includes("summary"));
      assert.ok(foundCols.includes("summary_status"));
      assert.ok(foundCols.includes("summary_retry_count"));
      assert.ok(foundCols.includes("summary_started_at"));

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

  describe("2. Configurable Limits & Natural Windowing", () => {
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
      for (const chunk of chunks) {
        assert.ok(chunk.length > 0);
      }
    });
  });

  describe("3. Real Service Failure Path Leaves Upload Intact", () => {
    it("should mark summary_status = 'failed' via real service code without altering file upload", async () => {
      const failUser = (await createTestUser({ email: "fail-service-call@example.com" })).user;
      // Exhaust daily quota so the real service call encounters QUOTA_EXCEEDED
      await enforceDailyFreeQuota(failUser.id, env.DAILY_FREE_AI_QUOTA);

      const file = await createTestFile(failUser.id, {
        originalName: "fail-safe-lecture.pdf",
        extractedText: "Some technical material for failure path testing.",
      });

      // Call the REAL service function
      await processFileSummary(file.id, failUser.id);

      // Verify database state for the file
      const res = await testQuery("SELECT * FROM files WHERE id = $1 AND user_id = $2", [file.id, failUser.id]);
      const updatedFile = res.rows[0];

      // File upload record is intact and never deleted
      assert.ok(updatedFile);
      assert.equal(updatedFile.original_name, "fail-safe-lecture.pdf");
      assert.equal(updatedFile.summary_status, "failed");
      assert.equal(updatedFile.summary_retry_count, 1);
      assert.equal(updatedFile.summary_started_at, null);
      assert.equal(updatedFile.summary, null);
    });
  });

  describe("4. Sweep Safety, Stale Processing Reset & Concurrency", () => {
    it("should reset stale processing rows after timeout", async () => {
      const staleUser = (await createTestUser({ email: "stale-check@example.com" })).user;
      const staleFile = await createTestFile(staleUser.id, {
        originalName: "stale-worker.pdf",
        extractedText: "Content of file that timed out during worker processing.",
      });

      // Simulate a crashed worker with started_at 15 minutes in the past
      await testQuery(
        `UPDATE files
         SET summary_status = 'processing',
             summary_started_at = NOW() - INTERVAL '15 minutes'
         WHERE id = $1`,
        [staleFile.id]
      );

      // Real service call to reset stale rows
      const resetCount = await resetStaleProcessingSummaries(5);
      assert.ok(resetCount >= 1);

      const res = await testQuery("SELECT summary_status, summary_started_at FROM files WHERE id = $1", [staleFile.id]);
      assert.equal(res.rows[0].summary_status, "pending");
      assert.equal(res.rows[0].summary_started_at, null);
    });

    it("should run real sweep to retry failed file below threshold", async () => {
      const retryUser = (await createTestUser({ email: "sweep-real@example.com" })).user;
      await enforceDailyFreeQuota(retryUser.id, env.DAILY_FREE_AI_QUOTA);

      const file = await createTestFile(retryUser.id, {
        originalName: "sweep-retry-real.pdf",
        extractedText: "Valid length text content for real sweep retry test.",
      });

      // Initially run real processFileSummary (fails -> retry_count = 1)
      await processFileSummary(file.id, retryUser.id);

      // Run real sweep (claims file -> retries -> fails -> retry_count = 2)
      await sweepPendingSummaries(3, 10);

      const res = await testQuery("SELECT summary_retry_count, summary_status FROM files WHERE id = $1", [file.id]);
      assert.equal(res.rows[0].summary_retry_count, 2);
      assert.equal(res.rows[0].summary_status, "failed");
    });

    it("should prevent concurrent sweeps from double-processing rows via FOR UPDATE SKIP LOCKED", async () => {
      const concUser = (await createTestUser({ email: "concurrent-sweeps@example.com" })).user;
      await enforceDailyFreeQuota(concUser.id, env.DAILY_FREE_AI_QUOTA);

      const file1 = await createTestFile(concUser.id, {
        originalName: "concurrent-file-1.pdf",
        extractedText: "Concurrent file 1 technical content text with sufficient characters.",
      });
      const file2 = await createTestFile(concUser.id, {
        originalName: "concurrent-file-2.pdf",
        extractedText: "Concurrent file 2 technical content text with sufficient characters.",
      });

      await testQuery("UPDATE files SET summary_status = 'pending' WHERE id IN ($1, $2)", [file1.id, file2.id]);

      // Launch two sweeps concurrently at the exact same time
      const [resA, resB] = await Promise.all([
        sweepPendingSummaries(3, 10),
        sweepPendingSummaries(3, 10),
      ]);

      // Assert that rows were claimed across both sweeps
      assert.ok(resA.claimedCount + resB.claimedCount >= 2);

      // Verify that claimed file sets are completely disjoint (zero double-processing)
      const setA = new Set(resA.claimedIds);
      for (const id of resB.claimedIds) {
        assert.equal(setA.has(id), false, `File ${id} was double-claimed by both concurrent sweeps!`);
      }
    });
  });

  describe("5. Lazy Backfill for Legacy Files", () => {
    it("should build search chunks with zero AI cost and queue summary on access", async () => {
      const legacyUser = (await createTestUser({ email: "legacy-backfill@example.com" })).user;
      const legacyFile = await createTestFile(legacyUser.id, {
        originalName: "legacy-course-notes.pdf",
        extractedText: "Legacy course text extracted prior to migration 009. Contains key concepts.",
      });

      // Mark as legacy skipped
      await testQuery(
        "UPDATE files SET summary_status = 'skipped', summary = NULL WHERE id = $1",
        [legacyFile.id]
      );

      // Ensure 0 chunks exist initially
      const initialChunks = await testQuery("SELECT COUNT(*) AS count FROM file_chunks WHERE file_id = $1", [legacyFile.id]);
      assert.equal(parseInt(initialChunks.rows[0].count, 10), 0);

      // User accesses legacy file -> triggers real lazyBackfillFile
      await lazyBackfillFile(legacyFile, legacyUser.id);

      // Search chunks are now built
      const postChunks = await testQuery("SELECT COUNT(*) AS count FROM file_chunks WHERE file_id = $1", [legacyFile.id]);
      assert.ok(parseInt(postChunks.rows[0].count, 10) > 0);

      // Summary status was queued to pending/processing
      const statusRes = await testQuery("SELECT summary_status FROM files WHERE id = $1", [legacyFile.id]);
      assert.ok(["pending", "processing", "failed", "done"].includes(statusRes.rows[0].summary_status));
    });
  });

  describe("6. Chunk Lifecycle (Regeneration & Cascade Deletion)", () => {
    it("should regenerate chunks when extracted_text changes and cascade delete on file removal", async () => {
      const lifeUser = (await createTestUser({ email: "lifecycle-test@example.com" })).user;
      const file = await createTestFile(lifeUser.id, {
        originalName: "lifecycle-doc.pdf",
        extractedText: "Initial version: Machine learning basics and neural network layers.",
      });

      // 1. Initial chunks generated via saveFileChunks
      await saveFileChunks(file.id, lifeUser.id, file.extracted_text);
      const chunksV1 = await searchRelevantChunks(lifeUser.id, [file.id], "neural network layers", 3);
      assert.ok(chunksV1.length > 0);
      assert.ok(chunksV1[0].includes("neural network layers"));

      // 2. Re-extraction / text update via real updateFileExtractedText
      const newText = "Updated version: Quantum mechanics and quantum key distribution protocols.";
      await updateFileExtractedText(file.id, lifeUser.id, newText, "ready");

      // Verify chunks were automatically regenerated
      const chunksOld = await searchRelevantChunks(lifeUser.id, [file.id], "neural network layers", 3);
      assert.equal(chunksOld.length, 0);

      const chunksNew = await searchRelevantChunks(lifeUser.id, [file.id], "quantum key distribution", 3);
      assert.ok(chunksNew.length > 0);
      assert.ok(chunksNew[0].includes("Quantum mechanics"));

      // 3. File deletion via real deleteFileRecord
      await deleteFileRecord(lifeUser.id, file.id);

      // Verify file_chunks were cascade deleted
      const remainingChunks = await testQuery("SELECT * FROM file_chunks WHERE file_id = $1", [file.id]);
      assert.equal(remainingChunks.rows.length, 0);
    });
  });

  describe("7. Natural Language Question Retrieval (Stemmed OR-Matching & ts_rank)", () => {
    it("should retrieve the relevant chunk for long natural-language questions with filler words", async () => {
      const ragUser = (await createTestUser({ email: "rag-nl-question@example.com" })).user;
      const file = await createTestFile(ragUser.id, {
        originalName: "distributed-systems.pdf",
      });

      const lectureText = `
Section 1: Operating System Microkernels
Microkernels structure the OS by moving services to user space servers.
IPC mechanisms define inter-process communication performance bottlenecks.

Section 2: Distributed Consensus Algorithms
The Paxos consensus algorithm solves state machine replication in asynchronous distributed systems.
It guarantees safety even with unannounced node crashes and network partitioning.
Phase 1 consists of prepare and promise messages, followed by Phase 2 accept and accepted messages.

Section 3: Database Query Optimization
Relational engines convert SQL queries into relational algebra trees and apply cost-based optimization.
`.trim();

      await saveFileChunks(file.id, ragUser.id, lectureText);

      // Long natural-language query with questions, verbs, and filler words
      const naturalQuery = "Could you please explain in detail how the Paxos consensus algorithm handles leader failure and state machine replication when network nodes crash?";

      const topChunks = await searchRelevantChunks(ragUser.id, [file.id], naturalQuery, 3);
      assert.ok(topChunks.length > 0);
      // The top ranked chunk must be Section 2 (Paxos Consensus)
      assert.ok(topChunks[0].includes("Paxos consensus algorithm"));
      assert.ok(topChunks[0].includes("state machine replication"));
    });

    it("should handle queries with only stopwords gracefully without throwing", async () => {
      const ragUser = (await createTestUser({ email: "stopwords-test@example.com" })).user;
      const file = await createTestFile(ragUser.id, {
        originalName: "sample.pdf",
        extractedText: "Some document text here.",
      });

      await saveFileChunks(file.id, ragUser.id, file.extracted_text);

      // Query with only stopwords
      const emptyResults = await searchRelevantChunks(ragUser.id, [file.id], "is it the of a", 3);
      assert.equal(Array.isArray(emptyResults), true);
      assert.equal(emptyResults.length, 0);
    });

    it("should correctly classify overview questions vs specific inquiries", () => {
      assert.equal(isOverviewQuery("/summary"), true);
      assert.equal(isOverviewQuery("/notes"), true);
      assert.equal(isOverviewQuery("Give me a comprehensive summary of this lecture"), true);
      assert.equal(isOverviewQuery("What is this paper about?"), true);
      assert.equal(isOverviewQuery("High-level overview of Chapter 3"), true);
      assert.equal(isOverviewQuery("TLDR for these slides"), true);

      assert.equal(isOverviewQuery("What is the time complexity of Dijkstra algorithm?"), false);
      assert.equal(isOverviewQuery("Explain how two-phase locking prevents dirty reads"), false);
      assert.equal(isOverviewQuery("Write a SQL query for finding top duplicate rows"), false);
    });
  });

  describe("8. Cross-User Isolation in Chunk Retrieval", () => {
    it("should prevent User B from retrieving User A's chunks even when passing User A's file ID", async () => {
      const userAFile = await createTestFile(userA.id, {
        originalName: "userA-sensitive-research.pdf",
        extractedText: "Confidential research on lattice-based cryptography and homomorphic encryption schemes.",
      });

      await saveFileChunks(userAFile.id, userA.id, userAFile.extracted_text);

      // User A can search own chunks
      const userAResults = await searchRelevantChunks(userA.id, [userAFile.id], "homomorphic encryption", 3);
      assert.ok(userAResults.length > 0);
      assert.ok(userAResults[0].includes("homomorphic encryption"));

      // User B searching User A's file MUST return 0 chunks
      const userBResults = await searchRelevantChunks(userB.id, [userAFile.id], "homomorphic encryption", 3);
      assert.equal(userBResults.length, 0);
    });
  });

  describe("9. Quota Accounting for AI Calls", () => {
    it("should enforce daily free AI quota and reject when exhausted", async () => {
      const quotaUser = (await createTestUser({ email: "quota-test-exhaust@example.com" })).user;

      await enforceDailyFreeQuota(quotaUser.id, env.DAILY_FREE_AI_QUOTA);

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
});
