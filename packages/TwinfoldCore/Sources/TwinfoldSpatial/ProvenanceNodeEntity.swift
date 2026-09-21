import CoreGraphics
import RealityKit
import TwinfoldCore

/// Builds a small RealityKit node representing one `ProvenanceEvent`,
/// stacked vertically by `index` when "Pull" is triggered on an
/// `AssetCardEntity`. Platform-independent: no ARKit/UIKit/SwiftUI import.
@MainActor
public enum ProvenanceNodeEntity {
    static let width: Float = 0.09
    static let height: Float = 0.035
    static let verticalSpacing: Float = 0.05

    public static func make(event: ProvenanceEvent, index: Int) -> Entity {
        let node = Entity()
        node.name = "twinfold.provenanceNode.\(event.id)"

        let plateMesh = MeshResource.generatePlane(width: width, height: height, cornerRadius: 0.004)
        let plate = ModelEntity(
            mesh: plateMesh,
            materials: [SimpleMaterial(color: color(for: event.status), roughness: 0.5, isMetallic: false)]
        )
        node.addChild(plate)

        let label = "\(event.kind.rawValue)\n\(shortDate(event.occurredAt))"
        let textMesh = MeshResource.generateText(
            label,
            extrusionDepth: 0.0005,
            font: .systemFont(ofSize: 0.009),
            containerFrame: CGRect(
                x: -Double(width) / 2 + 0.004,
                y: -Double(height) / 2 + 0.004,
                width: Double(width) - 0.008,
                height: Double(height) - 0.008
            ),
            alignment: .center,
            lineBreakMode: .byWordWrapping
        )
        let text = ModelEntity(mesh: textMesh, materials: [UnlitMaterial(color: .black)])
        text.position.z = 0.0007
        node.addChild(text)

        // Stacks nodes above the card it was pulled from. The card is
        // centered on its own origin, so start from its top edge
        // (AssetCardEntity.height / 2) plus a gap; index 0 is the oldest
        // event, closest to the card. Caller is free to reposition once
        // attached to the scene.
        let baseY = AssetCardEntity.height / 2 + 0.015 + height / 2
        node.position.y = baseY + Float(index) * verticalSpacing
        return node
    }

    private static func color(for status: ProvenanceStatus) -> Material.Color {
        switch status {
        case .pending:
            return .yellow
        case .confirmed:
            return .green
        case .failed:
            return .red
        }
    }

    private static func shortDate(_ isoTimestamp: String) -> String {
        String(isoTimestamp.prefix(10))
    }
}
