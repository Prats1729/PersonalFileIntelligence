import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getGoogleAuthUrl } from "../src/services/authService.js";

describe("OAuth State Parameter CSRF Protection (SEC-01)", () => {
  it("should generate auth URL containing state parameter", () => {
    const testState = "test_csrf_state_token_1234567890abcdef";
    const url = getGoogleAuthUrl(testState);
    assert.ok(url.includes("state=" + testState));
  });

  it("should generate auth URL without state when omitted", () => {
    const url = getGoogleAuthUrl();
    assert.ok(url.includes("accounts.google.com"));
  });
});
