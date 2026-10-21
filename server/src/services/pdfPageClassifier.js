import { env } from "../config/env.js";

/**
 * Strips common scanner and pagination boilerplate from page text.
 * Handles patterns such as:
 * - "-- 1 of 585 --" or "-- 1/585 --"
 * - "Page 1 of 585" or "Page 1"
 * - Bare page numbers on their own line ("1", "42")
 * - Scanner noise and watermarks
 */
export function stripBoilerplateText(text) {
  if (!text) return "";

  const lines = text.split(/\r?\n/);
  const cleanedLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Filter 1: Pagination footers like "-- 1 of 585 --", "-- 1 of 1 --", "1 of 585"
    if (/^--\s*\d+\s*(of|\/)\s*\d+\s*--$/i.test(line)) continue;
    if (/^\d+\s*of\s*\d+$/i.test(line)) continue;

    // Filter 2: "Page N of M" or "Page N"
    if (/^page\s*\d+(\s*(of|\/)\s*\d+)?$/i.test(line)) continue;

    // Filter 3: Bare digits on their own line
    if (/^\d{1,5}$/.test(line)) continue;

    // Filter 4: Common scanner application watermarks
    if (/^(camscanner|scanned with|z-library|1lib|pdfcoffee)/i.test(line)) continue;

    cleanedLines.push(rawLine);
  }

  return cleanedLines.join("\n").trim();
}

/**
 * Inspects whether the extracted text layer is corrupted, replacement-heavy,
 * or OCR garbage (gibberish symbols, broken font encoding).
 */
export function isGarbageTextLayer(text) {
  if (!text || text.length === 0) return true;

  // 1. Replacement character check (\ufffd)
  const replacementMatches = text.match(/[\ufffd\uFFFD]/g);
  if (replacementMatches && replacementMatches.length / text.length > 0.05) {
    return true; // More than 5% corrupt font glyphs
  }

  // 2. Extract alphanumeric letters
  const letters = text.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length < env.PDF_MIN_PAGE_CHARS) {
    return true;
  }

  // 3. Ratio of alphanumeric characters to total characters (excluding spaces)
  const nonSpaceTotal = text.replace(/\s/g, "").length;
  if (nonSpaceTotal === 0) return true;
  const letterRatio = letters.length / nonSpaceTotal;

  // Real academic prose typically has > 70% letters. Gibberish scanner noise often has < 45%.
  if (letterRatio < 0.45 && letters.length < 200) {
    return true;
  }

  // 4. Token & vowel distribution check
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z]/g, ""))
    .filter((w) => w.length > 1);

  if (words.length > 5) {
    let vowelsTotal = 0;
    let charsTotal = 0;
    for (const w of words) {
      const v = (w.match(/[aeiou]/gi) || []).length;
      vowelsTotal += v;
      charsTotal += w.length;
    }
    const vowelRatio = charsTotal > 0 ? vowelsTotal / charsTotal : 0;
    // Human English / academic text typically has 30% - 45% vowels.
    // Random OCR noise or broken font encoding often has < 12% or > 70%.
    if (vowelRatio < 0.12 || vowelRatio > 0.75) {
      return true;
    }
  }

  return false;
}

/**
 * Classifies a single page into:
 * - 'digital': Substantive clean text layer, no figures. Zero AI calls needed.
 * - 'needs_ocr': Missing/sparse text or corrupted/scanned layer. Full Vision OCR needed.
 * - 'has_figures': Clean digital text present, but page also contains significant images/figures.
 *                  Extract text locally + run targeted visual pass.
 */
export function classifyPage(rawPageText, imageOpCount = 0) {
  const cleaned = stripBoilerplateText(rawPageText);
  const substantiveLetters = cleaned.replace(/[^a-zA-Z0-9]/g, "");
  const substantiveCount = substantiveLetters.length;

  const isGarbage = isGarbageTextLayer(cleaned);

  // If text is below minimum threshold or garbage, it needs full Vision OCR
  if (substantiveCount < env.PDF_MIN_PAGE_CHARS || isGarbage) {
    return {
      classification: "needs_ocr",
      substantiveChars: substantiveCount,
      cleanedText: cleaned,
      hasImages: imageOpCount > 0,
      imageOpCount,
    };
  }

  // If text is healthy, check if the page has significant figures/images
  if (imageOpCount > 0) {
    return {
      classification: "has_figures",
      substantiveChars: substantiveCount,
      cleanedText: cleaned,
      hasImages: true,
      imageOpCount,
    };
  }

  // Clean digital text page
  return {
    classification: "digital",
    substantiveChars: substantiveCount,
    cleanedText: cleaned,
    hasImages: false,
    imageOpCount: 0,
  };
}
