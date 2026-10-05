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

export async function categorizeFile(
  fileName,
  mimeType,
  contextNote,
  existingFolders
) {
  const folderNames = existingFolders.map((f) => f.name).join(", ");

  const systemPrompt = `
    You are an AI file organizer.
    You look at the filetype, mimetype and user note and the filename
    and decide which folder it belongs to. i have given you exact list of folders that exixt in my app, you need to either tell me which folder fits it best or tell me a new folder name if none of them fit it. If you think it doesnt belong to any folder, then return null for both chosenExistingFolder and suggestedNewFolder. Don't give a folder name that is similar to any existing folder.
    
    Existing Folders: ${folderNames}
  `;

  const userPrompt = `
    File Name: ${fileName}
    Mime Type: ${mimeType}
    Context Note: ${contextNote || "None"}
    
    IMPORTANT: You must return ONLY a raw JSON object and nothing else. No markdown formatting, no backticks.
    Example: {"chosenExistingFolder": "Math", "suggestedNewFolder": null}
  `;

  return withRetry(async () => {
    const response = await openai.chat.completions.create({
      model: "openrouter/auto", // OpenRouter's automatic free router
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }, // Forces JSON output
    });

    const content = response.choices[0].message.content;
    
    try {
      return JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse AI JSON:", content);
      return { chosenExistingFolder: null, suggestedNewFolder: "AI Needs Review" };
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

