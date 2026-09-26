import * as fs from "node:fs";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplCore } from "@metaplex-foundation/mpl-core";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { createSignerFromKeypair, signerIdentity, type Umi } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { Keypair } from "@solana/web3.js";
import { RPC_URL, assertDevnet } from "./config.js";

/**
 * Builds a Umi instance pinned to Solana devnet, with mpl-core registered and
 * an Irys uploader configured for devnet (free — Irys's devnet bundler does
 * not require funding for small JSON payloads, unlike mainnet Irys/Arweave
 * uploads which cost SOL). We chose Irys over a self-hosted metadata host
 * because it needs no server of our own and mpl-core's `create` only needs a
 * URI, not a specific host.
 */
export function loadKeypair(path: string): Keypair {
  if (!fs.existsSync(path)) {
    throw new Error(
      `Keypair not found at ${path}. Run "npm run wallets:generate" first (scripts/solana).`
    );
  }
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8")));
  return Keypair.fromSecretKey(secret);
}

export function buildUmi(keypairPath: string): Umi {
  assertDevnet(RPC_URL);

  const umi = createUmi(RPC_URL).use(mplCore()).use(
    irysUploader({
      // Irys "devnet" address serves Solana devnet uploads for free at small
      // sizes; this keeps the pipeline test independent of a paid uploader.
      address: "https://devnet.irys.xyz",
    })
  );

  const web3Keypair = loadKeypair(keypairPath);
  const umiKeypair = fromWeb3JsKeypair(web3Keypair);
  const signer = createSignerFromKeypair(umi, umiKeypair);
  umi.use(signerIdentity(signer));

  return umi;
}
