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
    static let artworkName = "twinfold.assetCard.artwork"

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

        // Prefer the fixture's reference artwork PNG (a thin plane on the
        // card's front face, since texturing the whole box would stretch
        // the image across the sides/back too) over the plain white
        // card+title fallback. Only the front reads an image; the box's
        // sides/back stay white either way, which is fine for a "flat
        // card" that isn't meant to be inspected edge-on.
        if let artworkMaterial = makeArtworkMaterial(for: asset) {
            let artworkMesh = MeshResource.generatePlane(
                width: cardSize.width,
                height: cardSize.height,
                cornerRadius: 0.006
            )
            let artwork = ModelEntity(mesh: artworkMesh, materials: [artworkMaterial])
            artwork.name = artworkName
            artwork.position.z = cardSize.depth / 2 + 0.0006
            root.addChild(artwork)
        } else {
            // Font scales with card height so the title stays legible at
            // both the small default size and a real-world wall-sized
            // print (at the default 0.16m height this is exactly the
            // original fixed 0.012).
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
        }

        apply(state: .confirmed, to: root)
        return root
    }

    /// Used by `AssetRepresentationEntity` as the `.model` fallback when no
    /// USDZ twin is bundled yet (e.g. the kokeshi shelf-collectible example
    /// before a scan exists): a single thin image plane — no backing box,
    /// no frame border, no title — rather than the full `make(asset:)`
    /// card. If the PNG has an alpha channel (e.g. a transparent-background
    /// silhouette), that transparency shows through since this is a plane,
    /// not an opaque box. Falls back to a plain white plane (still no box)
    /// if the asset has no bundled artwork PNG either.
    ///
    /// Keeps the same `entityName` root and a `surfaceName` child as
    /// `make(asset:)`, so `apply(state:)` (pending/confirmed/failed) and
    /// tap picking (`ARView.entity(at:)` on iOS; `InputTargetComponent` +
    /// collision on visionOS) work unchanged.
    public static func makeThinPlate(asset: TwinfoldAsset) -> Entity {
        let root = Entity()
        root.name = entityName

        let cardSize = size(for: asset)

        let frameMesh = MeshResource.generatePlane(
            width: cardSize.width + 0.012,
            height: cardSize.height + 0.012,
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

        let material = makeArtworkMaterial(for: asset)
            ?? SimpleMaterial(color: .white, roughness: 0.6, isMetallic: false)
        let surfaceMesh = MeshResource.generatePlane(
            width: cardSize.width,
            height: cardSize.height,
            cornerRadius: 0.006
        )
        let surface = ModelEntity(mesh: surfaceMesh, materials: [material])
        surface.name = surfaceName
        // Same iOS 17 vs. visionOS tap-picking split as `make(asset:)`'s
        // `card` box: see the comment there.
        if #available(iOS 18.0, *) {
            surface.components.set(InputTargetComponent())
            surface.generateCollisionShapes(recursive: false)
        }
        root.addChild(surface)

        apply(state: .confirmed, to: root)
        return root
    }

    /// Loads `asset.display.imageUrl`'s PNG from the package's bundled
    /// `Resources/artworks` (synced from `fixtures/demo/artworks/*.png` —
    /// see `TwinfoldCoreResources.artworkURL(forImageUrl:)`) and wraps it
    /// in a lit (not `UnlitMaterial`) `SimpleMaterial` so the image
    /// receives the same environment lighting as the rest of the AR scene
    /// (P0 requirement). Returns `nil` — logging why — when there's no
    /// bundled PNG for this asset yet or it fails to decode, so callers
    /// fall back to the plain white card + title.
    private static func makeArtworkMaterial(for asset: TwinfoldAsset) -> SimpleMaterial? {
        guard let url = TwinfoldCoreResources.artworkURL(forImageUrl: asset.display.imageUrl) else {
            print(
                "[TwinfoldSpatial] \(asset.id): no bundled artwork PNG for "
                    + "\"\(asset.display.imageUrl)\" — falling back to plain card"
            )
            return nil
        }
        do {
            // Synchronous load (not the async `init(contentsOf:)`, which
            // needs iOS 18+): keeps `make(asset:)` a plain synchronous
            // MainActor function under the iOS 17 deployment target.
            let texture = try TextureResource.load(contentsOf: url)
            var material = SimpleMaterial()
            material.color = .init(tint: .white, texture: .init(texture))
            material.roughness = 0.8
            material.metallic = 0
            return material
        } catch {
            print(
                "[TwinfoldSpatial] \(asset.id): failed to load artwork texture "
                    + "from \(url.lastPathComponent): \(error) — falling back to plain card"
            )
            return nil
        }
    }

    /// Toggles the pending/confirmed/failed look of a card created by
    /// `make(asset:)`. Pending is semi-transparent, failed shows a red
    /// frame, confirmed is the normal appearance. When an artwork image is
    /// present (`artworkName` child), the image itself is dimmed for
    /// pending rather than being replaced by a plain white surface, so the
    /// image stays visible throughout.
    public static func apply(state: PlacementState, to entity: Entity) {
        let frame = entity.findEntity(named: frameName)
        guard let card = entity.findEntity(named: surfaceName) as? ModelEntity else { return }
        let artwork = entity.findEntity(named: artworkName) as? ModelEntity

        switch state {
        case .pending:
            setTintAlpha(0.4, on: artwork, fallback: card)
            frame?.isEnabled = false
        case .confirmed:
            setTintAlpha(1.0, on: artwork, fallback: card)
            frame?.isEnabled = false
        case .failed:
            setTintAlpha(1.0, on: artwork, fallback: card)
            frame?.isEnabled = true
        }
    }

    /// Sets a `SimpleMaterial`'s tint alpha on `artwork` (the image plane)
    /// when present, otherwise on `card` (the plain white box). Keeps
    /// whatever texture is already on the material (the artwork's, or none
    /// for the plain-card fallback), so this only ever changes opacity, not
    /// what's drawn.
    private static func setTintAlpha(_ alpha: CGFloat, on artwork: ModelEntity?, fallback card: ModelEntity) {
        let target = artwork ?? card
        guard let material = target.model?.materials.first as? SimpleMaterial else { return }
        var updated = material
        updated.color = .init(tint: Material.Color.white.withAlphaComponent(alpha), texture: material.color.texture)
        target.model?.materials = [updated]
    }
}
