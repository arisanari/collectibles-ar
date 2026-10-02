// Hardening tests for the redeem dry run (security review): stale reads, races, burn verification, Passport content, send targets.
//   node --experimental-strip-types --no-warnings --test scripts/redemption-hardening.test.mjs
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { register } from "node:module";
import { test } from "node:test";
import bs58 from "bs58";

process.env.TWINFOLD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "twinfold-redeem-hard-"));
register("./ts-resolve-hooks.mjs", import.meta.url);
const store = await import("../lib/redemptions/store.ts");
const { decideLockedCancel, decideOwnerBack, isTwinfoldOperatedWallet } = await import("../lib/redemptions/decide.ts");
const { isBurnTransaction } = await import("../lib/solana/burnDetect.ts");
const { buildPassport, PASSPORT_STEP_NOTES } = await import("../lib/redemptions/passport.ts");
const { applyRedemptionOverlay } = await import("../lib/redemptions/overlay.ts");

let n = 0;
const create = (assetId) => store.createRedemption({ id: `red-h-${++n}-${Math.random().toString(36).slice(2, 8)}`, wallet: `W${n}`, assetId, assetAddress: "ADDR" }).redemption;

test("H1: a stale owner read can never cancel a locked redemption; only a known, confirmed return signature can", () => {
  assert.equal(decideLockedCancel(undefined, undefined), "stay"); // DAS says old owner, no return tx known
  assert.equal(decideLockedCancel(undefined, "confirmed"), "stay");
  assert.equal(decideLockedCancel("sigReturn", "unknown"), "stay");
  assert.equal(decideLockedCancel("sigReturn", "failed"), "stay");
  assert.equal(decideLockedCancel("sigReturn", "confirmed"), "cancel");
  // and the state machine itself still lets a cancel without signature only from requested/locked by the owner route (not reconcile)
  const r = create("a-h1");
  store.markLocked(r, "L");
  assert.equal(r.status, "locked");
});

test("M1: shipped redemptions cannot be cancelled, a rejected markCancelled is reported as not ok; ship only from locked", () => {
  const r = create("a-m1");
  store.markLocked(r, "L");
  assert.equal(store.markShipped(r).ok, true);
  const refused = store.markCancelled(r, "sigReturn");
  assert.equal(refused.ok, false); // the route must turn this into a 409, never a 200
  assert.equal(r.status, "shipped");
  assert.equal(r.events.some((e) => e.kind === "returned"), false); // nothing was recorded for the refused cancel
  // owner back after shipping -> exception decision
  assert.equal(decideOwnerBack("W", "W"), "exception");
  assert.equal(decideOwnerBack("ESCROW", "W"), "stay");
  assert.equal(decideOwnerBack(null, "W"), "stay");
  // L1: ship is refused from exception, and leaving exception clears the reason
  const e = create("a-l1");
  store.markLocked(e, "L");
  store.markException(e, "operator stop: x");
  assert.equal(store.markShipped(e).ok, false);
  assert.equal(e.status, "exception");
  assert.equal(store.markResumed(e).ok, true);
  assert.equal(e.status, "locked");
  assert.equal(e.exceptionReason, undefined);
  assert.equal(e.exceptionFrom, undefined);
});

const MPL = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const tx = (disc, program = MPL, err = null) => ({
  transaction: { message: { accountKeys: ["payer", program], instructions: [{ programIdIndex: 1, data: bs58.encode(Uint8Array.from([disc, 0])) }] } },
  meta: { err, innerInstructions: [] },
});

test("M2: only a Core BurnV1 transaction counts as the retire; a transfer / other program / failed tx does not", () => {
  assert.equal(isBurnTransaction(tx(12)), true);
  assert.equal(isBurnTransaction(tx(14)), false); // TransferV1
  assert.equal(isBurnTransaction(tx(12, "11111111111111111111111111111111")), false);
  assert.equal(isBurnTransaction(tx(12, MPL, { InstructionError: [0, "Custom"] })), false);
  assert.equal(isBurnTransaction(null), false);
});

const asset = (id) => ({
  id, network: "devnet", address: "ADDR", standard: "metaplex-core", owner: "O", title: "T",
  display: { kind: "image", imageUrl: "", placeholder: false, rightsNote: "r" }, spatialRepresentation: { kind: "card" },
  physical: { physicalId: "P", condition: "c", rights: "r", custody: { vault: "TWINFOLD", status: "vaulted" }, lastVerifiedAt: "2026-09-30T00:00:00Z" },
  provenance: [{ id: "m", assetId: id, kind: "minted", occurredAt: "2026-09-27T00:00:00Z", source: "onchain", status: "confirmed", transaction: "sigMint", metadata: {} }],
});

test("M3: operator notes and exception events never reach the public Passport or the public asset overlay", () => {
  const r = create("a-m3");
  store.markLocked(r, "L");
  store.markException(r, "operator stop: SECRET-OPERATOR-NOTE");
  store.markResumed(r);
  store.markShipped(r);
  store.markReceived(r);
  store.markRetired(r, "R");
  // Public asset overlay: exception text is replaced by a fixed phrase.
  const overlaid = applyRedemptionOverlay(asset("a-m3"), r);
  assert.equal(JSON.stringify(overlaid).includes("SECRET-OPERATOR-NOTE"), false);
  // Passport: built from a snapshot that already carries the overlay (worst case: operator text inside metadata.note).
  const snapshot = applyRedemptionOverlay(asset("a-m3"), r);
  snapshot.provenance.push({ id: "x", assetId: "a-m3", kind: "redeemed", occurredAt: "2026-10-01T00:00:00Z", source: "offchain_evidence", status: "pending", metadata: { redeemStep: "shipped", redemptionId: r.id, note: "SECRET-OPERATOR-NOTE" } });
  const p = buildPassport(snapshot, r);
  assert.equal(JSON.stringify(p).includes("SECRET-OPERATOR-NOTE"), false);
  assert.equal(p.provenance.some((e) => e.metadata?.redeemStep === "exception"), false);
  for (const e of p.provenance.filter((e) => typeof e.metadata?.redeemStep === "string")) {
    assert.equal(e.metadata.note, PASSPORT_STEP_NOTES[e.metadata.redeemStep]);
  }
});

test("M4: a plain send to the vault or escrow wallet is recognised (and refused by the route)", () => {
  assert.equal(isTwinfoldOperatedWallet("VAULT", "VAULT", "ESCROW"), true);
  assert.equal(isTwinfoldOperatedWallet("ESCROW", "VAULT", "ESCROW"), true);
  assert.equal(isTwinfoldOperatedWallet("SOMEONE", "VAULT", "ESCROW"), false);
  assert.equal(isTwinfoldOperatedWallet("SOMEONE", null, null), false);
});
