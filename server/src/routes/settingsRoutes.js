import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { settingsLimiter } from "../middleware/rateLimiter.js";
import {
  listUserKeys,
  saveUserKey,
  deleteUserKey,
  testApiKey,
  getQuotaStatus,
  validateProvider,
} from "../services/keyService.js";

const router = Router();

// Apply auth and dedicated settings rate limiter to all settings endpoints
router.use(requireAuth);
router.use(settingsLimiter);

/**
 * GET /api/settings/keys
 * Returns list of configured keys (masked) and current quota status
 */
router.get("/keys", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [keys, quota] = await Promise.all([
      listUserKeys(userId),
      getQuotaStatus(userId),
    ]);

    // Build status map for supported providers
    const keyMap = {};
    for (const item of keys) {
      keyMap[item.provider] = {
        configured: true,
        maskedKey: item.masked_key,
        updatedAt: item.updated_at,
      };
    }

    res.json({
      providers: {
        openrouter: keyMap.openrouter || { configured: false },
        gemini: keyMap.gemini || { configured: false },
      },
      quota,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/keys
 * Encrypts and stores a provider API key
 */
router.post("/keys", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { provider, apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: "apiKey is required." });
    }

    const saved = await saveUserKey(userId, provider, apiKey);

    res.json({
      message: `API key for ${saved.provider} saved successfully.`,
      provider: saved.provider,
      maskedKey: saved.masked_key,
      updatedAt: saved.updated_at,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/keys/test
 * Validates a key with the upstream AI provider before saving
 */
router.post("/keys/test", async (req, res, next) => {
  try {
    const { provider, apiKey } = req.body;
    const p = validateProvider(provider);

    if (!apiKey) {
      return res.status(400).json({ error: "apiKey is required." });
    }

    const result = await testApiKey(p, apiKey);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/settings/keys/:provider
 * Deletes a user-provided API key
 */
router.delete("/keys/:provider", async (req, res, next) => {
  try {
    const userId = req.user.id;
    const provider = validateProvider(req.params.provider);

    const deleted = await deleteUserKey(userId, provider);

    if (!deleted) {
      return res.status(404).json({ error: `No configured key found for ${provider}.` });
    }

    res.json({
      message: `API key for ${provider} deleted. System will revert to server fallback.`,
      provider,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
