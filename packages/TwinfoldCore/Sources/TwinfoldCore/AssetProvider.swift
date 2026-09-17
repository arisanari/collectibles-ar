import Foundation

/// Mirrors the `AssetProvider` interface in `apps/web/lib/contract.ts` /
/// docs/architecture.md section 5. UI code must depend only on this
/// protocol, never on Solana RPC/DAS APIs directly.
public protocol AssetProvider: Sendable {
    /// `true` for fixture-backed providers (must show "DEMO DATA" in UI),
    /// `false` for real devnet connections (must show "DEVNET" in UI).
    var isDemoData: Bool { get }

    func getAssets(wallet: String) async throws -> [TwinfoldAsset]
    func getAsset(assetId: String) async throws -> TwinfoldAsset
    func refreshOwnership(assetId: String) async throws -> Entitlement
}

public enum AssetProviderError: Error, Sendable {
    case assetNotFound(String)
    case fixtureNotFound(String)
    case decodingFailed(String)
}
