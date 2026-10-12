# Collectibles AR

**Collectibles AR is the AR layer for real cards on Solana. Pull a pack, and the graded card appears life-size in the room you're in.**

[![Collectibles AR demo](apps/web/public/lp/hero-demo.jpg)](https://collectiblesar.com)

[collectiblesar.com](https://collectiblesar.com) · Built for [Crypto World's Fair 2026](https://colosseum.com/worldsfair) (Colosseum, Sept 14 – Oct 12, 2026)

Gacha runs on Collector Crypt's machines hosted in-app; Collectibles AR owns the summon, the display, and the shot. The physical card stays in Collector Crypt's vault. Sell it back and it leaves your room.

> Solana solved moving ownership: you can trade a real card without shipping it. Collectibles AR solves showing it off without shipping it.

## What works

| Flow | Network | Status |
|---|---|---|
| Web: connect Phantom → Pull from the `pokemon_25` machine → open → My Collection | devnet | Completed with real data |
| Web: capsule opening, card revealed through the camera, shot exported to share | devnet | Implemented |
| iPhone: link a wallet from the app through Phantom's in-app browser | n/a | Verified on device |
| iPhone AR: real cards from your own wallet placed on a wall and a desk at graded-slab size | mainnet, read-only | Verified on device with three real cards |
| iPhone AR: a card pulled on the Web appears on the linked iPhone; Passport; sell back and it disappears | devnet | Implemented, not yet verified end to end on device |
| Apple Vision Pro | n/a | Early prototype on demo data |

The public site is the landing page; Pull and Collection are marked "Soon" there. The full devnet flow runs from a local build.

Every screen says where its data comes from: `DEMO DATA` (fixtures), `DEVNET`, or `MAINNET (read-only)`.

## How it works

- **Web** (Next.js 16, React 19, TypeScript): wallet sign-in, machines, Pull and opening, My Collection, buyback
- **iPhone AR** (SwiftUI, RealityKit, ARKit): Appear, Place, Passport, Disappear. Only the iOS app claims life-size
- **Collector Crypt Gacha API**: `generatePack` → sign → `submitTransaction` → `openPack`, idempotent by memo, plus buyback and a VRF verification link for each pull
- **Helius RPC and DAS**: reads the card assets in a wallet (Metaplex Core, pNFT) and normalizes them into one shared model
- **Phantom**: all signing happens on the Web. The iPhone holds no keys

The UI never calls Solana or Collector Crypt directly. It goes through `AssetProvider` and `GachaProvider`, each with a mock and a live implementation that return the same model. Details are in [docs/architecture.md](docs/architecture.md).

## What Collector Crypt does, and what we do not

- Inventory, vault storage, shipping and buyback belong to Collector Crypt. Collectibles AR holds no physical cards, and funds never pass through it
- Price, odds, EV, stock and buyback rate are shown exactly as Collector Crypt publishes them. Nothing here promises a win, a profit or a return
- Grades, `Authenticated`, Insured Value and vault records are claims by Collector Crypt or the grading company. Collectibles AR has not verified them, and neither the NFT nor the Passport proves a card is authentic
- The app never Pulls, buys back or transfers on mainnet. A devnet Pull is not revenue
- The revenue plan is a per-pack fee of up to 10% through Collector Crypt's `can_adopt` feature. Our request is pending and not approved

Collectibles AR is an independent project and is not affiliated with Pokémon, PSA, CGC or Collector Crypt.

## Run it

**Web**

```bash
cd apps/web
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Machines, Pull and opening use Collector Crypt's devnet API and need no key. `.env.example` documents the rest: set `NEXT_PUBLIC_PULL_OPEN=1` to turn the Pull buttons on, and `HELIUS_API_KEY` to read wallet assets. A devnet Pull needs a Phantom wallet on devnet with SOL and devnet USDC ([faucet](https://spl-token-faucet.com/?token-name=USDC-Dev)).

**iPhone AR** (Xcode, [XcodeGen](https://github.com/yonaskolb/XcodeGen), a real iPhone on iOS 17 or later)

```bash
cd apps/ios
xcodegen generate
open TwinfoldAR.xcodeproj
```

In `apps/ios/project.yml`, set `TWINFOLD_API_BASE_URL` to where the iPhone reaches the Web app, and `TWINFOLD_WEB_URL` to a public `https` address for it (Phantom opens this one for the wallet link). Then run on the device with your own signing team.

## Prior work

- **Before Sept 14, 2026**: business documents (not included here), a Web UI prototype and a visionOS prototype, first committed on Sept 18
- **Sept 21 – Oct 6**: an AR collection for ukiyo-e woodblock prints on a wall
- **Oct 6**: pivoted to showing Collector Crypt's real graded cards in AR

The iPhone link, wallet signing and AR placement from the print version are reused. Its fixtures and redeem code remain in the repository, dormant. Code names such as `TwinfoldCore` keep the project's earlier name.

This is the public copy of a private working repository. Internal planning documents were left out, so some code comments point to files that are not here.

## License

© 2026 arisanari. All rights reserved. The code is published for review. No license is granted to use, copy, modify or distribute it.
