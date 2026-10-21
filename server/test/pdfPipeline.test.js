import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupTestDatabase, teardownTestDatabase, createTestUser, createTestFile, testQuery, TEST_SCHEMA } from "./testDatabase.js";
import { env } from "../src/config/env.js";
import { classifyPage, stripBoilerplateText, isGarbageTextLayer } from "../src/services/pdfPageClassifier.js";
import { renderPdfPageToBuffer } from "../src/services/pdfRenderer.js";
import { processPdfPipeline, resetStaleOcrJobs, claimNextOcrJob, computeFileHash } from "../src/services/pdfPipelineService.js";
import { saveUserKey } from "../src/services/keyService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Utility helper to construct multi-page synthetic PDFs in memory.
 */
function createSyntheticPdf(pages, options = {}) {
  const numPages = pages.length;
  let kids = "";
  for (let i = 0; i < numPages; i++) {
    kids += `${3 + i * 2} 0 R `;
  }

  let body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n`;
  body += `2 0 obj<</Type/Pages/Kids[${kids}]/Count ${numPages}>>endobj\n`;

  let currentObj = 3;
  const pageObjNums = [];
  for (let i = 0; i < numPages; i++) {
    const pageObj = currentObj++;
    const contentObj = currentObj++;
    pageObjNums.push({ pageObj, contentObj, text: pages[i].text || "", hasFigure: pages[i].hasFigure });
  }

  const fontObj = currentObj++;
  body += `${fontObj} 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n`;

  for (const p of pageObjNums) {
    body += `${p.pageObj} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 600 800]/Resources<</Font<</F1 ${fontObj} 0 R>>>>/Contents ${p.contentObj} 0 R>>endobj\n`;
    let stream = "";
    if (p.text) {
      const chunks = p.text.match(/.{1,60}(\s+|$)/g) || [p.text];
      stream += "BT\n/F1 12 Tf\n14 TL\n20 700 Td\n";
      for (const chunk of chunks) {
        stream += `(${chunk.trim().replace(/[()\\\\]/g, "\\$&")}) Tj\nT*\n`;
      }
      stream += "ET\n";
    }
    if (p.hasFigure) {
      stream += `q 100 0 0 100 50 50 cm BI /W 1 /H 1 /CS /DeviceGray /BPC 8 ID \xff EI Q\n`;
    }
    body += `${p.contentObj} 0 obj<</Length ${Buffer.byteLength(stream)}>>stream\n${stream}endstream\nendobj\n`;
  }

  body += `xref\n0 ${currentObj}\ntrailer<</Size ${currentObj}/Root 1 0 R>>\nstartxref\n9999\n%%EOF`;
  return Buffer.from(body);
}

describe("Phase 7: Resumable Per-Page PDF OCR & Figure Extraction Pipeline", () => {
  let userA;
  let userB;
  let originalFetch;
  let aiCalls = [];

  before(async () => {
    await setupTestDatabase();
    const createdA = await createTestUser({ email: "userA-pdf@test.com" });
    const createdB = await createTestUser({ email: "userB-pdf@test.com" });
    userA = createdA.user;
    userB = createdB.user;

    // Intercept fetch at provider boundary for OpenRouter & Gemini Vision
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes("openrouter.ai/api/v1/chat/completions")) {
        let parsed = {};
        try { parsed = JSON.parse(options.body); } catch (_) {}
        const isVision = options.body?.includes("image_url") || options.body?.includes("data:image");
        if (isVision) {
          aiCalls.push({ provider: "openrouter", type: "vision", url: urlStr, body: options.body });
          const prompt = parsed.messages?.[0]?.content?.[0]?.text || "";
          const isFigure = prompt.includes("figures, charts");
          const reply = isFigure
            ? "Architecture diagram showing microservices and queue layers."
            : "Transcribed text from scanned page: Artificial Intelligence fundamentals and search algorithms.";
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: reply } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        } else {
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "Mock summary response" } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      if (urlStr.includes("generativelanguage.googleapis.com")) {
        aiCalls.push({ provider: "gemini", url: urlStr, body: options.body });
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "Transcribed text from Gemini vision fallback." }],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return originalFetch(url, options);
    };
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await teardownTestDatabase();
  });

  beforeEach(() => {
    aiCalls = [];
  });

  describe("1. Migration 010 Idempotency & Schema Validation", () => {
    it("should safely re-run migration 010 SQL without errors using IF NOT EXISTS", async () => {
      const migrationPath = path.join(
        __dirname,
        "../src/db/migrations/010_add_pdf_page_pipeline.sql"
      );
      const sql = await fs.readFile(migrationPath, "utf-8");

      await assert.doesNotReject(async () => {
        await testQuery(sql);
      });

      const colCheck = await testQuery(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = '${TEST_SCHEMA}'
          AND table_name = 'files'
          AND column_name IN ('ocr_status', 'pages_total', 'pages_done', 'content_hash', 'ocr_started_at', 'ocr_note');
      `);
      const cols = colCheck.rows.map((r) => r.column_name);
      assert.ok(cols.includes("ocr_status"));
      assert.ok(cols.includes("pages_total"));
      assert.ok(cols.includes("pages_done"));
      assert.ok(cols.includes("content_hash"));
      assert.ok(cols.includes("ocr_started_at"));
      assert.ok(cols.includes("ocr_note"));

      const tableCheck = await testQuery(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'file_pages';
      `);
      assert.equal(tableCheck.rows.length, 1);
    });
  });

  describe("2. Boilerplate Stripping & Garbage Text Layer Classification", () => {
    it("should strip scanner stamps like '-- 1 of 585 --' and bare page numbers", () => {
      const dirty = `
-- 1 of 585 --
Chapter 1: Introduction to Artificial Intelligence
-- 1 of 585 --
42
Page 1 of 585
This is genuine substantive content that should be preserved.
      `;
      const cleaned = stripBoilerplateText(dirty);
      assert.ok(!cleaned.includes("-- 1 of 585 --"));
      assert.ok(!cleaned.includes("Page 1 of 585"));
      assert.ok(cleaned.includes("Chapter 1: Introduction to Artificial Intelligence"));
      assert.ok(cleaned.includes("This is genuine substantive content that should be preserved."));
    });

    it("should detect scanner footer noise or replacement character soup as garbage", () => {
      const footerOnly = "-- 1 of 585 --\n-- 2 of 585 --\n-- 3 of 585 --";
      assert.equal(isGarbageTextLayer(stripBoilerplateText(footerOnly)), true);

      const symbolSoup = "‘ : | = — 8 , a» = | 4 oe Sai a | mamas teem ee ee — a_i rE -— £ 0. = — Pedack iv, gett: va o) : = ae. NR |";
      assert.equal(isGarbageTextLayer(symbolSoup), true);

      const corruptedReplacementChars = "Abc\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd";
      assert.equal(isGarbageTextLayer(corruptedReplacementChars), true);

      const healthyText = "Artificial Intelligence is the study of techniques for making computers solve complex problems that currently require human intelligence.";
      assert.equal(isGarbageTextLayer(healthyText), false);
    });
  });

  describe("3. Fast Path: Digital PDF takes zero AI calls", () => {
    it("should extract pure digital PDF locally with zero vision API calls", async () => {
      const healthyProse = "Artificial Intelligence represents the modern study of intelligent agents that perceive their environment and take actions that maximize their chance of successfully achieving their goals. ".repeat(3);
      const pdfBuffer = createSyntheticPdf([
        { text: healthyProse },
        { text: healthyProse },
      ]);

      const testFile = await createTestFile(userA.id, {
        originalName: "digital-lecture.pdf",
        mimeType: "application/pdf",
        status: "processing",
      });

      const result = await processPdfPipeline(testFile, pdfBuffer, userA.id);

      assert.equal(result.success, true);
      assert.equal(result.digitalOnly, true);
      assert.equal(aiCalls.length, 0, "Zero AI calls must be made for digital PDF");

      // Verify file record in database
      const dbFile = await testQuery("SELECT * FROM files WHERE id = $1", [testFile.id]);
      assert.equal(dbFile.rows[0].ocr_status, "done");
      assert.equal(dbFile.rows[0].status, "ready");
      assert.equal(dbFile.rows[0].pages_total, 2);
      assert.equal(dbFile.rows[0].pages_done, 2);
      assert.ok(dbFile.rows[0].extracted_text.includes("Artificial Intelligence represents"));

      // Verify file_pages rows
      const pages = await testQuery("SELECT * FROM file_pages WHERE file_id = $1 ORDER BY page_number", [testFile.id]);
      assert.equal(pages.rows.length, 2);
      assert.equal(pages.rows[0].source, "digital");
      assert.equal(pages.rows[0].status, "done");
    });
  });

  describe("4. Scanned PDF with scanner stamps falls through to Vision OCR", () => {
    it("should classify page with only '-- 1 of 585 --' as needs_ocr and invoke vision pass", async () => {
      const stampPdf = createSyntheticPdf([
        { text: "-- 1 of 585 --" },
        { text: "-- 2 of 585 --" },
      ]);

      const testFile = await createTestFile(userA.id, {
        originalName: "scanned-book.pdf",
        mimeType: "application/pdf",
        status: "processing",
      });

      const result = await processPdfPipeline(testFile, stampPdf, userA.id);

      assert.equal(result.success, true);
      assert.ok(aiCalls.length >= 2, "Vision calls must be invoked for scanned pages");

      const dbFile = await testQuery("SELECT * FROM files WHERE id = $1", [testFile.id]);
      assert.equal(dbFile.rows[0].ocr_status, "done");
      assert.equal(dbFile.rows[0].status, "ready");
      assert.ok(dbFile.rows[0].extracted_text.includes("Transcribed text from scanned page"));

      const pages = await testQuery("SELECT * FROM file_pages WHERE file_id = $1 ORDER BY page_number", [testFile.id]);
      assert.equal(pages.rows.length, 2);
      assert.equal(pages.rows[0].source, "ocr");
      assert.equal(pages.rows[0].status, "done");
    });
  });

  describe("5. Mixed PDF: only scanned pages are sent to OCR", () => {
    it("should process digital pages locally and invoke OCR exclusively for scanned pages", async () => {
      const healthyProse = "Comprehensive coverage of heuristic search algorithms including A-star, hill climbing, and constraint satisfaction methods. ".repeat(2);
      const mixedPdf = createSyntheticPdf([
        { text: healthyProse },         // Page 1: Digital
        { text: "-- 2 of 585 --" },      // Page 2: Scanned stamp
      ]);

      const testFile = await createTestFile(userA.id, {
        originalName: "mixed-document.pdf",
        mimeType: "application/pdf",
        status: "processing",
      });

      await processPdfPipeline(testFile, mixedPdf, userA.id);

      // Only Page 2 should invoke an AI vision call!
      assert.equal(aiCalls.length, 1, "Exactly one vision call must be made for the single scanned page");

      const pages = await testQuery("SELECT * FROM file_pages WHERE file_id = $1 ORDER BY page_number", [testFile.id]);
      assert.equal(pages.rows[0].source, "digital");
      assert.equal(pages.rows[0].status, "done");
      assert.equal(pages.rows[1].source, "ocr");
      assert.equal(pages.rows[1].status, "done");
    });
  });

  describe("6. Figure-heavy digital page keeps text and gains visual description", () => {
    it("should extract text locally and append [Figure/Page N visual: ...] block", async () => {
      const healthyText = "System architecture diagram illustrating the decoupling between ingress transport and asynchronous background processing workers. ".repeat(2);
      const figurePdf = createSyntheticPdf([
        { text: healthyText, hasFigure: true },
      ]);

      const testFile = await createTestFile(userA.id, {
        originalName: "slide-with-diagram.pdf",
        mimeType: "application/pdf",
        status: "processing",
      });

      await processPdfPipeline(testFile, figurePdf, userA.id);

      assert.equal(aiCalls.length, 1, "Vision call must describe the figure");

      const dbFile = await testQuery("SELECT * FROM files WHERE id = $1", [testFile.id]);
      const extracted = dbFile.rows[0].extracted_text;
      assert.ok(extracted.includes("System architecture diagram illustrating"));
      assert.ok(extracted.includes("[Figure/Page 1 visual:"));
      assert.ok(extracted.includes("Architecture diagram showing microservices"));

      const pages = await testQuery("SELECT * FROM file_pages WHERE file_id = $1", [testFile.id]);
      assert.equal(pages.rows[0].source, "figure");
      assert.ok(pages.rows[0].visual_description.includes("Architecture diagram"));
    });
  });

  describe("7. Page Cap & 'partial' Status with Visible Note", () => {
    it("should enforce MAX_OCR_PAGES_PER_FILE, mark partial, and preserve user note", async () => {
      // Temporarily set page cap to 1 for test
      const originalCap = env.MAX_OCR_PAGES_PER_FILE;
      env.MAX_OCR_PAGES_PER_FILE = 1;

      try {
        const threeScansPdf = createSyntheticPdf([
          { text: "-- 1 of 3 --" },
          { text: "-- 2 of 3 --" },
        ]);

        const testFile = await createTestFile(userA.id, {
          originalName: "heavy-scanned-archive.pdf",
          mimeType: "application/pdf",
          status: "processing",
        });

        const result = await processPdfPipeline(testFile, threeScansPdf, userA.id);

        assert.equal(result.isPartial, true);
        assert.ok(result.ocrNote.includes("OCR capped at 1 pages"));

        const dbFile = await testQuery("SELECT * FROM files WHERE id = $1", [testFile.id]);
        assert.equal(dbFile.rows[0].ocr_status, "partial");
        assert.ok(dbFile.rows[0].ocr_note.includes("OCR capped at 1 pages"));

        // Only 1 page vision call made
        assert.equal(aiCalls.length, 1);
      } finally {
        env.MAX_OCR_PAGES_PER_FILE = originalCap;
      }
    });
  });

  describe("8. Resumable Jobs, Worker Concurrency & Stale Row Recovery", () => {
    it("should atomically claim pending job with SKIP LOCKED and prevent double processing", async () => {
      const testFile = await createTestFile(userA.id, {
        originalName: "job-claim-test.pdf",
        mimeType: "application/pdf",
      });
      await testQuery("UPDATE files SET ocr_status = 'pending' WHERE id = $1", [testFile.id]);

      // Worker 1 claims job
      const worker1Claim = await claimNextOcrJob();
      assert.ok(worker1Claim, "Worker 1 must claim the pending job");
      assert.equal(worker1Claim.id, testFile.id);

      // Concurrent Worker 2 attempts to claim next job
      const worker2Claim = await claimNextOcrJob();
      assert.equal(worker2Claim, null, "Worker 2 must not double-process claimed job");
    });

    it("should reset stale processing rows after timeout to pending", async () => {
      const testFile = await createTestFile(userA.id, {
        originalName: "stale-worker-test.pdf",
        mimeType: "application/pdf",
      });

      // Simulate a crashed worker whose job was claimed 15 minutes ago
      await testQuery(
        `UPDATE files
         SET ocr_status = 'processing', ocr_started_at = NOW() - INTERVAL '15 minutes'
         WHERE id = $1`,
        [testFile.id]
      );

      const recoveredCount = await resetStaleOcrJobs(5);
      assert.ok(recoveredCount >= 1);

      const check = await testQuery("SELECT ocr_status, ocr_started_at FROM files WHERE id = $1", [testFile.id]);
      assert.equal(check.rows[0].ocr_status, "pending");
      assert.equal(check.rows[0].ocr_started_at, null);
    });
  });

  describe("9. Content-Hash Cache Prevents Repeat OCR", () => {
    it("should reuse cached pages and text for identical PDF buffer", async () => {
      const scannedPdf = createSyntheticPdf([
        { text: "-- 1 of 100 --" },
      ]);

      const file1 = await createTestFile(userA.id, {
        originalName: "initial-upload.pdf",
        mimeType: "application/pdf",
        status: "processing",
      });

      // First run: calls vision OCR
      await processPdfPipeline(file1, scannedPdf, userA.id);
      assert.equal(aiCalls.length, 1);

      // Second upload by same user of exact same PDF
      const file2 = await createTestFile(userA.id, {
        originalName: "duplicate-upload.pdf",
        mimeType: "application/pdf",
        status: "processing",
      });

      aiCalls = [];
      const cacheResult = await processPdfPipeline(file2, scannedPdf, userA.id);

      assert.equal(cacheResult.cached, true);
      assert.equal(aiCalls.length, 0, "Zero vision calls on second upload due to content-hash cache");

      const dbFile2 = await testQuery("SELECT * FROM files WHERE id = $1", [file2.id]);
      assert.equal(dbFile2.rows[0].ocr_status, "done");
      assert.equal(dbFile2.rows[0].status, "ready");
      assert.ok(dbFile2.rows[0].ocr_note.includes("content-hash cache"));
    });
  });

  describe("10. Quota Accounting: 1 Quota unit per Document & BYOK Bypass", () => {
    it("should charge 1 quota unit for multi-page vision run on free tier, and 0 for BYOK", async () => {
      // 1. User without custom key: charges 1 unit
      const scannedPdf = createSyntheticPdf([
        { text: "-- 1 of 2 --" },
        { text: "-- 2 of 2 --" },
      ]);

      const fileFree = await createTestFile(userA.id, {
        originalName: "quota-test-free.pdf",
        mimeType: "application/pdf",
        status: "processing",
      });

      const usageBefore = await testQuery(
        "SELECT ai_call_count FROM user_daily_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE",
        [userA.id]
      );
      const countBefore = usageBefore.rows[0]?.ai_call_count || 0;

      await processPdfPipeline(fileFree, scannedPdf, userA.id);

      const usageAfter = await testQuery(
        "SELECT ai_call_count FROM user_daily_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE",
        [userA.id]
      );
      const countAfter = usageAfter.rows[0]?.ai_call_count || 0;
      assert.equal(countAfter - countBefore, 1, "Exactly 1 quota unit charged for document vision run");

      // 2. User with BYOK key: charges 0 units
      await saveUserKey(userB.id, "openrouter", "sk-or-v1-my-custom-test-byok-key-32chars");

      const fileByok = await createTestFile(userB.id, {
        originalName: "quota-test-byok.pdf",
        mimeType: "application/pdf",
        status: "processing",
      });

      const usageBBefore = await testQuery(
        "SELECT ai_call_count FROM user_daily_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE",
        [userB.id]
      );
      const countBBefore = usageBBefore.rows[0]?.ai_call_count || 0;

      await processPdfPipeline(fileByok, scannedPdf, userB.id);

      const usageBAfter = await testQuery(
        "SELECT ai_call_count FROM user_daily_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE",
        [userB.id]
      );
      const countBAfter = usageBAfter.rows[0]?.ai_call_count || 0;
      assert.equal(countBAfter, countBBefore, "BYOK user must not be charged against free quota");
    });
  });

  describe("11. Cross-User Isolation in Pages, Chunks and Content-Hash Cache", () => {
    it("should ensure User B cannot access User A's pages, chunks, or cache", async () => {
      const pdfBuffer = createSyntheticPdf([{ text: "-- 1 of 1 --" }]);

      const fileA = await createTestFile(userA.id, {
        originalName: "userA-file.pdf",
        mimeType: "application/pdf",
        status: "processing",
      });

      await processPdfPipeline(fileA, pdfBuffer, userA.id);

      // User B uploads same file
      const fileB = await createTestFile(userB.id, {
        originalName: "userB-file.pdf",
        mimeType: "application/pdf",
        status: "processing",
      });

      // User B must NOT use User A's cache because cache is strictly scoped by user_id
      aiCalls = [];
      const resB = await processPdfPipeline(fileB, pdfBuffer, userB.id);
      assert.equal(resB.cached, undefined, "User B must not hit User A's cache");

      // Verify file_pages isolation: User B querying file_pages for fileA gets 0 rows
      const pagesASeenByB = await testQuery(
        "SELECT * FROM file_pages WHERE file_id = $1 AND user_id = $2",
        [fileA.id, userB.id]
      );
      assert.equal(pagesASeenByB.rows.length, 0);

      // Verify chunks isolation
      const chunksASeenByB = await testQuery(
        "SELECT * FROM file_chunks WHERE file_id = $1 AND user_id = $2",
        [fileA.id, userB.id]
      );
      assert.equal(chunksASeenByB.rows.length, 0);
    });
  });
});
