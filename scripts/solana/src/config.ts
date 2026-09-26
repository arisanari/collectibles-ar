import * as os from "node:os";
import * as path from "node:path";

/**
 * Devnet-only guard shared by every script in this package. Twinfold does not
 * connect to mainnet from tooling (see AGENTS.md section 3). If someone sets
 * SOLANA_RPC_URL to a non-devnet endpoint, refuse to run instead of silently
 * sending a real transaction.
 */
export const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export function assertDevnet(rpcUrl: string): void {
  if (!/devnet/i.test(rpcUrl)) {
    throw new Error(
      `Refusing to run: SOLANA_RPC_URL "${rpcUrl}" does not look like a devnet endpoint. ` +
        "Twinfold scripts/solana only ever talks to Solana devnet."
    );
  }
}

/**
 * Test wallet keys live outside the repo, per the solana-devnet skill.
 * Override with TWINFOLD_DEVNET_KEY_DIR if you keep them elsewhere, but never
 * point this at a path inside the repo.
 */
export const KEY_DIR =
  process.env.TWINFOLD_DEVNET_KEY_DIR ?? path.join(os.homedir(), ".config", "twinfold", "devnet");

export function assertKeyDirOutsideRepo(repoRoot: string, keyDir: string): void {
  const resolvedRepo = path.resolve(repoRoot);
  const resolvedKeyDir = path.resolve(keyDir);
  if (resolvedKeyDir === resolvedRepo || resolvedKeyDir.startsWith(resolvedRepo + path.sep)) {
    throw new Error(
      `Refusing to run: TWINFOLD_DEVNET_KEY_DIR "${keyDir}" is inside the repo. ` +
        "Test wallet keys must live outside the repo (e.g. ~/.config/twinfold/devnet/)."
    );
  }
}

export const OWNER_A_KEYPAIR_PATH =
  process.env.TWINFOLD_OWNER_A_KEYPAIR ?? path.join(KEY_DIR, "owner-a.json");
export const OWNER_B_KEYPAIR_PATH =
  process.env.TWINFOLD_OWNER_B_KEYPAIR ?? path.join(KEY_DIR, "owner-b.json");
