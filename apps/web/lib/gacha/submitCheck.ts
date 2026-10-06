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
