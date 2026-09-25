import express from "express";
import multer from "multer";
import { requireAuth } from "../middleware/authMiddleware.js";
import { uploadFileToDrive } from "../services/driveService.js";
import { getUserById, saveFileRecord, getFilesByUser } from "../services/fileService.js";

const router = express.Router();
// Use memory storage for multer since we stream to Drive
const upload = multer({ storage: multer.memoryStorage() });

// Upload a file
router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const userId = req.user.id;
    const { contextNote } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    // 1. Get user's Google refresh token
    const user = await getUserById(userId);
    if (!user || !user.google_refresh_token) {
      return res.status(401).json({ error: "User or Google Refresh Token not found." });
    }

    // 2. Upload to Google Drive
    const driveMetadata = await uploadFileToDrive(user.google_refresh_token, file);

    // 3. Save to database
    const fileRecord = await saveFileRecord(userId, driveMetadata, file, contextNote);

    res.status(201).json({
      message: "File uploaded successfully",
      file: fileRecord,
      driveLink: driveMetadata.webViewLink
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to upload file." });
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

export default router;
