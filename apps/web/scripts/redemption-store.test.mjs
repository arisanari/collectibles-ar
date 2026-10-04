// Unit test for lib/redemptions/{store,passport,passportStore}.ts and lib/solana/rehearsal.ts. No network, no chain.
//   node --experimental-strip-types --no-warnings --test scripts/redemption-store.test.mjs
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { register } from "node:module";
import { test } from "node:test";

process.env.TWINFOLD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "twinfold-redeem-test-"));
register("./ts-resolve-hooks.mjs", import.meta.url);
const store = await import("../lib/redemptions/store.ts");
const { buildPassport, PASSPORT_LIMITATIONS } = await import("../lib/redemptions/passport.ts");
const passports = await import("../lib/redemptions/passportStore.ts");
const { parseRehearsalId, rehearsalRecord } = await import("../lib/solana/rehearsal.ts");

let n = 0;
const create = (over = {}, now = 1_000_000) =>
  store.createRedemption({ id: `red-${++n}-${Math.random().toString(36).slice(2, 8)}`, wallet: `OWNER-${n}`, assetId: `asset-${n}`, assetAddress: "ADDR", ...over }, now);

test("creating starts in requested, dry run, with a requested event", () => {
  const r = create();
  assert.equal(r.ok, true);
  assert.equal(r.redemption.status, "requested");
  assert.equal(r.redemption.dryRun, true);
  assert.equal(r.redemption.events[0].kind, "requested");
});

test("idempotent by id; a second open redemption for the same asset is refused (double request)", () => {
  const first = create({ id: "red-idem-0001", assetId: "a-double" });
  const same = create({ id: "red-idem-0001", assetId: "a-double" });
  assert.equal(same.reason, "exists");
  assert.equal(same.redemption, first.redemption);
  const dup = create({ id: "red-idem-0002", assetId: "a-double" });
  assert.equal(dup.reason, "asset_busy");
  assert.equal(store.isAssetInRedemption("a-double"), true);
});

test("per-wallet cap on open redemptions", () => {
  const w = "CAPPED";
  for (let i = 0; i < store.MAX_OPEN_PER_WALLET; i++) assert.equal(create({ wallet: w }).ok, true);
  assert.equal(create({ wallet: w }).reason, "wallet_cap");
});

test("happy path requested -> locked -> shipped -> received -> retired, each step recorded with its source", () => {
  const r = create({ assetId: "a-happy" }).redemption;
  assert.equal(store.markLocked(r, "sigLock").ok, true);
  assert.equal(r.lockSignature, "sigLock");
  assert.equal(store.markShipped(r).ok, true);
  assert.equal(r.events.at(-1).dryRun, true);
  assert.match(r.events.at(-1).note, /dry run/);
  assert.equal(store.markReceived(r).ok, true);
  assert.equal(store.markRetired(r, "sigBurn").ok, true);
  assert.equal(r.status, "retired");
  assert.deepEqual(r.events.map((e) => e.kind), ["requested", "locked", "shipped", "received", "retired"]);
  assert.equal(r.events.find((e) => e.kind === "locked").source, "onchain");
  assert.equal(r.events.find((e) => e.kind === "shipped").source, "offchain_evidence");
  assert.equal(r.events.find((e) => e.kind === "retired").source, "onchain");
  assert.equal(store.isAssetInRedemption("a-happy"), false);
  assert.equal(store.findEffectiveByAsset("a-happy").status, "retired");
});

test("cancel after shipped is refused; allowed in requested and locked", () => {
  const r = create({ assetId: "a-cancel1" }).redemption;
  store.markLocked(r, "s1");
  store.markShipped(r);
  const refused = store.markCancelled(r, undefined);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "wrong_state");
  assert.equal(r.status, "shipped");
  const a = create({ assetId: "a-cancel2" }).redemption;
  assert.equal(store.markCancelled(a, undefined).ok, true);
  assert.equal(a.status, "cancelled");
  assert.equal(store.isAssetInRedemption("a-cancel2"), false);
  const b = create({ assetId: "a-cancel3" }).redemption;
  store.markLocked(b, "s2");
  assert.equal(store.markCancelled(b, "sigReturn").ok, true);
  assert.deepEqual(b.events.slice(-2).map((e) => e.kind), ["returned", "cancelled"]);
  assert.equal(b.events.at(-2).signature, "sigReturn");
});

test("receive in the wrong state is refused (requested, locked)", () => {
  const r = create({ assetId: "a-wrong" }).redemption;
  assert.equal(store.markReceived(r).ok, false);
  store.markLocked(r, "s");
  const res = store.markReceived(r);
  assert.equal(res.ok, false);
  assert.equal(res.status, "locked");
});

test("a retire failure -> exception (safe stop); only retry via received; never straight to retired", () => {
  const r = create({ assetId: "a-exc" }).redemption;
  store.markLocked(r, "s");
  store.markShipped(r);
  store.markReceived(r);
  assert.equal(store.markException(r, "burn failed: RPC").ok, true);
  assert.equal(r.status, "exception");
  assert.equal(r.exceptionFrom, "received");
  assert.equal(store.isAssetInRedemption("a-exc"), true); // still blocks buyback / send / acquisition
  assert.equal(store.markRetired(r, "x").ok, false);
  assert.equal(store.markCancelled(r, undefined).ok, false);
  assert.equal(store.markReceived(r).ok, true); // operator retry_retire resumes at received
  assert.equal(r.exceptionReason, undefined);
});

test("persistence round-trip: a restart (reload from disk) keeps redemptions and passports", () => {
  const r = create({ assetId: "a-persist", id: "red-persist-0001" }).redemption;
  store.markLocked(r, "sigPersist");
  const file = path.join(process.env.TWINFOLD_DATA_DIR, "redemptions.json");
  assert.ok(fs.existsSync(file));
  assert.equal(fs.readdirSync(process.env.TWINFOLD_DATA_DIR).some((f) => f.endsWith(".tmp")), false);
  store.reloadFromDiskForTests();
  const back = store.getRedemption("red-persist-0001");
  assert.equal(back.status, "locked");
  assert.equal(back.lockSignature, "sigPersist");
  assert.equal(store.findOpenByAsset("a-persist").id, "red-persist-0001");

  const asset = fakeAsset("a-persist");
  const done = create({ assetId: "a-pp", id: "red-persist-0002" }).redemption;
  store.markLocked(done, "L");
  store.markShipped(done);
  store.markReceived(done);
  store.markRetired(done, "R");
  const passport = buildPassport({ ...asset, id: "a-pp" }, done);
  assert.equal(passports.savePassport(passport), true);
  assert.equal(passports.savePassport(passport), false); // written once
  passports.reloadPassportsFromDiskForTests();
  assert.equal(passports.getPassport("a-pp").onchain.retire, "R");
});

test("no personal data: contact keys in a request body and contact-like notes are refused; stored records carry no such field", () => {
  for (const key of ["name", "address", "phone", "email", "shippingAddress", "postal_code", "tel", "recipient", "tracking", "住所"]) {
    assert.equal(store.findPersonalDataKey({ requestId: "x", assetId: "y", [key]: "v" }) !== null, true, key);
  }
  assert.equal(store.findPersonalDataKey({ requestId: "x", assetId: "y" }), null);
  assert.equal(store.sanitizeNote("ok note").ok, true);
  assert.equal(store.sanitizeNote("call 090-1234-5678").ok, false);
  assert.equal(store.sanitizeNote("a@b.com").ok, false);
  assert.equal(store.sanitizeNote("〒100-0001").ok, false);
  assert.equal(store.sanitizeNote("x".repeat(121)).ok, false);
  const r = create({ assetId: "a-pd", name: "Taro", address: "Tokyo" }).redemption; // extra fields are ignored by createRedemption
  assert.deepEqual(Object.keys(r).sort(), ["assetAddress", "assetId", "createdAt", "dryRun", "events", "id", "status", "updatedAt", "wallet"]);
});

function fakeAsset(id) {
  return {
    id,
    network: "devnet",
    address: "ADDR",
    standard: "metaplex-core",
    owner: "OWNER",
    title: "T",
    display: { kind: "image", imageUrl: "/artworks/x.png", placeholder: false, rightsNote: "r" },
    spatialRepresentation: { kind: "card" },
    physical: { physicalId: "PHY-1", condition: "cond", rights: "r", custody: { vault: "TWINFOLD", status: "vaulted" }, lastVerifiedAt: "2026-09-30T08:30:00Z" },
    provenance: [
      { id: "m", assetId: id, kind: "minted", occurredAt: "2026-09-27T00:00:00Z", source: "onchain", status: "confirmed", transaction: "sigMint", metadata: {} },
      { id: "t", assetId: id, kind: "transferred", occurredAt: "2026-09-28T00:00:00Z", source: "onchain", status: "confirmed", transaction: "sigT1", metadata: {} },
      { id: "v", assetId: id, kind: "vaulted", occurredAt: "2026-09-30T08:30:00Z", source: "offchain_evidence", status: "confirmed", metadata: {} },
      { id: "l", assetId: id, kind: "transferred", occurredAt: "2026-10-01T00:00:00Z", source: "onchain", status: "confirmed", transaction: "L", metadata: {} },
    ],
  };
}

test("passport building: provenance up to exit with sources, signatures split, limitations present, burn event added", () => {
  const r = create({ assetId: "a-pb" }).redemption;
  store.markLocked(r, "L");
  store.markShipped(r);
  store.markReceived(r);
  store.markRetired(r, "R");
  const p = buildPassport(fakeAsset("a-pb"), r);
  assert.equal(p.sourceAsset, "ADDR");
  assert.equal(p.physicalId, "PHY-1");
  assert.equal(p.lastVerifiedAt, "2026-09-30T08:30:00Z");
  assert.equal(p.lastVerifiedCondition, "cond");
  assert.deepEqual(p.onchain, { mint: "sigMint", transfers: ["sigT1"], lock: "L", retire: "R" });
  assert.equal(p.provenance.at(-1).kind, "redeemed");
  assert.equal(p.provenance.at(-1).source, "onchain");
  assert.ok(p.provenance.every((e) => ["onchain", "offchain_evidence", "twinfold_interpretation"].includes(e.source)));
  assert.equal(p.dryRun, true);
  assert.ok(p.limitations.length >= 5);
  assert.equal(p.limitations, PASSPORT_LIMITATIONS);
  assert.ok(p.limitations.some((l) => l.includes("does not guarantee the current owner")));
  const text = JSON.stringify(p);
  assert.equal(/住所|電話|tracking|delivery address/.test(text.replace(/records no personal data such as a delivery address/g, "")), false);
});

test("passport is refused for a redemption that is not retired", () => {
  const r = create({ assetId: "a-nr" }).redemption;
  assert.throws(() => buildPassport(fakeAsset("a-nr"), r), /not retired/);
});

test("rehearsal ids resolve to a record marked rehearsal, never a Reference Asset", () => {
  assert.deepEqual(parseRehearsalId("tf-ukiyoe-001-rehearsal-1"), { baseId: "tf-ukiyoe-001", n: 1 });
  assert.equal(parseRehearsalId("tf-ukiyoe-001"), null);
  const rec = rehearsalRecord(fakeAsset("tf-ukiyoe-001"), "tf-ukiyoe-001-rehearsal-1");
  assert.equal(rec.rehearsal, true);
  assert.equal(rec.id, "tf-ukiyoe-001-rehearsal-1");
  assert.match(rec.title, /\(rehearsal\)$/);
  assert.match(rec.titleLocalized.en, /\(rehearsal\)$/);
  assert.equal(rec.physical.physicalId, "PHY-1");
  assert.ok(rec.provenance.every((e) => e.assetId === "tf-ukiyoe-001-rehearsal-1"));
});
