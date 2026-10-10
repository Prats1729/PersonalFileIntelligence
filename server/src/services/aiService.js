import OpenAI from "openai";
import { env } from "../config/env.js";
import { getActiveKeyForUser, enforceDailyFreeQuota } from "./keyService.js";
import { AppError } from "../middleware/errorHandler.js";

const MAX_TEXT_INPUT_CHARS = 40000;

// Helper to get an OpenAI client for a specific key with hard timeout
const getOpenRouterClient = (apiKey) => {
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: apiKey,
    timeout: 45000, // 45 seconds timeout
  });
};

// Retry wrapper with jittered exponential backoff on transient errors (429, 502, 503)
async function withRetry(operation, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      const isTransient =
        error.status === 429 || error.status === 503 || error.status === 502;
      if (isTransient && i < maxRetries - 1) {
        // Add full jitter (0 to 500ms) to prevent thundering herd
        const jitter = Math.floor(Math.random() * 500);
        const waitTime = Math.pow(2, i + 1) * 1000 + jitter;
        console.warn(`OpenRouter busy (Status ${error.status}). Retrying in ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Resolves API key for the user, enforces daily quota for free server keys,
 * and returns initialized OpenAI client.
 */
async function resolveAiClient(userId, { enforceQuota = true, callCount = 1 } = {}) {
  let key = env.OPENROUTER_API_KEY;
  let isCustom = false;

  if (userId) {
    const keyInfo = await getActiveKeyForUser(userId, "openrouter");
    key = keyInfo.key;
    isCustom = keyInfo.isCustom;
  }

  if (!key) {
    throw new AppError(
      "No OpenRouter API key configured. Please add your API key in Settings to continue.",
      400,
      "MISSING_API_KEY"
    );
  }

  // If using the shared server key, enforce the per-user daily quota atomically
  if (!isCustom && userId && enforceQuota) {
    await enforceDailyFreeQuota(userId, callCount);
  }

  return getOpenRouterClient(key);
}

export async function categorizeFilesBulk(
  files,
  contextNote,
  existingFolders,
  userId = null
) {
  const folderNames = existingFolders.map((f) => f.name).join(", ");

  const filesListStr = files
    .map((f) => {
      const preview = f.contentSnippet
        ? ` | Content Preview: "${f.contentSnippet.replace(/\s+/g, " ").slice(0, 400)}"`
        : "";
      return `File Index ${f.index}: Name: "${f.name}", MimeType: "${f.mimeType}"${preview}`;
    })
    .join("\n");

  const systemPrompt = `
    You are an academic document and file organizer.
    You will receive a list of files (with index, name, mime type, and document text content preview) and an optional user context note.
    Your job is to decide which academic folder/category each file belongs to based on its document content, topics, and filename.
    Existing folders: ${folderNames || "None"}

    Rules:
    - If the user provides a Context Note (e.g. "AIES", "Maths", "PYQs"), treat it as high-priority ground truth.
    - If a file has an obscure name (e.g. "SKM_...", "Scan_...", "IMG_...", random numbers) or little readable text, ALWAYS assign it according to the Context Note. DO NOT default to null or "Others" when a context note is provided.
    - For each file, choose an existing folder if it fits best, or suggest a concise new folder name (e.g. "Computer Networks", "PYQs", "Operating Systems", "Mathematics") if none fit.
    - If multiple files in this batch belong to the same new category, suggest the exact same suggestedNewFolder name for all of them.
  `;

  const userPrompt = `
    Context Note: ${contextNote || "None"}

    Files to categorize:
${filesListStr}

    IMPORTANT: You must return ONLY a raw JSON object with a "results" array. No markdown formatting, no backticks.
    Each item in "results" must contain:
    - "index": the numeric index of the file
    - "fileName": the name of the file
    - "chosenExistingFolder": string or null
    - "suggestedNewFolder": string or null

    Example:
    {
      "results": [
        { "index": 0, "fileName": "lecture1.pdf", "chosenExistingFolder": "Math", "suggestedNewFolder": null },
        { "index": 1, "fileName": "tax_2025.pdf", "chosenExistingFolder": null, "suggestedNewFolder": "Finance" }
      ]
    }
  `;

  const client = await resolveAiClient(userId, {
    enforceQuota: true,
    callCount: Math.max(1, files?.length || 1),
  });

  return withRetry(async () => {
    const response = await client.chat.completions.create({
      model: "openrouter/auto",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;

    try {
      const parsed = JSON.parse(content);
      return (
        parsed.results ||
        parsed.files ||
        parsed.categorizations ||
        (Array.isArray(parsed) ? parsed : [])
      );
    } catch (e) {
      console.error("Failed to parse bulk AI JSON:", content);
      return [];
    }
  });
}

export async function chatWithAI(messages, userId = null) {
  const client = await resolveAiClient(userId, { enforceQuota: true, callCount: 1 });

  // Bound overall text payload size to avoid token overrun / DOS
  let currentTotal = 0;
  const boundedMessages = messages.map((m) => {
    const raw = typeof m.content === "string" ? m.content : "";
    if (currentTotal + raw.length > MAX_TEXT_INPUT_CHARS) {
      const allowed = Math.max(0, MAX_TEXT_INPUT_CHARS - currentTotal);
      currentTotal += allowed;
      return { ...m, content: raw.slice(0, allowed) };
    }
    currentTotal += raw.length;
    return m;
  });

  return withRetry(async () => {
    const response = await client.chat.completions.create({
      model: "openrouter/auto",
      messages: boundedMessages,
    });
    return response.choices[0].message.content;
  });
}

export async function generateChatTitle(firstMessage, userId = null) {
  // Free server quota is NOT deducted for tiny automatic title summarization
  const client = await resolveAiClient(userId, { enforceQuota: false });

  return withRetry(async () => {
    const response = await client.chat.completions.create({
      model: "openrouter/auto",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant. Generate a very short, concise title (max 4 words) summarizing the user's message. DO NOT wrap the title in quotes. Respond with ONLY the title and nothing else.",
        },
        { role: "user", content: firstMessage },
      ],
    });
    return response.choices[0].message.content.trim();
  });
}
