import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

/**
 * Standard PDF default resolution is 72 DPI.
 * 150 DPI corresponds to scale: 150 / 72 ≈ 2.083
 */
const DEFAULT_SCALE = 2.083;

/**
 * Renders an individual page of a PDF document to a PNG image buffer.
 *
 * @param {Buffer|Uint8Array} pdfBuffer - The raw binary of the PDF.
 * @param {number} pageNumber - 1-indexed page number to render.
 * @param {number} [scale=2.083] - Viewport rendering scale (~150 DPI).
 * @returns {Promise<Buffer>} PNG image buffer of the rendered page.
 */
export async function renderPdfPageToBuffer(pdfBuffer, pageNumber, scale = DEFAULT_SCALE) {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error("Cannot render empty PDF buffer");
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) {
      throw new Error(`Page number ${pageNumber} out of range (1..${doc.numPages})`);
    }

    const page = await doc.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      // Fill white background before rendering
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      const renderContext = {
        canvasContext: context,
        viewport,
      };

      await page.render(renderContext).promise;
      return canvas.toBuffer("image/png");
    } finally {
      if (typeof page.cleanup === "function") {
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy();
  }
}
