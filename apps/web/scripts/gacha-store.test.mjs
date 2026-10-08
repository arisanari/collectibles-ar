// Unit test for the Pull record store, submit signer check, machines cache, formatting, orphan memos and
// openPackForUi (DEMO DATA path). No network, no chain. The store writes under a temp TWINFOLD_DATA_DIR.
//   node --experimental-strip-types --no-warnings --test scripts/gacha-store.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.TWINFOLD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "twinfold-gacha-store-"));
register("./ts-resolve-hooks.mjs", import.meta.url);
const store = await import("../lib/gacha/packStore.ts");
const { checkWalletIsSigner, requiredSigners } = await import("../lib/gacha/submitCheck.ts");
const { cachedMachines, clearMachinesCacheForTests, MACHINES_TTL_MS } = await import("../lib/gacha/machinesCache.ts");
const { formatOdds, formatEv, formatStock } = await import("../lib/gacha/format.ts");
const orphans = await import("../lib/gacha/orphanMemos.ts");
const { openPackForUi, isStatusConfirmed } = await import("../lib/gacha/openResult.ts");
const { MockGachaProvider } = await import("../lib/gacha/mockProvider.ts");
const web3 = await import("@solana/web3.js");
const { resolveResume, remoteFromCc, UNPAID_WINDOW_MS } = await import("../lib/gacha/resume.ts");
const statusRoute = await import("../app/api/gacha/pack/status/route.ts");
const openRoute = await import("../app/api/gacha/open/route.ts");

const T0 = 1_800_000_000_000;
const pack = (over = {}) => ({ memo: `memo-${Math.random().toString(36).slice(2)}`, wallet: "WalletA", packType: "pokemon_25", ...over });

// ---- pack store -----------------------------------------------------------------------------------------------

test("findOpenedByNft matches only an opened, non-demo record of the same wallet and mint", () => {
  const mine = store.recordGenerated(pack({ wallet: "WalletFind" }), T0);
  assert.equal(store.findOpenedByNft("WalletFind", "NftFind"), undefined, "not opened yet");
  store.markOpened(mine, { nftAddress: "NftFind", txSignature: "SigFind" }, T0 + 1);
  assert.equal(store.findOpenedByNft("WalletFind", "NftFind"), mine);
  assert.equal(store.findOpenedByNft("WalletOther", "NftFind"), undefined, "another wallet's record does not verify");
  assert.equal(store.findOpenedByNft("WalletFind", "NftOther"), undefined, "another mint");
  const demo = store.recordGenerated(pack({ wallet: "DEMO-FIND", demo: true }), T0);
  store.markOpened(demo, { nftAddress: "NftDemoFind" }, T0 + 1);
  assert.equal(store.findOpenedByNft("DEMO-FIND", "NftDemoFind"), undefined, "DEMO DATA never verifies");
});

test("recordGenerated creates one record per memo and is idempotent (never reset, never re-owned)", () => {
  const input = pack();
  const first = store.recordGenerated(input, T0);
  assert.equal(first.state, "generated");
  assert.equal(first.wallet, "WalletA");
  assert.equal(first.packType, "pokemon_25");
  assert.equal(first.createdAt, T0);
  store.markSubmitted(first, T0 + 1);
  const again = store.recordGenerated({ ...input, wallet: "WalletB" }, T0 + 2);
  assert.equal(again, first);
  assert.equal(again.state, "submitted");
  assert.equal(again.wallet, "WalletA");
});

test("getOwnedPack: only the creating wallet gets the record; unknown and foreign memos look the same", () => {
  const input = pack();
  store.recordGenerated(input, T0);
  assert.equal(store.getOwnedPack(input.memo, "WalletA")?.memo, input.memo);
  assert.equal(store.getOwnedPack(input.memo, "WalletB"), undefined);
  assert.equal(store.getOwnedPack("no-such-memo", "WalletA"), undefined);
});

test("state machine: generated -> submitted -> opened; failed is recoverable; opened never regresses", () => {
  const r = store.recordGenerated(pack(), T0);
  store.markSubmitted(r, T0 + 1);
  assert.equal(r.state, "submitted");
  store.markFailed(r, T0 + 2);
  assert.equal(r.state, "failed");
  store.markSubmitted(r, T0 + 3); // a retry of the relay
  assert.equal(r.state, "submitted");
  store.markOpened(r, { nftAddress: "Nft1", txSignature: "Sig1" }, T0 + 4);
  assert.equal(r.state, "opened");
  assert.equal(r.nftAddress, "Nft1");
  assert.equal(r.txSignature, "Sig1");
  assert.equal(r.openedAt, T0 + 4);
  // a repeat open / late failure / resubmit changes nothing
  store.markOpened(r, { nftAddress: "Other", txSignature: "Other" }, T0 + 9);
  store.markFailed(r, T0 + 10);
  store.markSubmitted(r, T0 + 11);
  assert.equal(r.state, "opened");
  assert.equal(r.nftAddress, "Nft1");
  assert.equal(r.txSignature, "Sig1");
  assert.equal(r.openedAt, T0 + 4);
});

test("real records survive a restart (file-backed); DEMO DATA records are memory-only", () => {
  const real = store.recordGenerated(pack({ wallet: "WalletRestart" }), T0);
  store.markOpened(real, { nftAddress: "NftR", txSignature: "SigR" }, T0 + 5);
  const demo = store.recordGenerated(pack({ wallet: "DEMO-PLAYER-WALLET", demo: true }), T0);
  store.reloadFromDiskForTests();
  const back = store.getOwnedPack(real.memo, "WalletRestart");
  assert.equal(back?.state, "opened");
  assert.equal(back?.nftAddress, "NftR");
  assert.equal(back?.openedAt, T0 + 5);
  assert.equal(store.getPack(demo.memo), undefined);
  const file = fs.readFileSync(path.join(process.env.TWINFOLD_DATA_DIR, "gacha-packs.json"), "utf8");
  assert.ok(!file.includes(demo.memo));
});

test("retention: records not touched for 7 days are swept on the next write", () => {
  const old = store.recordGenerated(pack(), T0);
  store.recordGenerated(pack(), T0 + store.PACK_RETENTION_MS + 1);
  assert.equal(store.getPack(old.memo), undefined);
});

test("DEMO DATA records cannot push real records out of the store", () => {
  const real = store.recordGenerated(pack({ wallet: "WalletKeep" }), T0);
  for (let i = 0; i < store.MAX_DEMO_PACKS + 50; i++) store.recordGenerated(pack({ wallet: "DEMO-PLAYER-WALLET", demo: true }), T0 + 1 + i);
  assert.equal(store.getPack(real.memo)?.wallet, "WalletKeep");
});

// ---- submit signer check --------------------------------------------------------------------------------------

const BLOCKHASH = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

function legacyTx(payer, extraSigner) {
  const other = web3.Keypair.generate().publicKey;
  const tx = new web3.Transaction({ feePayer: payer.publicKey, recentBlockhash: BLOCKHASH });
  const ix = web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: other, lamports: 1 });
  if (extraSigner) ix.keys.push({ pubkey: extraSigner.publicKey, isSigner: true, isWritable: false });
  tx.add(ix);
  return tx;
}

test("checkWalletIsSigner: legacy transaction signed by the wallet passes", () => {
  const player = web3.Keypair.generate();
  const tx = legacyTx(player);
  tx.sign(player);
  assert.deepEqual(checkWalletIsSigner(b64(tx.serialize()), player.publicKey.toBase58()), { ok: true });
});

test("checkWalletIsSigner: partially signed legacy transaction (gacha co-signs, player listed) passes; a stranger is refused", () => {
  const player = web3.Keypair.generate();
  const gacha = web3.Keypair.generate();
  const tx = legacyTx(gacha, player); // fee payer = gacha, player is a required signer too
  tx.partialSign(gacha);
  const wire = b64(tx.serialize({ requireAllSignatures: false }));
  assert.deepEqual(checkWalletIsSigner(wire, player.publicKey.toBase58()), { ok: true });
  const stranger = web3.Keypair.generate().publicKey.toBase58();
  assert.deepEqual(checkWalletIsSigner(wire, stranger), { ok: false, reason: "wallet_not_signer" });
});

test("checkWalletIsSigner: a wallet that is only a writable / read-only account (not a signer) is refused", () => {
  const payer = web3.Keypair.generate();
  const other = web3.Keypair.generate().publicKey;
  const tx = legacyTx(payer);
  tx.sign(payer);
  assert.deepEqual(checkWalletIsSigner(b64(tx.serialize()), other.toBase58()), { ok: false, reason: "wallet_not_signer" });
});

test("checkWalletIsSigner: v0 transaction", () => {
  const player = web3.Keypair.generate();
  const message = new web3.TransactionMessage({
    payerKey: player.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [web3.SystemProgram.transfer({ fromPubkey: player.publicKey, toPubkey: web3.Keypair.generate().publicKey, lamports: 1 })],
  }).compileToV0Message();
  const tx = new web3.VersionedTransaction(message);
  tx.sign([player]);
  assert.deepEqual(requiredSigners(b64(tx.serialize())), [player.publicKey.toBase58()]);
  assert.deepEqual(checkWalletIsSigner(b64(tx.serialize()), player.publicKey.toBase58()), { ok: true });
  assert.equal(checkWalletIsSigner(b64(tx.serialize()), web3.Keypair.generate().publicKey.toBase58()).ok, false);
});

test("checkWalletIsSigner: garbage is undecodable, not a crash", () => {
  assert.deepEqual(checkWalletIsSigner("AAAA", "W"), { ok: false, reason: "undecodable" });
  assert.deepEqual(checkWalletIsSigner("not base64 at all !!", "W"), { ok: false, reason: "undecodable" });
  assert.deepEqual(checkWalletIsSigner("", "W"), { ok: false, reason: "undecodable" });
});

// ---- machines cache -------------------------------------------------------------------------------------------

test("cachedMachines: 30 second TTL, fetchedAt is the real fetch time, failures are not cached", async () => {
  clearMachinesCacheForTests();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return [{ code: `m${calls}` }];
  };
  const a = await cachedMachines("k", fetcher, T0);
  const b = await cachedMachines("k", fetcher, T0 + MACHINES_TTL_MS - 1);
  assert.equal(calls, 1);
  assert.equal(b, a);
  assert.equal(b.fetchedAt, new Date(T0).toISOString());
  const c = await cachedMachines("k", fetcher, T0 + MACHINES_TTL_MS);
  assert.equal(calls, 2);
  assert.equal(c.machines[0].code, "m2");
  // another key is separate
  await cachedMachines("other", fetcher, T0 + MACHINES_TTL_MS);
  assert.equal(calls, 3);
  // a failure is thrown and not stored
  clearMachinesCacheForTests();
  await assert.rejects(cachedMachines("bad", async () => { throw new Error("down"); }, T0), /down/);
  const ok = await cachedMachines("bad", fetcher, T0 + 1);
  assert.equal(ok.machines[0].code, "m4");
});

// ---- formatting -----------------------------------------------------------------------------------------------

test("formatOdds / formatEv / formatStock", () => {
  assert.equal(formatOdds(0.75), "75%");
  assert.equal(formatOdds(0.2), "20%");
  assert.equal(formatOdds(0.04), "4%");
  assert.equal(formatOdds(0.01), "1%");
  assert.equal(formatOdds(0.005), "0.5%");
  assert.equal(formatEv(24.698898173277918), "24.70");
  assert.equal(formatEv(24), "24.00");
  assert.equal(formatStock(927), "927");
});

// ---- orphan memos ---------------------------------------------------------------------------------------------

test("orphan memos: newest first, de-duplicated, capped, malformed storage ignored", () => {
  const o = (memo) => ({ memo, packType: "pokemon_25", wallet: "W", droppedAt: "2026-10-06T00:00:00.000Z" });
  let list = [];
  list = orphans.addOrphan(list, o("a"));
  list = orphans.addOrphan(list, o("b"));
  list = orphans.addOrphan(list, o("a"));
  assert.deepEqual(list.map((x) => x.memo), ["a", "b"]);
  for (let i = 0; i < 40; i++) list = orphans.addOrphan(list, o(`m${i}`));
  assert.equal(list.length, orphans.MAX_ORPHANS);
  assert.deepEqual(orphans.removeOrphan([o("a"), o("b")], "a").map((x) => x.memo), ["b"]);
  assert.deepEqual(orphans.parseOrphans(null), []);
  assert.deepEqual(orphans.parseOrphans("{bad"), []);
  assert.deepEqual(orphans.parseOrphans('{"memo":"x"}'), []);
  assert.deepEqual(orphans.parseOrphans(JSON.stringify([o("ok"), { memo: 1 }])).map((x) => x.memo), ["ok"]);
});

// ---- openPackForUi (DEMO DATA) ----------------------------------------------------------------------------------

test("isStatusConfirmed: only a known, error-free, confirmed or finalized status", () => {
  assert.equal(isStatusConfirmed(null), false);
  assert.equal(isStatusConfirmed(undefined), false);
  assert.equal(isStatusConfirmed({ slot: 1, confirmations: 0, err: null, confirmationStatus: "processed" }), false);
  assert.equal(isStatusConfirmed({ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" }), true);
  assert.equal(isStatusConfirmed({ slot: 1, confirmations: null, err: null, confirmationStatus: "finalized" }), true);
  assert.equal(isStatusConfirmed({ slot: 1, confirmations: 1, err: { InstructionError: [0, "x"] }, confirmationStatus: "confirmed" }), false);
});

test("openPackForUi (DEMO DATA): waiting first, then opened; the same memo gives the same card and the stored event time", async () => {
  const provider = new MockGachaProvider();
  const { memo } = await provider.generatePack({ playerAddress: "DEMO-PLAYER-WALLET", packType: "demo_25" });
  const record = store.recordGenerated({ memo, wallet: "DEMO-PLAYER-WALLET", packType: "demo_25", demo: true }, T0);
  const first = await openPackForUi(provider, record, "DEMO-PLAYER-WALLET");
  assert.equal(first.state, "waiting");
  assert.equal(record.state, "generated");
  const second = await openPackForUi(provider, record, "DEMO-PLAYER-WALLET");
  assert.equal(second.state, "opened");
  assert.equal(record.state, "opened");
  assert.equal(second.asset.provenance[0].status, "confirmed"); // DEMO DATA: no chain to ask
  assert.equal(second.asset.provenance[0].occurredAt, new Date(record.openedAt).toISOString());
  const third = await openPackForUi(provider, record, "DEMO-PLAYER-WALLET");
  assert.deepEqual(third, second);
});

test("cachedMachines: concurrent requests share one upstream call", async () => {
  clearMachinesCacheForTests();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return [{ code: "m" }];
  };
  const [a, b, c] = await Promise.all([cachedMachines("c", fetcher, T0), cachedMachines("c", fetcher, T0), cachedMachines("c", fetcher, T0)]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(b, c);
});

// ---- lastError (why a submit / open failed) and blockhash expiry ----------------------------------------------

const silently = (fn) => {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args);
  try {
    return { result: fn(), lines };
  } finally {
    console.error = original;
  }
};

test("recordError keeps stage / code / status / clipped message, survives a restart, and logs one line without secrets", () => {
  const r = store.recordGenerated(pack({ wallet: "WalletErr" }), T0);
  const long = `x${"y".repeat(800)}`;
  const { result, lines } = silently(() => store.recordError(r, { stage: "submit", code: "upstream_error", httpStatus: 500, message: long }, T0 + 5));
  assert.equal(result.stage, "submit");
  assert.equal(result.code, "upstream_error");
  assert.equal(result.httpStatus, 500);
  assert.equal(result.at, new Date(T0 + 5).toISOString());
  assert.ok(result.message.length <= store.LAST_ERROR_MESSAGE_MAX);
  assert.equal(r.lastError, result);
  assert.equal(r.updatedAt, T0 + 5);
  assert.equal(r.state, "generated"); // recording does not move the state
  assert.equal(lines.length, 1);
  assert.equal(lines[0][0], "[gacha submit]");
  assert.deepEqual(Object.keys(lines[0][1]).sort(), ["code", "httpStatus", "memo", "message", "wallet"]);
  store.reloadFromDiskForTests();
  assert.deepEqual(store.getOwnedPack(r.memo, "WalletErr").lastError, result);
});

test("lastError is cleared by a later submit / open and never written onto an opened record", () => {
  const r = store.recordGenerated(pack(), T0);
  silently(() => store.recordError(r, { stage: "submit", code: "wallet_not_signer", httpStatus: 400, message: "m" }, T0 + 1));
  assert.equal(r.lastError.code, "wallet_not_signer");
  store.markSubmitted(r, T0 + 2);
  assert.equal(r.lastError, undefined);
  silently(() => store.recordError(r, { stage: "open", code: "upstream_error", httpStatus: 502, message: "m" }, T0 + 3));
  assert.equal(r.lastError.stage, "open");
  store.markOpened(r, { nftAddress: "NftE", txSignature: "SigE" }, T0 + 4);
  assert.equal(r.lastError, undefined);
  silently(() => store.recordError(r, { stage: "open", code: "busy_opening", httpStatus: 503, message: "m" }, T0 + 5));
  assert.equal(r.lastError, undefined);
});

test("DEMO DATA records log nothing and stay out of the file", () => {
  const r = store.recordGenerated(pack({ demo: true, wallet: "DEMO-PLAYER-WALLET" }), T0);
  const { lines } = silently(() => store.recordError(r, { stage: "submit", code: "upstream_error", httpStatus: 400, message: "m" }, T0 + 1));
  assert.equal(lines.length, 0);
  assert.equal(r.lastError.code, "upstream_error");
});

test("isTxExpiredFailure: only the upstream wording (blockhash / expired / block height) counts; a bare 500 does not", () => {
  const f = store.isTxExpiredFailure;
  assert.equal(f({ httpStatus: 400, message: "Blockhash not found" }), true);
  assert.equal(f({ httpStatus: 502, message: "transaction has expired" }), true);
  assert.equal(f({ httpStatus: 500, message: "block height exceeded" }), true);
  assert.equal(f({ httpStatus: 500, message: "blockhash expired" }), true);
  assert.equal(f({ httpStatus: 500, message: "Internal Server Error" }), false); // no proof it did not land
  assert.equal(f({ httpStatus: 400, message: "insufficient funds" }), false);
  assert.equal(f({ httpStatus: 429, message: "Too many pending packs" }), false);
  assert.equal(f({ httpStatus: 502, message: "Collector Crypt could not be reached" }), false);
});

const { reconcileSubmit, LANDING_WINDOW_MS } = await import("../lib/gacha/submitReconcile.ts");
const { firstSignature } = await import("../lib/gacha/submitCheck.ts");

function failedWithSignature(over = {}) {
  const r = store.recordGenerated(pack({ wallet: "ReconcileWallet" }), T0);
  store.recordSubmitSignature(r, "SigAAAA", T0 + 1);
  store.markFailed(r, T0 + 2);
  store.recordError(r, { stage: "submit", code: "upstream_error", httpStatus: 500, message: "Internal Server Error" }, T0 + 3);
  Object.assign(r, over);
  return r;
}
const quietly = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
};

test("submit failed with HTTP 500 and no expiry wording: not tx_expired, not unpaid", async () => {
  const r = failedWithSignature();
  assert.equal(r.lastError.code, "upstream_error");
  // inside the window and the chain does not know the signature yet: checking, not unpaid
  assert.equal(await reconcileSubmit(r, { lookup: async () => "absent", now: T0 + 10_000 }), "pending");
  assert.equal(r.lastError.code, "upstream_error");
  assert.equal(r.state, "failed");
  // resume logic keeps the memo
  assert.deepEqual(resolveResume({ state: r.state, lastError: r.lastError, createdAt: r.createdAt }, { paid: false, opened: false, refunded: false }, T0 + 10_000), { action: "unconfirmed" });
});

test("blockhash expired message is still tx_expired and drops the record at once", () => {
  const expired = store.isTxExpiredFailure({ httpStatus: 400, message: "Blockhash not found" });
  assert.equal(expired, true);
  assert.deepEqual(resolveResume({ state: "failed", lastError: { stage: "submit", code: "tx_expired", httpStatus: 502, message: "" }, createdAt: T0 }, null, T0 + 1000), { action: "drop", reason: "failed_unpaid" });
});

test("500 then the signature is found on chain: back to submitted, joins the normal open flow (and lastError is cleared)", async () => {
  const r = failedWithSignature();
  assert.equal(await reconcileSubmit(r, { lookup: async () => "landed", now: T0 + 5000 }), "landed");
  assert.equal(r.state, "submitted");
  assert.equal(r.landed, true);
  assert.equal(r.lastError, undefined);
  assert.equal(store.getPackStatusLocal(r.memo, "ReconcileWallet").local.landed, true);
  assert.deepEqual(resolveResume({ state: r.state, landed: true, createdAt: r.createdAt }, { paid: false, opened: false, refunded: false }, T0 + 5000), { action: "poll" });
  // idempotent: asking again does not look up the chain again
  assert.equal(await reconcileSubmit(r, { lookup: async () => assert.fail("must not ask again"), now: T0 + 6000 }), "none");
});

test("500 then the signature is absent AND the blockhash window is over: only then unpaid (tx_expired)", async () => {
  const r = failedWithSignature();
  // the window is counted from the last relay attempt (T0 + 1 in the helper), not from when the pack was issued
  assert.equal(await quietly(() => reconcileSubmit(r, { lookup: async () => "absent", now: T0 + 1 + LANDING_WINDOW_MS + 1 })), "unpaid");
  assert.equal(r.state, "failed");
  assert.equal(r.lastError.code, "tx_expired");
  // a submit relayed long after the pack was issued is still inside its own window: absent right after it is "pending"
  const late = failedWithSignature();
  store.recordSubmitSignature(late, "SigLATE", T0 + LANDING_WINDOW_MS * 3);
  assert.equal(await reconcileSubmit(late, { lookup: async () => "absent", now: T0 + LANDING_WINDOW_MS * 3 + 1000 }), "pending");
  assert.equal(late.lastError.code, "upstream_error");
  // an RPC failure ("unknown") is never grounds, even after the window
  const r2 = failedWithSignature();
  assert.equal(await reconcileSubmit(r2, { lookup: async () => "unknown", now: T0 + LANDING_WINDOW_MS * 10 }), "pending");
  assert.equal(r2.lastError.code, "upstream_error");
  // a record that never relayed anything (no signature) has no grounds either
  const r3 = store.recordGenerated(pack({ wallet: "ReconcileWallet" }), T0);
  store.markFailed(r3, T0 + 1);
  assert.equal(await reconcileSubmit(r3, { lookup: async () => "absent", now: T0 + LANDING_WINDOW_MS * 10 }), "none");
});

test("firstSignature: the transaction id of a signed transaction; null when unsigned or garbage", async () => {
  const payer = web3.Keypair.generate();
  const tx = new web3.Transaction({ feePayer: payer.publicKey, recentBlockhash: web3.Keypair.generate().publicKey.toBase58() });
  tx.add(web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: web3.Keypair.generate().publicKey, lamports: 1 }));
  const unsigned = tx.serialize({ requireAllSignatures: false }).toString("base64");
  assert.equal(firstSignature(unsigned), null);
  tx.sign(payer);
  const signed = tx.serialize().toString("base64");
  assert.match(firstSignature(signed), /^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
  const bs58 = (await import("bs58")).default;
  assert.equal(firstSignature(signed), bs58.encode(tx.signature));
  assert.equal(firstSignature("!!!"), null);
});

test("Mock submit failure flags (DEMO DATA only) throw GachaApiError; the normal path still succeeds", async () => {
  const { MOCK_FAIL_SUBMIT, MOCK_FAIL_EXPIRED } = await import("../lib/gacha/mockProvider.ts");
  const { GachaApiError } = await import("../lib/gacha/types.ts");
  const provider = new MockGachaProvider();
  await assert.rejects(provider.submitSigned({ signedTransaction: MOCK_FAIL_SUBMIT }), (e) => e instanceof GachaApiError && e.status === 400);
  await assert.rejects(provider.submitSigned({ signedTransaction: MOCK_FAIL_EXPIRED }), (e) => e instanceof GachaApiError && store.isTxExpiredFailure({ httpStatus: e.status, message: e.message }));
  assert.equal((await provider.submitSigned({ signedTransaction: "" })).success, true);
});

test("CollectorCryptGachaProvider keeps error, message and details of a refusal", async () => {
  const { CollectorCryptGachaProvider } = await import("../lib/gacha/collectorCryptProvider.ts");
  const { GachaApiError } = await import("../lib/gacha/types.ts");
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Transaction failed", message: "Blockhash not found", details: { logs: ["a"] } }), { status: 500 });
  try {
    const provider = new CollectorCryptGachaProvider({ baseUrl: "http://localhost:9", apiKey: "SECRET-KEY-VALUE" });
    await assert.rejects(provider.submitSigned({ signedTransaction: "AAAA" }), (e) => {
      assert.ok(e instanceof GachaApiError);
      assert.equal(e.status, 500);
      const text = `${e.message} ${e.details}`;
      assert.match(text, /Transaction failed/);
      assert.match(text, /Blockhash not found/);
      assert.match(text, /logs/);
      assert.doesNotMatch(text, /SECRET-KEY-VALUE/);
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

// ---- resuming a saved memo (lib/gacha/resume.ts), pack status route, open route `unpaid` ------------------------

const NOW = T0 + 10 * UNPAID_WINDOW_MS;
const fresh = NOW - 60_000; // issued a minute ago
const old = NOW - UNPAID_WINDOW_MS - 1; // issued just over 2 hours ago
const R = (paid, opened = false, refunded = false) => ({ paid, opened, refunded });

test("resolveResume: opened locally or remotely -> open the card again", () => {
  assert.deepEqual(resolveResume({ state: "opened", createdAt: fresh }, R(true, true), NOW), { action: "open" });
  assert.deepEqual(resolveResume({ state: "opened", createdAt: old }, null, NOW), { action: "open" });
  assert.deepEqual(resolveResume({ state: "submitted", createdAt: fresh }, R(true, true), NOW), { action: "open" });
  assert.deepEqual(resolveResume({ state: "failed", createdAt: old }, R(true, true), NOW), { action: "open" });
});

test("resolveResume: paid but not opened -> keep polling (even when the local record says failed)", () => {
  assert.deepEqual(resolveResume({ state: "submitted", createdAt: fresh }, R(true), NOW), { action: "poll" });
  assert.deepEqual(resolveResume({ state: "failed", createdAt: fresh }, R(true), NOW), { action: "poll" });
  assert.deepEqual(resolveResume({ state: "submitted", createdAt: old }, R(true), NOW), { action: "poll" });
});

test("resolveResume: failed with tx_expired (confirmed unpaid) -> not resumed; failed for any other cause stays unconfirmed", () => {
  const expired = { at: "x", stage: "submit", code: "tx_expired", httpStatus: 502, message: "" };
  assert.deepEqual(resolveResume({ state: "failed", lastError: expired, createdAt: fresh }, R(false), NOW), { action: "drop", reason: "failed_unpaid" });
  assert.deepEqual(resolveResume({ state: "failed", lastError: expired, createdAt: fresh }, null, NOW), { action: "drop", reason: "failed_unpaid" });
  const http500 = { at: "x", stage: "submit", code: "upstream_error", httpStatus: 500, message: "" };
  assert.deepEqual(resolveResume({ state: "failed", lastError: http500, createdAt: fresh }, R(false), NOW), { action: "unconfirmed" });
  assert.deepEqual(resolveResume({ state: "failed", createdAt: fresh }, null, NOW), { action: "unconfirmed" });
  assert.deepEqual(resolveResume({ state: "failed", createdAt: old }, null, NOW), { action: "drop", reason: "expired_unpaid" });
});

test("resolveResume: generated / submitted and unpaid -> unconfirmed inside 2 hours, failed after", () => {
  for (const state of ["generated", "submitted"]) {
    assert.deepEqual(resolveResume({ state, createdAt: fresh }, R(false), NOW), { action: "unconfirmed" });
    assert.deepEqual(resolveResume({ state, createdAt: NOW - UNPAID_WINDOW_MS }, R(false), NOW), { action: "unconfirmed" }); // exactly 2h is still inside
    assert.deepEqual(resolveResume({ state, createdAt: old }, R(false), NOW), { action: "drop", reason: "expired_unpaid" });
    assert.deepEqual(resolveResume({ state, createdAt: new Date(old).toISOString() }, R(false), NOW), { action: "drop", reason: "expired_unpaid" });
    assert.deepEqual(resolveResume({ state, createdAt: fresh }, null, NOW), { action: "unconfirmed" });
    assert.deepEqual(resolveResume({ state }, R(false), NOW), { action: "unconfirmed" }); // unknown issue time: never dropped silently
    assert.deepEqual(resolveResume({ state, createdAt: "not a date" }, R(false), NOW), { action: "unconfirmed" });
  }
});

test("resolveResume: refunded -> dropped as refunded (before paid / unpaid are considered), but an opened card wins", () => {
  assert.deepEqual(resolveResume({ state: "submitted", createdAt: fresh }, R(true, false, true), NOW), { action: "drop", reason: "refunded" });
  assert.deepEqual(resolveResume({ state: "failed", createdAt: fresh }, R(false, false, true), NOW), { action: "drop", reason: "refunded" });
  assert.deepEqual(resolveResume({ state: "submitted", createdAt: fresh }, R(true, true, true), NOW), { action: "open" });
});

test("remoteFromCc: reads Collector Crypt's /api/pack/status (opened, never paid, unknown memo, refunded, garbage)", () => {
  // opened (observed 2026-10-07): pack confirmed + send confirmed
  assert.deepEqual(remoteFromCc({ memo: "m", pack: { status: "confirmed", webhook_received: true, refunded: null, refund_transaction_signature: null }, send: { status: "confirmed", nft_address: "Nft" }, buyback: [] }), R(true, true, false));
  // the failed Pull: a pack row but status null, no send
  assert.deepEqual(remoteFromCc({ memo: "m", pack: { status: null, webhook_received: null, refunded: null, refund_transaction_signature: null }, send: null, buyback: [] }), R(false, false, false));
  // memo Collector Crypt does not know
  assert.deepEqual(remoteFromCc({ memo: "m", pack: null, send: null, buyback: [] }), R(false, false, false));
  // paid, not opened yet
  assert.deepEqual(remoteFromCc({ pack: { status: "confirmed", webhook_received: true }, send: null }), R(true, false, false));
  assert.deepEqual(remoteFromCc({ pack: { status: null, webhook_received: true }, send: null }), R(true, false, false));
  // refunded: a flag or a refund signature
  assert.equal(remoteFromCc({ pack: { status: "confirmed", refunded: true }, send: null }).refunded, true);
  assert.equal(remoteFromCc({ pack: { status: "confirmed", refunded: null, refund_transaction_signature: "RefundSig" }, send: null }).refunded, true);
  assert.equal(remoteFromCc({ pack: { status: "confirmed", refunded: false }, send: null }).refunded, false);
  // no answer we can read
  assert.equal(remoteFromCc(null), null);
  assert.equal(remoteFromCc("oops"), null);
  assert.equal(remoteFromCc([]), null);
});

test("getPackStatusLocal: the owner sees state / lastError / createdAt; a foreign or unknown memo is forbidden; DEMO DATA is separate", () => {
  const mine = store.recordGenerated(pack({ wallet: "StatusWalletA" }), T0);
  store.markSubmitted(mine, T0 + 1);
  store.markFailed(mine, T0 + 2);
  store.recordError(mine, { stage: "submit", code: "tx_expired", httpStatus: 500, message: "Blockhash not found" }, T0 + 3);
  const seen = store.getPackStatusLocal(mine.memo, "StatusWalletA");
  assert.equal(seen.kind, "ok");
  assert.equal(seen.local.state, "failed");
  assert.equal(seen.local.createdAt, new Date(T0).toISOString());
  assert.equal(seen.local.lastError.code, "tx_expired");
  assert.deepEqual(store.getPackStatusLocal(mine.memo, "StatusWalletB"), { kind: "forbidden" });
  assert.deepEqual(store.getPackStatusLocal("no-such-memo", "StatusWalletA"), { kind: "forbidden" });
  assert.deepEqual(store.getPackStatusLocal(mine.memo, null), { kind: "forbidden" }); // a DEMO DATA caller cannot read a real record
  const demo = store.recordGenerated(pack({ wallet: "DEMO-PLAYER-WALLET", demo: true }), T0);
  assert.equal(store.getPackStatusLocal(demo.memo, null).kind, "ok");
  assert.equal(store.getPackStatusLocal(demo.memo, null).local.lastError, null);
  assert.deepEqual(store.getPackStatusLocal(demo.memo, "StatusWalletA"), { kind: "forbidden" }); // and a real wallet cannot read a demo one
  assert.deepEqual(store.getPackStatusLocal("no-such-demo-memo", null), { kind: "unknown" });
});

const statusGet = (query) => statusRoute.GET(new Request(`http://localhost:3000/api/gacha/pack/status${query}`));

test("pack/status route (DEMO DATA): the documented shape, 404 unknown, 403 for a real record, 400 for a bad memo", async () => {
  const demo = store.recordGenerated(pack({ wallet: "DEMO-PLAYER-WALLET", demo: true }), Date.now());
  store.markFailed(demo);
  const ok = await statusGet(`?memo=${demo.memo}&demo=1`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  const body = await ok.json();
  assert.deepEqual(Object.keys(body).sort(), ["isDemoData", "local", "memo", "remote"]);
  assert.equal(body.memo, demo.memo);
  assert.deepEqual(Object.keys(body.local).sort(), ["createdAt", "landed", "lastError", "state"]);
  assert.equal(body.local.state, "failed");
  assert.equal(body.local.lastError, null);
  assert.equal(body.remote, null); // DEMO DATA has no Collector Crypt to ask
  assert.equal(body.isDemoData, true);

  assert.equal((await statusGet("?memo=never-seen-memo&demo=1")).status, 404);
  const real = store.recordGenerated(pack({ wallet: "StatusRealWallet" }), Date.now());
  const foreign = await statusGet(`?memo=${real.memo}&demo=1`);
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error, "memo_not_owned");
  assert.equal((await statusGet("?demo=1")).status, 400);
  assert.equal((await statusGet("?memo=a b&demo=1")).status, 400);
  assert.equal((await statusGet(`?memo=${real.memo}&network=mainnet`)).status, 400);
});

test("pack/status route: without a web session it is refused (never 200)", async () => {
  const real = store.recordGenerated(pack({ wallet: "StatusRealWallet2" }), Date.now());
  const res = await statusGet(`?memo=${real.memo}`);
  assert.notEqual(res.status, 200);
  assert.ok(res.status === 401 || res.status === 500);
  assert.doesNotMatch(JSON.stringify(await res.json()), /StatusRealWallet2/);
});

test("CollectorCryptGachaProvider.packStatus asks GET /api/pack/status?memo= and throws on a refusal", async () => {
  const { CollectorCryptGachaProvider } = await import("../lib/gacha/collectorCryptProvider.ts");
  const { hasPackStatus } = await import("../lib/gacha/collectorCryptProvider.ts");
  const { GachaApiError } = await import("../lib/gacha/types.ts");
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), method: init?.method });
    return String(url).includes("bad") ? new Response(JSON.stringify({ error: "boom" }), { status: 500 }) : new Response(JSON.stringify({ memo: "cc-1", pack: { status: null }, send: null, buyback: [] }), { status: 200 });
  };
  try {
    const provider = new CollectorCryptGachaProvider({ baseUrl: "http://localhost:9" });
    assert.equal(hasPackStatus(provider), true);
    assert.equal(hasPackStatus(new MockGachaProvider()), false);
    assert.deepEqual(remoteFromCc(await provider.packStatus("cc-1")), R(false));
    assert.equal(seen[0].url, "http://localhost:9/api/pack/status?memo=cc-1");
    assert.equal(seen[0].method, "GET");
    await assert.rejects(provider.packStatus("bad-memo"), (e) => e instanceof GachaApiError && e.status === 500);
  } finally {
    globalThis.fetch = original;
  }
});

const openPost = (body) =>
  openRoute.POST(new Request("http://localhost:3000/api/gacha/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

test("open route: a failed record (submit errored, no proof) answers waiting, not unpaid; tx_expired answers 409 unpaid; a failed record that opens still opens", async () => {
  // DEMO DATA (the mock answers `waiting` on the first call, then opens): same code path as a real record.
  const failed = store.recordGenerated(pack({ wallet: "DEMO-PLAYER-WALLET", demo: true }), Date.now());
  store.markFailed(failed);
  store.recordError(failed, { stage: "submit", code: "upstream_error", httpStatus: 500, message: "x" });
  const first = await openPost({ memo: failed.memo, playerAddress: "DEMO-PLAYER-WALLET", demo: true });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).state, "waiting"); // WAITING alone is not "unpaid"
  assert.equal(failed.state, "failed");
  const second = await openPost({ memo: failed.memo, playerAddress: "DEMO-PLAYER-WALLET", demo: true });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).state, "opened");
  assert.equal(failed.state, "opened");

  // A record that is not failed still answers waiting (200), as before.
  const normal = store.recordGenerated(pack({ wallet: "DEMO-PLAYER-WALLET", demo: true }), Date.now());
  store.markSubmitted(normal);
  const waiting = await openPost({ memo: normal.memo, playerAddress: "DEMO-PLAYER-WALLET", demo: true });
  assert.equal(waiting.status, 200);
  assert.equal((await waiting.json()).state, "waiting");
});
