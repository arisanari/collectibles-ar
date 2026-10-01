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
    /// Network-level failure (timeout, no connection, etc.) reaching a
    /// Backend API, e.g. `SolanaAssetProvider`'s Twinfold API calls.
    case networkFailed(String)
    /// Backend API responded with a non-2xx HTTP status.
    case httpError(status: Int, url: String)
    /// A protocol method was called in a shape it doesn't support (e.g.
    /// `SolanaAssetProvider.refreshOwnership(assetId:)`, which has no
    /// wallet to check against — callers must use the `assetId:wallet:`
    /// overload instead). Distinct from `decodingFailed` so callers can
    /// tell "this call can never succeed as written" from "the server sent
    /// something we couldn't parse".
    case unsupportedOperation(String)
}
