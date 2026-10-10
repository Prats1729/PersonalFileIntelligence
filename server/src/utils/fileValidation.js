import path from "node:path";

export const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".docx",
  ".doc",
  ".txt",
  ".md",
]);

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown",
  "application/octet-stream", // Sometimes sent by OS for specific documents; validated via extension & magic bytes
]);

/**
 * Sanitizes original filenames to prevent path traversal, control characters, or malicious names.
 */
export function sanitizeFilename(filename) {
  if (!filename || typeof filename !== "string") return "unnamed_file";
  // Remove path separators and null bytes
  const base = path.basename(filename).replace(/[\/\\]/g, "").replace(/\0/g, "");
  // Replace dangerous characters, keep standard alphanumerics, spaces, dots, dashes, underscores
  const cleaned = base.replace(/[^a-zA-Z0-9.\-_ ()]/g, "_").trim();
  return (cleaned.slice(0, 200) || "document");
}

/**
 * Verifies magic numbers for common binary file types to prevent content spoofing.
 */
export function verifyBufferSignature(buffer, extension) {
  if (!buffer || buffer.length < 4) return false;
  const ext = (extension || "").toLowerCase();

  // PDF check (%PDF-)
  if (ext === ".pdf") {
    const header = buffer.toString("utf8", 0, 5);
    return header.startsWith("%PDF");
  }

  // PNG check (\x89PNG)
  if (ext === ".png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }

  // JPEG check (\xFF\xD8\xFF)
  if (ext === ".jpg" || ext === ".jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  // WebP check (RIFF....WEBP)
  if (ext === ".webp") {
    if (buffer.length < 12) return false;
    const riff = buffer.toString("utf8", 0, 4);
    const webp = buffer.toString("utf8", 8, 12);
    return riff === "RIFF" && webp === "WEBP";
  }

  // DOCX / Office Open XML (PK\x03\x04 zip container)
  if (ext === ".docx") {
    return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  }

  // Text, markdown, SVG, and others pass if within size & allowed extensions
  return true;
}
