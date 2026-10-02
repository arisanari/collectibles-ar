// Pure verification of an owner-signed transfer transaction (Issue #45).
// Imports only node:crypto and @solana/web3.js (no relative imports) so it can
// be unit-tested directly: `node --experimental-strip-types --test scripts/transfer-verify.test.mjs`.
//
// The server prepared a transaction whose fee payer is Twinfold's vault wallet
// (partially signed by the server) and whose authority is the owner. The
// browser's Phantom adds the owner's signature. Before sending anything we
// check the message the owner signed is byte-for-byte the one we prepared and
// that the owner's signature really verifies; the vault signature that goes on
// chain is always OUR stored one, never the client's copy.

import { createPublicKey, verify } from "node:crypto";
import { VersionedTransaction } from "@solana/web3.js";

// DER prefix for an ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type VerifyFailure = "malformed" | "message_mismatch" | "owner_not_signer" | "bad_owner_signature" | "missing_signature";
export type VerifyResult = { ok: true; transaction: Uint8Array } | { ok: false; reason: VerifyFailure };

const isZero = (bytes: Uint8Array) => bytes.every((b) => b === 0);

/**
 * @param preparedTransaction  the partially signed (vault) transaction the server returned from /prepare
 * @param signedTransaction    what the client sent back after Phantom's signTransaction
 * @param owner                base58 address of the wallet that must have signed
 * @returns the final, fully signed transaction bytes to submit
 */
export function verifyOwnerSignedTransaction(params: {
  preparedTransaction: Uint8Array;
  signedTransaction: Uint8Array;
  owner: string;
}): VerifyResult {
  let prepared: VersionedTransaction;
  let signed: VersionedTransaction;
  try {
    prepared = VersionedTransaction.deserialize(params.preparedTransaction);
    signed = VersionedTransaction.deserialize(params.signedTransaction);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const preparedMessage = Buffer.from(prepared.message.serialize());
  const signedMessage = Buffer.from(signed.message.serialize());
  if (!preparedMessage.equals(signedMessage)) return { ok: false, reason: "message_mismatch" };

  const keys = prepared.message.staticAccountKeys;
  const required = prepared.message.header.numRequiredSignatures;
  const ownerIndex = keys.findIndex((key) => key.toBase58() === params.owner);
  if (ownerIndex < 0 || ownerIndex >= required) return { ok: false, reason: "owner_not_signer" };

  const ownerSignature = signed.signatures[ownerIndex];
  if (!ownerSignature || ownerSignature.length !== 64 || isZero(ownerSignature)) return { ok: false, reason: "bad_owner_signature" };
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, keys[ownerIndex].toBytes()]),
    format: "der",
    type: "spki",
  });
  if (!verify(null, preparedMessage, publicKey, Buffer.from(ownerSignature))) return { ok: false, reason: "bad_owner_signature" };

  // Final = our prepared transaction (with the server's own signatures) + the owner's verified signature.
  prepared.signatures[ownerIndex] = ownerSignature;
  if (prepared.signatures.length < required || prepared.signatures.slice(0, required).some(isZero)) {
    return { ok: false, reason: "missing_signature" };
  }
  return { ok: true, transaction: prepared.serialize() };
}
