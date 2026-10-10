import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encryptApiKey, decryptApiKey, maskApiKey } from "../src/utils/crypto.js";

describe("BYOK Cryptographic Service (AES-256-GCM)", () => {
  it("should encrypt and decrypt an API key successfully", () => {
    const originalKey = "sk-or-v1-abc1234567890xyzsecretkey";
    const { encryptedKey, iv, tag } = encryptApiKey(originalKey);

    assert.ok(encryptedKey);
    assert.ok(iv);
    assert.ok(tag);
    assert.notEqual(encryptedKey, originalKey);

    const decrypted = decryptApiKey(encryptedKey, iv, tag);
    assert.equal(decrypted, originalKey);
  });

  it("should fail decryption if auth tag is tampered with", () => {
    const originalKey = "sk-or-v1-my-secret-key";
    const { encryptedKey, iv } = encryptApiKey(originalKey);
    const tamperedTag = "00".repeat(16);

    assert.throws(() => {
      decryptApiKey(encryptedKey, iv, tamperedTag);
    });
  });

  it("should correctly mask sensitive API keys for preview", () => {
    assert.equal(maskApiKey("sk-or-v1-abcdef1234567890"), "sk-or-••••••••7890");
    assert.equal(maskApiKey("AIzaSyDeF123456789XYZ"), "AIza••••••••9XYZ");
    assert.equal(maskApiKey("short"), "••••••••");
  });
});
