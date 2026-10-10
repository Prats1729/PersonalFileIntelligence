import { query } from "../db/index.js";
import { encryptApiKey, decryptApiKey, maskApiKey } from "../utils/crypto.js";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";

const VALID_PROVIDERS = new Set(["openrouter", "gemini"]);

/**
 * Validates provider name
 */
export const validateProvider = (provider) => {
  const p = provider?.toLowerCase()?.trim();
  if (!VALID_PROVIDERS.has(p)) {
    throw new AppError(
      `Invalid provider "${provider}". Supported providers: openrouter, gemini.`,
      400,
      "INVALID_PROVIDER"
    );
  }
  return p;
};

/**
 * Gets a user's decrypted key for a provider, or falls back to server env key.
 */
export const getActiveKeyForUser = async (userId, provider) => {
  const p = validateProvider(provider);

  const result = await query(
    "SELECT encrypted_key, iv, tag FROM user_api_keys WHERE user_id = $1 AND provider = $2",
    [userId, p]
  );

  if (result.rows.length > 0) {
    const { encrypted_key, iv, tag } = result.rows[0];
    const decrypted = decryptApiKey(encrypted_key, iv, tag);
    return {
      key: decrypted,
      isCustom: true,
      provider: p,
    };
  }

  // Fallback to server env key
  const serverKey = p === "gemini" ? env.GEMINI_API_KEY : env.OPENROUTER_API_KEY;
  return {
    key: serverKey || "",
    isCustom: false,
    provider: p,
  };
};

/**
 * Saves or updates a user's API key.
 */
export const saveUserKey = async (userId, provider, rawKey) => {
  const p = validateProvider(provider);
  const trimmed = rawKey?.trim();

  if (!trimmed || trimmed.length < 8) {
    throw new AppError("API key must be at least 8 characters long.", 400, "INVALID_KEY_FORMAT");
  }

  const { encryptedKey, iv, tag } = encryptApiKey(trimmed);
  const maskedKey = maskApiKey(trimmed);

  const result = await query(
    `INSERT INTO user_api_keys (user_id, provider, encrypted_key, iv, tag, masked_key, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id, provider)
     DO UPDATE SET encrypted_key = EXCLUDED.encrypted_key,
                   iv = EXCLUDED.iv,
                   tag = EXCLUDED.tag,
                   masked_key = EXCLUDED.masked_key,
                   updated_at = NOW()
     RETURNING provider, masked_key, updated_at`,
    [userId, p, encryptedKey, iv, tag, maskedKey]
  );

  return result.rows[0];
};

/**
 * Deletes a user's API key for a provider.
 */
export const deleteUserKey = async (userId, provider) => {
  const p = validateProvider(provider);
  const result = await query(
    "DELETE FROM user_api_keys WHERE user_id = $1 AND provider = $2 RETURNING provider",
    [userId, p]
  );
  return result.rowCount > 0;
};

/**
 * Lists configured keys for a user (masked only).
 */
export const listUserKeys = async (userId) => {
  const result = await query(
    "SELECT provider, masked_key, updated_at FROM user_api_keys WHERE user_id = $1 ORDER BY provider ASC",
    [userId]
  );
  return result.rows;
};

/**
 * Tests an API key with the upstream AI provider.
 */
export const testApiKey = async (provider, rawKey) => {
  const p = validateProvider(provider);
  const key = rawKey?.trim();

  if (!key) {
    return { valid: false, message: "API key cannot be empty." };
  }

  try {
    if (p === "openrouter") {
      const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return {
          valid: true,
          message: "OpenRouter key is valid and active.",
          limit: data?.data?.limit || null,
          usage: data?.data?.usage || null,
        };
      }
      return {
        valid: false,
        message: data?.error?.message || "Invalid OpenRouter API key.",
      };
    }

    if (p === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=1`
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.models) {
        return { valid: true, message: "Google Gemini key is valid and active." };
      }
      return {
        valid: false,
        message: data?.error?.message || "Invalid Google Gemini API key.",
      };
    }
  } catch (error) {
    return {
      valid: false,
      message: `Failed to contact provider: ${error.message}`,
    };
  }

  return { valid: false, message: "Unknown provider test failure." };
};

/**
 * Checks and records daily usage for server-key fallbacks.
 * Throws 429 AppError if the quota is exceeded.
 */
export const enforceDailyFreeQuota = async (userId) => {
  const limit = env.DAILY_FREE_AI_QUOTA;

  const result = await query(
    `INSERT INTO user_daily_usage (user_id, usage_date, ai_call_count, updated_at)
     VALUES ($1, CURRENT_DATE, 1, NOW())
     ON CONFLICT (user_id, usage_date)
     DO UPDATE SET ai_call_count = user_daily_usage.ai_call_count + 1, updated_at = NOW()
     RETURNING ai_call_count`,
    [userId]
  );

  const currentCount = result.rows[0]?.ai_call_count || 1;

  if (currentCount > limit) {
    throw new AppError(
      `Daily free AI limit reached (${limit}/${limit} calls). Add your own API key in Settings for unlimited use.`,
      429,
      "QUOTA_EXCEEDED"
    );
  }

  return {
    used: currentCount,
    limit,
    remaining: Math.max(0, limit - currentCount),
  };
};

/**
 * Returns quota status for the current day without incrementing.
 */
export const getQuotaStatus = async (userId) => {
  const limit = env.DAILY_FREE_AI_QUOTA;
  const result = await query(
    "SELECT ai_call_count FROM user_daily_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE",
    [userId]
  );
  const used = result.rows[0]?.ai_call_count || 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
};
