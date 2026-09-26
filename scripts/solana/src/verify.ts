/**
 * Verifies a devnet Metaplex Core Asset via Helius DAS `getAsset`. Prints
 * interface, owner, name, and json_uri only — never the API key or a URL
 * containing it.
 *
 * Usage:
 *   npm run verify -- --asset=<address>
 *
 * Reads HELIUS_API_KEY from the environment, falling back to
 * apps/web/.env.local (HELIUS_API_KEY=...) if unset. Refuses to run against
 * any host other than devnet.helius-rpc.com.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const HELIUS_DEVNET_HOST = "devnet.helius-rpc.com";

function parseArgs() {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) args.set(match[1], match[2] ?? "true");
  }
  return { asset: args.get("asset") };
}

function loadHeliusApiKey(): string {
  const fromEnv = process.env.HELIUS_API_KEY;
  if (fromEnv) return fromEnv;

  // Fallback: apps/web/.env.local. Read only the HELIUS_API_KEY line; never
  // log the file's contents.
  const envPath = path.resolve(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
  if (!fs.existsSync(envPath)) {
    throw new Error(
      "HELIUS_API_KEY is not set and apps/web/.env.local was not found. " +
        "Set HELIUS_API_KEY in the environment or in apps/web/.env.local."
    );
  }
  const contents = fs.readFileSync(envPath, "utf8");
  const line = contents.split("\n").find((l) => l.trim().startsWith("HELIUS_API_KEY="));
  if (!line) {
    throw new Error("HELIUS_API_KEY not found in apps/web/.env.local.");
  }
  const value = line.split("=").slice(1).join("=").trim();
  if (!value) {
    throw new Error("HELIUS_API_KEY in apps/web/.env.local is empty.");
  }
  return value;
}

async function main() {
  const { asset } = parseArgs();
  if (!asset) {
    throw new Error("Missing --asset=<address>. Example: --asset=E81oVhc5R1bmCPHWmh58qV4YFtFr7rUwFmVnonDJVXLF");
  }

  const apiKey = loadHeliusApiKey();
  const url = `https://${HELIUS_DEVNET_HOST}/?api-key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "twinfold-verify",
      method: "getAsset",
      params: { id: asset },
    }),
  });

  if (!response.ok) {
    // Never include `url` (contains the API key) in any thrown message.
    throw new Error(`Helius DAS request failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as {
    result?: {
      interface?: string;
      ownership?: { owner?: string };
      content?: { metadata?: { name?: string }; json_uri?: string };
    };
    error?: { message?: string };
  };

  if (body.error) {
    throw new Error(`Helius DAS returned an error: ${body.error.message ?? "unknown error"}`);
  }

  const result = body.result;
  if (!result) {
    throw new Error("Helius DAS returned no result for this asset.");
  }

  console.log(`Asset address: ${asset}`);
  console.log(`interface: ${result.interface ?? "未確認"}`);
  console.log(`owner: ${result.ownership?.owner ?? "未確認"}`);
  console.log(`name: ${result.content?.metadata?.name ?? "未確認"}`);
  console.log(`json_uri: ${result.content?.json_uri ?? "未確認"}`);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
