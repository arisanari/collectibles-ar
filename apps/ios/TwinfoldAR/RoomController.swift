import ARKit
import Foundation
import Observation
import RealityKit
import TwinfoldCore
import TwinfoldSpatial

/// One of the demo (fixtures/demo/wallets.json) or devnet public keys this
/// app can act as. Hardcoded here (not loaded from the fixture bundle) to
/// avoid exposing wallets.json through TwinfoldCore's public API. Keep in
/// sync with the JSON file / Issue #14's devnet test wallets by hand per
/// docs/architecture.md section 5 (core-contract skill). Only the *public*
/// key is ever hardcoded — no secret key material lives in this repo.
struct DemoWallet: Identifiable, Hashable {
    let id: String // wallet address
    let label: String

    static let ownerA = DemoWallet(id: "DEMOwalletA1111111111111111111111111111111", label: "Owner A (demo)")
    static let ownerB = DemoWallet(id: "DEMOwalletB2222222222222222222222222222222", label: "Owner B (demo)")
    static let all: [DemoWallet] = [ownerA, ownerB]

    /// devnet owner-a / owner-b public keys (Issue #14). Devnet mode's
    /// wallet switch uses these instead of the DEMOwallet* pairs above.
    static let ownerADevnet = DemoWallet(id: "21hni5fvVgWm1NVAUBkki5ogTVweYsB7G9uVab9xTLWZ", label: "Owner A (devnet)")
    static let ownerBDevnet = DemoWallet(id: "6PWqBp82LwA15yrthuN83qJowaqNCmYBMWK5nUNJBLcn", label: "Owner B (devnet)")
    static let allDevnet: [DemoWallet] = [ownerADevnet, ownerBDevnet]

    static func wallets(for mode: DataMode) -> [DemoWallet] {
        mode == .demo ? all : allDevnet
    }

    static func label(forWallet wallet: String) -> String {
        if wallet == MockAssetProvider.vaultWallet || wallet == "vault" {
            return "Twinfold Vault"
        }
        return (all + allDevnet).first(where: { $0.id == wallet })?.label ?? wallet
    }

    /// The devnet server-signing shortcut's wallet label ("owner-a" /
    /// "owner-b") for this demo/devnet wallet, used by
    /// `SolanaAssetProvider.devnetTransfer(from:to:)`. Not meaningful for
    /// "vault" (Twinfold has no `DemoWallet` — it's addressed directly by
    /// the "vault" label).
    var devnetLabel: String {
        (id == DemoWallet.ownerA.id || id == DemoWallet.ownerADevnet.id) ? "owner-a" : "owner-b"
    }
}

/// Which `AssetProvider` backs the room: bundled fixture (always available)
/// or the Twinfold API's devnet-backed routes (may fail if the API isn't
/// reachable — see `RoomController.loadErrorMessage`). Mirrors
/// `AssetProvider.isDemoData`'s DEMO DATA / DEVNET label split.
enum DataMode: String, CaseIterable, Identifiable, Sendable {
    case demo
    case devnet

    var id: String { rawValue }
    var label: String { self == .demo ? "Demo data" : "Devnet" }
}

enum TransferState: Sendable, Equatable {
    case idle
    case pending
    case confirmed
    case failed
}

/// Which operation a pending/failed `TransferState` belongs to, so "Retry"
/// re-attempts the right thing (P2P send vs. "Twinfoldに売る" buyback)
/// instead of always assuming a P2P send.
enum TransferOperationKind: Sendable {
    case send
    case buyback
}

/// Shown after a transfer confirms, offering a shortcut to switch to the
/// receiving wallet so the Appear can be observed immediately.
struct TransferToast: Identifiable {
    let id = UUID()
    let assetTitle: String
    let destinationWallet: String
    /// Set only for a "Twinfoldに売る" buyback: the offer amount shown in the
    /// sheet (display only — no payment happens in Demo or Devnet mode).
    var buybackOfferAmount: Double? = nil
    var destinationLabel: String { DemoWallet.label(forWallet: destinationWallet) }
    /// True for a "Twinfoldに売る" buyback: there's no "相手の部屋を見る"
    /// shortcut for Twinfold's vault (it isn't one of this app's demo
    /// wallets), so `RoomOverlayView` hides that button.
    var isVaultDestination: Bool { destinationWallet == MockAssetProvider.vaultWallet }
}

/// Everything materialized in the scene for one placed asset. Present only
/// while that asset is both placed (has a `PlacementCoord`) and owned by
/// `activeWallet` — `syncEntities()` adds/removes these as ownership or
/// wallet changes.
private struct LiveEntity {
    var anchor: AnchorEntity
    var cardEntity: Entity
    var provenanceColumn: Entity?
    var twinFootprint: (width: Float, height: Float)?
}

/// Session-only placement (world transform + how it was placed) for one
/// asset. Kept independently of `LiveEntity`/wallet: placement is a
/// property of the room, not of who currently owns the asset, so a
/// transferred asset reappears at the same spot once its new owner's
/// wallet is active.
private struct PlacementCoord {
    var transform: simd_float4x4
    var isWallPlacement: Bool
    var isFloorPlacement: Bool
    /// Wall: the card's real-world height (for top-edge snapping). Floor
    /// twin: the settled footprint height. Unused for an air placement.
    var footprintHeight: Float
}

/// Owns placement, selection, holding-preview and simulated-transfer state
/// for every asset in "My Room" (multiple assets at once, replacing the
/// old one-asset-per-screen `ARSceneController`). `ARContainerView` drives
/// this from ARKit tap/per-frame events; this type only touches RealityKit
/// entities, the `TwinfoldSpatial` factories, and
/// `ARWorldTrackingConfiguration.isSupported` for the simulator fallback.
/// Repositioning an already-placed asset is "外す" (remove) + re-place from
/// the tray — there's no drag/move mode, since the holding preview already
/// makes picking a new spot easy.
@MainActor
@Observable
final class RoomController {
    private let mockProvider: MockAssetProvider
    private let devnetProvider: SolanaAssetProvider
    private(set) var dataMode: DataMode = .demo
    /// The currently-active `AssetProvider` for `dataMode`. Read-only from
    /// the outside (screens/tests use this, never `mockProvider`/
    /// `devnetProvider` directly) so `isDemoData`-driven UI (DEMO
    /// DATA/DEVNET badges, transfer disabling) always matches `dataMode`.
    var provider: any AssetProvider { dataMode == .demo ? mockProvider : devnetProvider }
    let isARSupported = ARWorldTrackingConfiguration.isSupported

    weak var arView: ARView?

    private(set) var activeWallet: DemoWallet = .ownerA
    /// Assets `provider.getAssets(activeWallet)` currently returns. The
    /// tray lists these; only these (intersected with placement) ever get
    /// a live entity in the scene.
    private(set) var ownedAssets: [TwinfoldAsset] = []
    private(set) var loadErrorMessage: String?

    private(set) var holdingAssetId: String?
    private(set) var selectedAssetId: String?
    private(set) var transferStates: [String: TransferState] = [:]
    private var transferOperationKinds: [String: TransferOperationKind] = [:]
    private(set) var toast: TransferToast?

    /// The asset a "Twinfoldに売る" offer sheet is currently showing for,
    /// if any. `buybackQuote`/`buybackQuoteError`/`buybackQuoteLoading`
    /// describe that fetch's state; `RoomOverlayView` reads these to render
    /// the sheet.
    private(set) var buybackAssetId: String?
    private(set) var buybackQuote: BuybackQuote?
    private(set) var buybackQuoteError: String?
    private(set) var buybackQuoteLoading = false
    /// Offer amount confirmed per asset, kept until the sale's toast shows it.
    private var buybackOfferAmounts: [String: Double] = [:]
    /// `true` once the current frame's raycast (during holding) found a
    /// matching wall/surface for the held asset's representation. Drives
    /// `hintText`'s "壁に向けてください" vs "タップして壁に掛ける" (and the
    /// floor/desk equivalents).
    private(set) var isPreviewDetected = false

    private var placementCoords: [String: PlacementCoord] = [:]
    private var liveEntities: [String: LiveEntity] = [:]

    private var previewAnchor: AnchorEntity?
    private var pendingPreviewTransform: simd_float4x4?
    private var pendingPreviewIsWall = false
    private var pendingPreviewCardHeight: Float = 0

    private static let placementDistance: Float = 0.4
    /// Top-edge height difference (meters) below which a newly-placed wall
    /// card snaps flush with an already-placed one.
    private static let wallSnapTolerance: Float = 0.03

    init(mockProvider: MockAssetProvider, devnetProvider: SolanaAssetProvider) {
        self.mockProvider = mockProvider
        self.devnetProvider = devnetProvider
    }

    // MARK: - Wallet / ownership

    var placedCount: Int { placementCoords.count }
    var unplacedCount: Int { ownedAssets.filter { placementCoords[$0.id] == nil }.count }

    func isPlaced(_ assetId: String) -> Bool { placementCoords[assetId] != nil }
    func transferState(for assetId: String) -> TransferState { transferStates[assetId] ?? .idle }

    var walletOptions: [DemoWallet] { DemoWallet.wallets(for: dataMode) }

    func start() async {
        await loadOwnedAssets()
    }

    func switchWallet(to wallet: DemoWallet) {
        guard wallet.id != activeWallet.id else { return }
        activeWallet = wallet
        selectedAssetId = nil
        holdingAssetId = nil
        // A `.confirmed` state belongs to the previous owner's transfer; the
        // new owner must see the same Asset as idle (来歴・送る available).
        transferStates = transferStates.filter { $0.value != .confirmed }
        cancelHolding()
        Task { await loadOwnedAssets() }
    }

    /// Switches between the bundled fixture (`DEMO DATA`) and the Twinfold
    /// API's devnet routes (`DEVNET`), clearing every placed
    /// entity/selection/pending-transfer first — the two modes' assets and
    /// wallets are unrelated, so nothing carries over. Defaults are the
    /// active mode's first wallet (Owner A). Defaults to Demo data at app
    /// launch; the user must explicitly switch to Devnet each session.
    func switchDataMode(to mode: DataMode) {
        guard mode != dataMode else { return }

        for live in liveEntities.values {
            arView?.scene.removeAnchor(live.anchor)
        }
        liveEntities.removeAll()
        placementCoords.removeAll()
        transferStates.removeAll()
        transferOperationKinds.removeAll()
        selectedAssetId = nil
        cancelHolding()
        toast = nil
        dismissBuybackOffer()

        dataMode = mode
        activeWallet = DemoWallet.wallets(for: mode).first ?? .ownerA
        Task { await loadOwnedAssets() }
    }

    private func loadOwnedAssets() async {
        if let mock = provider as? MockAssetProvider {
            await mock.connect(wallet: activeWallet.id)
        }
        do {
            ownedAssets = try await provider.getAssets(wallet: activeWallet.id)
            loadErrorMessage = nil
        } catch {
            // Full error goes to the console only; the on-screen text stays
            // short enough to read (and to appear in a demo recording).
            print("loadOwnedAssets failed: \(error)")
            loadErrorMessage = dataMode == .demo
                ? "作品を読み込めませんでした"
                : "Twinfold APIに接続できませんでした。同じWi-Fiにつながっているか、設定の「ローカルネットワーク」でTwinfoldARが許可されているかを確認してください"
        }
        syncEntities()
    }

    /// Adds/removes scene entities so only assets that are both placed
    /// (`placementCoords`) and owned by `activeWallet` (`ownedAssets`) are
    /// visible — the Appear/Disappear mechanism for both wallet switches
    /// and transfer confirmation.
    private func syncEntities() {
        let ownedIds = Set(ownedAssets.map(\.id))

        for (assetId, live) in liveEntities where !ownedIds.contains(assetId) {
            arView?.scene.removeAnchor(live.anchor)
            liveEntities[assetId] = nil
            if selectedAssetId == assetId { selectedAssetId = nil }
        }

        for asset in ownedAssets {
            guard liveEntities[asset.id] == nil, let coord = placementCoords[asset.id] else { continue }
            materialize(assetId: asset.id, asset: asset, transform: coord.transform, isWall: coord.isWallPlacement)
        }
    }

    // MARK: - Tray

    /// Tapping a tray thumbnail: an unplaced asset starts a holding
    /// preview; an already-placed one just selects it (same as tapping its
    /// entity in the scene).
    func trayTap(assetId: String) {
        if placementCoords[assetId] != nil {
            select(assetId)
        } else {
            startHolding(assetId: assetId)
        }
    }

    // MARK: - Holding (placement preview)

    func startHolding(assetId: String) {
        guard let asset = ownedAssets.first(where: { $0.id == assetId }), let arView else { return }
        removePreviewOnly()
        selectedAssetId = nil
        holdingAssetId = assetId
        pendingPreviewTransform = nil
        isPreviewDetected = false

        let entity = AssetRepresentationEntity.makeForWallPlacement(asset: asset)
        let anchor = AnchorEntity(world: matrix_identity_float4x4)
        anchor.addChild(entity)
        // A twin's own mesh origin isn't guaranteed to be its base (see
        // `AssetRepresentationEntity.settleOnAnchor`); settle it here too,
        // before the anchor even has a real position, so the preview
        // already rests on whatever surface the anchor is moved to each
        // frame instead of floating or clipping into it until confirmed.
        // Rotation-invariant since only yaw is ever applied to the anchor.
        if AssetRepresentationEntity.isTwin(asset) {
            _ = AssetRepresentationEntity.settleOnAnchor(entity: entity, anchor: anchor)
        }
        AssetRepresentationEntity.setPreviewTranslucent(true, on: entity)
        arView.scene.addAnchor(anchor)
        previewAnchor = anchor
    }

    func cancelHolding() {
        removePreviewOnly()
        holdingAssetId = nil
        pendingPreviewTransform = nil
        isPreviewDetected = false
    }

    /// Called every frame (via `ARContainerView`'s scene-update
    /// subscription) while holding, so the preview follows the raycast
    /// from the center of the screen.
    func updateHoldingPreview() {
        guard let holdingAssetId,
              let arView,
              let asset = ownedAssets.first(where: { $0.id == holdingAssetId }),
              let previewAnchor,
              isARSupported else {
            isPreviewDetected = false
            return
        }

        let point = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)
        let isTwin = AssetRepresentationEntity.isTwin(asset)

        if isTwin {
            // `.existingPlaneGeometry` first: once ARKit has committed to a
            // plane (typically after the user has looked at the floor/desk
            // for a moment) it's far more stable than the estimate: falling
            // straight to `.estimatedPlane` every frame produced a preview
            // that never settled, which — combined with occlusion from the
            // scene mesh — read as "no preview at all" on device.
            // `.estimatedPlane` stays as the fallback for the first moment
            // before a plane is registered.
            guard let hit = arView.raycast(from: point, allowing: .existingPlaneGeometry, alignment: .horizontal).first
                ?? arView.raycast(from: point, allowing: .estimatedPlane, alignment: .horizontal).first,
                let cameraTransform = arView.session.currentFrame?.camera.transform else {
                isPreviewDetected = false
                return
            }
            let transform = floorTransform(hit: hit, cameraTransform: cameraTransform)
            previewAnchor.transform = Transform(matrix: transform)
            pendingPreviewTransform = transform
            pendingPreviewIsWall = false
            isPreviewDetected = true
        } else {
            guard let hit = arView.raycast(from: point, allowing: .estimatedPlane, alignment: .vertical).first else {
                isPreviewDetected = false
                return
            }
            let transform = wallTransform(hit: hit)
            previewAnchor.transform = Transform(matrix: transform)
            pendingPreviewTransform = transform
            pendingPreviewIsWall = true
            pendingPreviewCardHeight = AssetCardEntity.size(for: asset).height
            isPreviewDetected = true
        }
    }

    /// Finalizes the held asset's placement: uses the last raycast-derived
    /// transform if there is one, otherwise falls back to a camera-facing
    /// air placement, then (AR unsupported, e.g. simulator) a fixed
    /// position offset per already-placed asset so multiple fallback
    /// placements don't overlap.
    func confirmHolding() {
        guard let holdingId = holdingAssetId,
              let asset = ownedAssets.first(where: { $0.id == holdingId }),
              let arView else { return }

        var transform: simd_float4x4
        var isWall = false
        var cardHeight: Float = 0

        if let pendingPreviewTransform {
            transform = pendingPreviewTransform
            isWall = pendingPreviewIsWall
            cardHeight = pendingPreviewCardHeight
        } else if isARSupported, let cameraTransform = arView.session.currentFrame?.camera.transform {
            transform = airTransform(cameraTransform: cameraTransform)
        } else {
            transform = fallbackTransform(index: placementCoords.count)
        }

        if isWall {
            if cardHeight == 0 { cardHeight = AssetCardEntity.size(for: asset).height }
            transform.columns.3.y = snappedWallY(candidateY: transform.columns.3.y, candidateHeight: cardHeight, excludingAssetId: holdingId)
        }

        removePreviewOnly()
        holdingAssetId = nil
        pendingPreviewTransform = nil
        isPreviewDetected = false
        materialize(assetId: holdingId, asset: asset, transform: transform, isWall: isWall, cardHeightOverride: cardHeight)
        selectedAssetId = holdingId
    }

    private func removePreviewOnly() {
        if let previewAnchor {
            arView?.scene.removeAnchor(previewAnchor)
        }
        previewAnchor = nil
    }

    // MARK: - Selection / tap dispatch

    /// Called by `ARContainerView`'s tap gesture with a point in the
    /// `ARView`'s coordinate space.
    func handleTap(at point: CGPoint) {
        guard let arView else { return }

        if holdingAssetId != nil {
            confirmHolding()
            return
        }
        if let hitEntity = arView.entity(at: point), let assetId = ownerAssetId(for: hitEntity) {
            select(assetId)
        } else {
            deselect()
        }
    }

    private func ownerAssetId(for hitEntity: Entity) -> String? {
        for (assetId, live) in liveEntities {
            var current: Entity? = hitEntity
            while let entity = current {
                if entity === live.cardEntity { return assetId }
                current = entity.parent
            }
        }
        return nil
    }

    func select(_ assetId: String) {
        guard liveEntities[assetId] != nil else { return }
        selectedAssetId = assetId
        applyHighlights()
    }

    func deselect() {
        selectedAssetId = nil
        applyHighlights()
    }

    private func applyHighlights() {
        for (assetId, live) in liveEntities {
            // Pending/failed styling already sets its own frame state;
            // only touch idle cards here so it isn't overridden.
            guard transferState(for: assetId) == .idle else { continue }
            AssetCardEntity.setHighlighted(assetId == selectedAssetId, on: live.cardEntity)
        }
    }

    // MARK: - Provenance ("来歴")

    func pullProvenanceForSelected() {
        guard let assetId = selectedAssetId,
              var live = liveEntities[assetId],
              let asset = ownedAssets.first(where: { $0.id == assetId }) else { return }
        closeAllProvenanceColumns(except: assetId)
        guard live.provenanceColumn == nil else { return }

        let column = ProvenanceNodeEntity.makeColumn(events: asset.provenance)
        column.position = SIMD3<Float>(
            provenanceColumnX(for: asset, live: live),
            provenanceColumnY(for: live),
            0
        )
        live.anchor.addChild(column)
        live.provenanceColumn = column
        liveEntities[assetId] = live
    }

    var isProvenancePulledForSelected: Bool {
        guard let selectedAssetId else { return false }
        return liveEntities[selectedAssetId]?.provenanceColumn != nil
    }

    private func closeAllProvenanceColumns(except keepId: String?) {
        for (assetId, live) in liveEntities where assetId != keepId {
            guard let column = live.provenanceColumn else { continue }
            column.removeFromParent()
            liveEntities[assetId]?.provenanceColumn = nil
        }
    }

    // MARK: - Remove ("外す")

    func removeSelected() {
        guard let assetId = selectedAssetId, let live = liveEntities[assetId] else { return }
        arView?.scene.removeAnchor(live.anchor)
        liveEntities[assetId] = nil
        placementCoords[assetId] = nil
        transferStates[assetId] = nil
        transferOperationKinds[assetId] = nil
        selectedAssetId = nil
    }

    // MARK: - Transfer ("送る")

    func destinationWallet(for asset: TwinfoldAsset) -> String {
        let (a, b) = dataMode == .demo ? (DemoWallet.ownerA, DemoWallet.ownerB) : (DemoWallet.ownerADevnet, DemoWallet.ownerBDevnet)
        return asset.owner == a.id ? b.id : a.id
    }

    var destinationLabelForSelected: String {
        guard let selectedAssetId, let asset = ownedAssets.first(where: { $0.id == selectedAssetId }) else { return "" }
        return DemoWallet.label(forWallet: destinationWallet(for: asset))
    }

    var transferStatesContainPending: Bool {
        transferStates.values.contains(.pending)
    }

    /// Demo mode: simulated P2P transfer via `MockAssetProvider`. Devnet
    /// mode (Issue #29): a real devnet transfer via
    /// `/api/devnet/transfer`'s dev-only server-signing shortcut, to the
    /// other devnet test wallet.
    func sendSelected() {
        guard let assetId = selectedAssetId,
              let live = liveEntities[assetId],
              let asset = ownedAssets.first(where: { $0.id == assetId }) else { return }
        let state = transferState(for: assetId)
        guard state == .idle || state == .failed else { return }

        transferStates[assetId] = .pending
        transferOperationKinds[assetId] = .send
        AssetCardEntity.apply(state: .pending, to: live.cardEntity)
        let requestId = UUID().uuidString

        if dataMode == .demo {
            let destination = destinationWallet(for: asset)
            Task { await runTransfer(assetId: assetId, asset: asset, destination: destination, requestId: requestId) }
        } else {
            let toLabel = activeWallet.devnetLabel == "owner-a" ? "owner-b" : "owner-a"
            let destinationWalletId = (toLabel == "owner-a" ? DemoWallet.ownerADevnet : DemoWallet.ownerBDevnet).id
            Task { await runDevnetTransfer(assetId: assetId, asset: asset, requestId: requestId, toLabel: toLabel, destinationWalletId: destinationWalletId, quoteId: nil) }
        }
    }

    /// "外す" isn't available while a "送る"/"Twinfoldに売る" is
    /// pending/failed — `RoomOverlayView`'s Retry button reads this to
    /// decide what to retry.
    func retrySelected() {
        guard let assetId = selectedAssetId else { return }
        switch transferOperationKinds[assetId] ?? .send {
        case .send:
            sendSelected()
        case .buyback:
            // Re-open the offer sheet rather than blindly resending: the
            // quote's eligibility/price may be stale after a failure, and
            // the server re-derives eligibility at send time regardless.
            presentBuybackOffer(assetId: assetId)
        }
    }

    // MARK: - Twinfoldに売る (buyback)

    /// Fetches a fresh buyback offer for `assetId` (defaults to the
    /// selected asset) and opens the offer sheet. DEMO DATA in Demo mode,
    /// a real devnet-derived offer in Devnet mode — no real payment either
    /// way; see `AGENTS.md` section 3 and the buyback-quote route's
    /// comments.
    func presentBuybackOffer(assetId: String? = nil) {
        guard let assetId = assetId ?? selectedAssetId else { return }
        buybackAssetId = assetId
        buybackQuote = nil
        buybackQuoteError = nil
        buybackQuoteLoading = true

        Task {
            do {
                let quote: BuybackQuote
                if let mock = provider as? MockAssetProvider {
                    quote = try await mock.buybackQuote(assetId: assetId, wallet: activeWallet.id)
                } else if let solana = provider as? SolanaAssetProvider {
                    quote = try await solana.buybackQuote(assetId: assetId, wallet: activeWallet.id)
                } else {
                    throw AssetProviderError.unsupportedOperation("no AssetProvider backing found for buyback quote")
                }
                await MainActor.run {
                    self.buybackQuote = quote
                    self.buybackQuoteLoading = false
                }
            } catch {
                await MainActor.run {
                    self.buybackQuoteError = "オファーを取得できませんでした: \(error)"
                    self.buybackQuoteLoading = false
                }
            }
        }
    }

    func dismissBuybackOffer() {
        buybackAssetId = nil
        buybackQuote = nil
        buybackQuoteError = nil
        buybackQuoteLoading = false
    }

    /// Confirms the currently-shown offer: transfers the asset to
    /// Twinfold's vault wallet. Demo mode simulates this exactly like a
    /// P2P transfer (`MockAssetProvider.vaultWallet` as the destination);
    /// Devnet mode sends a real devnet transfer to the vault wallet via the
    /// same `/api/devnet/transfer` shortcut used for P2P sends.
    func confirmBuyback() {
        guard let assetId = buybackAssetId,
              let quote = buybackQuote, quote.eligible,
              let asset = ownedAssets.first(where: { $0.id == assetId }) else { return }
        dismissBuybackOffer()

        transferStates[assetId] = .pending
        transferOperationKinds[assetId] = .buyback
        buybackOfferAmounts[assetId] = quote.offerAmount
        if let live = liveEntities[assetId] {
            AssetCardEntity.apply(state: .pending, to: live.cardEntity)
        }
        let requestId = UUID().uuidString

        if dataMode == .demo {
            Task { await runBuybackDemo(assetId: assetId, asset: asset, requestId: requestId) }
        } else {
            Task {
                await runDevnetTransfer(
                    assetId: assetId, asset: asset, requestId: requestId,
                    toLabel: "vault", destinationWalletId: MockAssetProvider.vaultWallet, quoteId: quote.quoteId
                )
            }
        }
    }

    private func runBuybackDemo(assetId: String, asset: TwinfoldAsset, requestId: String) async {
        guard let mock = provider as? MockAssetProvider else { return }
        do {
            _ = try await mock.simulateTransfer(assetId: assetId, to: MockAssetProvider.vaultWallet, requestId: requestId)
        } catch {
            await MainActor.run { self.failTransfer(assetId: assetId, message: "Twinfoldへの売却に失敗しました: \(error)") }
            return
        }
        do {
            let entitlement = try await provider.refreshOwnership(assetId: assetId)
            await MainActor.run {
                if entitlement.canDisplay {
                    self.failTransfer(assetId: assetId, message: "confirmedですが、このwalletはentitlementを維持しています: \(entitlement.reason)")
                } else {
                    self.confirmTransfer(assetId: assetId, asset: asset, destination: MockAssetProvider.vaultWallet)
                }
            }
        } catch {
            await MainActor.run { self.failTransfer(assetId: assetId, message: "entitlement確認に失敗しました: \(error)") }
        }
    }

    /// Devnet path shared by P2P send and buyback: sends
    /// `/api/devnet/transfer`, then polls (up to 5 minutes, every 5s) until
    /// DAS reflects the new owner — Helius's indexer can lag behind the
    /// devnet RPC confirmation the transfer route itself waits for.
    private func runDevnetTransfer(
        assetId: String, asset: TwinfoldAsset, requestId: String,
        toLabel: String, destinationWalletId: String, quoteId: String?
    ) async {
        guard let solana = provider as? SolanaAssetProvider else { return }
        let opLabel = toLabel == "vault" ? "Twinfoldへの売却" : "送信"
        do {
            let result = try await solana.devnetTransfer(
                requestId: requestId, assetId: assetId, from: activeWallet.devnetLabel, to: toLabel, quoteId: quoteId
            )
            if result.status == .failed {
                await MainActor.run { self.failTransfer(assetId: assetId, message: "\(opLabel)に失敗しました: \(result.error ?? "unknown error")") }
                return
            }
        } catch {
            await MainActor.run { self.failTransfer(assetId: assetId, message: "\(opLabel)に失敗しました: \(error)") }
            return
        }

        let deadline = Date().addingTimeInterval(300)
        while Date() < deadline {
            if let refreshed = try? await solana.getAsset(assetId: assetId), refreshed.owner != activeWallet.id {
                await MainActor.run { self.confirmTransfer(assetId: assetId, asset: asset, destination: destinationWalletId) }
                return
            }
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
        await MainActor.run {
            self.failTransfer(
                assetId: assetId,
                message: "\(opLabel)はdevnet上ではconfirmedですが、所有者情報の反映待ちです（DAS indexing lag）。Retryで再確認します"
            )
        }
    }

    /// Overflow menu "失敗をシミュレート (demo)" for the selected asset.
    func simulateFailureForSelected() {
        guard dataMode == .demo else { return }
        guard let assetId = selectedAssetId,
              let live = liveEntities[assetId],
              transferState(for: assetId) != .pending else { return }
        transferStates[assetId] = .pending
        AssetCardEntity.apply(state: .pending, to: live.cardEntity)
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            await MainActor.run { self.failTransfer(assetId: assetId, message: "transfer failed。Retryしてください") }
        }
    }

    private func runTransfer(assetId: String, asset: TwinfoldAsset, destination: String, requestId: String) async {
        if let mock = provider as? MockAssetProvider {
            do {
                _ = try await mock.simulateTransfer(assetId: assetId, to: destination, requestId: requestId)
            } catch {
                await MainActor.run { self.failTransfer(assetId: assetId, message: "transfer failed: \(error)") }
                return
            }
        } else {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }

        do {
            let entitlement = try await provider.refreshOwnership(assetId: assetId)
            await MainActor.run {
                if entitlement.canDisplay {
                    self.failTransfer(assetId: assetId, message: "transfer confirmedですが、このwalletはentitlementを維持しています: \(entitlement.reason)")
                } else {
                    self.confirmTransfer(assetId: assetId, asset: asset, destination: destination)
                }
            }
        } catch {
            await MainActor.run { self.failTransfer(assetId: assetId, message: "entitlement確認に失敗しました: \(error)") }
        }
    }

    /// The card/twin Disappears via the next `loadOwnedAssets` ->
    /// `syncEntities` pass (this session's wallet no longer owns it), not
    /// removed directly here, so other placed assets are untouched.
    private func confirmTransfer(assetId: String, asset: TwinfoldAsset, destination: String) {
        transferStates[assetId] = .confirmed
        if selectedAssetId == assetId { selectedAssetId = nil }
        toast = TransferToast(
            assetTitle: asset.title, destinationWallet: destination,
            buybackOfferAmount: destination == MockAssetProvider.vaultWallet ? buybackOfferAmounts[assetId] : nil
        )
        Task { await loadOwnedAssets() }
    }

    /// Keeps the card in place (still placed) and shows a red frame, so
    /// the operation card can offer Retry.
    private func failTransfer(assetId: String, message: String) {
        transferStates[assetId] = .failed
        if let live = liveEntities[assetId] {
            AssetCardEntity.apply(state: .failed, to: live.cardEntity)
        }
        loadErrorMessage = message
    }

    func dismissToast() {
        toast = nil
    }

    /// "〈相手〉の部屋を見る" — switches to the destination wallet so the
    /// just-transferred asset Appears at the same spot.
    func viewDestinationRoom() {
        guard let toast, !toast.isVaultDestination else { return }
        let match = (DemoWallet.all + DemoWallet.allDevnet).first(where: { $0.id == toast.destinationWallet })
        switchWallet(to: match ?? .ownerB)
        self.toast = nil
    }

    // MARK: - Reset

    func reset() {
        guard !transferStates.values.contains(.pending) else { return }
        for live in liveEntities.values {
            arView?.scene.removeAnchor(live.anchor)
        }
        liveEntities.removeAll()
        placementCoords.removeAll()
        transferStates.removeAll()
        transferOperationKinds.removeAll()
        selectedAssetId = nil
        cancelHolding()
        toast = nil
        dismissBuybackOffer()
        activeWallet = walletOptions.first ?? .ownerA

        if let mock = provider as? MockAssetProvider {
            Task {
                await mock.resetDemoState()
                await loadOwnedAssets()
            }
        } else {
            Task { await loadOwnedAssets() }
        }
    }

    // MARK: - Hint text

    var hintText: String {
        if let selectedAssetId, transferState(for: selectedAssetId) == .pending {
            return "送信中… 確定を待っています"
        }
        if let selectedAssetId, transferState(for: selectedAssetId) == .failed {
            return "送信に失敗。Retryを押す"
        }
        if let holdingAssetId {
            guard isARSupported else {
                return "AR非対応のため、タップすると固定位置に置きます"
            }
            let isTwin = ownedAssets.first(where: { $0.id == holdingAssetId }).map(AssetRepresentationEntity.isTwin) ?? false
            if isTwin {
                return isPreviewDetected ? "タップして机や床に置く" : "机や床に向けてください"
            } else {
                return isPreviewDetected ? "タップして壁に掛ける" : "壁に向けてください"
            }
        }
        if selectedAssetId != nil {
            return "作品をタップすると来歴や送るが出ます"
        }
        if unplacedCount == 0 {
            return "作品をタップすると来歴が見られます"
        }
        return "下から作品を選んで、壁に向ける"
    }

    // MARK: - Placement math

    private func materialize(
        assetId: String,
        asset: TwinfoldAsset,
        transform: simd_float4x4,
        isWall: Bool,
        cardHeightOverride: Float = 0
    ) {
        guard let arView else { return }
        let anchor = AnchorEntity(world: transform)
        let entity = AssetRepresentationEntity.makeForWallPlacement(asset: asset)
        anchor.addChild(entity)
        arView.scene.addAnchor(anchor)

        var twinFootprint: (width: Float, height: Float)?
        let isTwin = AssetRepresentationEntity.isTwin(asset)
        if isTwin {
            twinFootprint = AssetRepresentationEntity.settleOnAnchor(entity: entity, anchor: anchor)
        }

        liveEntities[assetId] = LiveEntity(anchor: anchor, cardEntity: entity, provenanceColumn: nil, twinFootprint: twinFootprint)
        // Store the exact `transform` parameter, not a read-back of
        // `anchor.transform` — re-materializing the same asset later (a
        // wallet switch, or Appear after a transfer) always passes
        // `coord.transform` straight back into this function, so any
        // read-back here would compound rounding drift across repeated
        // Disappear/Appear cycles instead of reproducing the exact
        // placement.
        placementCoords[assetId] = PlacementCoord(
            transform: transform,
            isWallPlacement: isWall,
            isFloorPlacement: isTwin,
            footprintHeight: isWall ? cardHeightOverride : (twinFootprint?.height ?? 0)
        )
        applyHighlights()
    }

    private static func yawFacingCamera(cameraTransform: simd_float4x4) -> Float {
        let cameraForward = -SIMD3<Float>(
            cameraTransform.columns.2.x,
            cameraTransform.columns.2.y,
            cameraTransform.columns.2.z
        )
        let headingXZ = SIMD3<Float>(cameraForward.x, 0, cameraForward.z)
        let facing = length(headingXZ) > .ulpOfOne ? -normalize(headingXZ) : SIMD3<Float>(0, 0, 1)
        return atan2(facing.x, facing.z)
    }

    private func airTransform(cameraTransform: simd_float4x4) -> simd_float4x4 {
        let cameraPosition = SIMD3<Float>(
            cameraTransform.columns.3.x,
            cameraTransform.columns.3.y,
            cameraTransform.columns.3.z
        )
        let cameraForward = -SIMD3<Float>(
            cameraTransform.columns.2.x,
            cameraTransform.columns.2.y,
            cameraTransform.columns.2.z
        )
        let position = cameraPosition + cameraForward * Self.placementDistance
        let rotation = simd_quatf(angle: Self.yawFacingCamera(cameraTransform: cameraTransform), axis: SIMD3<Float>(0, 1, 0))
        var transform = simd_float4x4(rotation)
        transform.columns.3 = SIMD4<Float>(position, 1)
        return transform
    }

    /// Fixed positions for the AR-unsupported (simulator) fallback,
    /// offset by `index` (the number of assets already placed) so
    /// multiple fallback placements don't overlap.
    private func fallbackTransform(index: Int) -> simd_float4x4 {
        var transform = matrix_identity_float4x4
        let xOffset = Float(index) * 0.3 - 0.15
        transform.columns.3 = SIMD4<Float>(xOffset, -0.05, -0.4, 1)
        return transform
    }

    /// Positions a wall-placed asset flush against the wall (offset only by
    /// `AssetCardEntity.paperWallOffset`, not by the fixture's `depthCm`) —
    /// wall placement on iOS always renders as
    /// `AssetCardEntity.makePaper(asset:)`, a paper sheet with essentially
    /// no thickness, so the gap doesn't depend on the asset's own size.
    private func wallTransform(hit: ARRaycastResult) -> simd_float4x4 {
        let hitTransform = hit.worldTransform
        let rawNormal = SIMD3<Float>(hitTransform.columns.1.x, hitTransform.columns.1.y, hitTransform.columns.1.z)
        let flattenedNormal = SIMD3<Float>(rawNormal.x, 0, rawNormal.z)
        let forward = length(flattenedNormal) > .ulpOfOne ? normalize(flattenedNormal) : SIMD3<Float>(0, 0, 1)
        let worldUp = SIMD3<Float>(0, 1, 0)
        let right = normalize(cross(worldUp, forward))
        let up = cross(forward, right)

        let hitPosition = SIMD3<Float>(hitTransform.columns.3.x, hitTransform.columns.3.y, hitTransform.columns.3.z)
        let position = hitPosition + forward * AssetCardEntity.paperWallOffset

        var transform = matrix_identity_float4x4
        transform.columns.0 = SIMD4<Float>(right, 0)
        transform.columns.1 = SIMD4<Float>(up, 0)
        transform.columns.2 = SIMD4<Float>(forward, 0)
        transform.columns.3 = SIMD4<Float>(position, 1)
        return transform
    }

    private func floorTransform(hit: ARRaycastResult, cameraTransform: simd_float4x4) -> simd_float4x4 {
        let hitTransform = hit.worldTransform
        let hitPosition = SIMD3<Float>(hitTransform.columns.3.x, hitTransform.columns.3.y, hitTransform.columns.3.z)
        let rotation = simd_quatf(angle: Self.yawFacingCamera(cameraTransform: cameraTransform), axis: SIMD3<Float>(0, 1, 0))
        var transform = simd_float4x4(rotation)
        transform.columns.3 = SIMD4<Float>(hitPosition, 1)
        return transform
    }

    /// If an already-placed wall card's top edge is within
    /// `wallSnapTolerance` of the candidate's top edge, nudge the
    /// candidate's y so the two tops align exactly.
    private func snappedWallY(candidateY: Float, candidateHeight: Float, excludingAssetId: String) -> Float {
        let candidateTop = candidateY + candidateHeight / 2
        for (assetId, coord) in placementCoords where assetId != excludingAssetId && coord.isWallPlacement {
            let existingTop = coord.transform.columns.3.y + coord.footprintHeight / 2
            if abs(existingTop - candidateTop) < Self.wallSnapTolerance {
                return existingTop - candidateHeight / 2
            }
        }
        return candidateY
    }

    private func provenanceColumnX(for asset: TwinfoldAsset, live: LiveEntity) -> Float {
        if let twinFootprint = live.twinFootprint {
            return twinFootprint.width / 2 + 0.02 + ProvenanceNodeEntity.width / 2
        }
        let cardSize = AssetCardEntity.size(for: asset)
        return cardSize.width / 2 + 0.02 + ProvenanceNodeEntity.width / 2
    }

    private func provenanceColumnY(for live: LiveEntity) -> Float {
        guard let twinFootprint = live.twinFootprint else { return 0 }
        return twinFootprint.height / 2
    }
}
