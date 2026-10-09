import express from "express";
import multer from "multer";
import { requireAuth } from "../middleware/authMiddleware.js";
import { uploadLimiter } from "../middleware/rateLimiter.js";
import { uploadFileToDrive, deleteFileFromDrive, getDriveFolders, createDriveFolder, downloadFileBuffer } from "../services/driveService.js";
import { getUserById, saveFileRecord, getFilesByUser, deleteFileRecord, getFileRecord, deleteFilesByFolder, getFilesByFolder, updateFileContextNote, updateFileExtractedText } from "../services/fileService.js";
import { categorizeFilesBulk } from "../services/aiService.js";
import { syncUserWithDrive } from "../services/syncService.js";
import { extractDocumentText } from "../services/ocrService.js";

const router = express.Router();
// Use memory storage for multer with a 50MB per-file safety limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// Upload files
router.post("/upload", requireAuth, uploadLimiter, upload.array("files"), async (req, res) => {
  if (!req.files || req.files.length === 0){
    return res.status(400).json({ error: "No file uploaded." });
  }
  
  try {
    const userId = req.user.id;
    const { contextNote } = req.body;
    const files = req.files;

    // 1. Get user's Google refresh token
    const user = await getUserById(userId);
    if (!user || !user.google_refresh_token) {
      return res.status(401).json({ error: "User or Google Refresh Token not found." });
    }

    let existingFolders = await getDriveFolders(user.google_refresh_token);

    // 2. Prepare metadata and perform bulk AI categorization in ONE call
    const filesMetadata = files.map((file, idx) => ({
      index: idx,
      name: file.originalname,
      mimeType: file.mimetype,
    }));

    let aiResults = [];
    try {
      aiResults = await categorizeFilesBulk(
        filesMetadata,
        contextNote,
        existingFolders
      );
    } catch (aiErr) {
      console.error("Bulk categorization failed, falling back to default:", aiErr);
    }

    // Map AI results by index or fileName for fast lookup
    const resultMap = new Map();
    if (Array.isArray(aiResults)) {
      aiResults.forEach((item) => {
        if (item.index !== undefined && item.index !== null) {
          resultMap.set(Number(item.index), item);
        }
        if (item.fileName) {
          resultMap.set(item.fileName, item);
        }
      });
    }

    // 3. Pre-resolve or create any newly suggested folders so concurrent uploads don't race
    const targetFolderByFileIndex = new Map();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const aiResultFolder = resultMap.get(i) || resultMap.get(file.originalname) || {
        chosenExistingFolder: null,
        suggestedNewFolder: null,
      };

      let targetFolder = null;
      let finalFolderName = "Others";

      if (aiResultFolder.chosenExistingFolder && !aiResultFolder.suggestedNewFolder) {
        targetFolder = existingFolders.find(
          (f) => f.name.toLowerCase() === aiResultFolder.chosenExistingFolder.toLowerCase()
        );
        if (targetFolder) finalFolderName = targetFolder.name;
      }

      if (!targetFolder && aiResultFolder.suggestedNewFolder) {
        const trimmedNewName = aiResultFolder.suggestedNewFolder.trim();
        targetFolder = existingFolders.find(
          (f) => f.name.toLowerCase() === trimmedNewName.toLowerCase()
        );
        if (!targetFolder) {
          targetFolder = await createDriveFolder(user.google_refresh_token, trimmedNewName);
          existingFolders.push(targetFolder);
        }
        finalFolderName = targetFolder.name;
      }

      if (!targetFolder) {
        targetFolder = existingFolders.find((f) => f.name.toLowerCase() === "others");
        if (!targetFolder) {
          targetFolder = await createDriveFolder(user.google_refresh_token, "Others");
          existingFolders.push(targetFolder);
        }
        finalFolderName = targetFolder.name;
      }

      targetFolderByFileIndex.set(i, { targetFolder, finalFolderName });
    }

    // 4. Concurrently upload each file directly into Drive and immediately record in DB
    const uploadTasks = files.map(async (file, i) => {
      const { targetFolder, finalFolderName } = targetFolderByFileIndex.get(i);
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
          finalFolderName
        );

        return { success: true, fileRecord };
      } catch (fileErr) {
        console.error(`Failed to upload "${file.originalname}":`, fileErr);
        return {
          success: false,
          fileName: file.originalname,
          error: fileErr.message || "Upload failed",
        };
      }
    });

    const results = await Promise.all(uploadTasks);
    const savedFiles = results.filter((r) => r.success).map((r) => r.fileRecord);
    const failedFiles = results.filter((r) => !r.success).map((r) => ({ fileName: r.fileName, error: r.error }));

    if (savedFiles.length === 0 && failedFiles.length > 0) {
      return res.status(500).json({
        error: "All file uploads failed.",
        failedFiles,
      });
    }

    res.status(201).json({
      message: `${savedFiles.length} file(s) uploaded successfully${failedFiles.length > 0 ? `, ${failedFiles.length} failed` : ""}`,
      files: savedFiles,
      failedFiles,
    });

    // Asynchronous Background OCR: extract and index text without delaying the upload response
    (async () => {
      for (const file of files) {
        const saved = savedFiles.find((s) => s.original_name === file.originalname);
        if (!saved) continue;
        try {
          const text = await extractDocumentText(file.buffer, file.mimetype, file.originalname);
          if (text) {
            await updateFileExtractedText(saved.id, text, "ready");
            console.log(`[OCR Complete] Extracted ${text.length} chars for "${file.originalname}"`);
          }
        } catch (ocrErr) {
          console.warn(`[OCR Error] Background extraction failed for "${file.originalname}":`, ocrErr.message);
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

    // If text already exists and is substantive (not force-refreshed, and not boilerplate like "-- 1 of 1 --")
    if (fileRecord.extracted_text && !force && fileRecord.extracted_text.trim().length > 35) {
      return res.status(200).json({
        success: true,
        file: fileRecord,
        extractedText: fileRecord.extracted_text,
      });
    }

    // Download buffer from Google Drive & extract via ocrService
    const buffer = await downloadFileBuffer(user.google_refresh_token, fileRecord.drive_file_id);
    let text = await extractDocumentText(buffer, fileRecord.mime_type, fileRecord.original_name);

    if (!text || text.trim().length === 0) {
      text = "No readable text detected in this document.";
    }

    const updated = await updateFileExtractedText(fileRecord.id, text, "ready");
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

export default router;
