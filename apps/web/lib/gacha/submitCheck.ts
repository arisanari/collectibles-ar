// Server-only. Checks a player-signed transaction BEFORE it is relayed to Collector Crypt: the signed-in wallet must be
// one of the transaction's required signers. This stops a session from relaying someone else's transaction through
// our server. It does not interpret what the transaction does (Collector Crypt built it).
import { VersionedTransaction } from "@solana/web3.js";

export type SignerCheck = { ok: true } | { ok: false; reason: "undecodable" | "wallet_not_signer" };

/** Decodes base64 (legacy or v0) and lists the required signers: the first `numRequiredSignatures` static account keys. */
export function requiredSigners(signedTransactionB64: string): string[] | null {
  try {
    const bytes = Buffer.from(signedTransactionB64, "base64");
    if (bytes.length === 0) return null;
    // VersionedTransaction.deserialize reads both legacy and v0 wire formats.
    const message = VersionedTransaction.deserialize(bytes).message;
    return message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map((key) => key.toBase58());
  } catch {
    return null;
  }
}

export function checkWalletIsSigner(signedTransactionB64: string, wallet: string): SignerCheck {
  const signers = requiredSigners(signedTransactionB64);
  if (signers === null) return { ok: false, reason: "undecodable" };
  return signers.includes(wallet) ? { ok: true } : { ok: false, reason: "wallet_not_signer" };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => B58[d]).join("");
}

/**
 * The transaction id of a signed transaction: its first signature (base58), or null when it cannot be decoded or the first
 * signature slot is still empty (all zeros). Public data; kept on the pack record so the chain can be asked later whether
 * the transaction landed.
 */
export function firstSignature(signedTransactionB64: string): string | null {
  try {
    const bytes = Buffer.from(signedTransactionB64, "base64");
    if (bytes.length === 0) return null;
    const first = VersionedTransaction.deserialize(bytes).signatures[0];
    if (!first || first.every((b) => b === 0)) return null;
    return base58Encode(first);
  } catch {
    return null;
  }
}
