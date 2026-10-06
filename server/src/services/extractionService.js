import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

export async function extractTextFromBuffer(buffer, mimeType = "") {
  if (!buffer || buffer.length === 0) {
    return "";
  }

  const normalizedMime = (mimeType || "").toLowerCase();

  // 1. Plain text / Markdown / Code / JSON / CSV files
  if (
    normalizedMime.startsWith("text/") ||
    normalizedMime === "application/json" ||
    normalizedMime === "application/javascript" ||
    normalizedMime === "application/xml" ||
    normalizedMime === "application/x-yaml"
  ) {
    try {
      return buffer.toString("utf-8").trim();
    } catch (textErr) {
      console.warn("Failed to decode text file as utf-8:", textErr);
    }
  }

  // 2. Check for PDF header or PDF mimeType
  const isPdf =
    normalizedMime === "application/pdf" ||
    (buffer.length >= 4 && buffer.toString("utf-8", 0, 5).startsWith("%PDF-"));

  if (isPdf) {
    try {
      const data = await pdf(buffer);
      const text = data.text.trim();

      if (!text || text.length < 20) {
        console.log("Scanned PDF detected (OCR pipeline coming soon)");
        return "[SCANNED PDF - OCR COMING SOON]";
      }

      return text;
    } catch (pdfError) {
      console.error("Error extracting text from PDF:", pdfError.message);
      return "[PDF EXTRACTION FAILED]";
    }
  }

  // 3. Fallback: Check if file looks like plain ASCII/UTF-8 text
  try {
    const sample = buffer.slice(0, Math.min(buffer.length, 1024));
    let hasNull = false;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) {
        hasNull = true;
        break;
      }
    }
    if (!hasNull) {
      const decoded = buffer.toString("utf-8").trim();
      if (decoded.length > 0) return decoded;
    }
  } catch (err) {
    // Ignore fallback decode error
  }

  return "[Binary/Unsupported format - Text extraction coming soon]";
}
