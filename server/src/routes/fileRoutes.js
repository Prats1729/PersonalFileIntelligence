import express from "express";
import multer from "multer";
import { requireAuth } from "../middleware/authMiddleware.js";
import { uploadFileToDrive, deleteFileFromDrive, getDriveFolders, createDriveFolder, moveFileToFolder } from "../services/driveService.js";
import { getUserById, saveFileRecord, getFilesByUser, deleteFileRecord, getFileRecord } from "../services/fileService.js";
import {categorizeFile} from "../services/aiService.js"

const router = express.Router();
// Use memory storage for multer since we stream to Drive
const upload = multer({ storage: multer.memoryStorage() });

// Upload a file
router.post("/upload", requireAuth, upload.array("files"), async (req, res) => {
  if (req.files.length === 0){
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

    const savedFiles = [];
    let existingFolders = await getDriveFolders(user.google_refresh_token);

    for await (const file of req.files){
      // 2. Upload to Google Drive
      const driveMetadata = await uploadFileToDrive(user.google_refresh_token, file);
      // 3. Save to database
      const fileRecord = await saveFileRecord(userId, driveMetadata, file, contextNote);
      savedFiles.push(fileRecord);

      const aiResultFolder = await categorizeFile(
        file.originalname,
        file.mimetype,
        contextNote,
        existingFolders
      );

      // handling 3 main scenarios

      // if the folder does exist in the preexisting array
      if (
        aiResultFolder.chosenExistingFolder &&
        !aiResultFolder.suggestedNewFolder &&
        existingFolders.find(
          (f) => f.name === aiResultFolder.chosenExistingFolder,
        )
      ) {
        const folder = existingFolders.find(
          (f) => f.name === aiResultFolder.chosenExistingFolder,
        );

        await moveFileToFolder(
          user.google_refresh_token,
          driveMetadata.id,
          folder.id,
        );
      }
      // if it suggests new folder
      else if (aiResultFolder.suggestedNewFolder) {
        const folder = await createDriveFolder(
          user.google_refresh_token,
          aiResultFolder.suggestedNewFolder,
        );
        await moveFileToFolder(
          user.google_refresh_token,
          driveMetadata.id,
          folder.id,
        );
        // add the folder to our list so it is available for the next iteration
        existingFolders.push(folder);
      }
      // if the file doesn't belong to any folder, create an others folder
      else {
        if (existingFolders.find((f) => f.name === "Others")) {
          const folder = existingFolders.find((f) => f.name === "Others");
          await moveFileToFolder(
            user.google_refresh_token,
            driveMetadata.id,
            folder.id,
          );
        } else {
          const folder = await createDriveFolder(
            user.google_refresh_token,
            "Others",
          );
          await moveFileToFolder(
            user.google_refresh_token,
            driveMetadata.id,
            folder.id,
          );
          existingFolders.push(folder);
        }
      }
    }

    res.status(201).json({
      message: `${savedFiles.length} file(s) uploaded successfully`,
      files: savedFiles,
    })
    
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
