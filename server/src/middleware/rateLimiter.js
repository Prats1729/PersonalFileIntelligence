import rateLimit from "express-rate-limit";

/**
 * Generates an isolated rate-limiting key using authenticated user ID when available,
 * falling back to IP address.
 */
const getUserOrIpKey = (req) => {
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }
  return req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown_client";
};

const createLimiter = (options) => {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getUserOrIpKey,
    handler: (req, res, next, opts) => {
      res.status(opts.statusCode || 429).json({
        error: {
          message: typeof opts.message === "string" ? opts.message : opts.message?.error || "Too many requests. Please slow down.",
          code: "RATE_LIMIT_EXCEEDED",
          retryAfterSeconds: Math.ceil(opts.windowMs / 1000),
        },
      });
    },
    ...options,
  });
};

export const generalApiLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute
  message: { error: "API rate limit exceeded. Please wait a moment." },
});

export const chatLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 chat requests per minute per user
  message: { error: "AI Chat rate limit reached. Please wait a moment before sending another prompt." },
});

export const uploadLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 15, // 15 upload batches per minute per user
  message: { error: "Upload limit reached. Please wait a minute before uploading additional files." },
});

export const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 auth requests per 15 mins
  message: { error: "Too many authentication requests. Please try again in a few minutes." },
});

export const settingsLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 settings/key requests per minute per user
  message: { error: "Settings rate limit reached. Please wait a moment." },
});
