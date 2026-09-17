import Foundation

/// Reads `Resources/fixtures/demo/assets.json` (synced via
/// scripts/sync-fixtures.sh) and implements the shared `AssetProvider`
/// contract. Screens using this provider must show a "DEMO DATA" label per
/// docs/architecture.md section 5. Mirrors
/// `apps/web/lib/providers/mockAssetProvider.ts`.
///
/// An `actor` (rather than a class guarded by a lock) so `connectedWallet`
/// is safely mutated across concurrent callers without `@unchecked
/// Sendable`.
public actor MockAssetProvider: AssetProvider {
    public nonisolated let isDemoData = true

    private var connectedWallet: String?
    private let assets: [TwinfoldAsset]

    public init(bundle: Bundle? = nil) throws {
        let bundle = bundle ?? Bundle.module
        guard let url = bundle.url(
            forResource: "assets",
            withExtension: "json",
            subdirectory: "fixtures/demo"
        ) else {
            throw AssetProviderError.fixtureNotFound("fixtures/demo/assets.json")
        }
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        do {
            self.assets = try decoder.decode([TwinfoldAsset].self, from: data)
        } catch {
            throw AssetProviderError.decodingFailed(String(describing: error))
        }
    }

    /// Models the wallet session a real backend would track server-side.
    /// Not part of the `AssetProvider` interface.
    public func connect(wallet: String) {
        connectedWallet = wallet
    }

    public func disconnect() {
        connectedWallet = nil
    }

    public func getAssets(wallet: String) async throws -> [TwinfoldAsset] {
        assets.filter { $0.owner == wallet }
    }

    public func getAsset(assetId: String) async throws -> TwinfoldAsset {
        guard let asset = assets.first(where: { $0.id == assetId }) else {
            throw AssetProviderError.assetNotFound(assetId)
        }
        return asset
    }

    public func refreshOwnership(assetId: String) async throws -> Entitlement {
        let asset = try await getAsset(assetId: assetId)
        let wallet = connectedWallet ?? ""
        let canDisplay = !wallet.isEmpty && asset.owner == wallet
        return Entitlement(
            wallet: wallet,
            assetId: assetId,
            canDisplay: canDisplay,
            reason: canDisplay
                ? "demo: chain owner matches wallet"
                : "demo: chain owner does not match wallet",
            checkedAt: ISO8601DateFormatter().string(from: Date())
        )
    }
}
