// Unit test for lib/acquisitions/store.ts and lib/solana/acquisitionEligibility.ts ("Twinfoldから取得", Issue #60). No network.
//   node --experimental-strip-types --no-warnings --test scripts/acquisition-store.test.mjs
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("./ts-resolve-hooks.mjs", import.meta.url);
const store = await import("../lib/acquisitions/store.ts");
const { evaluateAcquisitionEligibility, NOT_ACQUIRABLE_MESSAGE } = await import("../lib/solana/acquisitionEligibility.ts");

const base = { wallet: "BUYER", assetId: "tf-x", assetAddress: "ADDR", assetTitle: "T", listedPrice: { amount: 350, currency: "USDC" } };
let n = 0;
const reserve = (over = {}, now = 1_000_000) => store.reserveAcquisition({ ...base, id: `acq-${++n}-${Math.random()}`, ...over }, now);

test("a reservation starts pending, and the view marks that no payment was made", () => {
  const r = reserve({ assetId: "a-1" });
  assert.equal(r.ok, true);
  assert.equal(r.acquisition.status, "pending");
  const view = store.toAcquisitionView(r.acquisition);
  assert.equal(view.paymentMade, false);
  assert.deepEqual(view.listedPrice, { amount: 350, currency: "USDC" });
  assert.equal(view.buyerWallet, "BUYER");
});

test("idempotent by id: reserving the same id again returns the existing record, not a new one", () => {
  const first = reserve({ assetId: "a-idem", id: "acq-idem-0001" });
  const again = reserve({ assetId: "a-idem", id: "acq-idem-0001" });
  assert.equal(again.ok, false);
  assert.equal(again.reason, "exists");
  assert.equal(again.acquisition, first.acquisition);
});

test("one in-flight acquisition per asset (pending and submitted both block), freed on terminal", () => {
  const first = reserve({ assetId: "a-busy" });
  assert.equal(reserve({ assetId: "a-busy" }).reason, "asset_busy");
  store.markAcqSubmitted(first.acquisition, "sigbusy123");
  assert.equal(reserve({ assetId: "a-busy" }).reason, "asset_busy");
  store.markAcqConfirmed(first.acquisition, "signature");
  assert.equal(reserve({ assetId: "a-busy" }).ok, true);
});

test("a failed acquisition frees the asset and keeps its error", () => {
  const first = reserve({ assetId: "a-fail" });
  store.markAcqFailed(first.acquisition, "boom");
  assert.equal(first.acquisition.status, "failed");
  assert.equal(first.acquisition.error, "boom");
  assert.equal(reserve({ assetId: "a-fail" }).ok, true);
});

test("a submitted acquisition keeps its signature and does not time out", () => {
  const first = reserve({ assetId: "a-sub" }, 1_000_000);
  store.markAcqSubmitted(first.acquisition, "sigsub456", 1_000_001);
  assert.equal(reserve({ assetId: "a-sub-other" }, 1_000_000 + 60 * 60 * 1000).ok, true); // sweep runs
  assert.equal(first.acquisition.status, "submitted");
  assert.equal(first.acquisition.signature, "sigsub456");
});

test("a pending acquisition that never sent is dropped as failed after the pending limit, so it cannot block the asset", () => {
  const first = reserve({ assetId: "a-hung" }, 1_000_000);
  assert.equal(reserve({ assetId: "a-hung" }, 1_000_000 + 60_000).reason, "asset_busy");
  assert.equal(reserve({ assetId: "a-hung" }, 1_000_000 + store.PENDING_MAX_MS + 1).ok, true);
  assert.equal(first.acquisition.status, "failed");
});

test("listForWallet is scoped to the buyer", () => {
  reserve({ wallet: "W-list", assetId: "a-l1" });
  reserve({ wallet: "W-other", assetId: "a-l2" });
  assert.ok(store.listForWallet("W-list", 1_000_001).every((a) => a.wallet === "W-list"));
});

const record = (over = {}) => ({
  commerce: { twinfoldPrice: { amount: 350, currency: "USDC" }, buybackRate: 0.8, buybackEligible: true },
  provenance: [],
  ...over,
});

test("eligibility: vault-held, priced, not redeemed -> eligible", () => {
  const e = evaluateAcquisitionEligibility({ offchainRecord: record(), currentOwner: "VAULT", vaultWallet: "VAULT" });
  assert.equal(e.eligible, true);
  assert.deepEqual(e.reasons, []);
});

test("eligibility: owned by anyone other than the vault -> not acquirable", () => {
  const e = evaluateAcquisitionEligibility({ offchainRecord: record(), currentOwner: "SOMEONE", vaultWallet: "VAULT" });
  assert.equal(e.eligible, false);
  assert.ok(e.reasons.length >= 1);
  assert.equal(NOT_ACQUIRABLE_MESSAGE, "この作品は現在取得できません");
});

test("eligibility: no price, burnt, redeemed, or no vault wallet -> refused", () => {
  assert.equal(evaluateAcquisitionEligibility({ offchainRecord: record({ commerce: undefined }), currentOwner: "VAULT", vaultWallet: "VAULT" }).eligible, false);
  assert.equal(evaluateAcquisitionEligibility({ offchainRecord: undefined, currentOwner: "VAULT", vaultWallet: "VAULT" }).eligible, false);
  assert.equal(evaluateAcquisitionEligibility({ offchainRecord: record(), currentOwner: "VAULT", burnt: true, vaultWallet: "VAULT" }).eligible, false);
  const redeemed = record({ provenance: [{ kind: "redeemed", status: "confirmed" }] });
  assert.equal(evaluateAcquisitionEligibility({ offchainRecord: redeemed, currentOwner: "VAULT", vaultWallet: "VAULT" }).eligible, false);
  assert.equal(evaluateAcquisitionEligibility({ offchainRecord: record(), currentOwner: "VAULT", vaultWallet: null }).eligible, false);
});
