import pdf from "pdf-parse";

export async function extractTextFromBuffer(buffer) {
  try {
    const data = await pdf(buffer);
    const text = data.text.trim();

    // Here is our Fallback pipeline check!
    if (!text || text.length < 20) {
      console.log("Looks like a scanned PDF! (We will add OCR here later)");
      return "[SCANNED PDF - OCR NOT YET CONFIGURED]";
    }

    return text;
  } catch (error) {
    console.error("Error extracting text:", error);
    return "[ERROR EXTRACTING TEXT]";
  }
}
