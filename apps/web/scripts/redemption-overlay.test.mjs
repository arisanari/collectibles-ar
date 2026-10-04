// Unit test for lib/redemptions/{overlay,operatorAuth}.ts and the redemption-aware eligibility rules. No network.
//   node --experimental-strip-types --no-warnings --test scripts/redemption-overlay.test.mjs
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("./ts-resolve-hooks.mjs", import.meta.url);
const { applyRedemptionOverlay, redemptionEntitlement } = await import("../lib/redemptions/overlay.ts");
const { operatorTokenMatches, checkOperatorToken, OPERATOR_HEADER } = await import("../lib/redemptions/operatorAuth.ts");
const { evaluateBuybackEligibility } = await import("../lib/solana/buybackEligibility.ts");
const { evaluateAcquisitionEligibility } = await import("../lib/solana/acquisitionEligibility.ts");

const asset = () => ({
  id: "tf-x",
  network: "devnet",
  address: "ADDR",
  standard: "metaplex-core",
  owner: "OWNER",
  title: "T",
  display: { kind: "image", imageUrl: "", placeholder: false, rightsNote: "r" },
  spatialRepresentation: { kind: "card" },
  physical: { physicalId: "P", condition: "c", rights: "r", custody: { vault: "TWINFOLD", status: "vaulted" }, lastVerifiedAt: "2026-09-30T00:00:00Z" },
  commerce: { twinfoldPrice: { amount: 100, currency: "USDC" }, buybackRate: 0.8, buybackEligible: true },
  provenance: [
    { id: "m", assetId: "tf-x", kind: "minted", occurredAt: "2026-09-27T00:00:00Z", source: "onchain", status: "confirmed", transaction: "sigMint", metadata: {} },
    { id: "lock", assetId: "tf-x", kind: "transferred", occurredAt: "2026-10-01T00:01:00.000Z", source: "onchain", status: "confirmed", transaction: "sigLock", metadata: {} },
  ],
});

const redemption = (status, events) => ({
  id: "red-1", assetId: "tf-x", assetAddress: "ADDR", wallet: "OWNER", status, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:05:00.000Z",
  events, dryRun: true,
});
const ev = (kind, at, source, extra = {}) => ({ kind, at, source, ...extra });

test("open redemption: summary, pending steps with correct sources, lock tagged on the existing onchain event", () => {
  const r = redemption("shipped", [
    ev("requested", "2026-10-01T00:00:00.000Z", "offchain_evidence"),
    ev("locked", "2026-10-01T00:01:00.000Z", "onchain", { signature: "sigLock" }),
    ev("shipped", "2026-10-01T00:02:00.000Z", "offchain_evidence", { dryRun: true, note: "保険付き配送相当（dry run、実配送なし）" }),
  ]);
  const out = applyRedemptionOverlay(asset(), r);
  assert.deepEqual(out.redemption, { id: "red-1", status: "shipped", open: true, updatedAt: "2026-10-01T00:05:00.000Z" });
  assert.equal(out.physical.custody.status, "vaulted");
  assert.equal(out.commerce.buybackEligible, false);
  const lock = out.provenance.find((e) => e.transaction === "sigLock");
  assert.equal(lock.kind, "transferred");
  assert.equal(lock.source, "onchain");
  assert.equal(lock.metadata.redeemStep, "locked");
  assert.equal(out.provenance.filter((e) => e.transaction === "sigLock").length, 1); // not duplicated
  const shipped = out.provenance.find((e) => e.metadata.redeemStep === "shipped");
  assert.equal(shipped.source, "offchain_evidence");
  assert.equal(shipped.status, "pending");
  assert.equal(shipped.metadata.dryRun, true);
  const requested = out.provenance.find((e) => e.metadata.redeemStep === "requested");
  assert.equal(requested.source, "offchain_evidence");
});

test("retired: custody released, owner null, final event is onchain `redeemed` with the burn signature", () => {
  const r = redemption("retired", [
    ev("requested", "2026-10-01T00:00:00.000Z", "offchain_evidence"),
    ev("locked", "2026-10-01T00:01:00.000Z", "onchain", { signature: "sigLock" }),
    ev("shipped", "2026-10-01T00:02:00.000Z", "offchain_evidence", { dryRun: true }),
    ev("received", "2026-10-01T00:03:00.000Z", "offchain_evidence", { dryRun: true }),
    ev("retired", "2026-10-01T00:04:00.000Z", "onchain", { signature: "sigBurn" }),
  ]);
  const out = applyRedemptionOverlay(asset(), r);
  assert.equal(out.physical.custody.status, "released");
  assert.equal(out.owner, null);
  const burn = out.provenance.find((e) => e.transaction === "sigBurn");
  assert.equal(burn.kind, "redeemed");
  assert.equal(burn.source, "onchain");
  assert.equal(burn.status, "confirmed");
  assert.equal(out.redemption.open, false);
  assert.ok(out.provenance.every((e) => e.status === "confirmed"));
});

test("a cancelled redemption (or none) leaves the asset untouched", () => {
  const base = asset();
  assert.equal(applyRedemptionOverlay(base, undefined), base);
  assert.equal(applyRedemptionOverlay(base, redemption("cancelled", [])), base);
});

test("entitlement: requested still circulates; locked/shipped/exception stop it with a reason; retired points to the Passport", () => {
  assert.equal(redemptionEntitlement(undefined), null);
  assert.equal(redemptionEntitlement(redemption("requested", [])), null);
  assert.equal(redemptionEntitlement(redemption("cancelled", [])), null);
  for (const s of ["locked", "shipped", "received", "exception"]) {
    const e = redemptionEntitlement(redemption(s, []));
    assert.equal(e.canDisplay, false);
    assert.match(e.reason, /Redemption in progress \(out of circulation\)/);
  }
  const retired = redemptionEntitlement(redemption("retired", []));
  assert.equal(retired.canDisplay, false);
  assert.match(retired.reason, /Passport/);
  assert.match(retired.reason, /\/passport\/tf-x/);
});

test("buyback and acquisition are refused while a redemption is open", () => {
  const rec = asset();
  const buy = evaluateBuybackEligibility({ offchainRecord: rec, currentOwner: "OWNER", wallet: "OWNER", redemptionOpen: true });
  assert.equal(buy.eligible, false);
  assert.ok(buy.reasons.some((x) => x.includes("redeem")));
  assert.equal(evaluateBuybackEligibility({ offchainRecord: rec, currentOwner: "OWNER", wallet: "OWNER" }).eligible, true);
  const acq = evaluateAcquisitionEligibility({ offchainRecord: rec, currentOwner: "VAULT", vaultWallet: "VAULT", redemptionOpen: true });
  assert.equal(acq.eligible, false);
  assert.equal(evaluateAcquisitionEligibility({ offchainRecord: rec, currentOwner: "VAULT", vaultWallet: "VAULT" }).eligible, true);
});

test("operator token: constant-time compare, missing config or header is refused", () => {
  assert.equal(operatorTokenMatches("abc", "abc"), true);
  assert.equal(operatorTokenMatches("abc", "abd"), false);
  assert.equal(operatorTokenMatches("abc", "abcd"), false);
  assert.equal(operatorTokenMatches("", "abc"), false);
  assert.equal(operatorTokenMatches(null, "abc"), false);
  assert.equal(operatorTokenMatches("abc", undefined), false);
  const req = (token) => new Request("http://x/", { headers: token ? { [OPERATOR_HEADER]: token } : {} });
  delete process.env.TWINFOLD_OPERATOR_TOKEN;
  assert.equal(checkOperatorToken(req("anything")).ok, false); // not configured
  process.env.TWINFOLD_OPERATOR_TOKEN = "secret-token";
  assert.equal(checkOperatorToken(req()).ok, false);
  assert.equal(checkOperatorToken(req("nope")).ok, false);
  assert.equal(checkOperatorToken(req("secret-token")).ok, true);
});
