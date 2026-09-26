/**
 * Mints a Metaplex Core Asset on Solana devnet from an input file describing
 * a Reference Asset (see inputs/example.json for the shape). Metadata is
 * uploaded to Irys's devnet endpoint (free for small JSON payloads) before
 * mpl-core's `create` is called with the resulting URI.
 *
 * Usage:
 *   npm run mint -- --input=inputs/pipeline-test.json --dry-run
 *   npm run mint -- --input=inputs/pipeline-test.json
 *   npm run mint -- --input=inputs/tf-ukiyoe-001.json --owner=b
 *
 * --dry-run builds and prints the metadata JSON without uploading it or
 * sending any transaction. It never touches the network.
 *
 * Fields left as "未確認" ("unconfirmed") are allowed: this pipeline exists so
 * an Asset can be minted before the artwork's full catalogue (artist,
 * edition, condition survey) arrives, and information can be filled in via a
 * later `update` once the record is complete. This script does not claim
 * authenticity or attribution for any field it did not itself verify.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import bs58 from "bs58";
import { generateSigner, publicKey } from "@metaplex-foundation/umi";
import { create } from "@metaplex-foundation/mpl-core";
import { buildUmi } from "./umi.js";
import { OWNER_A_KEYPAIR_PATH, OWNER_B_KEYPAIR_PATH } from "./config.js";

type MintInput = {
  assetId: string;
  name: string;
  description: string;
  attributes: Record<string, string>;
};

function parseArgs() {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) args.set(match[1], match[2] ?? "true");
  }
  return {
    input: args.get("input"),
    dryRun: args.get("dry-run") === "true",
    owner: args.get("owner") === "b" ? "b" : "a",
  };
}

function readInput(inputPath: string): MintInput {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Input file not found: ${resolved}`);
  }
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8"));
  for (const field of ["assetId", "name", "description", "attributes"]) {
    if (!(field in raw)) {
      throw new Error(`Input file ${resolved} is missing required field "${field}"`);
    }
  }
  return raw as MintInput;
}

function buildOffchainMetadata(input: MintInput) {
  // Standard-ish token metadata JSON (name/description/attributes) so any
  // wallet or explorer can render it. `twinfold` block carries the fields
  // docs/architecture.md section 4 (Physical, Provenance) needs once this
  // Asset is synced into the common model. This metadata as a whole is
  // off-chain evidence, not an on-chain fact, and is labelled as such
  // downstream — but it does not assert a single confirmation level for
  // every field: individual attributes (and the description) may mix
  // confirmed catalogue facts, "推定"/estimated readings, and "未確認"/
  // unconfirmed placeholders, so no single `source` value would be
  // accurate for the whole payload.
  return {
    name: input.name,
    description: input.description,
    attributes: Object.entries(input.attributes).map(([trait_type, value]) => ({
      trait_type,
      value,
    })),
    twinfold: {
      assetId: input.assetId,
      note:
        "Attributes each state whether confirmed, estimated, or unconfirmed. " +
        "Fields with value 'unconfirmed' / '未確認' are open questions pending further cataloguing; " +
        "they are not verified claims.",
    },
  };
}

async function main() {
  const { input, dryRun, owner } = parseArgs();
  if (!input) {
    throw new Error('Missing --input=<path>. Example: --input=inputs/pipeline-test.json');
  }

  const mintInput = readInput(input);
  const offchainMetadata = buildOffchainMetadata(mintInput);

  console.log("Prepared off-chain metadata JSON:");
  console.log(JSON.stringify(offchainMetadata, null, 2));

  if (dryRun) {
    console.log("\n--dry-run: no upload, no transaction sent.");
    return;
  }

  const keypairPath = owner === "b" ? OWNER_B_KEYPAIR_PATH : OWNER_A_KEYPAIR_PATH;
  const umi = buildUmi(keypairPath);

  console.log(`\nUploading metadata to Irys devnet as owner-${owner} (${umi.identity.publicKey})...`);
  const uri = await umi.uploader.uploadJson(offchainMetadata);
  console.log(`Metadata URI: ${uri}`);

  const asset = generateSigner(umi);
  console.log(`Minting Metaplex Core Asset ${asset.publicKey}...`);

  const tx = await create(umi, {
    asset,
    name: mintInput.name,
    uri,
    owner: publicKey(umi.identity.publicKey),
  }).sendAndConfirm(umi);

  const signature = bs58.encode(tx.signature);
  console.log("\nMint confirmed.");
  console.log(`Asset address: ${asset.publicKey}`);
  console.log(`Owner: ${umi.identity.publicKey}`);
  console.log(`Transaction signature: ${signature}`);
  console.log(`Explorer: https://explorer.solana.com/address/${asset.publicKey}?cluster=devnet`);
  console.log(`Explorer (tx): https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
