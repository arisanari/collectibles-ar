// Unit test for lib/transferRequests/verify.ts (no network, no server, throwaway keys).
//   node --experimental-strip-types --test scripts/transfer-verify.test.mjs   (Node 22.6+)
import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { verifyOwnerSignedTransaction } from "../lib/transferRequests/verify.ts";

const vault = Keypair.generate(); // fee payer, signs server-side
const owner = Keypair.generate(); // the user's wallet (Phantom)
const stranger = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58(); // any 32-byte base58 works as a stand-in blockhash

function build(lamports) {
  const message = new TransactionMessage({
    payerKey: vault.publicKey,
    recentBlockhash: blockhash,
    // `owner` appears as a required signer (stand-in for mpl-core TransferV1's authority).
    instructions: [SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: stranger.publicKey, lamports })],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function prepared() {
  const tx = build(1);
  tx.sign([vault]); // server's partial signature
  return tx;
}

const run = (preparedTx, signedTx) =>
  verifyOwnerSignedTransaction({
    preparedTransaction: preparedTx.serialize(),
    signedTransaction: signedTx.serialize(),
    owner: owner.publicKey.toBase58(),
  });

test("valid: owner-signed prepared transaction is accepted and fully signed", () => {
  const p = prepared();
  const client = VersionedTransaction.deserialize(p.serialize());
  client.sign([owner]);
  const result = run(p, client);
  assert.equal(result.ok, true);
  const final = VersionedTransaction.deserialize(result.transaction);
  assert.ok(final.signatures.every((s) => s.some((b) => b !== 0)));
});

test("a client that strips the vault signature is still fine (server's own is used)", () => {
  const p = prepared();
  const client = build(1); // unsigned copy of the same message
  client.sign([owner]);
  assert.equal(run(p, client).ok, true);
});

test("tampered message (different amount) is rejected even if the owner signed it", () => {
  const p = prepared();
  const tampered = build(999);
  tampered.sign([vault, owner]);
  const result = run(p, tampered);
  assert.deepEqual(result, { ok: false, reason: "message_mismatch" });
});

test("missing owner signature is rejected", () => {
  const p = prepared();
  const client = VersionedTransaction.deserialize(p.serialize()); // vault only
  assert.deepEqual(run(p, client), { ok: false, reason: "bad_owner_signature" });
});

test("owner slot signed by another key is rejected", () => {
  const p = prepared();
  const client = VersionedTransaction.deserialize(p.serialize());
  const ownerIndex = p.message.staticAccountKeys.findIndex((k) => k.equals(owner.publicKey));
  client.signatures[ownerIndex] = new Uint8Array(64).fill(7); // 64 bytes, but not a signature by `owner`
  assert.deepEqual(run(p, client), { ok: false, reason: "bad_owner_signature" });
});

test("a wallet that is not a required signer is rejected", () => {
  const p = prepared();
  const client = VersionedTransaction.deserialize(p.serialize());
  client.sign([owner]);
  const result = verifyOwnerSignedTransaction({
    preparedTransaction: p.serialize(),
    signedTransaction: client.serialize(),
    owner: stranger.publicKey.toBase58(),
  });
  assert.deepEqual(result, { ok: false, reason: "owner_not_signer" });
});

test("garbage bytes are rejected as malformed", () => {
  const p = prepared();
  const result = verifyOwnerSignedTransaction({
    preparedTransaction: p.serialize(),
    signedTransaction: new Uint8Array([1, 2, 3]),
    owner: owner.publicKey.toBase58(),
  });
  assert.deepEqual(result, { ok: false, reason: "malformed" });
});
