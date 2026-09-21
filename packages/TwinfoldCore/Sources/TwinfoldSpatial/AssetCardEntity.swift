import CoreGraphics
import RealityKit
import TwinfoldCore

/// Builds the RealityKit representation of a `TwinfoldAsset` "card" used by
/// Place/Pull. Platform-independent: does not import ARKit, UIKit, or
/// SwiftUI. Callers on iOS (`ARView`) and visionOS (`RealityView`) attach
/// the returned `Entity` to their own anchors.
@MainActor
public enum AssetCardEntity {
    public static let entityName = "twinfold.assetCard"
    static let surfaceName = "twinfold.assetCard.surface"
    static let frameName = "twinfold.assetCard.frame"
    static let titleName = "twinfold.assetCard.title"

    /// Default footprint, used when `asset.physical?.dimensions` is absent
    /// (e.g. no real-world size is known yet).
    public static let width: Float = 0.12
    static let height: Float = 0.16
    /// Default card body thickness. Small enough to read as a flat card,
    /// thick enough that the box's back face is a visible plain-white back
    /// side when the user rotates the card 180 degrees.
    static let depth: Float = 0.002

    /// Real-world footprint (meters) `make(asset:)` builds the card at:
    /// derived from `asset.physical?.dimensions` (cm, e.g. a framed
    /// ukiyo-e print's outer size) when present, so a wall placement reads
    /// at true scale; otherwise falls back to `width`/`height`/`depth`.
    public static func size(for asset: TwinfoldAsset) -> (width: Float, height: Float, depth: Float) {
        guard let dimensions = asset.physical?.dimensions else {
            return (width, height, depth)
        }
        let cardWidth = Float(dimensions.widthCm) / 100
        let cardHeight = Float(dimensions.heightCm) / 100
        let cardDepth = dimensions.depthCm.map { Float($0) / 100 } ?? depth
        return (cardWidth, cardHeight, cardDepth)
    }

    public static func make(asset: TwinfoldAsset) -> Entity {
        let root = Entity()
        root.name = entityName

        let cardSize = size(for: asset)

        let frameMesh = MeshResource.generateBox(
            width: cardSize.width + 0.012,
            height: cardSize.height + 0.012,
            depth: 0.0015,
            cornerRadius: 0.008
        )
        let frame = ModelEntity(
            mesh: frameMesh,
            materials: [SimpleMaterial(color: .red, roughness: 1, isMetallic: false)]
        )
        frame.name = frameName
        frame.position.z = -0.0005
        frame.isEnabled = false
        root.addChild(frame)

        // Box, not plane, so the card has a real back face: rotating it
        // shows a plain white back rather than nothing (a plane is
        // invisible from behind).
        let cardMesh = MeshResource.generateBox(
            width: cardSize.width,
            height: cardSize.height,
            depth: cardSize.depth,
            cornerRadius: 0.006
        )
        let card = ModelEntity(
            mesh: cardMesh,
            materials: [SimpleMaterial(color: .white, roughness: 0.6, isMetallic: false)]
        )
        card.name = surfaceName
        // Makes the card hit-testable for visionOS `SpatialTapGesture`
        // (`.targetedToAnyEntity()`). `InputTargetComponent` needs iOS 18+;
        // the app's iOS 17 deployment target doesn't need it since ARView's
        // `entity(at:)` picking does not require these components.
        if #available(iOS 18.0, *) {
            card.components.set(InputTargetComponent())
            card.generateCollisionShapes(recursive: false)
        }
        root.addChild(card)

        // Font scales with card height so the title stays legible at both
        // the small default size and a real-world wall-sized print (at the
        // default 0.16m height this is exactly the original fixed 0.012).
        let fontSize = max(0.01, cardSize.height * 0.075)
        let textMesh = MeshResource.generateText(
            asset.title,
            extrusionDepth: 0.001,
            font: .systemFont(ofSize: CGFloat(fontSize)),
            containerFrame: CGRect(
                x: -Double(cardSize.width) / 2 + 0.006,
                y: -Double(cardSize.height) / 2 + 0.012,
                width: Double(cardSize.width) - 0.012,
                height: Double(cardSize.height) - 0.024
            ),
            alignment: .center,
            lineBreakMode: .byWordWrapping
        )
        let title = ModelEntity(mesh: textMesh, materials: [UnlitMaterial(color: .black)])
        title.name = titleName
        // Front face only: just in front of the card's front surface
        // (depth / 2), not centered inside the box.
        title.position.z = cardSize.depth / 2 + 0.0015
        root.addChild(title)

        apply(state: .confirmed, to: root)
        return root
    }

    /// Toggles the pending/confirmed/failed look of a card created by
    /// `make(asset:)`. Pending is semi-transparent, failed shows a red
    /// frame, confirmed is the normal appearance.
    public static func apply(state: PlacementState, to entity: Entity) {
        let frame = entity.findEntity(named: frameName)
        guard let card = entity.findEntity(named: surfaceName) as? ModelEntity else { return }

        switch state {
        case .pending:
            card.model?.materials = [
                SimpleMaterial(color: Material.Color.white.withAlphaComponent(0.4), roughness: 0.6, isMetallic: false)
            ]
            frame?.isEnabled = false
        case .confirmed:
            card.model?.materials = [
                SimpleMaterial(color: .white, roughness: 0.6, isMetallic: false)
            ]
            frame?.isEnabled = false
        case .failed:
            card.model?.materials = [
                SimpleMaterial(color: .white, roughness: 0.6, isMetallic: false)
            ]
            frame?.isEnabled = true
        }
    }
}
