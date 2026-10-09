import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { chatLimiter } from "../middleware/rateLimiter.js";
import {
  getUserChats,
  getChatMessages,
  getChatById,
  deleteLastAiMessage,
  saveMessage,
  createChat,
  updateChatTitle,
  deleteChat
} from "../services/chatService.js";
import { chatWithAI, generateChatTitle } from "../services/aiService.js";
import { getUserById, getFileRecord } from "../services/fileService.js";
import { downloadFileBuffer } from "../services/driveService.js";
import { extractTextFromBuffer } from "../services/extractionService.js";

const router = Router();

const COMMAND_EXPANSIONS = {
  "/summary": "Summarize the core concepts, key formulas, and exam takeaways from this material:",
  "/quiz": "Generate 5 practice exam questions with detailed answer keys based on this material:",
  "/notes": "Extract structured, bulleted high-yield revision notes from this document:",
  "/formulas": "Extract all mathematical formulas, theorems, algorithms, and definitions in clear monospace blocks:",
  "/flashcards": "Create 4 high-yield flashcard pairs (Front: Concept/Question, Back: Explanation) from this material:",
};

function expandSlashCommand(text) {
  if (!text || typeof text !== "string") return text;
  const trimmed = text.trim();
  for (const [cmd, expansion] of Object.entries(COMMAND_EXPANSIONS)) {
    if (trimmed.toLowerCase().startsWith(cmd)) {
      const remainder = trimmed.slice(cmd.length).trim();
      return remainder ? `${expansion}\nSpecific focus: ${remainder}` : expansion;
    }
  }
  return text;
}

router.use(chatLimiter);

router.get("/", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const result = await getUserChats(userId);
  return res.status(200).json(result || []);
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
  const userId = req.user.id;
  const chat = await getChatById(chatId, userId);
  if (!chat) return res.status(404).json({ error: "Chat not found" });

  const messages = await getChatMessages(chatId);
  return res.status(200).json(messages);
});

router.delete("/:chatId", requireAuth, async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const userId = req.user.id;
    const chat = await getChatById(chatId, userId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    await deleteChat(chatId, userId);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error deleting chat:", error);
    return res.status(500).json({ error: "Failed to delete chat" });
  }
});

router.post("/:chatId", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const chatId = req.params.chatId;
  const { message, isRegenerate = false } = req.body;

  try {
    const chat = await getChatById(chatId, userId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    // STEP 1: Save the user's message or clean last AI response on regenerate
    if (isRegenerate) {
      await deleteLastAiMessage(chatId);
    } else if (message) {
      await saveMessage(chatId, "user", message);
    }

    // STEP 2: Fetch the entire chat history
    const history = await getChatMessages(chatId);

    // --- STEP 2.5: BACKGROUND TITLE GENERATION ---
    if (!isRegenerate && history.length === 1 && message) {
      // Fire-and-forget! We don't await this so it doesn't slow down the response
      generateChatTitle(message).then(async (title) => {
        console.log(`Auto-generated title: ${title}`);
        await updateChatTitle(chatId, title);
      }).catch(err => console.error("Failed to generate title", err));
    }

    // STEP 3: Format the history for OpenRouter (Map "ai" to "assistant", expand slash commands)
    const formattedHistory = history.map((msg) => ({
      role: msg.role === "ai" ? "assistant" : "user",
      content: msg.role === "user" ? expandSlashCommand(msg.content) : msg.content,
    }));

    const { mentionedFileIds, groundingMode = "strict", scope = "document" } = req.body;
    let combinedFileText = "";
    const attachedContextNotes = [];

    // --- STEP 3.5: THE MIDDLEMAN INJECTION WITH CONTEXT NOTES ---
    if (mentionedFileIds && mentionedFileIds.length > 0) {
      console.log(
        `User mentioned ${mentionedFileIds.length} files. Downloading and reading...`,
      );
      try {
        const user = await getUserById(userId);
        for (const fileId of mentionedFileIds.slice(0, 5)) {
          try {
            const fileRecord = await getFileRecord(userId, fileId);
            if (!fileRecord) continue;

            let noteInfo = "";
            if (fileRecord.context_note) {
              noteInfo = `\n[Pinned Student/Professor Context Note for "${fileRecord.original_name}"]: "${fileRecord.context_note}"\n`;
              attachedContextNotes.push({
                fileId: fileRecord.id,
                fileName: fileRecord.original_name,
                note: fileRecord.context_note,
              });
            }

            let text = fileRecord.extracted_text;
            if (!text) {
              const buffer = await downloadFileBuffer(
                user.google_refresh_token,
                fileRecord.drive_file_id,
              );
              text = await extractTextFromBuffer(buffer, fileRecord.mime_type);
            }

            // Limit text per file to 25k characters to prevent token overflow
            const truncatedText = text ? text.slice(0, 25000) : "No text content extracted.";
            combinedFileText += `\n--- Document: "${fileRecord.original_name}" ---\n${noteInfo}${truncatedText}\n`;
          } catch (fileErr) {
            console.warn(`Error processing file ${fileId} for chat:`, fileErr.message);
          }
        }
      } catch (authErr) {
        console.warn("Error fetching user for Drive download:", authErr.message);
      }
    }

    const systemPrompt = `You are the Intelligence Assistant for Personal Library — an advanced academic knowledge and document intelligence engine.
Your purpose is to help students understand, analyze, and master their course materials, textbook slides, and exam context notes.

GROUNDING & REASONING GUIDELINES:
- Use the provided documents and context notes as primary ground truth.
- Provide comprehensive explanations, step-by-step reasoning, architectural breakdowns, formulas, and connections between concepts.
- Include clear source citations in brackets (e.g. [Slide 18] or [Source: Document Name]) when referencing specific document facts.
- If a specific detail is not found in the documents, state what is missing while providing helpful academic guidance.

SPECIAL INSTRUCTIONS:
1. INTERNAL REASONING: Always prefix your response with an internal reasoning summary enclosed in <thinking>...</thinking> tags. Describe what you retrieved, analyzed, and synthesized, including a simulated timer (e.g., <thinking>Reasoned through congestion control mechanisms, rwnd buffer allocation, and professor notes (1.2s)</thinking>).
2. CONTEXT NOTES HIGHLIGHT: If the document has a pinned context note (especially professor exam tips, warnings, or study notes) that relates to the user's question, call it out using:
> 📌 **Pinned Context Match:** "exact text or quote of note"
3. FORMULAS & CODE: Format mathematical equations or protocol formulas in clean monospace code blocks with a title comment.
4. Keep the output beautifully structured, sharp, concise, and pedagogical.`;

    formattedHistory.unshift({
      role: "system",
      content: `${systemPrompt}${
        combinedFileText
          ? `\n\nATTACHED DOCUMENTS AND CONTEXT NOTES:\n${combinedFileText}`
          : "\n\n(No documents attached for this conversation. Rely on general file intelligence principles.)"
      }`,
    });

    // STEP 4: Send the history to the LLM
    const aiResponseText = await chatWithAI(formattedHistory);

    // STEP 5: Save the AI's response to the DB
    const savedAiMessage = await saveMessage(chatId, "ai", aiResponseText);

    // STEP 6: Return the AI's message to the frontend
    return res.status(200).json({
      ...savedAiMessage,
      attachedContextNotes,
    });
  } catch (error) {
    console.error("Chat Error:", error);
    return res.status(500).json({ error: "AI failed to respond" });
  }
});

export default router;
