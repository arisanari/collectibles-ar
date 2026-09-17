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

    static let width: Float = 0.12
    static let height: Float = 0.16

    public static func make(asset: TwinfoldAsset) -> Entity {
        let root = Entity()
        root.name = entityName

        let frameMesh = MeshResource.generatePlane(
            width: width + 0.012,
            height: height + 0.012,
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

        let cardMesh = MeshResource.generatePlane(width: width, height: height, cornerRadius: 0.006)
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

        let textMesh = MeshResource.generateText(
            asset.title,
            extrusionDepth: 0.001,
            font: .systemFont(ofSize: 0.012),
            containerFrame: CGRect(
                x: -Double(width) / 2 + 0.006,
                y: -Double(height) / 2 + 0.012,
                width: Double(width) - 0.012,
                height: Double(height) - 0.024
            ),
            alignment: .center,
            lineBreakMode: .byWordWrapping
        )
        let title = ModelEntity(mesh: textMesh, materials: [UnlitMaterial(color: .black)])
        title.name = titleName
        title.position.z = 0.001
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
