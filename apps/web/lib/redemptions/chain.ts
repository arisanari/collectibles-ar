// Server-only chain side of the redeem dry run. Escrow-signed operations: the redemption escrow wallet is the
// Asset's owner/authority and signs; Twinfold's vault wallet is the fee payer (so the escrow needs no SOL).
// Both keys are loaded only after assertDevnetServerSigningAllowed() (dev-only server signing gate).
// Never logs a secret key.

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { burn, fetchAssetV1, mplCore, transfer } from "@metaplex-foundation/mpl-core";
import { createSignerFromKeypair, signerIdentity, publicKey as umiPublicKey } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import bs58 from "bs58";
import { devnetWalletAddressOrNull } from "../solana/devnetAuthz";
import { loadDevnetKeypair } from "../solana/devnetKeys";
import { assertDevnetServerSigningAllowed } from "../solana/devnetSigningGuard";
import { devnetRpcUrl } from "../solana/devnetTransfer";
import { assertVaultFunded } from "../transferRequests/chain";

export const ESCROW_NOT_CONFIGURED_MESSAGE = "The OshiPin redemption escrow wallet is not configured (scripts/solana: npm run wallets:generate)";
export const ESCROW_LABEL = "OshiPin Redemption Escrow";

export function escrowAddress(): string | null {
  return devnetWalletAddressOrNull("escrow");
}

function setup() {
  assertDevnetServerSigningAllowed();
  const vault = loadDevnetKeypair("vault");
  const escrow = loadDevnetKeypair("escrow");
  const umi = createUmi(devnetRpcUrl()).use(mplCore());
  const vaultSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(vault));
  const escrowSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(escrow));
  umi.use(signerIdentity(vaultSigner)); // identity + fee payer = vault
  return { umi, vaultSigner, escrowSigner, escrowAddress: escrow.publicKey.toBase58() };
}

/**
 * Current owner via the RPC account (not DAS, which can lag): `null` when the account cannot be read
 * (e.g. already burnt). Used where a stale read must never decide a state change.
 */
export async function fetchOwnerViaRpc(assetAddress: string): Promise<string | null> {
  const umi = createUmi(devnetRpcUrl()).use(mplCore());
  try {
    return (await fetchAssetV1(umi, umiPublicKey(assetAddress))).owner.toString();
  } catch {
    return null;
  }
}

export type ChainOutcome = { signature?: string; error?: string };

/**
 * Returns the Asset from escrow to `to` (cancel of a locked redemption). Verifies on chain that the escrow
 * currently owns it. `onSubmitted` fires once the signature is known (before confirmation).
 */
export async function escrowTransferTo(params: {
  assetAddress: string;
  to: string;
  onSubmitted?: (signature: string) => void;
}): Promise<ChainOutcome> {
  const { umi, vaultSigner, escrowSigner, escrowAddress: escrow } = setup();
  await assertVaultFunded();
  const asset = await fetchAssetV1(umi, umiPublicKey(params.assetAddress));
  if (asset.owner.toString() !== escrow) return { error: "The Asset is not in escrow (the owner is not the escrow wallet)" };
  const blockhash = await umi.rpc.getLatestBlockhash();
  const builder = transfer(umi, { asset, newOwner: umiPublicKey(params.to), authority: escrowSigner, payer: vaultSigner }).setBlockhash(blockhash);
  const sent = await builder.send(umi, { preflightCommitment: "confirmed" });
  const signature = bs58.encode(sent);
  params.onSubmitted?.(signature);
  const result = await umi.rpc.confirmTransaction(sent, { strategy: { type: "blockhash", ...blockhash }, commitment: "confirmed" });
  if (result.value.err) return { signature, error: `transaction failed on devnet: ${JSON.stringify(result.value.err)}` };
  return { signature };
}

/** Burns (retires) the Core Asset, signed by the escrow wallet as owner; fee payer = vault. */
export async function escrowBurn(params: { assetAddress: string; onSubmitted?: (signature: string) => void }): Promise<ChainOutcome> {
  const { umi, vaultSigner, escrowSigner, escrowAddress: escrow } = setup();
  await assertVaultFunded();
  const asset = await fetchAssetV1(umi, umiPublicKey(params.assetAddress));
  if (asset.owner.toString() !== escrow) return { error: "The Asset is not in escrow (the owner is not the escrow wallet)" };
  const blockhash = await umi.rpc.getLatestBlockhash();
  const builder = burn(umi, { asset, authority: escrowSigner, payer: vaultSigner }).setBlockhash(blockhash);
  const sent = await builder.send(umi, { preflightCommitment: "confirmed" });
  const signature = bs58.encode(sent);
  params.onSubmitted?.(signature);
  const result = await umi.rpc.confirmTransaction(sent, { strategy: { type: "blockhash", ...blockhash }, commitment: "confirmed" });
  if (result.value.err) return { signature, error: `transaction failed on devnet: ${JSON.stringify(result.value.err)}` };
  return { signature };
}
