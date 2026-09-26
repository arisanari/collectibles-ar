/**
 * Generates two devnet-only test wallets (owner-a, owner-b) used by the mint
 * pipeline's demo transfer flow, and requests a devnet airdrop for each.
 *
 * Keys are written outside the repo (default ~/.config/twinfold/devnet/) as
 * solana-keygen-compatible JSON (an array of 64 secret key bytes). Only
 * public keys are ever printed to stdout — never the secret key or seed.
 *
 * Usage:
 *   npm run wallets:generate
 *   npm run wallets:generate -- --airdrop=0   # skip airdrop
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  RPC_URL,
  assertDevnet,
  assertKeyDirOutsideRepo,
  KEY_DIR,
  OWNER_A_KEYPAIR_PATH,
  OWNER_B_KEYPAIR_PATH,
} from "./config.js";

const REPO_ROOT = path.resolve(new URL("../../../", import.meta.url).pathname);

function parseAirdropFlag(): number {
  const flag = process.argv.find((arg) => arg.startsWith("--airdrop="));
  if (!flag) return 1; // default: 1 SOL per wallet
  const value = Number(flag.split("=")[1]);
  return Number.isFinite(value) ? value : 1;
}

function writeKeypairIfAbsent(filePath: string, label: string): Keypair {
  if (fs.existsSync(filePath)) {
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(filePath, "utf8")));
    const keypair = Keypair.fromSecretKey(secret);
    console.log(`[${label}] already exists at ${filePath}`);
    console.log(`[${label}] public key: ${keypair.publicKey.toBase58()}`);
    return keypair;
  }

  const keypair = Keypair.generate();
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  console.log(`[${label}] generated new devnet keypair`);
  console.log(`[${label}] saved to ${filePath} (secret key never printed)`);
  console.log(`[${label}] public key: ${keypair.publicKey.toBase58()}`);
  return keypair;
}

async function main() {
  assertDevnet(RPC_URL);
  assertKeyDirOutsideRepo(REPO_ROOT, KEY_DIR);

  const airdropSol = parseAirdropFlag();
  const connection = new Connection(RPC_URL, "confirmed");

  const ownerA = writeKeypairIfAbsent(OWNER_A_KEYPAIR_PATH, "owner-a");
  const ownerB = writeKeypairIfAbsent(OWNER_B_KEYPAIR_PATH, "owner-b");

  if (airdropSol <= 0) {
    console.log("Skipping airdrop (--airdrop=0).");
    return;
  }

  for (const [label, keypair] of [
    ["owner-a", ownerA],
    ["owner-b", ownerB],
  ] as const) {
    try {
      const balanceBefore = await connection.getBalance(keypair.publicKey);
      if (balanceBefore >= airdropSol * LAMPORTS_PER_SOL) {
        console.log(`[${label}] balance already ${balanceBefore / LAMPORTS_PER_SOL} SOL, skipping airdrop`);
        continue;
      }
      const signature = await connection.requestAirdrop(keypair.publicKey, airdropSol * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(signature, "confirmed");
      console.log(`[${label}] airdropped ${airdropSol} SOL (devnet). signature: ${signature}`);
    } catch (error) {
      console.warn(
        `[${label}] airdrop failed (devnet faucet is often rate-limited). ` +
          `Fund manually via https://faucet.solana.com if needed. Error: ${(error as Error).message}`
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
