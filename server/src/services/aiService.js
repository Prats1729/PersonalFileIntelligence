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
export async function resolveAiClient(userId, { enforceQuota = true, callCount = 1 } = {}) {
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
      max_tokens: 1500,
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

export async function callGeminiChat(messages, userId = null) {
  let apiKey = env.GEMINI_API_KEY;
  if (userId) {
    try {
      const active = await getActiveKeyForUser(userId, "gemini");
      if (active.key) apiKey = active.key;
    } catch (_) {}
  }
  if (!apiKey) {
    throw new AppError("No Gemini API key available for fallback.", 500, "MISSING_GEMINI_KEY");
  }

  const contents = [];
  let systemInstruction = "";

  for (const m of messages) {
    if (m.role === "system") {
      systemInstruction += (systemInstruction ? "\n\n" : "") + m.content;
    } else {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content || "" }],
      });
    }
  }

  if (contents.length === 0 || contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "Hello" }] });
  }

  const payload = { contents };
  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const candidateModels = ["gemini-3.5-flash", "gemini-3-flash-preview"];
  for (const model of candidateModels) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(25000),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (reply) return reply;
    } catch (err) {
      console.warn(`[Gemini Chat Fallback ${model} error]:`, err.message);
    }
  }

  throw new AppError("All Gemini fallback models failed.", 500, "GEMINI_FALLBACK_FAILED");
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

  try {
    return await withRetry(async () => {
      const response = await client.chat.completions.create({
        model: "openrouter/auto",
        messages: boundedMessages,
        max_tokens: 2048,
      });
      return response.choices[0].message.content;
    });
  } catch (err) {
    // If OpenRouter has insufficient credits (402) or upstream fails, gracefully fall back to Gemini
    if (err.status === 402 || err.message?.includes("402") || err.status >= 500) {
      console.warn(`[OpenRouter Chat Fallback]: ${err.message}. Falling back to Google Gemini...`);
      return await callGeminiChat(boundedMessages, userId);
    }
    throw err;
  }
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
      max_tokens: 40,
    });
    return response.choices[0].message.content.trim();
  });
}
