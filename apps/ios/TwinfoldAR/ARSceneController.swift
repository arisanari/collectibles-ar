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
    /// Provenance column, a sibling of `cardEntity` under `anchorEntity`
    /// (not a child of the card), so rotating/scaling the card doesn't
    /// carry the column along with it. See `pullProvenance(from:)`.
    private var provenanceColumn: Entity?

    /// `true` once `handleTap` places the card flush against a detected
    /// vertical plane (`placeOnWall`), instead of the original
    /// camera-relative air placement. Changes how `pan` interprets drag
    /// (`slideOnWall` instead of `rotate`) and disables `scale(by:)` (wall
    /// art is shown at its real-world size, not resized by pinch). Reset by
    /// `addCard`. Exposed read-only so `AROverlayView` can pick the matching
    /// gesture hint.
    private(set) var isWallPlacement = false
    /// The wall's own right/up basis captured by `placeOnWall`, reused by
    /// `slideOnWall` so a drag moves the card along the same plane it was
    /// placed on. `nil` for an air placement.
    private var wallRight: SIMD3<Float>?
    private var wallUp: SIMD3<Float>?

    /// `true` once `handleTap` stands a `model` twin on a detected
    /// horizontal plane (`placeOnFloor`), instead of falling back to the
    /// camera-relative air placement. Only used to pick the provenance
    /// column's vertical offset (`provenanceColumnY`) — drag/pinch stay
    /// disabled for a twin either way (see `pan`/`scale(by:)`). Reset by
    /// `addCard`.
    private(set) var isFloorPlacement = false
    /// The settled twin's own width/height (meters), read from
    /// `visualBounds` by `settleTwinOnFloor` right after placement. `nil`
    /// for a `card` representation, which uses `cardSize` instead. A twin
    /// has no `asset.physical?.dimensions` (unlike a framed print), so its
    /// on-screen footprint is only known once its actual mesh (USDZ, or
    /// the `makeThinPlate` fallback) is loaded — `cardSize` would be wrong
    /// for it. Used by `provenanceColumnX`/`provenanceColumnY`.
    private var twinFootprint: (width: Float, height: Float)?

    /// This asset's real-world footprint (`AssetCardEntity.size(for:)`),
    /// computed once since `asset` never changes for this controller.
    /// Used for `provenanceColumnX` so the column clears a wall-sized card
    /// the same way it clears the small default-sized one. Not used for a
    /// `model` twin — see `twinFootprint`.
    private let cardSize: (width: Float, height: Float, depth: Float)

    /// Distance in front of the camera (meters) a freshly-placed card
    /// appears at. See `place(cameraTransform:)`.
    private static let placementDistance: Float = 0.4
    private static let minScale: Float = 0.5
    private static let maxScale: Float = 3.0
    /// Meters of on-wall slide per point of one-finger drag. See
    /// `slideOnWall`.
    private static let wallDragSensitivity: Float = 0.0015

    /// Cumulative pinch scale applied to `cardEntity`, tracked here (not
    /// read back from the entity) because `scale(by:)` receives an
    /// incremental factor per gesture callback. Reset to 1 whenever a new
    /// card is placed.
    private var currentScale: Float = 1.0

    /// Whichever of the two demo wallets (`DemoWallet`, defined in
    /// CollectionView.swift — the single place those addresses are
    /// hardcoded per docs/architecture.md section 5 / core-contract skill)
    /// does *not* currently own this asset. `runConfirmedTransfer` sends
    /// the simulated transfer here.
    var destinationWallet: String {
        asset.owner == DemoWallet.ownerA.id ? DemoWallet.ownerB.id : DemoWallet.ownerA.id
    }

    /// Short display label for `destinationWallet`, used in
    /// `AROverlayView`'s step copy and primary button.
    var destinationLabel: String {
        asset.owner == DemoWallet.ownerA.id ? "Owner B" : "Owner A"
    }

    init(asset: TwinfoldAsset, provider: any AssetProvider) {
        self.asset = asset
        self.provider = provider
        self.cardSize = AssetCardEntity.size(for: asset)
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

        guard isARSupported else {
            placeFallback()
            return
        }

        // `currentFrame` is nil in the simulator (and briefly before ARKit
        // has a first frame on device); every air-placement path below
        // needs it for its camera-facing yaw, so fetch it once up front.
        let cameraTransform = arView.session.currentFrame?.camera.transform

        // A `model` twin (e.g. the kokeshi USDZ) stands on a detected
        // horizontal surface (floor/table/shelf) so it reads as resting
        // next to the real object it twins, at its real-world size. The
        // flat `card` representation (a framed print) never uses this
        // branch — see below for its own vertical-plane (wall) placement.
        if AssetRepresentationEntity.isTwin(asset) {
            if let floorHit = arView.raycast(from: point, allowing: .estimatedPlane, alignment: .horizontal).first,
               let cameraTransform {
                placeOnFloor(hitResult: floorHit, cameraTransform: cameraTransform)
            } else if let cameraTransform {
                place(
                    cameraTransform: cameraTransform,
                    message: "水平面が見つからないため空中に置きました。作品をタップすると来歴を引き出せます"
                )
            } else {
                placeFallback()
            }
            return
        }

        // Wall (vertical-plane) placement only applies to the flat `card`
        // representation (a framed print hung on a wall).
        if let wallHit = arView.raycast(from: point, allowing: .estimatedPlane, alignment: .vertical).first {
            placeOnWall(hitResult: wallHit)
            return
        }

        if let cameraTransform {
            place(cameraTransform: cameraTransform)
        } else {
            placeFallback()
        }
    }

    /// Dispatches a one-finger drag based on how the card was placed: a
    /// wall placement slides the card along the wall's own plane
    /// (`slideOnWall`) since wall art doesn't spin; an air placement of the
    /// flat `card` representation keeps the original rotate-in-place
    /// behavior (`rotate`). No-op before placement (both branches guard on
    /// `cardEntity`/`anchorEntity`).
    ///
    /// No-op for a `model` (USDZ twin) representation: it's placed at its
    /// real-world size next to the physical object it twins, and the
    /// intended way to see it from other angles is walking around it, not
    /// dragging it.
    func pan(translationX: Float, translationY: Float, viewWidth: Float) {
        guard cardEntity != nil, !AssetRepresentationEntity.isTwin(asset) else { return }
        if isWallPlacement {
            slideOnWall(translationX: translationX, translationY: translationY)
        } else {
            let yawDelta = translationX / viewWidth * .pi
            let pitchDelta = translationY / viewWidth * .pi
            rotate(yawDelta: yawDelta, pitchDelta: pitchDelta)
        }
    }

    /// Applies a rotation delta to the placed card's root Entity: `yawDelta`
    /// around the world Y axis (so the card always spins about "up",
    /// regardless of its current tilt), `pitchDelta` around the card's own
    /// local X axis. Any already-Pulled provenance nodes are children of
    /// this Entity, so they rotate along with the card. No-op before
    /// placement. Used for air placements only; a wall placement slides
    /// instead (see `pan`/`slideOnWall`).
    private func rotate(yawDelta: Float, pitchDelta: Float) {
        guard let cardEntity else { return }
        let worldYaw = simd_quatf(angle: yawDelta, axis: SIMD3<Float>(0, 1, 0))
        let localPitch = simd_quatf(angle: pitchDelta, axis: SIMD3<Float>(1, 0, 0))
        cardEntity.orientation = worldYaw * cardEntity.orientation * localPitch
    }

    /// Slides a wall-placed card along the wall's own plane, using the
    /// right/up basis `placeOnWall` captured at placement time, so the
    /// card stays flush against the wall as it moves. No-op before a wall
    /// placement.
    private func slideOnWall(translationX: Float, translationY: Float) {
        guard let anchorEntity, let wallRight, let wallUp else { return }
        let deltaRight = wallRight * (translationX * Self.wallDragSensitivity)
        // Screen Y grows downward; negate so an upward drag moves the card
        // up the wall.
        let deltaUp = wallUp * (-translationY * Self.wallDragSensitivity)
        anchorEntity.position += deltaRight + deltaUp
    }

    /// Applies an incremental scale `factor` (e.g. a pinch recognizer's
    /// per-callback `scale`, not its cumulative value) to the placed card,
    /// clamping the resulting cumulative scale to `minScale...maxScale`.
    /// No-op before placement. The provenance column (if pulled) is not
    /// scaled — only repositioned, so it stays clear of the card as it
    /// grows or shrinks.
    ///
    /// No-op for a `model` (USDZ twin) representation: it's placed at its
    /// real-world size next to the physical object it twins, and pinch
    /// would let that size drift from the real thing's, so scaling stays
    /// disabled to keep it 1:1.
    ///
    /// No-op for a wall placement too, regardless of representation: per
    /// docs/mvp.md Spatial Fidelity, the framed print on the wall is shown
    /// at its real-world size and scale isn't user-adjustable. Only an air
    /// placement of the flat `card` (the fallback when no wall was found)
    /// keeps pinch-to-scale.
    func scale(by factor: Float) {
        guard let cardEntity, !AssetRepresentationEntity.isTwin(asset), !isWallPlacement else { return }
        currentScale = min(max(currentScale * factor, Self.minScale), Self.maxScale)
        cardEntity.scale = SIMD3<Float>(repeating: currentScale)
        provenanceColumn?.position.x = provenanceColumnX
    }

    /// Starts (or retries, from `.failed`) a simulated transfer: `pending`
    /// immediately, then either `confirmed` (card and anchor Disappear) or
    /// `failed` (card and anchor are kept, with a red frame and a Retry
    /// affordance in `AROverlayView`). `.confirmed` drives the real
    /// Provider round trip via `runConfirmedTransfer`; `.failed` (the
    /// "Transfer fail (demo)" button) stays UI-only and never calls
    /// `provider`.
    func simulateTransfer(outcome: TransferOutcome) {
        guard placement == .placed,
              transferState == .idle || transferState == .failed,
              let card = cardEntity else { return }
        transferState = .pending
        AssetCardEntity.apply(state: .pending, to: card)
        statusMessage = "transfer pending..."

        switch outcome {
        case .failed:
            Task {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                await MainActor.run { self.failTransfer(message: "transfer failed。Retryしてください") }
            }
        case .confirmed:
            // A fresh requestId per attempt; Retry (which also calls this
            // method with `.confirmed`) gets its own id rather than reusing
            // a stale one.
            let requestId = UUID().uuidString
            Task { await self.runConfirmedTransfer(requestId: requestId) }
        }
    }

    func reset() {
        if let arView, let anchorEntity {
            arView.scene.removeAnchor(anchorEntity)
        }
        anchorEntity = nil
        cardEntity = nil
        provenanceColumn = nil
        placement = .notPlaced
        isProvenancePulled = false
        transferState = .idle
        isWallPlacement = false
        wallRight = nil
        wallUp = nil
        isFloorPlacement = false
        twinFootprint = nil
        statusMessage = Self.idleMessage(isARSupported: isARSupported)

        // MockAssetProvider only: clear the in-memory transfer overrides,
        // so a repeated demo starts clean. The session wallet is owned by
        // CollectionView's Picker, not touched here. Other AssetProvider
        // implementations don't yet expose a demo-state reset, so there's
        // nothing to undo there.
        if let mock = provider as? MockAssetProvider {
            Task { await mock.resetDemoState() }
        }
    }

    // MARK: - Private

    /// Places the card in the air directly in front of wherever the camera
    /// was pointed at tap time: `placementDistance` meters along the
    /// camera's full 3D forward vector (so tilting the phone up/down moves
    /// where the card appears), oriented with only the camera's yaw (its
    /// horizontal heading) so the card is always upright and its front
    /// (+Z) faces back at the camera, regardless of phone pitch/roll.
    /// `AnchorEntity(world:)` fixes the result in world space, so it stays
    /// put as the device (and thus the camera) moves afterward. Also the
    /// twin's fallback when `handleTap` finds no horizontal plane to stand
    /// it on — `message` lets that caller note why in `statusMessage`.
    private func place(
        cameraTransform: simd_float4x4,
        message: String = "配置しました。カードをタップするとprovenanceを引き出せます"
    ) {
        let cameraPosition = SIMD3<Float>(
            cameraTransform.columns.3.x,
            cameraTransform.columns.3.y,
            cameraTransform.columns.3.z
        )
        // ARKit cameras look down their own local -Z axis.
        let cameraForward = -SIMD3<Float>(
            cameraTransform.columns.2.x,
            cameraTransform.columns.2.y,
            cameraTransform.columns.2.z
        )
        let position = cameraPosition + cameraForward * Self.placementDistance
        let rotation = simd_quatf(angle: Self.yawFacingCamera(cameraTransform: cameraTransform), axis: SIMD3<Float>(0, 1, 0))

        var transform = simd_float4x4(rotation)
        transform.columns.3 = SIMD4<Float>(position, 1)

        addCard(anchor: AnchorEntity(world: transform))
        statusMessage = message
    }

    /// Yaw (radians, about world Y) that orients an entity's local +Z axis
    /// (the front of both `AssetCardEntity`'s card and a loaded twin, per
    /// `AssetRepresentationEntity`) to face back toward the camera, using
    /// only the camera's horizontal heading so phone pitch/roll doesn't
    /// tilt the result. Shared by `place(cameraTransform:)` (air placement)
    /// and `placeOnFloor` (standing a twin on a detected horizontal plane).
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

    /// Places the card flush against a detected vertical surface (a wall):
    /// the card's local +Z (its front, matching `AssetCardEntity`'s title
    /// side) is aimed along the wall's outward normal so the front faces
    /// into the room, and its local +Y is kept aligned to world up so the
    /// title reads right-side up regardless of how the phone was tilted
    /// when the wall was hit. ARKit plane/raycast transforms always carry
    /// the surface's normal in their Y column, for both horizontal and
    /// vertical alignments. The card's center is offset from the wall
    /// surface by half its own thickness (`cardSize.depth`) plus a small
    /// buffer, so its back sits just off the wall instead of clipping into
    /// it. `wallRight`/`wallUp` (the basis used here) are kept so
    /// `slideOnWall` can drag the card along the same plane afterward.
    private func placeOnWall(hitResult: ARRaycastResult) {
        let hitTransform = hitResult.worldTransform
        let rawNormal = SIMD3<Float>(hitTransform.columns.1.x, hitTransform.columns.1.y, hitTransform.columns.1.z)
        // Flatten to horizontal: a wall's normal should be level even if
        // the raycast's estimated-plane normal drifted slightly off-vertical.
        let flattenedNormal = SIMD3<Float>(rawNormal.x, 0, rawNormal.z)
        let forward = length(flattenedNormal) > .ulpOfOne ? normalize(flattenedNormal) : SIMD3<Float>(0, 0, 1)
        let worldUp = SIMD3<Float>(0, 1, 0)
        let right = normalize(cross(worldUp, forward))
        let up = cross(forward, right)

        let hitPosition = SIMD3<Float>(hitTransform.columns.3.x, hitTransform.columns.3.y, hitTransform.columns.3.z)
        let position = hitPosition + forward * (cardSize.depth / 2 + 0.002)

        var transform = matrix_identity_float4x4
        transform.columns.0 = SIMD4<Float>(right, 0)
        transform.columns.1 = SIMD4<Float>(up, 0)
        transform.columns.2 = SIMD4<Float>(forward, 0)
        transform.columns.3 = SIMD4<Float>(position, 1)

        addCard(anchor: AnchorEntity(world: transform))
        isWallPlacement = true
        wallRight = right
        wallUp = up
        statusMessage = "壁に配置しました。カードをタップするとprovenanceを引き出せます"
    }

    /// Stands a `model` twin (e.g. the kokeshi USDZ) upright on a detected
    /// horizontal surface (floor, table, shelf): the anchor sits at the
    /// raycast hit's position with only a camera-facing yaw applied — never
    /// the hit's own normal — so the twin stays plumb (world-up) even on a
    /// tilted plane estimate, matching `place(cameraTransform:)`'s
    /// convention of orienting by camera yaw alone. `settleTwinOnFloor`
    /// then lifts the twin so its lowest visible point (not necessarily its
    /// own origin) rests on that surface instead of clipping through it.
    private func placeOnFloor(hitResult: ARRaycastResult, cameraTransform: simd_float4x4) {
        let hitTransform = hitResult.worldTransform
        let hitPosition = SIMD3<Float>(hitTransform.columns.3.x, hitTransform.columns.3.y, hitTransform.columns.3.z)
        let rotation = simd_quatf(angle: Self.yawFacingCamera(cameraTransform: cameraTransform), axis: SIMD3<Float>(0, 1, 0))

        var transform = simd_float4x4(rotation)
        transform.columns.3 = SIMD4<Float>(hitPosition, 1)

        addCard(anchor: AnchorEntity(world: transform))
        settleTwinOnFloor()
        isFloorPlacement = true
        statusMessage = "床や机に置きました。作品をタップすると来歴を引き出せます"
    }

    /// Shifts the just-placed twin straight up so its lowest visible point
    /// sits at the anchor's own y = 0 (the floor/table surface
    /// `placeOnFloor` anchored to) rather than the entity's own origin,
    /// since neither a loaded USDZ's origin nor `AssetCardEntity
    /// .makeThinPlate`'s centered fallback plate is guaranteed to be its
    /// base. Also records the settled footprint (`twinFootprint`) so
    /// `provenanceColumnX`/`provenanceColumnY` can clear the twin's actual
    /// visible edges instead of `cardSize`'s fixed default footprint. Scale
    /// stays untouched — a twin is always shown at real-world size (1).
    private func settleTwinOnFloor() {
        guard let anchorEntity, let cardEntity else { return }
        let bounds = cardEntity.visualBounds(relativeTo: anchorEntity)
        cardEntity.position.y -= bounds.min.y
        twinFootprint = (width: bounds.extents.x, height: bounds.extents.y)
    }

    private func placeFallback() {
        var transform = matrix_identity_float4x4
        transform.columns.3 = SIMD4<Float>(0, -0.05, -0.4, 1)
        addCard(anchor: AnchorEntity(world: transform))
        statusMessage = "AR非対応のため固定位置に配置しました。カードをタップするとprovenanceを引き出せます"
    }

    private func addCard(anchor: AnchorEntity) {
        guard let arView else { return }
        let card = AssetRepresentationEntity.make(asset: asset)
        anchor.addChild(card)
        arView.scene.addAnchor(anchor)
        anchorEntity = anchor
        cardEntity = card
        provenanceColumn = nil
        currentScale = 1.0
        isWallPlacement = false
        wallRight = nil
        wallUp = nil
        isFloorPlacement = false
        twinFootprint = nil
        placement = .placed
    }

    /// x offset (from the anchor's origin) that keeps the provenance column
    /// just clear of the placed asset's current visible right edge. A
    /// `model` twin uses its settled `twinFootprint` (its actual mesh
    /// width, read from `visualBounds` — it has no
    /// `asset.physical?.dimensions` for `cardSize` to reflect); a `card`
    /// uses `cardSize` (the card's own center is the anchor's origin),
    /// accounting for `currentScale`.
    private var provenanceColumnX: Float {
        if let twinFootprint {
            return twinFootprint.width / 2 + 0.02 + ProvenanceNodeEntity.width / 2
        }
        return cardSize.width / 2 * currentScale + 0.02 + ProvenanceNodeEntity.width / 2
    }

    /// y offset (from the anchor's origin) for the provenance column. A
    /// wall or air `card` placement centers the column on the anchor's own
    /// origin (y = 0), which is already the card's own center. A
    /// floor-placed twin instead anchors its origin at the *floor*
    /// (`settleTwinOnFloor` lifts the twin so its base, not its center,
    /// sits at y = 0), so the column is centered on the twin's own
    /// vertical middle instead — otherwise it would read half-buried in
    /// the floor.
    private var provenanceColumnY: Float {
        guard isFloorPlacement, let twinFootprint else { return 0 }
        return twinFootprint.height / 2
    }

    /// Builds the provenance column and adds it as a sibling of `card`
    /// under `anchorEntity` (not a child of the card), positioned beside
    /// the card/twin, so rotating or scaling the card (`rotate`/`scale`,
    /// which only touch `cardEntity`) leaves the column fixed in place.
    private func pullProvenance(from card: Entity) {
        guard !isProvenancePulled, let anchorEntity else { return }
        let column = ProvenanceNodeEntity.makeColumn(events: asset.provenance)
        column.position = SIMD3<Float>(provenanceColumnX, provenanceColumnY, 0)
        anchorEntity.addChild(column)
        provenanceColumn = column
        isProvenancePulled = true
        statusMessage = "provenanceを引き出しました（\(asset.provenance.count)件）"
    }

    /// Drives the real transfer round trip for the `.confirmed` outcome:
    /// asks the provider to move ownership (`MockAssetProvider`), or falls
    /// back to a timed pseudo-wait for any other `AssetProvider`
    /// implementation (`as? MockAssetProvider`, not a type switch, because
    /// only `MockAssetProvider` implements `simulateTransfer`; a future
    /// `ApiAssetProvider` would need its own real transfer call, but until
    /// then this keeps the pending -> confirmed UI working). Either way,
    /// it then asks the provider whether *this* session can still display
    /// the asset. Only a `false` Entitlement makes the card Disappear:
    /// `simulateTransfer` changes who owns the asset, but never changes
    /// which wallet this session is connected to, so the old owner's
    /// session should lose entitlement once the transfer confirms.
    private func runConfirmedTransfer(requestId: String) async {
        if let mock = provider as? MockAssetProvider {
            do {
                _ = try await mock.simulateTransfer(assetId: asset.id, to: destinationWallet, requestId: requestId)
            } catch {
                await MainActor.run {
                    self.failTransfer(message: "transfer failed: \(error)")
                }
                return
            }
        } else {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }

        do {
            let entitlement = try await provider.refreshOwnership(assetId: asset.id)
            await MainActor.run {
                if entitlement.canDisplay {
                    self.failTransfer(message: "transfer confirmedですが、このwalletはentitlementを維持しています: \(entitlement.reason)")
                } else {
                    self.confirmTransfer()
                }
            }
        } catch {
            await MainActor.run {
                self.failTransfer(message: "entitlement確認に失敗しました: \(error)")
            }
        }
    }

    private func confirmTransfer() {
        guard let arView, let anchorEntity else { return }
        transferState = .confirmed
        statusMessage = "transfer confirmed。旧ownerの空間からDisappearしました"
        arView.scene.removeAnchor(anchorEntity)
        self.anchorEntity = nil
        cardEntity = nil
        provenanceColumn = nil
        placement = .notPlaced
        isProvenancePulled = false
        isWallPlacement = false
        wallRight = nil
        wallUp = nil
        isFloorPlacement = false
        twinFootprint = nil
    }

    /// Keeps the card and anchor in place (placement stays `.placed`) and
    /// shows a red frame, so `AROverlayView` can offer Retry.
    private func failTransfer(message: String) {
        guard let card = cardEntity else { return }
        transferState = .failed
        AssetCardEntity.apply(state: .failed, to: card)
        statusMessage = message
    }

    private static func idleMessage(isARSupported: Bool) -> String {
        isARSupported
            ? "画面をタップしてPlaceしてください"
            : "ARは実機でのみ動作します。タップすると固定位置に配置します"
    }
}
