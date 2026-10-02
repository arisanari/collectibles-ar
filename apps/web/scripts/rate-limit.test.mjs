// Unit test for lib/rateLimit.ts (per-wallet hourly caps protecting the vault fee payer). No network.
//   node --experimental-strip-types --no-warnings --test scripts/rate-limit.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { takeSlot, HOUR_MS } from "../lib/rateLimit.ts";

test("allows up to the limit per key per window, then refuses without recording", () => {
  for (let i = 0; i < 3; i++) assert.equal(takeSlot("t", "w1", 3, HOUR_MS, 1000 + i), true);
  assert.equal(takeSlot("t", "w1", 3, HOUR_MS, 2000), false);
  assert.equal(takeSlot("t", "w2", 3, HOUR_MS, 2000), true); // other wallet unaffected
  assert.equal(takeSlot("other", "w1", 3, HOUR_MS, 2000), true); // other bucket unaffected
});

test("slots free up after the window", () => {
  for (let i = 0; i < 2; i++) assert.equal(takeSlot("t2", "w", 2, HOUR_MS, 1000), true);
  assert.equal(takeSlot("t2", "w", 2, HOUR_MS, 1000 + HOUR_MS - 1), false);
  assert.equal(takeSlot("t2", "w", 2, HOUR_MS, 1000 + HOUR_MS + 1), true);
});
