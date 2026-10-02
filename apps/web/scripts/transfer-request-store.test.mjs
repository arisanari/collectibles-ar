// Unit test for lib/transferRequests/store.ts: lifecycle, one open request per asset, expiry. No network.
//   node --experimental-strip-types --no-warnings --test scripts/transfer-request-store.test.mjs
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("./ts-resolve-hooks.mjs", import.meta.url);
const store = await import("../lib/transferRequests/store.ts");

const base = { wallet: "W1", assetId: "tf-test", assetAddress: "A1", assetTitle: "T", kind: "buyback", toWallet: "V", toLabel: "Twinfold Vault", origin: "web" };
let n = 0;
const make = (over = {}, now = 1_000_000) => {
  const created = store.createRequest({ ...base, id: `req-${++n}-${Math.random()}`, ...over }, now);
  assert.equal(created.ok, true);
  return created.request;
};

test("a new request is awaiting_approval with a 10 minute TTL", () => {
  const r = make({ assetId: "a-ttl" });
  assert.equal(r.status, "awaiting_approval");
  assert.equal(r.expiresAt - r.createdAt, 10 * 60 * 1000);
});

test("expiry: an unapproved request expires after the TTL and is no longer open", () => {
  const r = make({ assetId: "a-expire" }, 1_000_000);
  assert.equal(store.getRequest(r.id, 1_000_000 + 9 * 60 * 1000)?.status, "awaiting_approval");
  assert.equal(store.findOpenByAsset("a-expire", 1_000_000 + 9 * 60 * 1000)?.id, r.id);
  assert.equal(store.getRequest(r.id, 1_000_000 + 10 * 60 * 1000 + 1)?.status, "expired");
  assert.equal(store.findOpenByAsset("a-expire", 1_000_000 + 10 * 60 * 1000 + 1), undefined);
});

test("one open request per asset: findOpenByAsset sees awaiting and submitted, not terminal", () => {
  const r = make({ assetId: "a-open" });
  assert.equal(store.findOpenByAsset("a-open", 1_000_001)?.id, r.id);
  store.markSubmitted(r, "sig123456", 1_000_002);
  assert.equal(store.findOpenByAsset("a-open", 1_000_003)?.id, r.id);
  store.markConfirmed(r, 1_000_004);
  assert.equal(store.findOpenByAsset("a-open", 1_000_005), undefined);
});

test("a submitted request does not expire while confirmation is pending", () => {
  const r = make({ assetId: "a-submitted" }, 1_000_000);
  store.markSubmitted(r, "sigabcdef", 1_000_001);
  assert.equal(store.getRequest(r.id, 1_000_000 + 60 * 60 * 1000)?.status, "submitted");
});

test("rejected and failed are terminal for the open check; retryable failure keeps its flag", () => {
  const rejected = make({ assetId: "a-rej" });
  store.markRejected(rejected, 1_000_010);
  assert.equal(store.findOpenByAsset("a-rej", 1_000_011), undefined);
  const failed = make({ assetId: "a-fail" });
  store.markFailed(failed, "blockhash expired", true, 1_000_010);
  assert.equal(failed.status, "failed");
  assert.equal(failed.retryable, true);
  store.markPrepared(failed, { transactionB64: "x", lastValidBlockHeight: 1 }, 1_000_020);
  assert.equal(failed.status, "awaiting_approval");
  assert.equal(failed.error, undefined);
});

test("listForWallet is scoped to the wallet and the view never leaks the prepared transaction", () => {
  const mine = make({ wallet: "W-list", assetId: "a-list-1" });
  make({ wallet: "W-other", assetId: "a-list-2" });
  store.markPrepared(mine, { transactionB64: "SECRET-TX", lastValidBlockHeight: 1 }, 1_000_030);
  const listed = store.listForWallet("W-list", 1_000_031);
  assert.equal(listed.length, 1);
  const json = JSON.stringify(store.toView(listed[0]));
  assert.ok(!json.includes("SECRET-TX"));
  assert.ok(!json.includes("prepared"));
});

test("expired requests drop out of the open list once they leave the recent window", () => {
  const r = make({ wallet: "W-old", assetId: "a-old" }, 1_000_000);
  assert.equal(store.listForWallet("W-old", 1_000_000 + 11 * 60 * 1000).length, 1); // expired, still shown briefly
  assert.equal(store.listForWallet("W-old", 1_000_000 + 40 * 60 * 1000).length, 0);
  assert.equal(r.status, "expired");
});

test("origin is stored and shown in the view (device-created requests are marked)", () => {
  const r = make({ assetId: "a-origin", origin: "device" });
  assert.equal(store.toView(r).origin, "device");
  assert.equal(store.toView(make({ assetId: "a-origin-web" })).origin, "web");
});

test("chain reconciliation: confirmed from a chain fact, also from a retryable failure", () => {
  const r = make({ assetId: "a-recon" });
  store.markSubmitted(r, "sigrecon1", 1_000_001);
  assert.equal(r.status, "submitted");
  store.markConfirmedFromChain(r, "signature", 1_000_002);
  assert.equal(r.status, "confirmed");
  const f = make({ assetId: "a-recon-failed" });
  store.markFailed(f, "blockhash", true, 1_000_003);
  store.markConfirmedFromChain(f, "owner", 1_000_004);
  assert.equal(f.status, "confirmed");
  assert.equal(f.retryable, undefined);
});

test("re-preparing drops the stale signature of the earlier (dead) transaction", () => {
  const r = make({ assetId: "a-resig" });
  store.markSubmitted(r, "sigold123", 1_000_001);
  store.markFailed(r, "expired", true, 1_000_002);
  store.markPrepared(r, { transactionB64: "x", lastValidBlockHeight: 2 }, 1_000_003);
  assert.equal(r.signature, undefined);
});
