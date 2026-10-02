// Server-only. Builds and sends a real Metaplex Core `transfer` on Solana
// devnet, signed with a devnet test wallet's own keypair (see
// devnetSigningGuard.ts for why this is safe only in dev). Only imported by
// app/api/devnet/transfer/route.ts. Independent of scripts/solana (a
// separate npm package per its README) — this duplicates the small amount
// of Umi setup scripts/solana/src/umi.ts does, without the Irys uploader
// (not needed for a transfer).

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplCore, fetchAssetV1, transfer } from "@metaplex-foundation/mpl-core";
import { createSignerFromKeypair, signerIdentity, publicKey as umiPublicKey } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { loadDevnetKeypair, type DevnetWalletLabel } from "./devnetKeys";

const HELIUS_DEVNET_RPC = "https://devnet.helius-rpc.com";

export function devnetRpcUrl(): string {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "HELIUS_API_KEY is not set. Copy apps/web/.env.example to .env.local and fill in a real value."
    );
  }
  return `${HELIUS_DEVNET_RPC}/?api-key=${apiKey}`;
}

/** Public key (base58) for a devnet test wallet label, without exposing its secret key. */
export function devnetWalletAddress(label: DevnetWalletLabel): string {
  return loadDevnetKeypair(label).publicKey.toBase58();
}

/**
 * Signs and sends a devnet transfer of Core Asset `assetAddress` from `from`
 * to `to` (both devnet test wallets whose keypairs live under
 * TWINFOLD_DEVNET_KEY_DIR). Throws on failure; never logs a secret key.
 * Only reachable from the dev-only server-signing route (insecure dev flag).
 */
export async function sendDevnetTransfer(params: {
  assetAddress: string;
  from: DevnetWalletLabel;
  to: DevnetWalletLabel;
}): Promise<{ signature: string; newOwner: string }> {
  const newOwner = devnetWalletAddress(params.to);
  const { signature, error } = await sendDevnetTransferWithSigner({
    assetAddress: params.assetAddress,
    signer: loadDevnetKeypair(params.from),
    newOwner,
  });
  if (error) throw new Error(error);
  return { signature, newOwner };
}

/**
 * Reusable core: sends a Core `transfer` of `assetAddress` to `newOwner`
 * (base58) signed by an arbitrary web3.js `signer` (the current owner, who
 * also pays the fee). Used by `sendDevnetTransfer` (test wallets) and
 * intended for a future server-side "buy from Twinfold" transfer signed by
 * the vault wallet. Never logs the secret key.
 */
export async function sendDevnetTransferWithSigner(params: {
  assetAddress: string;
  signer: Keypair;
  newOwner: string;
  /**
   * Called as soon as the transaction has been sent (signature known) and BEFORE
   * confirmation, so a caller can keep a "submitted" state if confirmation then
   * times out or errors, instead of reporting a failure for a transfer that may land.
   */
  onSubmitted?: (signature: string, lastValidBlockHeight: number) => void;
}): Promise<{ signature: string; error?: string }> {
  const umi = createUmi(devnetRpcUrl()).use(mplCore());
  umi.use(signerIdentity(createSignerFromKeypair(umi, fromWeb3JsKeypair(params.signer))));

  const asset = await fetchAssetV1(umi, umiPublicKey(params.assetAddress));
  const blockhash = await umi.rpc.getLatestBlockhash();
  const builder = transfer(umi, { asset, newOwner: umiPublicKey(params.newOwner) }).setBlockhash(blockhash);
  const sent = await builder.send(umi, { preflightCommitment: "confirmed" });
  const signature = bs58.encode(sent);
  params.onSubmitted?.(signature, blockhash.lastValidBlockHeight);
  const result = await umi.rpc.confirmTransaction(sent, { strategy: { type: "blockhash", ...blockhash }, commitment: "confirmed" });
  if (result.value.err) return { signature, error: `transaction failed on devnet: ${JSON.stringify(result.value.err)}` };
  return { signature };
}
