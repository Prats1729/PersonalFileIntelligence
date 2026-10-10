import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeFilename, verifyBufferSignature, ALLOWED_EXTENSIONS } from "../src/utils/fileValidation.js";

describe("File Validation & Sanitization Tests", () => {
  test("sanitizeFilename removes path traversal and null bytes", () => {
    assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
    assert.equal(sanitizeFilename("C:\\Windows\\System32\\cmd.exe"), "cmd.exe");
    assert.equal(sanitizeFilename("malicious\0file.pdf"), "maliciousfile.pdf");
    assert.equal(sanitizeFilename(""), "unnamed_file");
  });

  test("verifyBufferSignature correctly validates PDF header", () => {
    const validPdfBuffer = Buffer.from("%PDF-1.7 standard header");
    const invalidPdfBuffer = Buffer.from("NOT_A_PDF content");

    assert.equal(verifyBufferSignature(validPdfBuffer, ".pdf"), true);
    assert.equal(verifyBufferSignature(invalidPdfBuffer, ".pdf"), false);
  });

  test("verifyBufferSignature correctly validates PNG header", () => {
    const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const invalidPngBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);

    assert.equal(verifyBufferSignature(validPngBuffer, ".png"), true);
    assert.equal(verifyBufferSignature(invalidPngBuffer, ".png"), false);
  });

  test("ALLOWED_EXTENSIONS contains core academic document extensions", () => {
    assert.ok(ALLOWED_EXTENSIONS.has(".pdf"));
    assert.ok(ALLOWED_EXTENSIONS.has(".png"));
    assert.ok(ALLOWED_EXTENSIONS.has(".docx"));
    assert.ok(ALLOWED_EXTENSIONS.has(".txt"));
    assert.ok(!ALLOWED_EXTENSIONS.has(".exe"));
    assert.ok(!ALLOWED_EXTENSIONS.has(".sh"));
  });
});
