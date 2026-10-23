import { PDFParse } from "pdf-parse";
import { env } from "../config/env.js";
import { getActiveKeyForUser } from "./keyService.js";

/**
 * Tier 1: Local digital PDF text extraction (< 30ms) with configurable timeout & limits
 */
async function extractFromDigitalPdf(buffer) {
  try {
    const parsePromise = (async () => {
      const parser = new PDFParse({ data: buffer });
      // Extract up to configured page limit (default: 100)
      const result = await parser.getText({ first: env.MAX_PDF_PAGES });
      await parser.destroy();
      return (result?.text || "").trim();
    })();

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `PDF text extraction timed out after ${env.PDF_PARSE_TIMEOUT_MS}ms`
            )
          ),
        env.PDF_PARSE_TIMEOUT_MS
      )
    );

    const text = await Promise.race([parsePromise, timeoutPromise]);
    return text.slice(0, env.MAX_EXTRACT_CHARS);
  } catch (err) {
    console.warn("⚠️ Tier 1 (pdf-parse) failed:", err.message);
    return "";
  }
}

/**
 * Tier 2A: OpenRouter Vision OCR (Fast, robust gpt-4o-mini endpoint)
 */
export async function extractWithOpenRouterVision(buffer, mimeType, userId = null, customPrompt = null) {
  let apiKey = process.env.OPENROUTER_API_KEY;
  if (userId) {
    try {
      const active = await getActiveKeyForUser(userId, "openrouter");
      if (active.key) apiKey = active.key;
    } catch (_) {}
  }
  if (!apiKey) return "";

  try {
    const base64Data = buffer.toString("base64");
    const mime = mimeType || "image/jpeg";
    const dataUrl = `data:${mime};base64,${base64Data}`;
    const promptText =
      customPrompt ||
      "Transcribe all readable text, headings, numbers, and notes from this image accurately. Output only the transcribed text without conversational commentary.";

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
                text: promptText,
              },
              {
                type: "image_url",
                image_url: { url: dataUrl },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(env.OCR_PAGE_TIMEOUT_MS || 15000),
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
  if (trimmed.length < 35 && (/^(--\s*\d+\s*(of|\/)\s*\d+\s*--|page\s*\d+(\s*(of|\/)\s*\d+)?|\d+\s*\/\s*\d+)$/i.test(trimmed) || trimmed.length < 15)) {
    return true;
  }
  return false;
}

/**
 * Tier 2B: Google Gemini Vision OCR (with model fallback for high-demand spikes)
 */
export async function extractWithGeminiVision(buffer, mimeType, userId = null, customPrompt = null) {
  let apiKey = process.env.GEMINI_API_KEY;
  if (userId) {
    try {
      const active = await getActiveKeyForUser(userId, "gemini");
      if (active.key) apiKey = active.key;
    } catch (_) {}
  }
  if (!apiKey) {
    console.warn("⚠️ No GEMINI_API_KEY configured for Vision OCR.");
    return "";
  }

  const candidateModels = [
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
    "gemini-3.8-flash",
  ];
  const base64Data = buffer.toString("base64");
  const promptText =
    customPrompt ||
    "Transcribe all readable text, exam questions, headings, formulas, and notes from this document accurately. Output only the transcribed text without extra commentary.";

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
                  text: promptText,
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
        signal: AbortSignal.timeout(env.OCR_PAGE_TIMEOUT_MS || 15000),
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
  userId = null,
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
    return buffer.subarray(0, env.MAX_EXTRACT_CHARS).toString("utf-8").trim();
  }

  // Case 2: PDF Document
  if (mime.includes("pdf") || name.endsWith(".pdf")) {
    const { stripBoilerplateText, isGarbageTextLayer } = await import("./pdfPageClassifier.js");
    let text = await extractFromDigitalPdf(buffer);
    const cleaned = stripBoilerplateText(text);

    // If substantial non-boilerplate digital text exists
    if (cleaned && cleaned.replace(/[^a-zA-Z0-9]/g, "").length >= env.PDF_MIN_PAGE_CHARS && !isGarbageTextLayer(cleaned)) {
      return cleaned.slice(0, env.MAX_EXTRACT_CHARS);
    }

    // Otherwise fallback to Vision OCR on first page render
    console.log(`📄 Document "${fileName}" contains no substantial digital text layer. Invoking Vision OCR...`);
    try {
      const { renderPdfPageToBuffer } = await import("./pdfRenderer.js");
      const pagePng = await renderPdfPageToBuffer(buffer, 1);
      const visionText =
        (await extractWithOpenRouterVision(pagePng, "image/png", userId)) ||
        (await extractWithGeminiVision(pagePng, "image/png", userId));
      return (visionText || cleaned || text || "").slice(0, env.MAX_EXTRACT_CHARS);
    } catch (renderErr) {
      console.warn(`⚠️ PDF page rendering failed for "${fileName}":`, renderErr.message);
      const fallbackVision = await extractWithGeminiVision(buffer, "application/pdf", userId);
      return (fallbackVision || cleaned || text || "").slice(0, env.MAX_EXTRACT_CHARS);
    }
  }

  // Case 3: Images (PNG, JPG, WebP)
  if (mime.includes("image") || name.match(/\.(png|jpg|jpeg|webp)$/)) {
    let visionText = await extractWithOpenRouterVision(buffer, mime || "image/jpeg", userId);
    if (!visionText) {
      visionText = await extractWithGeminiVision(buffer, mime || "image/jpeg", userId);
    }
    return (visionText || "").slice(0, env.MAX_EXTRACT_CHARS);
  }

  return "";
}
