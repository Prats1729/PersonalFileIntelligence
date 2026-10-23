import dotenv from "dotenv";

dotenv.config();

/**
 * Validates and exposes sanitized environment configuration.
 * Fails fast at startup with explicit error messages if any critical key is missing.
 */
function loadAndValidateEnv() {
  const errors = [];

  const NODE_ENV = process.env.NODE_ENV || "development";
  const PORT = parseInt(process.env.PORT || "5000", 10);
  if (isNaN(PORT) || PORT <= 0 || PORT > 65535) {
    errors.push("PORT must be a valid integer between 1 and 65535.");
  }

  const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    errors.push("DATABASE_URL is required for database connectivity.");
  }

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  if (!GOOGLE_CLIENT_ID) {
    errors.push("GOOGLE_CLIENT_ID is required for Google OAuth2.");
  }

  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  if (!GOOGLE_CLIENT_SECRET) {
    errors.push("GOOGLE_CLIENT_SECRET is required for Google OAuth2.");
  }

  const GOOGLE_REDIRECT_URI =
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:5000/api/auth/google/callback";

  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) {
    errors.push("SESSION_SECRET is required to sign authentication JWT tokens.");
  } else if (SESSION_SECRET.length < 16) {
    errors.push("SESSION_SECRET must be at least 16 characters long for cryptographic security.");
  }

  const LOG_LEVEL = process.env.LOG_LEVEL || (NODE_ENV === "production" ? "info" : "debug");
  const TRUST_PROXY =
    process.env.TRUST_PROXY === "true" ||
    process.env.TRUST_PROXY === "1" ||
    NODE_ENV === "production";

  const DEFAULT_DEV_KEY = "dev_default_master_encryption_key_32chars!";
  const ENCRYPTION_MASTER_KEY =
    process.env.ENCRYPTION_MASTER_KEY ||
    (NODE_ENV === "production"
      ? ""
      : DEFAULT_DEV_KEY);

  if (NODE_ENV === "production") {
    if (!ENCRYPTION_MASTER_KEY || ENCRYPTION_MASTER_KEY.length < 32) {
      errors.push("ENCRYPTION_MASTER_KEY must be at least 32 characters in production for AES-256-GCM.");
    } else if (ENCRYPTION_MASTER_KEY === DEFAULT_DEV_KEY || ENCRYPTION_MASTER_KEY.includes("dev_default")) {
      errors.push("ENCRYPTION_MASTER_KEY cannot use default development key in production.");
    }
  }

  const DAILY_FREE_AI_QUOTA = parseInt(process.env.DAILY_FREE_AI_QUOTA || "30", 10);
  if (isNaN(DAILY_FREE_AI_QUOTA) || DAILY_FREE_AI_QUOTA < 0) {
    errors.push("DAILY_FREE_AI_QUOTA must be a non-negative integer.");
  }

  const MAX_PDF_PAGES = parseInt(process.env.MAX_PDF_PAGES || "100", 10);
  if (isNaN(MAX_PDF_PAGES) || MAX_PDF_PAGES <= 0) {
    errors.push("MAX_PDF_PAGES must be a positive integer.");
  }

  const MAX_EXTRACT_CHARS = parseInt(process.env.MAX_EXTRACT_CHARS || "400000", 10);
  if (isNaN(MAX_EXTRACT_CHARS) || MAX_EXTRACT_CHARS <= 0) {
    errors.push("MAX_EXTRACT_CHARS must be a positive integer.");
  }

  const PDF_PARSE_TIMEOUT_MS = parseInt(process.env.PDF_PARSE_TIMEOUT_MS || "30000", 10);
  if (isNaN(PDF_PARSE_TIMEOUT_MS) || PDF_PARSE_TIMEOUT_MS <= 0) {
    errors.push("PDF_PARSE_TIMEOUT_MS must be a positive integer.");
  }

  const PDF_MIN_PAGE_CHARS = parseInt(process.env.PDF_MIN_PAGE_CHARS || "100", 10);
  if (isNaN(PDF_MIN_PAGE_CHARS) || PDF_MIN_PAGE_CHARS < 0) {
    errors.push("PDF_MIN_PAGE_CHARS must be a non-negative integer.");
  }

  const MAX_OCR_PAGES_PER_FILE = parseInt(process.env.MAX_OCR_PAGES_PER_FILE || "150", 10);
  if (isNaN(MAX_OCR_PAGES_PER_FILE) || MAX_OCR_PAGES_PER_FILE <= 0) {
    errors.push("MAX_OCR_PAGES_PER_FILE must be a positive integer.");
  }

  const OCR_PAGE_TIMEOUT_MS = parseInt(process.env.OCR_PAGE_TIMEOUT_MS || "25000", 10);
  if (isNaN(OCR_PAGE_TIMEOUT_MS) || OCR_PAGE_TIMEOUT_MS <= 0) {
    errors.push("OCR_PAGE_TIMEOUT_MS must be a positive integer.");
  }

  const OCR_BATCH_SIZE = parseInt(process.env.OCR_BATCH_SIZE || "3", 10);
  if (isNaN(OCR_BATCH_SIZE) || OCR_BATCH_SIZE <= 0) {
    errors.push("OCR_BATCH_SIZE must be a positive integer.");
  }

  const OCR_STALE_TIMEOUT_MINUTES = parseInt(
    process.env.OCR_STALE_TIMEOUT_MINUTES || (NODE_ENV === "production" ? "5" : "2"),
    10
  );
  if (isNaN(OCR_STALE_TIMEOUT_MINUTES) || OCR_STALE_TIMEOUT_MINUTES <= 0) {
    errors.push("OCR_STALE_TIMEOUT_MINUTES must be a positive integer.");
  }

  if (errors.length > 0) {
    const errorReport = [
      "==================================================",
      "❌ FATAL CONFIGURATION ERROR - STARTUP ABORTED",
      "==================================================",
      ...errors.map((err) => `  • ${err}`),
      "==================================================",
      "Please verify your .env file or deployment variables.",
    ].join("\n");
    console.error(errorReport);
    throw new Error("Configuration validation failed. See above logs for missing variables.");
  }

  return {
    NODE_ENV,
    isProduction: NODE_ENV === "production",
    isTest: NODE_ENV === "test",
    PORT,
    CLIENT_URL,
    DATABASE_URL,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    SESSION_SECRET,
    ENCRYPTION_MASTER_KEY,
    DAILY_FREE_AI_QUOTA,
    MAX_PDF_PAGES,
    MAX_EXTRACT_CHARS,
    PDF_PARSE_TIMEOUT_MS,
    PDF_MIN_PAGE_CHARS,
    MAX_OCR_PAGES_PER_FILE,
    OCR_PAGE_TIMEOUT_MS,
    OCR_BATCH_SIZE,
    OCR_STALE_TIMEOUT_MINUTES,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
    LOG_LEVEL,
    TRUST_PROXY,
  };
}

export const env = loadAndValidateEnv();
