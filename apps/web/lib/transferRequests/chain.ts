// Server-only chain side of owner-approved transfers (Issue #45).
//
// prepare: builds a Metaplex Core TransferV1 whose authority is the OWNER (a
// no-op signer here: the server never holds the owner's key) and whose fee
// payer is Twinfold's vault wallet, partially signed by the server, so the
// owner's Phantom account needs no devnet SOL.
// submit: after `verifyOwnerSignedTransaction` succeeds, sends the final
// transaction through the server's own devnet RPC and waits for confirmation.

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplCore, fetchAssetV1, transfer } from "@metaplex-foundation/mpl-core";
import {
  createNoopSigner,
  createSignerFromKeypair,
  signerIdentity,
  publicKey as umiPublicKey,
} from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { Connection, VersionedMessage, VersionedTransaction } from "@solana/web3.js";
import { loadDevnetKeypair } from "../solana/devnetKeys";
import { assertDevnetServerSigningAllowed } from "../solana/devnetSigningGuard";
import { devnetRpcUrl } from "../solana/devnetTransfer";

export class NotOwnerError extends Error {}
export class BlockhashExpiredError extends Error {}
export class VaultLowBalanceError extends Error {}

/** The vault pays every transaction fee; refuse new work below this (lamports, 0.01 SOL). */
export const MIN_VAULT_LAMPORTS = 10_000_000;
export const VAULT_LOW_BALANCE_MESSAGE = "The SlabAR vault wallet does not have enough devnet SOL, so this cannot be processed now. Please try again later.";

/** Throws VaultLowBalanceError when the vault (fee payer) holds less than MIN_VAULT_LAMPORTS. */
export async function assertVaultFunded(): Promise<void> {
  const vault = loadDevnetKeypair("vault");
  const lamports = await new Connection(devnetRpcUrl(), "confirmed").getBalance(vault.publicKey);
  if (lamports < MIN_VAULT_LAMPORTS) throw new VaultLowBalanceError(`vault balance ${lamports} lamports`);
}

export type SignatureState = "confirmed" | "failed" | "unknown";

/** Signature status from the chain. `unknown` = not (yet) visible; says nothing about whether it will land. */
export async function fetchSignatureState(signature: string): Promise<{ state: SignatureState; error?: string }> {
  const connection = new Connection(devnetRpcUrl(), "confirmed");
  const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const status = value[0];
  if (!status) return { state: "unknown" };
  if (status.err) return { state: "failed", error: `transaction failed on devnet: ${JSON.stringify(status.err)}` };
  if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return { state: "confirmed" };
  return { state: "unknown" };
}

/** True once the chain is past `lastValidBlockHeight`, i.e. a transaction using that blockhash can no longer land. */
export async function blockhashIsDead(lastValidBlockHeight: number): Promise<boolean> {
  const height = await new Connection(devnetRpcUrl(), "confirmed").getBlockHeight("confirmed");
  return height > lastValidBlockHeight;
}

export type PreparedTransfer = {
  /** Partially signed (vault) transaction, base64, for the browser's Phantom. */
  transactionB64: string;
  lastValidBlockHeight: number;
};

export async function prepareOwnerTransfer(params: {
  assetAddress: string;
  owner: string;
  newOwner: string;
}): Promise<PreparedTransfer> {
  // This loads the vault key: same explicit dev-only gate as every other server-signing path.
  assertDevnetServerSigningAllowed();
  await assertVaultFunded();
  const vault = loadDevnetKeypair("vault");
  const umi = createUmi(devnetRpcUrl()).use(mplCore());
  const vaultSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(vault));
  umi.use(signerIdentity(vaultSigner)); // identity + fee payer = vault

  const asset = await fetchAssetV1(umi, umiPublicKey(params.assetAddress));
  if (asset.owner.toString() !== params.owner) throw new NotOwnerError("on-chain owner differs from the requesting wallet");

  const blockhash = await umi.rpc.getLatestBlockhash();
  const builder = transfer(umi, {
    asset,
    newOwner: umiPublicKey(params.newOwner),
    authority: createNoopSigner(umiPublicKey(params.owner)),
    payer: vaultSigner,
  }).setBlockhash(blockhash);
  const built = builder.build(umi);

  // Wrap the Umi message in a web3.js VersionedTransaction so the vault can sign its slot and the owner's slot stays empty.
  const message = VersionedMessage.deserialize(umi.transactions.serializeMessage(built.message));
  const tx = new VersionedTransaction(message);
  tx.sign([vault]);
  return {
    transactionB64: Buffer.from(tx.serialize()).toString("base64"),
    lastValidBlockHeight: blockhash.lastValidBlockHeight,
  };
}

/** Sends a fully signed transaction and waits for `confirmed`. Throws BlockhashExpiredError if it can no longer land. */
export async function sendAndConfirmFinal(
  transaction: Uint8Array,
  lastValidBlockHeight: number,
  onSubmitted: (signature: string) => void,
): Promise<{ signature: string; error?: string }> {
  const connection = new Connection(devnetRpcUrl(), "confirmed");
  const tx = VersionedTransaction.deserialize(transaction);
  const blockhash = tx.message.recentBlockhash;
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(transaction, { skipPreflight: false, preflightCommitment: "confirmed" });
  } catch (error) {
    if (/blockhash not found|block height exceeded/i.test(String(error))) throw new BlockhashExpiredError(String(error));
    throw error;
  }
  onSubmitted(signature);
  try {
    const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (result.value.err) return { signature, error: `transaction failed on devnet: ${JSON.stringify(result.value.err)}` };
    return { signature };
  } catch (error) {
    if (/block height exceeded|expired/i.test(String(error))) throw new BlockhashExpiredError(String(error));
    throw error;
  }
}
