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
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
    LOG_LEVEL,
    TRUST_PROXY,
  };
}

export const env = loadAndValidateEnv();
