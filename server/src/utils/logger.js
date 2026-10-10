import pino from "pino";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";

// Sensitive keys and paths to redact across all log outputs
const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "res.headers['set-cookie']",
  "token",
  "jwt",
  "apiKey",
  "key",
  "password",
  "secret",
  "google_refresh_token",
  "refresh_token",
  "*.token",
  "*.apiKey",
  "*.google_refresh_token",
  "*.buffer",
  "file.buffer",
  "files[*].buffer",
  "extracted_text",
  "*.extracted_text",
  "contextNote",
  "*.context_note",
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    env: env.NODE_ENV,
  },
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.headers["x-request-id"] || randomUUID(),
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} - ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} - ${res.statusCode} (Error: ${err.message})`,
  autoLogging: {
    ignore: (req) => req.url === "/healthz" || req.url === "/readyz",
  },
});
