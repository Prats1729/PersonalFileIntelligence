import express from "express";
import multer from "multer";
import path from "node:path";
import { query } from "../db/index.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { uploadLimiter } from "../middleware/rateLimiter.js";
import { uploadFileToDrive, deleteFileFromDrive, getDriveFolders, createDriveFolder, downloadFileBuffer } from "../services/driveService.js";
import { getUserById, saveFileRecord, getFilesByUser, deleteFileRecord, getFileRecord, deleteFilesByFolder, getFilesByFolder, updateFileContextNote, updateFileExtractedText, toggleFileFavorite } from "../services/fileService.js";
import { categorizeFilesBulk } from "../services/aiService.js";
import { syncUserWithDrive } from "../services/syncService.js";
import { extractDocumentText } from "../services/ocrService.js";
import { saveFileChunks } from "../services/chunkService.js";
import { processFileSummary, lazyBackfillFile } from "../services/summaryService.js";
import { processPdfPipeline, processNextPendingOcrJob } from "../services/pdfPipelineService.js";
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, sanitizeFilename, verifyBufferSignature } from "../utils/fileValidation.js";
import { AppError } from "../middleware/errorHandler.js";

const router = express.Router();

// Memory storage for multer with strict size limit (50MB) and cap of 25 files per request
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 25, // max 25 files per upload batch
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(
        new AppError(
          `File type "${ext}" is not permitted. Supported formats: PDF, PNG, JPG, WEBP, DOCX, TXT.`,
          400,
          "UNSUPPORTED_FILE_TYPE"
        )
      );
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(
        new AppError(
          `MIME type "${file.mimetype}" is not permitted.`,
          400,
          "INVALID_MIME_TYPE"
        )
      );
    }
    cb(null, true);
  },
});

// Upload files
router.post("/upload", requireAuth, uploadLimiter, upload.array("files"), async (req, res, next) => {
  if (!req.files || req.files.length === 0){
    return res.status(400).json({ error: "No file uploaded." });
  }
  
  try {
    const userId = req.user.id;
    const { contextNote } = req.body;

    // 1. Sanitize filenames and verify binary magic numbers
    for (const file of req.files) {
      file.originalname = sanitizeFilename(file.originalname);
      const ext = path.extname(file.originalname).toLowerCase();
      if (!verifyBufferSignature(file.buffer, ext)) {
        return res.status(400).json({
          error: `File signature mismatch for "${file.originalname}". The content does not match the file extension.`,
        });
      }
    }

    // 2. Get user's Google refresh token
    const user = await getUserById(userId);
    if (!user || !user.google_refresh_token) {
      return res.status(401).json({ error: "User or Google Refresh Token not found." });
    }

    // 3. Deduplication check: compare against existing user files
    const userExistingFiles = await getFilesByUser(userId);
    const existingFileSet = new Set(
      userExistingFiles.map((f) => `${f.original_name}__${f.size_bytes}`)
    );

    const filesToProcess = [];
    const skippedFiles = [];

    for (const file of req.files) {
      const fileKey = `${file.originalname}__${file.size}`;
      if (existingFileSet.has(fileKey)) {
        skippedFiles.push({
          fileName: file.originalname,
          reason: "File with identical name and size already exists in library",
        });
      } else {
        filesToProcess.push(file);
      }
    }

    // If ALL files were already uploaded, return early without calling Drive or AI
    if (filesToProcess.length === 0) {
      return res.status(200).json({
        message: `All ${skippedFiles.length} file(s) already exist in your library.`,
        files: [],
        skippedFiles,
        failedFiles: [],
      });
    }

    let existingFolders = await getDriveFolders(user.google_refresh_token);

    // Determine target folder for files:
    // If user provided contextNote, prioritize it as the folder candidate.
    // Otherwise fallback to "Others".
    let targetFolder = null;
    let finalFolderName = "Others";

    if (contextNote && contextNote.trim().length > 0) {
      const noteFolderCandidate = contextNote.trim().slice(0, 30);
      targetFolder = existingFolders.find(
        (f) => f.name.toLowerCase() === noteFolderCandidate.toLowerCase()
      );
      if (!targetFolder) {
        targetFolder = await createDriveFolder(user.google_refresh_token, noteFolderCandidate);
        existingFolders.push(targetFolder);
      }
      finalFolderName = targetFolder.name;
    } else {
      targetFolder = existingFolders.find((f) => f.name.toLowerCase() === "others");
      if (!targetFolder) {
        targetFolder = await createDriveFolder(user.google_refresh_token, "Others");
        existingFolders.push(targetFolder);
      }
      finalFolderName = targetFolder.name;
    }

    // Upload files in batches of 5 to Google Drive
    const BATCH_SIZE = 5;
    const results = [];

    for (let b = 0; b < filesToProcess.length; b += BATCH_SIZE) {
      const batch = filesToProcess.slice(b, b + BATCH_SIZE);
      const batchPromises = batch.map(async (file) => {
        try {
          const driveMetadata = await uploadFileToDrive(
            user.google_refresh_token,
            file,
            targetFolder ? targetFolder.id : null
          );

          const fileRecord = await saveFileRecord(
            userId,
            driveMetadata,
            file,
            contextNote,
            finalFolderName,
            null, // extracted_text initially null
            "processing" // status initially processing
          );

          return { success: true, fileRecord, file };
        } catch (fileErr) {
          console.error(`Failed to upload "${file.originalname}":`, fileErr);
          return {
            success: false,
            fileName: file.originalname,
            error: fileErr.message || "Upload failed",
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    const savedResults = results.filter((r) => r.success);
    const savedFiles = savedResults.map((r) => r.fileRecord);
    const failedFiles = results.filter((r) => !r.success).map((r) => ({ fileName: r.fileName, error: r.error }));

    if (savedFiles.length === 0 && failedFiles.length > 0 && skippedFiles.length === 0) {
      return res.status(500).json({
        error: "All file uploads failed.",
        failedFiles,
      });
    }

    // Immediately return HTTP 201 so the UI upload manager shows "Uploaded"
    res.status(201).json({
      message: `${savedFiles.length} file(s) uploaded successfully${skippedFiles.length > 0 ? `, ${skippedFiles.length} skipped` : ""}${failedFiles.length > 0 ? `, ${failedFiles.length} failed` : ""}`,
      files: savedFiles,
      skippedFiles,
      failedFiles,
    });

    // Asynchronous Background Tasks: Text Extraction (OCR), Search Chunks, Smart Categorization & Summarization
    (async () => {
      for (const item of savedResults) {
        const { fileRecord, file } = item;
        try {
          const buffer = file?.buffer || (await downloadFileBuffer(user.google_refresh_token, fileRecord.drive_file_id));
          const isPdf = fileRecord.mime_type?.includes("pdf") || fileRecord.original_name.toLowerCase().endsWith(".pdf");

          if (isPdf) {
            // Per-page PDF extraction and classification pipeline
            await processPdfPipeline(fileRecord, buffer, userId);
          } else {
            // Standard document / image extraction
            const text = await extractDocumentText(buffer, fileRecord.mime_type, fileRecord.original_name, userId);
            await updateFileExtractedText(fileRecord.id, userId, text || "", "ready");

            if (!contextNote && text && text.trim().length > 50) {
              try {
                const aiResults = await categorizeFilesBulk(
                  [{ index: 0, name: fileRecord.original_name, mimeType: fileRecord.mime_type, contentSnippet: text.slice(0, 500) }],
                  null,
                  existingFolders,
                  userId
                );
                const resFolder = aiResults?.[0];
                const suggested = resFolder?.suggestedNewFolder?.trim() || resFolder?.chosenExistingFolder?.trim();
                if (suggested && suggested.toLowerCase() !== "others" && suggested.toLowerCase() !== (fileRecord.ai_result_folder || "").toLowerCase()) {
                  await query("UPDATE files SET ai_result_folder = $1 WHERE id = $2 AND user_id = $3", [suggested, fileRecord.id, userId]);
                }
              } catch (catErr) {
                console.warn(`[Background Categorization Warning] "${fileRecord.original_name}":`, catErr.message);
              }
            }

            if (text && text.trim().length > 0) {
              await processFileSummary(fileRecord.id, userId);
            }
          }
          console.log(`[Background Processing Complete] Finished indexing & summary for "${fileRecord.original_name}"`);
        } catch (procErr) {
          console.error(`[Background Processing Error] "${fileRecord.original_name}":`, procErr.message);
          await updateFileExtractedText(fileRecord.id, userId, "", "failed").catch(() => {});
        }
      }
    })();
    
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to upload file." });
  }
});

// Trigger on-demand two-way sync
router.post("/sync", requireAuth, async (req, res) => {
  try {
    const stats = await syncUserWithDrive(req.user.id);
    const updatedFiles = await getFilesByUser(req.user.id);
    res.json({
      message: "Sync completed successfully",
      stats,
      files: updatedFiles,
    });
  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({ error: "Failed to sync with Google Drive." });
  }
});

// Get user files
router.get("/", requireAuth, async (req, res) => {
  try {
    const files = await getFilesByUser(req.user.id);
    res.json(files);
  } catch (error) {
    console.error("Error fetching files:", error);
    res.status(500).json({ error: "Failed to fetch files." });
  }
});

// Get a single file by ID (with lazy backfill for search chunks & summary queue)
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const file = await getFileRecord(req.user.id, req.params.id);
    if (!file) return res.status(404).json({ error: "File not found" });

    if (file.extracted_text) {
      lazyBackfillFile(file, req.user.id).catch((err) =>
        console.warn(`[Lazy Backfill Error for ${file.id}]:`, err.message)
      );
    }

    return res.status(200).json(file);
  } catch (error) {
    console.error("Error fetching file:", error);
    return res.status(500).json({ error: "Failed to fetch file." });
  }
});

// Delete entire folder and all its files
router.delete("/folder/:folderName", requireAuth, async (req, res) => {
  const { folderName } = req.params;
  try {
    const user = await getUserById(req.user.id);
    
    // 1. Fetch all files inside this folder from DB so we have their drive_file_ids
    const filesInFolder = await getFilesByFolder(req.user.id, folderName);

    // 2. Delete each file individually from Google Drive
    if (user && user.google_refresh_token) {
      for (const file of filesInFolder) {
        try {
          await deleteFileFromDrive(user.google_refresh_token, file.drive_file_id);
        } catch (driveFileErr) {
          console.error(`Error deleting file "${file.original_name}" from Drive:`, driveFileErr);
        }
      }

      // 3. Delete the folder container itself from Google Drive
      try {
        const driveFolders = await getDriveFolders(user.google_refresh_token);
        const folder = driveFolders.find(
          (f) => f.name.toLowerCase() === folderName.toLowerCase()
        );
        if (folder) {
          await deleteFileFromDrive(user.google_refresh_token, folder.id);
        }
      } catch (driveFolderErr) {
        console.error("Error deleting folder container from Drive:", driveFolderErr);
      }
    }

    // 4. Delete all file records from database (case-insensitive)
    const deletedFiles = await deleteFilesByFolder(req.user.id, folderName);

    return res.status(200).json({
      message: `Folder "${folderName}" and its ${deletedFiles.length} file(s) deleted successfully`,
      deletedCount: deletedFiles.length,
    });
  } catch (error) {
    console.error("Error deleting folder:", error);
    return res.status(500).json({ error: "Failed to delete folder." });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
    const file = await getFileRecord(req.user.id, req.params.id);
    if (!file){
        return res.status(404).json({error: "File not found"})
    }
    try {
      const user = await getUserById(req.user.id);
      await deleteFileFromDrive(user.google_refresh_token, file.drive_file_id);
    } catch (error) {
        console.error("Error deleting file from Drive:", error);
        // Don't fail the whole request if Drive deletion fails
    }
    try {
        await deleteFileRecord(req.user.id, req.params.id);
    } catch (error) {
        console.error("Error deleting file from database:", error);
        return res.status(500).json({ error: "Failed to delete file from database." });
    }
    
    return res.status(200).json({message: "File deleted successfully"});
});

// Update context note for a file
router.patch("/:id/note", requireAuth, async (req, res) => {
  try {
    const { contextNote } = req.body;
    const updated = await updateFileContextNote(req.user.id, req.params.id, contextNote);
    if (!updated) {
      return res.status(404).json({ error: "File not found" });
    }
    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating context note:", error);
    return res.status(500).json({ error: "Failed to update context note." });
  }
});

// On-demand OCR / text extraction for a file
router.post("/:id/ocr", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const fileId = req.params.id;
  const force = req.query.force === "true";
  try {
    const fileRecord = await getFileRecord(userId, fileId);
    if (!fileRecord) return res.status(404).json({ error: "File not found" });

    const user = await getUserById(userId);
    if (!user?.google_refresh_token) {
      return res.status(401).json({ error: "Google authentication required" });
    }

    // If text already exists and is substantive and not force-refreshed
    if (fileRecord.extracted_text && !force && fileRecord.extracted_text.trim().length > 35 && fileRecord.ocr_status === "done") {
      lazyBackfillFile(fileRecord, userId).catch(() => {});
      return res.status(200).json({
        success: true,
        file: fileRecord,
        extractedText: fileRecord.extracted_text,
      });
    }

    const isPdf = fileRecord.mime_type?.includes("pdf") || fileRecord.original_name.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      await query(
        `UPDATE files
         SET ocr_status = 'pending', ocr_note = NULL, updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [fileId, userId]
      );

      // Trigger background worker asynchronously without blocking the HTTP request
      processNextPendingOcrJob().catch((err) =>
        console.warn(`[Async OCR Trigger Error for ${fileId}]:`, err.message)
      );

      const updated = await getFileRecord(userId, fileId);
      return res.status(202).json({
        success: true,
        message: "OCR processing started in background",
        file: updated,
      });
    }

    // Only download buffer for non-PDFs (images, text) which process synchronously
    const buffer = await downloadFileBuffer(user.google_refresh_token, fileRecord.drive_file_id);

    let text = await extractDocumentText(buffer, fileRecord.mime_type, fileRecord.original_name, userId);
    if (!text || text.trim().length === 0) {
      text = "No readable text detected in this document.";
    }

    const updated = await updateFileExtractedText(fileRecord.id, userId, text, "ready");
    lazyBackfillFile(updated, userId).catch(() => {});
    return res.status(200).json({
      success: true,
      file: updated,
      extractedText: text,
    });
  } catch (err) {
    console.error("On-demand OCR error:", err);
    return res.status(500).json({ error: err.message || "Failed to extract text from document" });
  }
});

// Get individual page breakdown for a file
router.get("/:id/pages", requireAuth, async (req, res) => {
  try {
    const pagesRes = await query(
      `SELECT id, page_number, text, visual_description, source, status, created_at, updated_at
       FROM file_pages
       WHERE file_id = $1 AND user_id = $2
       ORDER BY page_number ASC`,
      [req.params.id, req.user.id]
    );
    res.json(pagesRes.rows);
  } catch (err) {
    console.error("Error fetching file pages:", err);
    res.status(500).json({ error: "Failed to fetch file pages" });
  }
});

// Toggle favorite status for a document
router.patch("/:id/favorite", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const fileId = req.params.id;
  try {
    const updated = await toggleFileFavorite(userId, fileId);
    if (!updated) {
      return res.status(404).json({ error: "File not found." });
    }
    res.json({
      message: updated.is_favorite ? "Added to Favorites" : "Removed from Favorites",
      file: updated,
    });
  } catch (err) {
    console.error("Error toggling favorite:", err);
    res.status(500).json({ error: "Failed to update favorite status" });
  }
});

export default router;
