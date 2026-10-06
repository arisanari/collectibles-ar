import CoreGraphics
import Foundation
import RealityKit
import TwinfoldCore

/// Where a slab is posed relative to its anchor.
public enum SlabSurface: Sendable, Equatable {
    /// Back face flush against a vertical plane (anchor +z points out of the wall).
    case wall
    /// Standing on a horizontal plane (desk, floor) on its bottom edge, leaning back `GradedSlabDimensions.standingTilt`.
    case horizontal
}

/// RealityKit representation of a graded card in its holder ("slab"), built at the real size in
/// `GradedSlabDimensions.psaStandard`. Platform-independent: no ARKit, UIKit or SwiftUI. `scale` is never touched.
///
/// Structure (entity-local, origin at the slab's center, front face towards +z):
/// - body: thin translucent box (PBR, clear-coat, faint opacity) with the slab's outer size; carries the collision
///   shape used for tap picking
/// - insert: near-white backing plate inside the body (what you see at the edges of a real slab)
/// - label: white band at the top with the grade line and a shortened name (extruded text)
/// - card: the card picture, 63 x 88 mm, a little below center. The picture is fetched at runtime from `imageUrl`
///   (https) or taken from the bundled DEMO fixture art; until it arrives a neutral gray face is shown
/// - frame: hidden outline used for selection (blue) and failure (red)
/// - shadow: soft contact shadow, enabled only on a wall (on a horizontal plane the grounding shadow does the job)
///
/// Tagged with `AssetCardEntity.entityName` so callers that look up "the placed asset entity" by name keep working.
@MainActor
public enum GradedSlabEntity {
    static let bodyName = "twinfold.gradedSlab.body"
    static let insertName = "twinfold.gradedSlab.insert"
    static let labelName = "twinfold.gradedSlab.label"
    static let cardName = "twinfold.gradedSlab.card"

    /// Gap between the slab's back face and the anchor plane on a wall (the anchor itself already sits
    /// `AssetCardEntity.paperWallOffset` off the wall).
    static let wallGap: Float = 0.0004

    private static let dimensions = GradedSlabDimensions.psaStandard

    // Label band and card placement inside the body. The card sits low: bottom margin 8.5 mm, label 4 mm from the top.
    private static let labelWidth: Float = 0.073
    private static let labelHeight: Float = 0.0225
    private static let labelTopMargin: Float = 0.004
    private static let cardBottomMargin: Float = 0.0085

    public static func isSlab(_ entity: Entity) -> Bool {
        entity.findEntity(named: bodyName) != nil
    }

    public static func make(asset: TwinfoldAsset) -> Entity {
        let root = Entity()
        root.name = AssetCardEntity.entityName

        let width = dimensions.width
        let height = dimensions.height
        let depth = dimensions.depth

        // Selection / failure outline, hidden by default; sits in the back half of the body so it never enters a wall.
        let frame = ModelEntity(
            mesh: .generateBox(width: width + 0.010, height: height + 0.010, depth: 0.001, cornerRadius: 0.004),
            materials: [SimpleMaterial(color: .red, roughness: 1, isMetallic: false)]
        )
        frame.name = AssetCardEntity.frameName
        frame.position.z = -depth / 2 + 0.0005
        frame.isEnabled = false
        root.addChild(frame)

        let shadow = ModelEntity(
            mesh: .generatePlane(width: width + 0.016, height: height + 0.016, cornerRadius: 0.006),
            materials: [AssetCardEntity.makeShadowMaterial()]
        )
        shadow.name = AssetCardEntity.shadowName
        shadow.position.z = -depth / 2 - 0.0002
        shadow.isEnabled = false
        root.addChild(shadow)

        // White insert behind the card and label.
        let insert = ModelEntity(
            mesh: .generateBox(width: width - 0.006, height: height - 0.006, depth: 0.0008, cornerRadius: 0.002),
            materials: [matte(.white)]
        )
        insert.name = insertName
        insert.position.z = -0.0008
        root.addChild(insert)

        // Label band: top of the slab.
        let labelY = height / 2 - labelTopMargin - labelHeight / 2
        let label = ModelEntity(
            mesh: .generatePlane(width: labelWidth, height: labelHeight, cornerRadius: 0.0015),
            materials: [matte(.white)]
        )
        label.name = labelName
        label.position = SIMD3<Float>(0, labelY, 0)
        root.addChild(label)
        addLabelText(for: asset, centerY: labelY, to: root)

        // Card picture, "a little low".
        let cardY = -height / 2 + cardBottomMargin + GradedSlabDimensions.card.height / 2
        let card = ModelEntity(
            mesh: .generatePlane(
                width: GradedSlabDimensions.card.width,
                height: GradedSlabDimensions.card.height,
                cornerRadius: 0.002
            ),
            materials: [matte(.init(white: 0.82, alpha: 1))]
        )
        card.name = cardName
        card.position = SIMD3<Float>(0, cardY, 0.0001)
        root.addChild(card)
        loadPicture(for: asset, into: card)

        // Translucent holder, drawn last (transparent) over everything inside.
        let body = ModelEntity(
            mesh: .generateBox(width: width, height: height, depth: depth, cornerRadius: 0.0025),
            materials: [holderMaterial()]
        )
        body.name = bodyName
        body.generateCollisionShapes(recursive: false)
        if #available(iOS 18.0, visionOS 2.0, *) {
            body.components.set(InputTargetComponent())
        }
        root.addChild(body)

        pose(root, on: .wall)
        apply(state: .confirmed, to: root)
        return root
    }

    /// Sets the slab's pose within its anchor for `surface`. Safe to call every frame (holding preview): it only
    /// writes the root's local position and orientation and toggles the contact shadow.
    public static func pose(_ root: Entity, on surface: SlabSurface) {
        let depth = dimensions.depth
        switch surface {
        case .wall:
            root.orientation = simd_quatf(angle: 0, axis: SIMD3<Float>(1, 0, 0))
            root.position = SIMD3<Float>(0, 0, depth / 2 + wallGap)
        case .horizontal:
            let tilt = GradedSlabDimensions.standingTilt
            let pose = GradedSlabDimensions.standingPose(tilt: tilt, dimensions: dimensions)
            // Negative rotation about +x tips the top away from the viewer (towards -z).
            root.orientation = simd_quatf(angle: -tilt, axis: SIMD3<Float>(1, 0, 0))
            root.position = SIMD3<Float>(0, pose.y, pose.z)
        }
        root.findEntity(named: AssetCardEntity.shadowName)?.isEnabled = (surface == .wall)
        if #available(iOS 18.0, visionOS 2.0, macOS 15.0, *) {
            let casts = (surface == .horizontal)
            for name in [bodyName, insertName] {
                if let model = root.findEntity(named: name) {
                    model.components.set(GroundingShadowComponent(castsShadow: casts))
                }
            }
        }
    }

    /// pending: faded, confirmed: solid, failed: solid with the red outline.
    public static func apply(state: PlacementState, to entity: Entity) {
        let frame = entity.findEntity(named: AssetCardEntity.frameName)
        switch state {
        case .pending:
            setOpacity(0.4, on: entity)
            frame?.isEnabled = false
        case .confirmed:
            setOpacity(1, on: entity)
            frame?.isEnabled = false
        case .failed:
            setOpacity(1, on: entity)
            if let model = frame as? ModelEntity {
                model.model?.materials = [SimpleMaterial(color: .red, roughness: 1, isMetallic: false)]
            }
            frame?.isEnabled = true
        }
    }

    // MARK: - Private

    private static func setOpacity(_ value: Float, on entity: Entity) {
        if #available(iOS 18.0, visionOS 2.0, macOS 15.0, *) {
            entity.components.set(OpacityComponent(opacity: value))
        }
    }

    private static func matte(_ color: Material.Color) -> PhysicallyBasedMaterial {
        var material = PhysicallyBasedMaterial()
        material.baseColor = .init(tint: color)
        material.roughness = .init(floatLiteral: 0.7)
        material.metallic = .init(floatLiteral: 0)
        material.specular = .init(floatLiteral: 0.3)
        return material
    }

    /// Clear plastic: faint opacity, glossy with a clear coat so the environment reflects off it.
    private static func holderMaterial() -> PhysicallyBasedMaterial {
        var material = PhysicallyBasedMaterial()
        material.baseColor = .init(tint: .init(white: 0.96, alpha: 1))
        material.roughness = .init(floatLiteral: 0.06)
        material.metallic = .init(floatLiteral: 0)
        material.specular = .init(floatLiteral: 1)
        material.clearcoat = .init(floatLiteral: 1)
        material.clearcoatRoughness = .init(floatLiteral: 0.05)
        material.blending = .transparent(opacity: .init(floatLiteral: 0.16))
        return material
    }

    private static func addLabelText(for asset: TwinfoldAsset, centerY: Float, to root: Entity) {
        let lines = GradedSlabDimensions.labelLines(for: asset)
        let maxWidth = labelWidth - 0.006
        let zFront: Float = 0.0004
        var rows: [(text: String, size: CGFloat, weight: Float, y: Float)] = []
        if !lines.headline.isEmpty { rows.append((lines.headline, 0.0058, 0.7, centerY + 0.0048)) }
        if !lines.name.isEmpty { rows.append((lines.name, 0.0040, 0.3, centerY - (lines.headline.isEmpty ? 0 : 0.0052))) }
        for row in rows {
            let mesh = MeshResource.generateText(
                row.text,
                extrusionDepth: 0.0001,
                font: .systemFont(ofSize: row.size, weight: weightValue(row.weight)),
                containerFrame: .zero,
                alignment: .center,
                lineBreakMode: .byTruncatingTail
            )
            let text = ModelEntity(mesh: mesh, materials: [UnlitMaterial(color: .black)])
            let bounds = mesh.bounds
            // Center the text on the band; shrink only the text (never the slab) when it is wider than the band.
            let fit = min(1, maxWidth / max(bounds.extents.x, .ulpOfOne))
            text.scale = SIMD3<Float>(fit, fit, 1)
            text.position = SIMD3<Float>(-bounds.center.x * fit, row.y - bounds.center.y * fit, zFront)
            root.addChild(text)
        }
    }

    private static func weightValue(_ weight: Float) -> MeshResource.Font.Weight {
        weight >= 0.6 ? .bold : .regular
    }

    /// Fetches the card picture and swaps it onto the card plane. The slab is usable (and tappable) meanwhile.
    private static func loadPicture(for asset: TwinfoldAsset, into card: ModelEntity) {
        guard let source = SlabImageLoader.source(for: asset) else { return }
        Task { @MainActor [weak card] in
            guard let image = await SlabImageLoader.shared.image(for: source), let card else { return }
            do {
                let texture = try TextureResource.generate(from: image, withName: nil, options: .init(semantic: .color))
                var material = PhysicallyBasedMaterial()
                material.baseColor = .init(tint: .white, texture: .init(texture))
                material.roughness = .init(floatLiteral: 0.55)
                material.metallic = .init(floatLiteral: 0)
                material.specular = .init(floatLiteral: 0.4)
                card.model?.materials = [material]
            } catch {
                print("[TwinfoldSpatial] \(asset.id): could not build slab picture texture: \(error)")
            }
        }
    }
}
