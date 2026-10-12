# Twinfold Vision

A SwiftUI + RealityKit prototype for visionOS 2. In the Crypto World's Fair 2026 MVP it is the **hero / secondary client (P1)**. The primary client is iPhone AR (`apps/ios`, SwiftUI + RealityKit + ARKit). Both share `packages/TwinfoldCore`. It is used for a hero demo recording that shows the same assets, and as a fallback, without delaying the required end-to-end flow on iOS.

Its role is defined in the [Technical Architecture](../../docs/architecture.md).

The target core interactions are shared with the other clients.

- `Place`: put an asset you own into your own space
- `Unfold`: expand the Ownership, Provenance, Evidence and Physical layers
- `Pull the provenance`: draw the mint and transfer history out of an asset
- `Appear / Disappear`: experience acquisition, transfer and redeem as an asset appearing and its display right lapsing

It does no purchasing, selling, redeem requests, shipping address entry or wallet private key storage. Those belong to the Web. The intended design receives a session signed on the Web through a one-time link code and checks the display right through the API.

## Current implementation

A spatial gallery on fixed data (DEMO DATA). Wallet, Solana assets, provenance events and display-right revocation are not connected. The fixtures are still the anime production art and trading card demo data of the first prototype, not the shared package's fixtures.

## Generating the Xcode project

`project.yml` is for XcodeGen.

```bash
brew install xcodegen
cd apps/visionos
xcodegen generate
open TwinfoldVision.xcodeproj
```

Select the Apple Vision Pro simulator and run.
