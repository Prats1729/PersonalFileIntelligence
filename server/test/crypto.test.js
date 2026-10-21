import { describe, it } from "node:test";
import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { encryptApiKey, decryptApiKey, maskApiKey } from "../src/utils/crypto.js";
import { env } from "../src/config/env.js";

describe("BYOK Cryptographic Service (AES-256-GCM + HKDF-SHA256)", () => {
  it("should encrypt with HKDF-SHA256 and return keyVersion 1", () => {
    const originalKey = "sk-or-v1-abc1234567890xyzsecretkey";
    const { encryptedKey, iv, tag, keyVersion } = encryptApiKey(originalKey);

    assert.ok(encryptedKey);
    assert.ok(iv);
    assert.ok(tag);
    assert.equal(keyVersion, 1);
    assert.notEqual(encryptedKey, originalKey);

    const decrypted = decryptApiKey(encryptedKey, iv, tag, keyVersion);
    assert.equal(decrypted, originalKey);
  });

  it("should decrypt legacy version 0 keys encrypted with single SHA-256 derivation", () => {
    // Encrypt using legacy SHA-256 key
    const legacyKey = nodeCrypto.createHash("sha256").update(env.ENCRYPTION_MASTER_KEY).digest();
    const iv = nodeCrypto.randomBytes(12);
    const cipher = nodeCrypto.createCipheriv("aes-256-gcm", legacyKey, iv);
    const secret = "legacy-openai-key-value-123456";
    let encrypted = cipher.update(secret, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");

    // Decrypt specifying version 0
    const decrypted = decryptApiKey(encrypted, iv.toString("hex"), tag, 0);
    assert.equal(decrypted, secret);
  });

  it("should fail decryption if auth tag is tampered with", () => {
    const originalKey = "sk-or-v1-my-secret-key";
    const { encryptedKey, iv } = encryptApiKey(originalKey);
    const tamperedTag = "00".repeat(16);

    assert.throws(() => {
      decryptApiKey(encryptedKey, iv, tamperedTag, 1);
    });
  });

  it("should fail decryption if ciphertext is tampered with", () => {
    const originalKey = "sk-or-v1-my-secret-key";
    const { encryptedKey, iv, tag } = encryptApiKey(originalKey);
    const tamperedCipher = "ab" + encryptedKey.slice(2);

    assert.throws(() => {
      decryptApiKey(tamperedCipher, iv, tag, 1);
    });
  });

  it("should correctly mask sensitive API keys for preview", () => {
    assert.equal(maskApiKey("sk-or-v1-abcdef1234567890"), "sk-or-••••••••7890");
    assert.equal(maskApiKey("AIzaSyDeF123456789XYZ"), "AIza••••••••9XYZ");
    assert.equal(maskApiKey("short"), "••••••••");
  });
});
