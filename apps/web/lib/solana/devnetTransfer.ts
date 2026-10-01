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
import bs58 from "bs58";
import { loadDevnetKeypair, type DevnetWalletLabel } from "./devnetKeys";

const HELIUS_DEVNET_RPC = "https://devnet.helius-rpc.com";

function rpcUrl(): string {
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
 */
export async function sendDevnetTransfer(params: {
  assetAddress: string;
  from: DevnetWalletLabel;
  to: DevnetWalletLabel;
}): Promise<{ signature: string; newOwner: string }> {
  const umi = createUmi(rpcUrl()).use(mplCore());

  const fromKeypair = fromWeb3JsKeypair(loadDevnetKeypair(params.from));
  const signer = createSignerFromKeypair(umi, fromKeypair);
  umi.use(signerIdentity(signer));

  const newOwner = devnetWalletAddress(params.to);
  const assetPk = umiPublicKey(params.assetAddress);
  const asset = await fetchAssetV1(umi, assetPk);

  const tx = await transfer(umi, {
    asset,
    newOwner: umiPublicKey(newOwner),
  }).sendAndConfirm(umi);

  return { signature: bs58.encode(tx.signature), newOwner };
}
