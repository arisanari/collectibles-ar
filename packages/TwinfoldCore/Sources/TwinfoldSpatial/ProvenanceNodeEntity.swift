import CoreGraphics
import RealityKit
import TwinfoldCore

/// Builds a small RealityKit node representing one `ProvenanceEvent`,
/// stacked vertically by `index` when "Pull" is triggered on an
/// `AssetCardEntity`. Platform-independent: no ARKit/UIKit/SwiftUI import.
@MainActor
public enum ProvenanceNodeEntity {
    public static let width: Float = 0.09
    static let height: Float = 0.035
    static let verticalSpacing: Float = 0.05

    /// Builds one node and stacks it above the card it was pulled from: the
    /// card is centered on its own origin, so `index` 0 (the oldest event)
    /// starts at the card's top edge (`AssetCardEntity.height / 2`) plus a
    /// gap, and later events stack further up. Intended for callers (like
    /// `apps/visionos/TwinfoldVision/GalleryModel.swift`) that add the
    /// returned node directly as a child of the `AssetCardEntity`, so it
    /// moves with the card. For a column that stays put while the card
    /// rotates/scales independently, use `makeColumn(events:)` instead.
    public static func make(event: ProvenanceEvent, index: Int) -> Entity {
        let node = makeNode(event: event)
        let baseY = AssetCardEntity.height / 2 + 0.015 + height / 2
        node.position.y = baseY + Float(index) * verticalSpacing
        return node
    }

    /// Builds a vertical column of every `ProvenanceEvent`, centered on the
    /// returned Entity's own origin (not on any card). `events[0]` (the
    /// oldest) is placed at the bottom, the most recent at the top. Callers
    /// attach the returned Entity as a sibling of the `AssetCardEntity` (not
    /// a child), so it can stay fixed in place while the card is rotated or
    /// scaled independently.
    public static func makeColumn(events: [ProvenanceEvent]) -> Entity {
        let column = Entity()
        column.name = "twinfold.provenanceColumn"
        guard !events.isEmpty else { return column }

        let midIndex = Float(events.count - 1) / 2
        for (index, event) in events.enumerated() {
            let node = makeNode(event: event)
            node.position.y = (Float(index) - midIndex) * verticalSpacing
            column.addChild(node)
        }
        return column
    }

    /// Shared node visuals (plate + label) for both `make(event:index:)` and
    /// `makeColumn(events:)`. Leaves `position` untouched; callers place it.
    private static func makeNode(event: ProvenanceEvent) -> Entity {
        let node = Entity()
        node.name = "twinfold.provenanceNode.\(event.id)"

        // Box, not plane, so the plate still reads as a (plain) colored
        // node when the asset card (and its stacked nodes) are rotated to
        // show the back.
        let plateMesh = MeshResource.generateBox(width: width, height: height, depth: 0.001, cornerRadius: 0.004)
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
        // Front face only: just in front of the plate's front surface.
        text.position.z = 0.0005 + 0.0007
        node.addChild(text)

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
