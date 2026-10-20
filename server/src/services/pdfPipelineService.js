import crypto from "node:crypto";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { query } from "../db/index.js";
import { env } from "../config/env.js";
import { classifyPage } from "./pdfPageClassifier.js";
import { renderPdfPageToBuffer } from "./pdfRenderer.js";
import { getActiveKeyForUser, enforceDailyFreeQuota } from "./keyService.js";
import { saveFileChunks } from "./chunkService.js";
import { processFileSummary } from "./summaryService.js";
import { extractWithOpenRouterVision, extractWithGeminiVision } from "./ocrService.js";
import { getUserById } from "./fileService.js";
import { downloadFileBuffer } from "./driveService.js";

/**
 * Calculates SHA-256 hash of a file buffer.
 */
export function computeFileHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Resets stale processing OCR rows back to 'pending' if their worker crashed or timed out.
 */
export async function resetStaleOcrJobs(timeoutMinutes = env.OCR_STALE_TIMEOUT_MINUTES) {
  const result = await query(
    `UPDATE files
     SET ocr_status = 'pending', ocr_started_at = NULL, updated_at = NOW()
     WHERE ocr_status = 'processing'
       AND ocr_started_at < NOW() - make_interval(mins => $1::int)
     RETURNING id, original_name`,
    [timeoutMinutes]
  );
  if (result.rowCount > 0) {
    console.log(`[OCR Stale Recovery] Reset ${result.rowCount} stale processing file(s) to pending.`);
  }
  return result.rowCount;
}

/**
 * Claims the next pending OCR file atomically using FOR UPDATE SKIP LOCKED.
 */
export async function claimNextOcrJob() {
  const result = await query(
    `SELECT id, user_id, drive_file_id, original_name, mime_type, content_hash
     FROM files
     WHERE ocr_status = 'pending'
     ORDER BY created_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT 1`
  );
  if (result.rowCount === 0) return null;

  const job = result.rows[0];
  await query(
    `UPDATE files
     SET ocr_status = 'processing', ocr_started_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [job.id]
  );
  return job;
}

let ocrWorkerTimer = null;
let isOcrWorkerRunning = false;

/**
 * Claims and processes the next pending OCR file.
 */
export async function processNextPendingOcrJob() {
  if (isOcrWorkerRunning) return null;
  isOcrWorkerRunning = true;
  try {
    // 1. Recover stale processing rows
    await resetStaleOcrJobs(env.OCR_STALE_TIMEOUT_MINUTES || 5);

    // 2. Claim next pending job atomically
    const job = await claimNextOcrJob();
    if (!job) return null;

    console.log(`[OCR Worker] Claimed file "${job.original_name}" (${job.id})`);

    const user = await getUserById(job.user_id);
    if (!user?.google_refresh_token) {
      await query(
        `UPDATE files SET ocr_status = 'failed', ocr_note = 'Google authentication missing', status = 'failed', updated_at = NOW() WHERE id = $1`,
        [job.id]
      );
      return null;
    }

    const buffer = await downloadFileBuffer(user.google_refresh_token, job.drive_file_id);
    const result = await processPdfPipeline(job, buffer, job.user_id);
    console.log(`[OCR Worker] Finished processing "${job.original_name}" (${job.id})`);
    return result;
  } catch (err) {
    console.error("[OCR Worker Error]:", err.message);
    return null;
  } finally {
    isOcrWorkerRunning = false;
  }
}

/**
 * Starts the periodic background worker for OCR jobs.
 */
export function startOcrWorkerJob(intervalMs = 10000) {
  if (ocrWorkerTimer) return;
  // Sweep once on startup: immediately recover any interrupted processing rows from prior server run
  resetStaleOcrJobs(0).then(() => {
    processNextPendingOcrJob().catch(() => {});
  }).catch(() => {});

  ocrWorkerTimer = setInterval(() => {
    processNextPendingOcrJob().catch(() => {});
  }, intervalMs);
  if (ocrWorkerTimer.unref) ocrWorkerTimer.unref();
  console.log(`[OCR Worker] Initialized recurring sweep (every ${intervalMs / 1000}s)`);
}

/**
 * Stops the periodic background worker.
 */
export function stopOcrWorkerJob() {
  if (ocrWorkerTimer) {
    clearInterval(ocrWorkerTimer);
    ocrWorkerTimer = null;
  }
}

/**
 * Executes a vision pass on a rendered page image using OpenRouter with Gemini fallback.
 */
export async function performPageVision(imageBuffer, userId, prompt) {
  // 1. Try OpenRouter Vision
  let text = await extractWithOpenRouterVision(imageBuffer, "image/png", userId, prompt);
  if (text && text.trim().length > 0 && text.trim() !== "NO_TEXT" && text.trim() !== "NO_VISUALS") {
    return text.trim();
  }

  // 2. Cascade to Gemini Vision
  text = await extractWithGeminiVision(imageBuffer, "image/png", userId, prompt);
  if (text && text.trim().length > 0 && text.trim() !== "NO_TEXT" && text.trim() !== "NO_VISUALS") {
    return text.trim();
  }

  return "";
}

/**
 * Assembles the composite document text from all currently completed pages.
 */
export async function assembleCompositeText(fileId) {
  const res = await query(
    `SELECT page_number, text, visual_description, source
     FROM file_pages
     WHERE file_id = $1 AND status = 'done'
     ORDER BY page_number ASC`,
    [fileId]
  );

  const parts = [];
  for (const page of res.rows) {
    const pageHeader = `--- Page ${page.page_number} ---`;
    let content = (page.text || "").trim();
    if (page.visual_description && page.visual_description.trim().length > 0) {
      const figureBlock = `[Figure/Page ${page.page_number} visual: ${page.visual_description.trim()}]`;
      content = content ? `${content}\n\n${figureBlock}` : figureBlock;
    }
    if (content) {
      parts.push(`${pageHeader}\n${content}`);
    }
  }

  return parts.join("\n\n").slice(0, env.MAX_EXTRACT_CHARS);
}

/**
 * Main Pipeline: Processes a PDF page by page with hybrid local text extraction,
 * targeted rendering, figure descriptions, quota safety, and caching.
 *
 * @param {Object} fileRecord - Database file record
 * @param {Buffer} pdfBuffer - Raw PDF binary buffer
 * @param {string} userId - ID of the owning user
 * @returns {Promise<Object>} Final processing result
 */
export async function processPdfPipeline(fileRecord, pdfBuffer, userId, options = {}) {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error("Cannot process empty PDF buffer");
  }

  const shouldTriggerSummary = options.triggerSummary ?? (process.env.NODE_ENV !== "test");
  const fileId = fileRecord.id;
  const contentHash = computeFileHash(pdfBuffer);

  // 1. Update file record with content hash & status
  await query(
    `UPDATE files
     SET content_hash = $1, ocr_status = 'processing', ocr_started_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND user_id = $3`,
    [contentHash, fileId, userId]
  );

  // 2. Content-Hash Cache Check (scoped strictly by user_id)
  const cachedRes = await query(
    `SELECT id, extracted_text, pages_total, pages_done, ocr_note
     FROM files
     WHERE user_id = $1
       AND content_hash = $2
       AND id != $3
       AND ocr_status IN ('done', 'partial')
       AND extracted_text IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, contentHash, fileId]
  );

  if (cachedRes.rows.length > 0) {
    const cached = cachedRes.rows[0];
    console.log(`[PDF Cache Hit] Reusing page records from file ${cached.id} for file ${fileId}`);

    // Copy cached file_pages to new file
    await query(
      `INSERT INTO file_pages (file_id, user_id, page_number, text, visual_description, source, status, created_at, updated_at)
       SELECT $1, $2, page_number, text, visual_description, source, status, NOW(), NOW()
       FROM file_pages
       WHERE file_id = $3
       ON CONFLICT (file_id, page_number) DO UPDATE SET
         text = EXCLUDED.text,
         visual_description = EXCLUDED.visual_description,
         source = EXCLUDED.source,
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [fileId, userId, cached.id]
    );

    await query(
      `UPDATE files
       SET extracted_text = $1,
           pages_total = $2,
           pages_done = $3,
           ocr_status = 'done',
           status = 'ready',
           ocr_note = 'Reused from content-hash cache',
           updated_at = NOW()
       WHERE id = $4 AND user_id = $5`,
      [cached.extracted_text, cached.pages_total, cached.pages_done, fileId, userId]
    );

    if (cached.extracted_text) {
      await saveFileChunks(fileId, userId, cached.extracted_text);
      if (shouldTriggerSummary) {
        processFileSummary(fileId, userId).catch(() => {});
      }
    }

    return {
      success: true,
      cached: true,
      pagesTotal: cached.pages_total,
      pagesDone: cached.pages_done,
      extractedText: cached.extracted_text,
    };
  }

  // 3. Inspect PDF Document Structure
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  const totalPages = doc.numPages;
  const pagesToScan = Math.min(totalPages, env.MAX_PDF_PAGES);

  // Check how many pages are already done from a prior run
  const initialDoneRes = await query(
    `SELECT count(*)::int as cnt FROM file_pages WHERE file_id = $1 AND status = 'done'`,
    [fileId]
  );
  let pagesDone = initialDoneRes.rows[0]?.cnt || 0;

  await query(
    `UPDATE files
     SET pages_total = $1, pages_done = $2, updated_at = NOW()
     WHERE id = $3 AND user_id = $4`,
    [totalPages, pagesDone, fileId, userId]
  );

  const pageAnalyses = [];

  // 4. Per-Page Extraction & Classification
  for (let pageNum = 1; pageNum <= pagesToScan; pageNum++) {
    const page = await doc.getPage(pageNum);
    try {
      const tc = await page.getTextContent();
      let rawText = "";
      let lastY = null;

      for (const item of tc.items) {
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
          rawText += "\n";
        } else if (rawText.length > 0 && !rawText.endsWith(" ") && !rawText.endsWith("\n")) {
          rawText += " ";
        }
        rawText += item.str;
        lastY = item.transform[5];
      }

      const ops = await page.getOperatorList();
      let imageOpCount = 0;
      const imageOpCodes = new Set([
        pdfjsLib.OPS.paintImageXObject,
        pdfjsLib.OPS.paintInlineImageXObject,
        pdfjsLib.OPS.paintImageMaskXObject,
        pdfjsLib.OPS.paintImageMaskXObjectGroup,
        pdfjsLib.OPS.paintInlineImageXObjectGroup,
        pdfjsLib.OPS.paintImageXObjectRepeat,
      ]);

      for (let i = 0; i < ops.fnArray.length; i++) {
        if (imageOpCodes.has(ops.fnArray[i])) {
          imageOpCount++;
        }
      }

      const classification = classifyPage(rawText, imageOpCount);
      pageAnalyses.push({
        pageNum,
        classification,
      });
    } finally {
      if (typeof page.cleanup === "function") {
        page.cleanup();
      }
    }
  }

  // Batch insert page records into file_pages without overwriting already completed pages
  if (pageAnalyses.length > 0) {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < pageAnalyses.length; i += CHUNK_SIZE) {
      const chunk = pageAnalyses.slice(i, i + CHUNK_SIZE);
      const values = [];
      const params = [];
      let pIdx = 1;

      for (const item of chunk) {
        const pageNum = item.pageNum;
        const classification = item.classification;
        const initialStatus = classification.classification === "digital" ? "done" : "pending";
        const initialSource =
          classification.classification === "digital"
            ? "digital"
            : classification.classification === "needs_ocr"
            ? "ocr"
            : "figure";
        const pageText = classification.classification === "needs_ocr" ? "" : classification.cleanedText;

        values.push(`($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, NULL, $${pIdx + 4}, $${pIdx + 5}, NOW(), NOW())`);
        params.push(fileId, userId, pageNum, pageText, initialSource, initialStatus);
        pIdx += 6;
      }

      await query(
        `INSERT INTO file_pages (file_id, user_id, page_number, text, visual_description, source, status, created_at, updated_at)
         VALUES ${values.join(", ")}
         ON CONFLICT (file_id, page_number) DO UPDATE SET
           text = CASE WHEN file_pages.status = 'done' THEN file_pages.text ELSE EXCLUDED.text END,
           visual_description = CASE WHEN file_pages.status = 'done' THEN file_pages.visual_description ELSE EXCLUDED.visual_description END,
           source = CASE WHEN file_pages.status = 'done' THEN file_pages.source ELSE EXCLUDED.source END,
           status = CASE WHEN file_pages.status = 'done' THEN file_pages.status ELSE EXCLUDED.status END,
           updated_at = NOW()`,
        params
      );
    }
  }

  await doc.destroy();

  // 5. Check if Any Pages Need Vision OCR or Figure Descriptions
  const visionPages = pageAnalyses.filter(
    (p) => p.classification.classification === "needs_ocr" || p.classification.classification === "has_figures"
  );

  // If 100% of pages are digital, finish fast with zero AI calls
  if (visionPages.length === 0) {
    const fullText = await assembleCompositeText(fileId);
    await query(
      `UPDATE files
       SET extracted_text = $1,
           pages_done = $2,
           ocr_status = 'done',
           status = 'ready',
           updated_at = NOW()
       WHERE id = $3 AND user_id = $4`,
      [fullText, totalPages, fileId, userId]
    );

    if (fullText) {
      await saveFileChunks(fileId, userId, fullText);
      if (shouldTriggerSummary) {
        processFileSummary(fileId, userId).catch(() => {});
      }
    }

    return {
      success: true,
      digitalOnly: true,
      pagesTotal: totalPages,
      pagesDone: totalPages,
      extractedText: fullText,
    };
  }

  // 6. Cost Controls & Quota Accounting for Vision Pages
  let isPartial = false;
  let ocrNote = null;
  let pagesToProcessWithVision = visionPages;

  if (visionPages.length > env.MAX_OCR_PAGES_PER_FILE) {
    isPartial = true;
    ocrNote = `OCR capped at ${env.MAX_OCR_PAGES_PER_FILE} pages. Remaining ${visionPages.length - env.MAX_OCR_PAGES_PER_FILE} pages skipped to preserve quota.`;
    pagesToProcessWithVision = visionPages.slice(0, env.MAX_OCR_PAGES_PER_FILE);

    // Mark remaining vision pages as skipped in file_pages
    const skippedPages = visionPages.slice(env.MAX_OCR_PAGES_PER_FILE);
    for (const sk of skippedPages) {
      await query(
        `UPDATE file_pages
         SET status = 'failed', text = COALESCE(NULLIF(text, ''), '[Page skipped due to OCR page cap]'), updated_at = NOW()
         WHERE file_id = $1 AND page_number = $2 AND status != 'done'`,
        [fileId, sk.pageNum]
      );
    }
  }

  // Check currently completed pages to avoid repeating work
  const doneRes = await query(
    `SELECT page_number FROM file_pages WHERE file_id = $1 AND status = 'done'`,
    [fileId]
  );
  const donePagesSet = new Set(doneRes.rows.map((r) => r.page_number));
  pagesDone = donePagesSet.size;

  // Filter out pages that are ALREADY DONE
  const pendingVisionPages = pagesToProcessWithVision.filter((p) => !donePagesSet.has(p.pageNum));

  // If all vision pages are already completed, finalize and return
  if (pendingVisionPages.length === 0) {
    const fullText = await assembleCompositeText(fileId);
    const finalStatus = isPartial ? "partial" : "done";
    await query(
      `UPDATE files
       SET extracted_text = $1,
           pages_done = $2,
           ocr_status = $3,
           status = 'ready',
           ocr_note = $4,
           updated_at = NOW()
       WHERE id = $5 AND user_id = $6`,
      [fullText, pagesDone, finalStatus, ocrNote, fileId, userId]
    );

    if (fullText) {
      await saveFileChunks(fileId, userId, fullText);
      if (shouldTriggerSummary) {
        processFileSummary(fileId, userId).catch(() => {});
      }
    }

    return {
      success: true,
      isPartial,
      ocrNote,
      pagesTotal: totalPages,
      pagesDone,
      extractedText: fullText,
    };
  }

  // Quota Accounting: Charge exactly ONE quota unit per document's vision run (if using server key)
  if (userId) {
    const openrouterKey = await getActiveKeyForUser(userId, "openrouter");
    const geminiKey = await getActiveKeyForUser(userId, "gemini");
    const hasCustomKey = openrouterKey.isCustom || geminiKey.isCustom;

    if (!hasCustomKey) {
      try {
        await enforceDailyFreeQuota(userId, 1);
      } catch (quotaErr) {
        console.warn(`[OCR Quota Exceeded] User ${userId} exceeded quota during PDF pipeline:`, quotaErr.message);
        await query(
          `UPDATE files
           SET ocr_status = 'failed',
               ocr_note = $1,
               status = 'failed',
               updated_at = NOW()
           WHERE id = $2 AND user_id = $3`,
          [quotaErr.message, fileId, userId]
        );
        throw quotaErr;
      }
    }
  }

  // 7. Render and Process Vision Pages in Batches
  const BATCH_SIZE = env.OCR_BATCH_SIZE || 3;
  for (let b = 0; b < pendingVisionPages.length; b += BATCH_SIZE) {
    const batch = pendingVisionPages.slice(b, b + BATCH_SIZE);

    await Promise.all(
      batch.map(async (item) => {
        const pageNum = item.pageNum;
        const kind = item.classification.classification;

        try {
          // Render page to PNG buffer
          const imageBuffer = await renderPdfPageToBuffer(pdfBuffer, pageNum);

          if (kind === "needs_ocr") {
            const prompt =
              "Transcribe all readable text, headings, numbers, and notes from this page accurately. Output only the transcribed text without conversational commentary.";
            const transcribed = await performPageVision(imageBuffer, userId, prompt);

            await query(
              `UPDATE file_pages
               SET text = $1, status = 'done', updated_at = NOW()
               WHERE file_id = $2 AND page_number = $3`,
              [transcribed || "No readable text detected on this page.", fileId, pageNum]
            );
          } else if (kind === "has_figures") {
            const prompt =
              "Describe any figures, charts, diagrams, formulas, or visual elements on this page concisely for academic study. If there are no figures or meaningful visuals, output NO_VISUALS.";
            const visualDesc = await performPageVision(imageBuffer, userId, prompt);

            await query(
              `UPDATE file_pages
               SET visual_description = $1, status = 'done', updated_at = NOW()
               WHERE file_id = $2 AND page_number = $3`,
              [visualDesc && visualDesc !== "NO_VISUALS" ? visualDesc : null, fileId, pageNum]
            );
          }
        } catch (pageErr) {
          console.warn(`[Page OCR Error] File ${fileId} Page ${pageNum}:`, pageErr.message);
          await query(
            `UPDATE file_pages
             SET status = 'failed', updated_at = NOW()
             WHERE file_id = $1 AND page_number = $2`,
            [fileId, pageNum]
          );
        }
      })
    );

    // Update real count of completed pages in files table
    const doneCountRes = await query(
      `SELECT count(*)::int as cnt FROM file_pages WHERE file_id = $1 AND status = 'done'`,
      [fileId]
    );
    pagesDone = doneCountRes.rows[0]?.cnt || pagesDone;

    await query(
      `UPDATE files
       SET pages_done = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3`,
      [pagesDone, fileId, userId]
    );

    // Progressive Chunk Assembly: Make completed pages instantly searchable while remaining pages finish
    const partialText = await assembleCompositeText(fileId);
    if (partialText && partialText.length > 0) {
      await query(
        `UPDATE files
         SET extracted_text = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3`,
        [partialText, fileId, userId]
      );
      await saveFileChunks(fileId, userId, partialText).catch(() => {});
    }
  }

  // 8. Finalize Pipeline Execution
  const finalFullText = await assembleCompositeText(fileId);
  const finalStatus = isPartial ? "partial" : "done";

  await query(
    `UPDATE files
     SET extracted_text = $1,
         pages_done = $2,
         ocr_status = $3,
         status = 'ready',
         ocr_note = $4,
         updated_at = NOW()
     WHERE id = $5 AND user_id = $6`,
    [finalFullText, pagesDone, finalStatus, ocrNote, fileId, userId]
  );

  if (finalFullText && finalFullText.length > 0) {
    await saveFileChunks(fileId, userId, finalFullText);
    if (shouldTriggerSummary) {
      processFileSummary(fileId, userId).catch(() => {});
    }
  }

  return {
    success: true,
    isPartial,
    ocrNote,
    pagesTotal: totalPages,
    pagesDone,
    extractedText: finalFullText,
  };
}
