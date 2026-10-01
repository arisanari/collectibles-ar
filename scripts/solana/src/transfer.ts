/**
 * Transfers a Metaplex Core Asset between the devnet test wallets
 * (owner-a, owner-b, vault) using mpl-core's `transfer` instruction. Signs
 * with the *sender's* keypair (the current owner or delegate). Also used by
 * apps/web's `/api/devnet/transfer` dev-only server-signing shortcut (see
 * that route's comments) via `transferAsset` below.
 *
 * Usage:
 *   npm run transfer -- --asset=<address> --from=a --to=vault
 *   npm run transfer -- --asset=<address> --from=owner-a --to=owner-b
 *   npm run transfer -- --asset=<address> --from=a --to=b --dry-run
 *
 * --from/--to accept "a"/"owner-a", "b"/"owner-b", "vault" (case-insensitive
 * shorthand). --dry-run resolves and prints the accounts without sending a
 * transaction.
 */
import { publicKey as umiPublicKey } from "@metaplex-foundation/umi";
import { fetchAssetV1, transfer } from "@metaplex-foundation/mpl-core";
import bs58 from "bs58";
import { buildUmi } from "./umi.js";
import { OWNER_A_KEYPAIR_PATH, OWNER_B_KEYPAIR_PATH, VAULT_KEYPAIR_PATH } from "./config.js";

export type WalletLabel = "owner-a" | "owner-b" | "vault";

function normalizeWalletLabel(raw: string): WalletLabel {
  const value = raw.trim().toLowerCase();
  if (value === "a" || value === "owner-a") return "owner-a";
  if (value === "b" || value === "owner-b") return "owner-b";
  if (value === "vault") return "vault";
  throw new Error(`Unknown wallet "${raw}". Use a|owner-a, b|owner-b, or vault.`);
}

function keypairPathFor(label: WalletLabel): string {
  switch (label) {
    case "owner-a":
      return OWNER_A_KEYPAIR_PATH;
    case "owner-b":
      return OWNER_B_KEYPAIR_PATH;
    case "vault":
      return VAULT_KEYPAIR_PATH;
  }
}

function parseArgs() {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) args.set(match[1], match[2] ?? "true");
  }
  const asset = args.get("asset");
  const from = args.get("from");
  const to = args.get("to");
  if (!asset || !from || !to) {
    throw new Error(
      "Usage: npm run transfer -- --asset=<address> --from=a|b|vault --to=a|b|vault [--dry-run]"
    );
  }
  return {
    asset,
    from: normalizeWalletLabel(from),
    to: normalizeWalletLabel(to),
    dryRun: args.get("dry-run") === "true",
  };
}

/**
 * Signs and sends a transfer with the `from` wallet's keypair, returning the
 * transaction signature. Devnet-only (buildUmi -> assertDevnet). Shared by
 * the CLI below and apps/web's dev-only server-signing route.
 */
export async function transferAsset(params: {
  assetAddress: string;
  from: WalletLabel;
  to: WalletLabel;
}): Promise<{ signature: string; newOwner: string }> {
  const umi = buildUmi(keypairPathFor(params.from));
  const assetPk = umiPublicKey(params.assetAddress);
  const asset = await fetchAssetV1(umi, assetPk);

  const toKeypairPath = keypairPathFor(params.to);
  const toUmi = buildUmi(toKeypairPath);
  const newOwner = toUmi.identity.publicKey;

  const tx = await transfer(umi, {
    asset,
    newOwner: umiPublicKey(newOwner),
  }).sendAndConfirm(umi);

  return { signature: bs58.encode(tx.signature), newOwner };
}

async function main() {
  const { asset, from, to, dryRun } = parseArgs();

  if (dryRun) {
    console.log(`--dry-run: would transfer ${asset} from ${from} to ${to}. No transaction sent.`);
    return;
  }

  console.log(`Transferring ${asset} from ${from} to ${to} (devnet)...`);
  const { signature, newOwner } = await transferAsset({ assetAddress: asset, from, to });
  console.log("Transfer confirmed.");
  console.log(`New owner: ${newOwner}`);
  console.log(`Transaction signature: ${signature}`);
  console.log(`Explorer (tx): https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

// Only run the CLI when this file is executed directly (not when imported
// by apps/web's route handler equivalent / tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
