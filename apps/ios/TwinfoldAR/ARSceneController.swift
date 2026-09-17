import ARKit
import Foundation
import Observation
import RealityKit
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

/// Desired outcome of a simulated transfer, chosen by whichever Overlay
/// button the user taps (`Transfer (demo)` vs `Transfer fail (demo)`, or
/// `Retry` after a failure).
enum TransferOutcome: Sendable {
    case confirmed
    case failed
}

/// Owns Place / Pull / Reset / simulated transfer state for one asset.
/// `ARContainerView` drives this from ARKit tap/raycast events; this type
/// itself only touches `RealityKit` entities and the `TwinfoldSpatial`
/// factories, plus `ARWorldTrackingConfiguration.isSupported` to decide the
/// simulator fallback.
@MainActor
@Observable
final class ARSceneController {
    let asset: TwinfoldAsset
    let provider: any AssetProvider
    let isARSupported = ARWorldTrackingConfiguration.isSupported

    private(set) var placement: CardPlacement = .notPlaced
    private(set) var isProvenancePulled = false
    private(set) var transferState: TransferState = .idle
    private(set) var statusMessage: String

    weak var arView: ARView?
    private var anchorEntity: AnchorEntity?
    private var cardEntity: Entity?

    init(asset: TwinfoldAsset, provider: any AssetProvider) {
        self.asset = asset
        self.provider = provider
        self.statusMessage = ARSceneController.idleMessage(isARSupported: ARWorldTrackingConfiguration.isSupported)
    }

    /// Called by `ARContainerView`'s tap gesture with a point in the
    /// `ARView`'s coordinate space.
    func handleTap(at point: CGPoint) {
        guard let arView else { return }

        if let hitEntity = arView.entity(at: point),
           let card = hitEntity.selfOrAncestor(named: AssetCardEntity.entityName) {
            pullProvenance(from: card)
            return
        }

        guard placement == .notPlaced else { return }

        if isARSupported {
            let results = arView.raycast(from: point, allowing: .estimatedPlane, alignment: .horizontal)
            guard let result = results.first else { return }
            place(worldTransform: result.worldTransform)
        } else {
            placeFallback()
        }
    }

    /// Starts (or retries, from `.failed`) a simulated transfer: `pending`
    /// for ~2s, then either `confirmed` (card and anchor Disappear) or
    /// `failed` (card and anchor are kept, with a red frame and a Retry
    /// affordance in `AROverlayView`).
    func simulateTransfer(outcome: TransferOutcome) {
        guard placement == .placed,
              transferState == .idle || transferState == .failed,
              let card = cardEntity else { return }
        transferState = .pending
        AssetCardEntity.apply(state: .pending, to: card)
        statusMessage = "transfer pending..."

        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            await MainActor.run { self.completeTransfer(outcome: outcome) }
        }
    }

    func reset() {
        if let arView, let anchorEntity {
            arView.scene.removeAnchor(anchorEntity)
        }
        anchorEntity = nil
        cardEntity = nil
        placement = .notPlaced
        isProvenancePulled = false
        transferState = .idle
        statusMessage = Self.idleMessage(isARSupported: isARSupported)
    }

    // MARK: - Private

    private func place(worldTransform: simd_float4x4) {
        addCard(anchor: AnchorEntity(world: worldTransform))
        statusMessage = "配置しました。カードをタップするとprovenanceを引き出せます"
    }

    private func placeFallback() {
        var transform = matrix_identity_float4x4
        transform.columns.3 = SIMD4<Float>(0, -0.05, -0.4, 1)
        addCard(anchor: AnchorEntity(world: transform))
        statusMessage = "AR非対応のため固定位置に配置しました。カードをタップするとprovenanceを引き出せます"
    }

    private func addCard(anchor: AnchorEntity) {
        guard let arView else { return }
        let card = AssetCardEntity.make(asset: asset)
        anchor.addChild(card)
        arView.scene.addAnchor(anchor)
        anchorEntity = anchor
        cardEntity = card
        placement = .placed
    }

    private func pullProvenance(from card: Entity) {
        guard !isProvenancePulled else { return }
        for (index, event) in asset.provenance.enumerated() {
            let node = ProvenanceNodeEntity.make(event: event, index: index)
            card.addChild(node)
        }
        isProvenancePulled = true
        statusMessage = "provenanceを引き出しました（\(asset.provenance.count)件）"
    }

    private func completeTransfer(outcome: TransferOutcome) {
        switch outcome {
        case .confirmed:
            confirmTransfer()
        case .failed:
            failTransfer()
        }
    }

    private func confirmTransfer() {
        guard let arView, let anchorEntity else { return }
        transferState = .confirmed
        statusMessage = "transfer confirmed。旧ownerの空間からDisappearしました"
        arView.scene.removeAnchor(anchorEntity)
        self.anchorEntity = nil
        cardEntity = nil
        placement = .notPlaced
        isProvenancePulled = false
    }

    /// Keeps the card and anchor in place (placement stays `.placed`) and
    /// shows a red frame, so `AROverlayView` can offer Retry.
    private func failTransfer() {
        guard let card = cardEntity else { return }
        transferState = .failed
        AssetCardEntity.apply(state: .failed, to: card)
        statusMessage = "transfer failed。Retryしてください"
    }

    private static func idleMessage(isARSupported: Bool) -> String {
        isARSupported
            ? "水平面をタップしてPlaceしてください"
            : "ARは実機でのみ動作します。タップすると固定位置に配置します"
    }
}
