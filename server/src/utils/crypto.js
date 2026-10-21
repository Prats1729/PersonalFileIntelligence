import crypto from "node:crypto";
import { env } from "../config/env.js";

const CURRENT_KEY_VERSION = 1;
const HKDF_SALT = Buffer.from("pfi-salt-v1");
const HKDF_INFO = Buffer.from("pfi-byok-aes-256-gcm");

/**
 * Derives a 32-byte key using RFC 5869 HKDF-SHA256.
 */
export const getHkdfDerivedKey = (secret = env.ENCRYPTION_MASTER_KEY) => {
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(secret, "utf-8"), HKDF_SALT, HKDF_INFO, 32)
  );
};

/**
 * Legacy single-pass SHA-256 derivation for backward-compatibility.
 */
export const getLegacyDerivedKey = (secret = env.ENCRYPTION_MASTER_KEY) => {
  return crypto.createHash("sha256").update(secret).digest();
};

/**
 * Encrypts a plaintext string using AES-256-GCM and HKDF-derived key.
 * Returns { encryptedKey, iv, tag, keyVersion }
 */
export const encryptApiKey = (plaintext, version = CURRENT_KEY_VERSION) => {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("Plaintext must be a non-empty string.");
  }

  const key = getHkdfDerivedKey();
  const iv = crypto.randomBytes(12); // Standard 96-bit random IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    encryptedKey: encrypted,
    iv: iv.toString("hex"),
    tag: authTag.toString("hex"),
    keyVersion: version,
  };
};

/**
 * Decrypts an encrypted hex string using AES-256-GCM.
 * Supports both version 1 (HKDF) and version 0 (legacy SHA-256).
 */
export const decryptApiKey = (encryptedHex, ivHex, tagHex, version = 1) => {
  if (!encryptedHex || !ivHex || !tagHex) {
    throw new Error("Encrypted key, IV, and auth tag are all required.");
  }

  const key = version === 1 ? getHkdfDerivedKey() : getLegacyDerivedKey();
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
 * Example: 'sk-or-v1-abcdef1234567890' -> 'sk-or-••••••••7890'
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
