import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateProvider, testApiKey } from "../src/services/keyService.js";

describe("Key Service Unit & Provider Validation", () => {
  it("validates supported providers and rejects unknown ones", () => {
    assert.equal(validateProvider("OpenRouter"), "openrouter");
    assert.equal(validateProvider("gemini "), "gemini");

    assert.throws(() => {
      validateProvider("anthropic");
    }, /Invalid provider/);
  });

  it("handles empty key gracefully during testApiKey", async () => {
    const res = await testApiKey("openrouter", "");
    assert.equal(res.valid, false);
    assert.match(res.message, /cannot be empty/i);
  });

  it("reports invalid API key when contacting external provider with fake key", async () => {
    const res = await testApiKey("openrouter", "sk-or-v1-invalid-test-key-fake-12345");
    assert.equal(res.valid, false);
    assert.ok(res.message);
  });
});
