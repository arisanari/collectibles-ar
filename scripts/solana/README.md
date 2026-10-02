# scripts/solana

Devnet-only Metaplex Core mint/transfer tooling. Independent `package.json`
from `apps/web` on purpose — this is a one-off pipeline for Operators, not
part of the Web app's dependency tree.

Full explanation of the pipeline, event normalization, and rules lives in the
`solana-devnet` skill: `.claude/skills/solana-devnet/SKILL.md`.

## Setup

```bash
cd scripts/solana
npm install
npm run wallets:generate   # creates ~/.config/twinfold/devnet/{owner-a,owner-b,vault,escrow}.json (escrow: redemption escrow), airdrops devnet SOL
```

## Mint

```bash
npm run mint -- --input=inputs/pipeline-test.json --dry-run   # prints metadata only, no network calls
npm run mint -- --input=inputs/pipeline-test.json             # uploads metadata + mints on devnet
npm run mint -- --input=inputs/<assetId>.json --owner=b        # mint to owner-b instead of owner-a
```

Input files follow `inputs/example.json`'s shape. Unconfirmed fields should be
left as `"未確認"` / `"unconfirmed"` rather than guessed.

Everything here refuses to run against a non-devnet RPC URL (see
`src/config.ts`), and never prints a secret key — only public keys,
transaction signatures, and Asset addresses.

## Rehearsal Asset (redeem dry run)

`inputs/tf-ukiyoe-001-rehearsal-1.json` is a rehearsal token for the redeem dry run. It represents the same
physical item as `tf-ukiyoe-001` and is NOT an additional claim on it and NOT a Reference Asset. Retiring it
rehearses lock -> dry-run shipping -> burn -> Passport without retiring the Reference Asset.

```bash
npm run mint -- --input=inputs/tf-ukiyoe-001-rehearsal-1.json --owner=a   # mints on devnet to owner-a (or --owner=b)
```

Then add the printed address to `SOLANA_ASSET_ADDRESSES` in `apps/web/.env.local` (a JSON object), keeping the
existing entries, e.g. `{"tf-ukiyoe-001":"<address>","tf-ukiyoe-001-rehearsal-1":"<rehearsal address>"}`.
Registry ids of the form `<baseId>-rehearsal-<n>` resolve to the off-chain record of `<baseId>` and are shown
with a REHEARSAL badge. To rehearse as a real owner, transfer it to your Phantom wallet (or acquire it from the
vault) first. Only the escrow wallet (`npm run wallets:generate`) is needed for the redeem lock.

More rehearsal tokens: copy the input to `inputs/<baseId>-rehearsal-<next number>.json` (change `assetId`), mint it the same way
(`tf-ukiyoe-001-rehearsal-2.json` already exists) and add its address to `SOLANA_ASSET_ADDRESSES`.

## Verify

```bash
npm run verify -- --asset=<address>   # Helius DAS getAsset: interface, owner, name, json_uri
```

Reads `HELIUS_API_KEY` from the environment, falling back to
`apps/web/.env.local` if unset. Only ever talks to
`https://devnet.helius-rpc.com` — refuses any other host. Never prints the
API key or a URL containing it.

## Outputs

Successful mints are recorded in `outputs/devnet-assets.json` — asset ID,
network, address, mint transaction signature, owner public key, and metadata
URI only. Never record a secret key or API key there.

