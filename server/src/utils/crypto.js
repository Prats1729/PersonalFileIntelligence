import crypto from "node:crypto";
import { env } from "../config/env.js";

// Derive a strict 32-byte key from master key using SHA-256
const getDerivedKey = () => {
  return crypto.createHash("sha256").update(env.ENCRYPTION_MASTER_KEY).digest();
};

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns { encryptedHex, ivHex, tagHex }
 */
export const encryptApiKey = (plaintext) => {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("Plaintext must be a non-empty string.");
  }

  const key = getDerivedKey();
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    encryptedKey: encrypted,
    iv: iv.toString("hex"),
    tag: authTag.toString("hex"),
  };
};

/**
 * Decrypts an encrypted hex string using AES-256-GCM with verification.
 */
export const decryptApiKey = (encryptedHex, ivHex, tagHex) => {
  if (!encryptedHex || !ivHex || !tagHex) {
    throw new Error("Encrypted key, IV, and auth tag are all required.");
  }

  const key = getDerivedKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
};

/**
 * Produces a secure masked preview of an API key for display in settings.
 * Example: 'sk-or-v1-abcdef1234567890' -> 'sk-or...7890'
 */
export const maskApiKey = (key) => {
  if (!key || typeof key !== "string") return "";
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return "••••••••";
  }
  const prefixLength = trimmed.startsWith("sk-") ? 6 : 4;
  const suffixLength = 4;

  const prefix = trimmed.slice(0, prefixLength);
  const suffix = trimmed.slice(-suffixLength);
  return `${prefix}••••••••${suffix}`;
};
