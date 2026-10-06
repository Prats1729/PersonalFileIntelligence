import express from "express";
import multer from "multer";
import { requireAuth } from "../middleware/authMiddleware.js";
import { uploadFileToDrive, deleteFileFromDrive, getDriveFolders, createDriveFolder, moveFileToFolder } from "../services/driveService.js";
import { getUserById, saveFileRecord, getFilesByUser, deleteFileRecord, getFileRecord, updateFileFolder } from "../services/fileService.js";
import { categorizeFilesBulk } from "../services/aiService.js";

const router = express.Router();
// Use memory storage for multer since we stream to Drive
const upload = multer({ storage: multer.memoryStorage() });

// Upload files
router.post("/upload", requireAuth, upload.array("files"), async (req, res) => {
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

    const savedFiles = [];
    const failedFiles = [];

    // 3. Process each file with fault isolation and direct folder upload
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        const aiResultFolder = resultMap.get(i) || resultMap.get(file.originalname) || {
          chosenExistingFolder: null,
          suggestedNewFolder: null,
        };

        let targetFolder = null;
        let finalFolderName = "Others";

        // Scenario A: AI chose an existing folder
        if (
          aiResultFolder.chosenExistingFolder &&
          !aiResultFolder.suggestedNewFolder
        ) {
          targetFolder = existingFolders.find(
            (f) => f.name.toLowerCase() === aiResultFolder.chosenExistingFolder.toLowerCase()
          );
          if (targetFolder) {
            finalFolderName = targetFolder.name;
          }
        }

        // Scenario B: AI suggested a new folder
        if (!targetFolder && aiResultFolder.suggestedNewFolder) {
          const trimmedNewName = aiResultFolder.suggestedNewFolder.trim();
          // Check if created earlier in this batch
          targetFolder = existingFolders.find(
            (f) => f.name.toLowerCase() === trimmedNewName.toLowerCase()
          );
          if (!targetFolder) {
            targetFolder = await createDriveFolder(
              user.google_refresh_token,
              trimmedNewName
            );
            existingFolders.push(targetFolder);
          }
          finalFolderName = targetFolder.name;
        }

        // Scenario C: File doesn't belong to any folder -> "Others"
        if (!targetFolder) {
          targetFolder = existingFolders.find((f) => f.name.toLowerCase() === "others");
          if (!targetFolder) {
            targetFolder = await createDriveFolder(
              user.google_refresh_token,
              "Others"
            );
            existingFolders.push(targetFolder);
          }
          finalFolderName = targetFolder.name;
        }

        // 1. Upload DIRECTLY into targetFolder on Drive (eliminates 2 extra API roundtrips)
        const driveMetadata = await uploadFileToDrive(
          user.google_refresh_token,
          file,
          targetFolder ? targetFolder.id : null
        );

        // 2. Save record to DB with folder already populated (eliminates secondary update query)
        const fileRecord = await saveFileRecord(
          userId,
          driveMetadata,
          file,
          contextNote,
          finalFolderName
        );

        savedFiles.push(fileRecord);
      } catch (fileErr) {
        console.error(`Failed to upload "${file.originalname}":`, fileErr);
        failedFiles.push({
          fileName: file.originalname,
          error: fileErr.message || "Upload failed",
        });
      }
    }

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


})

export default router;
