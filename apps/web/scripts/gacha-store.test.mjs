// Unit test for the Pull record store, submit signer check, machines cache, formatting, orphan memos and
// openPackForUi (DEMO DATA path). No network, no chain. The store writes under a temp TWINFOLD_DATA_DIR.
//   node --experimental-strip-types --no-warnings --test scripts/gacha-store.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.TWINFOLD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "slabar-gacha-store-"));
register("./ts-resolve-hooks.mjs", import.meta.url);
const store = await import("../lib/gacha/packStore.ts");
const { checkWalletIsSigner, requiredSigners } = await import("../lib/gacha/submitCheck.ts");
const { cachedMachines, clearMachinesCacheForTests, MACHINES_TTL_MS } = await import("../lib/gacha/machinesCache.ts");
const { formatOdds, formatEv, formatStock } = await import("../lib/gacha/format.ts");
const orphans = await import("../lib/gacha/orphanMemos.ts");
const { openPackForUi, isStatusConfirmed } = await import("../lib/gacha/openResult.ts");
const { MockGachaProvider } = await import("../lib/gacha/mockProvider.ts");
const web3 = await import("@solana/web3.js");

const T0 = 1_800_000_000_000;
const pack = (over = {}) => ({ memo: `memo-${Math.random().toString(36).slice(2)}`, wallet: "WalletA", packType: "pokemon_25", ...over });

// ---- pack store -----------------------------------------------------------------------------------------------

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
