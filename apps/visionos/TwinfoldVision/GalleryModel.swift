import Observation
import RealityKit
import SwiftUI
import TwinfoldCore
import TwinfoldSpatial

enum CardPlacement: Sendable, Equatable {
    case notPlaced
    case placed
}

enum TransferState: Sendable, Equatable {
    case idle
    case pending
    case confirmed
    case failed
}

/// Desired outcome of a simulated transfer, mirroring
/// `apps/ios/TwinfoldAR/ARSceneController.swift`'s `TransferOutcome`.
enum TransferOutcome: Sendable {
    case confirmed
    case failed
}

/// Vision Pro Hero Demo model, backed by `MockAssetProvider`
/// (packages/TwinfoldCore) instead of a local fixture. Views read the
/// demo/devnet badge text from `provider.isDemoData`
/// (docs/architecture.md section 5). Holds the same
/// Place/Pull/Reset/simulated-transfer state that
/// `apps/ios/TwinfoldAR/ARSceneController.swift` holds for the iPhone AR
/// client, adapted for `RealityView` instead of `ARView`.
@MainActor
@Observable
final class GalleryModel {
    static let collectionWindowID = "twinfold-collection"
    static let immersiveSpaceID = "twinfold-gallery"

    private static let demoWallet = "DEMOwalletA1111111111111111111111111111111"

    let provider: any AssetProvider

    private(set) var assets: [TwinfoldAsset] = []
    var selectedAssetID: String?
    var isImmersive = false
    var showInformation = true
    private(set) var statusMessage = "作品をタップするとPullできます"

    private var placement: [String: CardPlacement] = [:]
    private var provenancePulled: Set<String> = []
    private var transferState: [String: TransferState] = [:]
    private var cardEntities: [String: Entity] = [:]

    init(provider: any AssetProvider) {
        self.provider = provider
    }

    var selectedAsset: TwinfoldAsset? {
        assets.first { $0.id == selectedAssetID }
    }

    var selectedTransferState: TransferState {
        guard let asset = selectedAsset else { return .idle }
        return transferState[asset.id] ?? .idle
    }

    func loadAssets() async {
        do {
            assets = try await provider.getAssets(wallet: Self.demoWallet)
            selectedAssetID = assets.first?.id
        } catch {
            statusMessage = "資産を読み込めませんでした: \(error)"
        }
    }

    /// Called once per asset when `ImmersiveGalleryView`'s `RealityView`
    /// builds the scene, so later Pull/Reset/transfer calls can find the
    /// `AssetCardEntity` for a given asset id.
    func registerCard(_ entity: Entity, for assetID: String) {
        cardEntities[assetID] = entity
        placement[assetID] = .placed
        transferState[assetID] = .idle
    }

    /// Resolves a visionOS spatial tap to the `AssetCardEntity` (if any)
    /// and pulls its provenance.
    func handleTap(on entity: Entity) {
        guard let card = entity.selfOrAncestor(named: AssetCardEntity.entityName),
              let assetID = cardEntities.first(where: { $0.value === card })?.key,
              let asset = assets.first(where: { $0.id == assetID }) else { return }
        pullProvenance(for: asset)
    }

    /// Starts (or retries, from `.failed`) a simulated transfer: `pending`
    /// for ~2s, then either `confirmed` (card Disappears) or `failed` (card
    /// is kept, with a red frame and a Retry affordance).
    func simulateTransfer(for asset: TwinfoldAsset, outcome: TransferOutcome) {
        let currentState = transferState[asset.id] ?? .idle
        guard placement[asset.id] == .placed,
              currentState == .idle || currentState == .failed,
              let card = cardEntities[asset.id] else { return }
        transferState[asset.id] = .pending
        AssetCardEntity.apply(state: .pending, to: card)
        statusMessage = "transfer pending..."

        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            await MainActor.run { self.completeTransfer(for: asset, outcome: outcome) }
        }
    }

    func reset(for asset: TwinfoldAsset) {
        guard let card = cardEntities[asset.id] else { return }
        card.isEnabled = true
        AssetCardEntity.apply(state: .confirmed, to: card)
        let provenanceNodes = card.children.filter { $0.name.hasPrefix("twinfold.provenanceNode.") }
        for node in provenanceNodes {
            node.removeFromParent()
        }
        provenancePulled.remove(asset.id)
        transferState[asset.id] = .idle
        placement[asset.id] = .placed
        statusMessage = "作品をタップするとPullできます"
    }

    // MARK: - Private

    private func pullProvenance(for asset: TwinfoldAsset) {
        guard let card = cardEntities[asset.id], !provenancePulled.contains(asset.id) else { return }
        for (index, event) in asset.provenance.enumerated() {
            let node = ProvenanceNodeEntity.make(event: event, index: index)
            card.addChild(node)
        }
        provenancePulled.insert(asset.id)
        statusMessage = "provenanceを引き出しました（\(asset.provenance.count)件）"
    }

    private func completeTransfer(for asset: TwinfoldAsset, outcome: TransferOutcome) {
        switch outcome {
        case .confirmed:
            confirmTransfer(for: asset)
        case .failed:
            failTransfer(for: asset)
        }
    }

    private func confirmTransfer(for asset: TwinfoldAsset) {
        guard let card = cardEntities[asset.id] else { return }
        transferState[asset.id] = .confirmed
        placement[asset.id] = .notPlaced
        provenancePulled.remove(asset.id)
        card.isEnabled = false
        statusMessage = "transfer confirmed。旧ownerの空間からDisappearしました"
    }

    /// Keeps the card in place (placement stays `.placed`) and shows a red
    /// frame, so the controls attachment can offer Retry.
    private func failTransfer(for asset: TwinfoldAsset) {
        guard let card = cardEntities[asset.id] else { return }
        transferState[asset.id] = .failed
        AssetCardEntity.apply(state: .failed, to: card)
        statusMessage = "transfer failed。Retryしてください"
    }
}
