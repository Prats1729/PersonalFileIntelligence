import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

// 1. Initialize OpenAI but point it to OpenRouter!
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// A simple retry wrapper (only retries on 429 or 503)
async function withRetry(operation, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (
        (error.status === 429 || error.status === 503 || error.status === 502) &&
        i < maxRetries - 1
      ) {
        const waitTime = Math.pow(2, i + 1) * 1000;
        console.log(`OpenRouter busy (Status ${error.status}). Retrying in ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
}

export async function categorizeFilesBulk(
  files,
  contextNote,
  existingFolders
) {
  const folderNames = existingFolders.map((f) => f.name).join(", ");

  const filesListStr = files
    .map((f) => {
      const preview = f.contentSnippet
        ? ` | Content Preview: "${f.contentSnippet.replace(/\s+/g, ' ').slice(0, 400)}"`
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
    - If a file has an obscure name (e.g. "SKM_...", "Scan_...", "IMG_...", random numbers) or little readable text, ALWAYS assign it according to the Context Note (e.g. if Context Note is "AIES", choose an existing folder matching "AIES" or suggest a new folder named after the Context Note). DO NOT default to null or "Others" when a context note is provided.
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

  return withRetry(async () => {
    const response = await openai.chat.completions.create({
      model: "openrouter/auto",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;

    try {
      const parsed = JSON.parse(content);
      const items = parsed.results || parsed.files || parsed.categorizations || (Array.isArray(parsed) ? parsed : []);
      return items;
    } catch (e) {
      console.error("Failed to parse bulk AI JSON:", content);
      return [];
    }
  });
}

export async function chatWithAI(messages) {
  return withRetry(async () => {
    const response = await openai.chat.completions.create({
      model: "openrouter/auto",
      messages: messages, 
      // Optional: Add instructions here if you want the bot to behave differently
    });
    return response.choices[0].message.content;
  });
}

export async function generateChatTitle(firstMessage) {
  return withRetry(async () => {
    const response = await openai.chat.completions.create({
      model: "openrouter/auto",
      messages: [
        { role: "system", content: "You are a helpful assistant. Generate a very short, concise title (max 4 words) summarizing the user's message. DO NOT wrap the title in quotes. Respond with ONLY the title and nothing else." },
        { role: "user", content: firstMessage }
      ],
    });
    return response.choices[0].message.content.trim();
  });
}

