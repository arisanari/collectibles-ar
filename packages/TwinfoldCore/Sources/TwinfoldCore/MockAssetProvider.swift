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

    /// In-memory owner overrides written by `simulateTransfer`, keyed by
    /// `assetId`. `getAssets`/`getAsset`/`refreshOwnership` all read through
    /// this before falling back to the fixture's `owner`.
    private var ownerOverrides: [String: String] = [:]
    /// `transferred` `ProvenanceEvent`s produced by `simulateTransfer`,
    /// appended to the fixture's `provenance` when materializing an asset.
    private var extraProvenance: [String: [ProvenanceEvent]] = [:]
    /// requestId -> the confirmed event already produced for it, so a
    /// repeated call with the same requestId (e.g. a UI retry after a
    /// timeout) returns the prior result instead of transferring again.
    /// Idempotency per AGENTS.md section 3.
    private var transferRequests: [String: ProvenanceEvent] = [:]

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
        assets.map(materialize).filter { $0.owner == wallet }
    }

    public func getAsset(assetId: String) async throws -> TwinfoldAsset {
        guard let asset = assets.first(where: { $0.id == assetId }) else {
            throw AssetProviderError.assetNotFound(assetId)
        }
        return materialize(asset)
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

    /// Simulates an on-chain transfer for the Primary E2E ("別walletへ
    /// transfer → 旧所有者からDisappear → 新所有者へAppear"): waits ~1.5s
    /// (standing in for devnet confirmation latency), then moves
    /// `assetId`'s owner to `wallet` and returns a `confirmed`
    /// `transferred` `ProvenanceEvent`. Callers show their own `pending`
    /// state before awaiting this call (see
    /// `ARSceneController.simulateTransfer(outcome:)`); this method only
    /// ever returns `confirmed`. Idempotent per `requestId`. Mirrors
    /// `apps/web/lib/providers/mockAssetProvider.ts`.
    public func simulateTransfer(assetId: String, to wallet: String, requestId: String) async throws -> ProvenanceEvent {
        if let existing = transferRequests[requestId] {
            return existing
        }

        try await Task.sleep(nanoseconds: 1_500_000_000)

        // Re-check after the wait: a duplicate call with the same
        // requestId may have completed while this one was sleeping (the
        // actor yields other callers during `await`).
        if let existing = transferRequests[requestId] {
            return existing
        }

        guard assets.contains(where: { $0.id == assetId }) else {
            throw AssetProviderError.assetNotFound(assetId)
        }

        let event = ProvenanceEvent(
            id: "tf-transfer-\(requestId)",
            assetId: assetId,
            kind: .transferred,
            occurredAt: ISO8601DateFormatter().string(from: Date()),
            source: .onchain,
            status: .confirmed,
            transaction: "DEMO-TX-TRANSFER-\(requestId)"
        )

        ownerOverrides[assetId] = wallet
        extraProvenance[assetId, default: []].append(event)
        transferRequests[requestId] = event

        return event
    }

    /// Clears all owner overrides and transferred events accumulated by
    /// `simulateTransfer`, restoring every asset to its fixture owner.
    /// Does not touch `connectedWallet`; callers that also want to restore
    /// the demo session (e.g. `ARSceneController.reset()`) should call
    /// `connect(wallet:)` afterwards.
    public func resetDemoState() {
        ownerOverrides.removeAll()
        extraProvenance.removeAll()
        transferRequests.removeAll()
    }

    // MARK: - Private

    private func materialize(_ asset: TwinfoldAsset) -> TwinfoldAsset {
        let owner = ownerOverrides[asset.id] ?? asset.owner
        let extra = extraProvenance[asset.id] ?? []
        guard owner != asset.owner || !extra.isEmpty else { return asset }
        return TwinfoldAsset(
            id: asset.id,
            network: asset.network,
            address: asset.address,
            standard: asset.standard,
            owner: owner,
            title: asset.title,
            display: asset.display,
            provenance: asset.provenance + extra,
            physical: asset.physical
        )
    }
}
