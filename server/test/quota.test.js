import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDatabase, teardownTestDatabase, createTestUser, testQuery } from "./testDatabase.js";
import { enforceDailyFreeQuota, getQuotaStatus } from "../src/services/keyService.js";
import { env } from "../src/config/env.js";

describe("Daily Free AI Quota & Concurrency Hardening (SEC-05)", () => {
  let testUser;

  before(async () => {
    await setupTestDatabase();
    const created = await createTestUser();
    testUser = created.user;
  });

  after(async () => {
    await teardownTestDatabase();
  });

  it("should atomically increment quota count", async () => {
    const result1 = await enforceDailyFreeQuota(testUser.id, 1);
    assert.equal(result1.used, 1);
    assert.equal(result1.limit, env.DAILY_FREE_AI_QUOTA);

    const result2 = await enforceDailyFreeQuota(testUser.id, 2);
    assert.equal(result2.used, 3);
  });

  it("should support batch accounting for multi-file operations", async () => {
    const statusBefore = await getQuotaStatus(testUser.id);
    const batchSize = 5;
    const result = await enforceDailyFreeQuota(testUser.id, batchSize);

    assert.equal(result.used, statusBefore.used + batchSize);
  });

  it("should prevent concurrent race conditions when near limit", async () => {
    // Fill quota up to limit - 1
    const limit = env.DAILY_FREE_AI_QUOTA;
    await testQuery(
      `UPDATE user_daily_usage
       SET ai_call_count = $1
       WHERE user_id = $2 AND usage_date = CURRENT_DATE`,
      [limit - 1, testUser.id]
    );

    // Launch 10 concurrent requests at the same time
    const concurrentCalls = Array.from({ length: 10 }).map(() =>
      enforceDailyFreeQuota(testUser.id, 1).then(
        () => ({ status: "fulfilled" }),
        (err) => ({ status: "rejected", code: err.code })
      )
    );

    const results = await Promise.all(concurrentCalls);
    const successful = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly 1 should succeed (since remaining was 1), and 9 must be rejected with QUOTA_EXCEEDED
    assert.equal(successful.length, 1);
    assert.equal(rejected.length, 9);
    for (const r of rejected) {
      assert.equal(r.code, "QUOTA_EXCEEDED");
    }

    // Verify database count never exceeded the limit
    const finalStatus = await getQuotaStatus(testUser.id);
    assert.equal(finalStatus.used, limit);
  });
});
