import { GoogleGenAI } from "@google/genai";

// Initialize the SDK with the key from your .env file
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Retries an async function with exponential backoff if it fails.
 * This completely solves the "Service is Busy" error!
 */
async function withRetry(fn, retries = 3, delay = 2000) {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) throw error;
    console.log(`AI busy or failed. Retrying in ${delay}ms...`);
    await new Promise((res) => setTimeout(res, delay));
    return withRetry(fn, retries - 1, delay * 2); // Wait 2s, then 4s, then 8s
  }
}

/**
 * Asks Gemini to categorize a file based on its metadata and user note.
 */
export async function categorizeFile(
  fileName,
  mimeType,
  contextNote,
  existingFolders,
) {
  // 1. Convert the array of existing folders into a comma-separated string
  const folderNames = existingFolders.map((f) => f.name).join(", ");

  // 2. YOUR JOB: Write a strict system prompt!
  // Tell it to look at the filename, mimetype, and context note.
  // Tell it to pick an exact folder from the `folderNames` list, OR suggest a new one.

  // also we can add an others folder so if nothing is returned then we consider it in others fodler
  const prompt = `
    You are an AI file organizer.
    You look at the filetype, mimetype and user note and the filename
    and decide which folder it belongs to. i have given you exact list of folders that exixt in my app, you need to either tell me which folder fits it best or tell me a new folder name if none of them fit it. If you think it doesnt belong to any folder, then return null for both chosenExistingFolder and suggestedNewFolder. Don't give a folder name that is similar to any existing folder.
    
    File Name: ${fileName}
    Mime Type: ${mimeType}
    Context Note: ${contextNote || "None"}
    Existing Folders: ${folderNames}
  `;

  // 3. We call Gemini inside our safety wrapper
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        // This is the magic! We FORCE the AI to return this exact JSON structure
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            chosenExistingFolder: {
              type: "STRING",
              description:
                "The exact name of the folder from the list, or null if none fit.",
            },
            suggestedNewFolder: {
              type: "STRING",
              description:
                "A short, 1-3 word name for a new folder if none fit, or null.",
            },
          },
        },
      },
    });

    // Parse the JSON string back into a JavaScript object
    return JSON.parse(response.text);
  });
}
