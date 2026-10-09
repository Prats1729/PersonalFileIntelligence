import { PDFParse } from "pdf-parse";

const MAX_TEXT_CHARS = 50000; // Cap to ~25 pages of dense text

/**
 * Tier 1: Local digital PDF text extraction (< 30ms)
 */
async function extractFromDigitalPdf(buffer) {
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return (result?.text || "").trim();
  } catch (err) {
    console.warn(
      "⚠️ Tier 1 (pdf-parse) failed:",
      err.message,
    );
    return "";
  }
}

/**
 * Tier 2A: OpenRouter Vision OCR (Fast, robust gpt-4o-mini endpoint)
 */
async function extractWithOpenRouterVision(buffer, mimeType) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return "";

  try {
    const base64Data = buffer.toString("base64");
    const mime = mimeType || "image/jpeg";
    const dataUrl = `data:${mime};base64,${base64Data}`;

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe all readable text, headings, numbers, and notes from this image accurately. Output only the transcribed text without conversational commentary.",
              },
              {
                type: "image_url",
                image_url: { url: dataUrl },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`⚠️ OpenRouter Vision HTTP ${res.status}`);
      return "";
    }

    const data = await res.json();
    const result = data?.choices?.[0]?.message?.content?.trim() || "";
    return result === "NO_TEXT" ? "" : result;
  } catch (err) {
    console.warn("⚠️ OpenRouter Vision error:", err.message);
    return "";
  }
}

/**
 * Helper to identify scanner/photocopier watermarks like "-- 1 of 1 --"
 */
function isBoilerplateScannerText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length < 35 && (/^(--\s*\d+\s*of\s*\d+\s*--|page\s*\d+(\s*of\s*\d+)?|\d+\s*\/\s*\d+)$/i.test(trimmed) || trimmed.length < 15)) {
    return true;
  }
  return false;
}

/**
 * Tier 2B: Google Gemini Vision OCR (with model fallback for high-demand spikes)
 */
async function extractWithGeminiVision(buffer, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ No GEMINI_API_KEY configured for Vision OCR.");
    return "";
  }

  const candidateModels = [
    "gemini-flash-latest",
    "gemini-2.5-flash-lite",
    "gemini-flash-lite-latest",
  ];
  const base64Data = buffer.toString("base64");

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Transcribe all readable text, exam questions, headings, formulas, and notes from this document accurately. Output only the transcribed text without extra commentary.",
                },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        console.warn(`⚠️ Gemini Vision (${model}) HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      const extracted = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      if (extracted) {
        return extracted;
      }
    } catch (err) {
      console.warn(`⚠️ Gemini Vision (${model}) failed:`, err.message);
    }
  }

  return "";
}

/**
 * Primary Ingestion Entry Point
 */
export async function extractDocumentText(
  buffer,
  mimeType = "",
  fileName = "",
) {
  if (!buffer || buffer.length === 0) return "";

  const mime = (mimeType || "").toLowerCase();
  const name = (fileName || "").toLowerCase();

  // Case 1: Plain text / Code / JSON / CSV (Safe bounded slice)
  if (
    mime.includes("text") ||
    mime.includes("json") ||
    mime.includes("csv") ||
    name.endsWith(".txt") ||
    name.endsWith(".json") ||
    name.endsWith(".csv") ||
    name.endsWith(".md")
  ) {
    return buffer.subarray(0, MAX_TEXT_CHARS).toString("utf-8").trim();
  }

  // Case 2: PDF Document
  if (mime.includes("pdf") || name.endsWith(".pdf")) {
    // Step A: Fast Tier 1 Local parse (< 30ms)
    let text = await extractFromDigitalPdf(buffer);

    // If substantial digital text exists (not just scanner footer like "-- 1 of 1 --")
    if (text && !isBoilerplateScannerText(text)) {
      return text.slice(0, MAX_TEXT_CHARS);
    }

    // Step B: For scans or boilerplate-only PDFs, attempt Vision OCR
    console.log(
      `📄 Document "${fileName}" contains no substantial digital text layer. Invoking Vision OCR...`,
    );
    const visionText = await extractWithGeminiVision(buffer, "application/pdf");
    return (visionText || text || "").slice(0, MAX_TEXT_CHARS);
  }

  // Case 3: Images (PNG, JPG, WebP)
  if (mime.includes("image") || name.match(/\.(png|jpg|jpeg|webp)$/)) {
    // Try OpenRouter gpt-4o-mini vision first
    let visionText = await extractWithOpenRouterVision(buffer, mime || "image/jpeg");
    if (!visionText) {
      visionText = await extractWithGeminiVision(buffer, mime || "image/jpeg");
    }
    return (visionText || "").slice(0, MAX_TEXT_CHARS);
  }

  return "";
}
