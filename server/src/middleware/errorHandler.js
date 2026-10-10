import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * Custom application error with HTTP status codes and operational classification.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 404 handler for undefined routes.
 */
export function notFoundHandler(req, res, next) {
  const err = new AppError(`Resource not found: ${req.method} ${req.originalUrl}`, 404, "NOT_FOUND");
  next(err);
}

/**
 * Central Express error handler.
 * Prevents leaking stack traces or internal implementation details in production.
 */
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const requestId = req.id || req.headers["x-request-id"] || "unknown";

  // Log full error internally with context and request ID
  logger.error(
    {
      err: {
        message: err.message,
        stack: err.stack,
        code: err.code,
      },
      statusCode,
      requestId,
      method: req.method,
      url: req.originalUrl,
      userId: req.user?.id,
    },
    `Request error: ${err.message}`
  );

  // In production, mask internal 500 errors to avoid information leakage
  const isInternal = statusCode >= 500;
  const clientMessage =
    env.isProduction && isInternal
      ? "An internal server error occurred. Please try again later."
      : err.message || "An unexpected error occurred.";

  const clientCode = err.code || (isInternal ? "INTERNAL_ERROR" : "BAD_REQUEST");

  const responsePayload = {
    error: {
      message: clientMessage,
      code: clientCode,
      requestId,
    },
  };

  // Include stack and details only in non-production environments
  if (!env.isProduction && err.stack) {
    responsePayload.error.stack = err.stack;
  }

  res.status(statusCode).json(responsePayload);
}
