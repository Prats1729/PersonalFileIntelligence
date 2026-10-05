import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  getUserChats,
  getChatMessages,
  saveMessage,
  createChat,
} from "../services/chatService.js";
import { chatWithAI } from "../services/aiService.js";
import { getUserById, getFileRecord } from "../services/fileService.js";
import { downloadFileBuffer } from "../services/driveService.js";
import { extractTextFromBuffer } from "../services/extractionService.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const result = await getUserChats(userId);
  if (!result) return res.status(404).json({ error: "No chats found" });
  return res.status(200).json(result);
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const chat = await createChat(userId, "New Chat");
    return res.status(201).json(chat);
  } catch (error) {
    console.error("Error creating chat:", error);
    return res.status(500).json({ error: "Failed to create chat" });
  }
});

router.get("/:chatId", requireAuth, async (req, res) => {
  const chatId = req.params.chatId;
  const chat = await getChatMessages(chatId);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  return res.status(200).json(chat);
});

router.post("/:chatId", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const chatId = req.params.chatId;
  const { message } = req.body;

  try {
    // STEP 1: Save the user's message
    await saveMessage(chatId, "user", message);

    // STEP 2: Fetch the entire chat history
    const history = await getChatMessages(chatId);

    // STEP 3: Format the history for OpenRouter (Map "ai" to "assistant")
    const formattedHistory = history.map((msg) => ({
      role: msg.role === "ai" ? "assistant" : "user",
      content: msg.content,
    }));

    const { mentionedFileIds } = req.body;
    // --- STEP 3.5: THE MIDDLEMAN INJECTION ---
    if (mentionedFileIds && mentionedFileIds.length > 0) {
      console.log(
        `User mentioned ${mentionedFileIds.length} files. Downloading...`,
      );
      const user = await getUserById(userId);
      let combinedFileText = "";
      for (const fileId of mentionedFileIds) {
        // Fetch from DB to get the Google Drive ID
        const fileRecord = await getFileRecord(userId, fileId);
        if (!fileRecord) continue;
        // 1. Download buffer
        const buffer = await downloadFileBuffer(
          user.google_refresh_token,
          fileRecord.drive_file_id,
        );
        // 2. Extract Text
        const text = await extractTextFromBuffer(buffer);

        combinedFileText += `\n--- Contents of ${fileRecord.original_name} ---\n${text}`;
      }
      // 3. Inject it into the AI's history as a System message at the very top!
      formattedHistory.unshift({
        role: "system",
        content: `You have been provided the following files. Use them to answer the user's questions:\n${combinedFileText}`,
      });
    }

    // STEP 4: Send the history to the LLM
    const aiResponseText = await chatWithAI(formattedHistory);

    // STEP 5: Save the AI's response to the DB
    const savedAiMessage = await saveMessage(chatId, "ai", aiResponseText);

    // STEP 6: Return the AI's message to the frontend
    return res.status(200).json(savedAiMessage);
  } catch (error) {
    console.error("Chat Error:", error);
    return res.status(500).json({ error: "AI failed to respond" });
  }
});

export default router;
