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

/// How a graded card is shown: in its holder (the slab, default) or taken out of it (the card alone, 63 x 88 mm).
public enum SlabStyle: Sendable, Equatable {
    case holder
    case cardOnly
}

/// RealityKit representation of a graded card in its holder ("slab"), built at the real size in
/// `GradedSlabDimensions.psaStandard`. Platform-independent: no ARKit, UIKit or SwiftUI. `scale` is never touched.
///
/// Collector Crypt's `imageUrl` is a photo of the whole graded slab (label, grade and holder edge included), so the
/// photo is pasted onto the front as is. No label band, text or insert is drawn here: they are in the photo.
///
/// Structure (entity-local, origin at the slab's center, front face towards +z):
/// - body: clear acrylic box with the slab's outer size (81 x 136 x 6.5 mm). Its sides read as the holder's
///   translucent thickness (the front face sits behind the photo and is never seen);
///   it carries the collision shape used for tap picking
/// - photo: plane just in front of the body's front face. Starts as a dark gray face the size of the slab front; when
///   the picture arrives it is resized to the largest size that fits the front at the picture's aspect ratio (a slab
///   photo, aspect about 0.596, fills the front) and shown with an `UnlitMaterial` so its brightness is not dimmed by
///   AR lighting estimation. The picture is fetched at runtime from `imageUrl` (https) or taken from the bundled DEMO
///   fixture art
/// - gloss: plane in front of the photo, same size as the slab front, nearly transparent (opacity <= 0.05) clear-coat
///   material that only adds environment reflections
/// - frame: hidden outline used for selection (blue) and failure (red)
/// - shadow: soft contact shadow, enabled only on a wall (on a horizontal plane the grounding shadow does the job)
///
/// `SlabStyle.cardOnly` builds the card alone at `GradedSlabDimensions.card` (63 x 88 mm, 1.6 mm thick: thicker than a real card so the
/// edge reads at arm's length) instead:
/// - body (`bodyName`): light gray matte box (visible as the card stock edge) carrying the collision shape and input target
/// - photo (`cardName`): plane just in front of the body; the slab photo is cropped to the card with `SlabCardCrop`
///   and fitted to 63 x 88 mm. Unlit like the holder photo (see `pictureMaterial`). No gloss layer
/// - frame / shadow: as above, sized to the card (frame = card + 10 mm, halo margin 2 mm, faint)
/// - an empty marker entity (`cardOnlyMarkerName`) tells `pose(_:on:)` which layout applies (`isCardOnly`)
///
/// Tagged with `AssetCardEntity.entityName` so callers that look up "the placed asset entity" by name keep working.
@MainActor
public enum GradedSlabEntity {
    static let bodyName = "twinfold.gradedSlab.body"
    static let cardName = "twinfold.gradedSlab.card"
    static let glossName = "twinfold.gradedSlab.gloss"
    static let cardOnlyMarkerName = "twinfold.gradedSlab.cardOnly"

    /// Gap between the slab's back face and the anchor plane on a wall (the anchor itself already sits
    /// `AssetCardEntity.paperWallOffset` off the wall), so the back face sits 1 mm off the detected plane. It was
    /// 2.5 mm for a while to escape the LiDAR scene mesh, which wobbles by several millimetres and ate the contact
    /// shadow; since mesh occlusion is off (2026-10-09) a larger gap only made the card look as if it floated.
    /// The same gap is used on horizontal surfaces.
    static let wallGap: Float = 0.0004

    private static let dimensions = GradedSlabDimensions.psaStandard
    /// How far the wall contact shadow extends beyond the slab on each side (meters).
    private static let shadowMargin: Float = 0.007
    /// Card-only layout: thickness of the bare card, halo margin and halo peak opacity.
    private static let cardOnlyDepth: Float = 0.0016
    private static let cardOnlyShadowMargin: Float = 0.002
    private static let cardOnlyShadowPeak: Float = 0.12

    public static func isSlab(_ entity: Entity) -> Bool {
        entity.findEntity(named: bodyName) != nil
    }

    public static func isCardOnly(_ entity: Entity) -> Bool {
        entity.findEntity(named: cardOnlyMarkerName) != nil
    }

    public static func make(asset: TwinfoldAsset) -> Entity {
        make(asset: asset, style: .holder)
    }

    public static func make(asset: TwinfoldAsset, style: SlabStyle) -> Entity {
        switch style {
        case .holder: return makeHolder(asset: asset)
        case .cardOnly: return makeCardOnly(asset: asset)
        }
    }

    private static func makeHolder(asset: TwinfoldAsset) -> Entity {
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

        // Contact shadow on the wall: a tight dark rim around the slab (the slab stands only 6.5 mm proud of the
        // wall, so the shadow must hug the outline: a wide soft halo reads as floating), shifted a touch down and
        // right as if lit from above-left, so the slab reads as resting on the wall rather than printed on it.
        let shadow = ModelEntity(
            mesh: .generatePlane(width: width + 2 * shadowMargin, height: height + 2 * shadowMargin, cornerRadius: 0.006),
            materials: [makeShadowMaterial(
                size: SIMD2<Float>(width, height), margin: shadowMargin, peak: 0.3
            )]
        )
        shadow.name = AssetCardEntity.shadowName
        shadow.position = SIMD3<Float>(0.0008, -0.002, -depth / 2 - 0.0002)
        shadow.isEnabled = false
        root.addChild(shadow)

        // Clear acrylic holder body: its sides are the slab's translucent thickness.
        let body = ModelEntity(
            mesh: .generateBox(width: width, height: height, depth: depth, cornerRadius: 0.0025),
            materials: [clearBodyMaterial()]
        )
        body.name = bodyName
        body.generateCollisionShapes(recursive: false)
        if #available(iOS 18.0, visionOS 2.0, *) {
            body.components.set(InputTargetComponent())
        }
        root.addChild(body)

        // Slab photo on the front face; dark gray until the picture arrives.
        let photo = ModelEntity(
            mesh: .generatePlane(width: width, height: height, cornerRadius: 0.002),
            materials: [UnlitMaterial(color: .init(white: 0.18, alpha: 1))]
        )
        photo.name = cardName
        photo.position.z = depth / 2 + 0.0001
        root.addChild(photo)
        loadPicture(for: asset, into: photo)

        // Faint reflection layer over the photo. Never whitens it (opacity stays <= 0.05).
        let gloss = ModelEntity(
            mesh: .generatePlane(width: width, height: height, cornerRadius: 0.002),
            materials: [holderMaterial()]
        )
        gloss.name = glossName
        gloss.position.z = depth / 2 + 0.0003
        root.addChild(gloss)

        pose(root, on: .wall)
        apply(state: .confirmed, to: root)
        return root
    }

    private static func makeCardOnly(asset: TwinfoldAsset) -> Entity {
        let root = Entity()
        root.name = AssetCardEntity.entityName

        let width = GradedSlabDimensions.card.width
        let height = GradedSlabDimensions.card.height
        let depth = cardOnlyDepth

        let marker = Entity()
        marker.name = cardOnlyMarkerName
        root.addChild(marker)

        // Selection / failure outline (card + 10 mm), hidden by default, just behind the body's back face.
        let frameDepth: Float = 0.0004
        let frame = ModelEntity(
            mesh: .generateBox(width: width + 0.010, height: height + 0.010, depth: frameDepth, cornerRadius: 0.004),
            materials: [SimpleMaterial(color: .red, roughness: 1, isMetallic: false)]
        )
        frame.name = AssetCardEntity.frameName
        frame.position.z = -depth / 2 - frameDepth / 2
        frame.isEnabled = false
        root.addChild(frame)

        // Soft contact halo on a wall (the bare card is only 1.6 mm proud, so the halo is small and light).
        let shadow = ModelEntity(
            mesh: .generatePlane(
                width: width + 2 * cardOnlyShadowMargin, height: height + 2 * cardOnlyShadowMargin, cornerRadius: 0.004
            ),
            materials: [makeShadowMaterial(
                size: SIMD2<Float>(width, height), margin: cardOnlyShadowMargin, peak: cardOnlyShadowPeak
            )]
        )
        shadow.name = AssetCardEntity.shadowName
        shadow.position = SIMD3<Float>(0, 0, -depth / 2 - 0.0001)
        shadow.isEnabled = false
        root.addChild(shadow)

        let body = ModelEntity(
            mesh: .generateBox(width: width - 0.0004, height: height - 0.0004, depth: depth, cornerRadius: cardCornerRadius),
            materials: [matte(.init(white: 0.72, alpha: 1), roughness: 0.9)] // light gray card stock, visible as the edge
        )
        body.name = bodyName
        body.generateCollisionShapes(recursive: false)
        if #available(iOS 18.0, visionOS 2.0, *) {
            body.components.set(InputTargetComponent())
        }
        root.addChild(body)

        // The card photo on the front face; dark gray until the picture arrives.
        let photo = ModelEntity(
            mesh: .generatePlane(width: width, height: height, cornerRadius: cardCornerRadius),
            materials: [UnlitMaterial(color: .init(white: 0.18, alpha: 1))]
        )
        photo.name = cardName
        photo.position.z = depth / 2 + 0.0001
        root.addChild(photo)
        loadPicture(for: asset, into: photo, style: .cardOnly)

        pose(root, on: .wall)
        apply(state: .confirmed, to: root)
        return root
    }

    /// Sets the slab's pose within its anchor for `surface`. Safe to call every frame (holding preview): it only
    /// writes the root's local position and orientation and toggles the contact shadow.
    public static func pose(_ root: Entity, on surface: SlabSurface) {
        if isCardOnly(root) {
            poseCardOnly(root, on: surface)
            return
        }
        let depth = dimensions.depth
        switch surface {
        case .wall:
            root.orientation = simd_quatf(angle: 0, axis: SIMD3<Float>(1, 0, 0))
            root.position = SIMD3<Float>(0, 0, depth / 2 + wallGap)
        case .horizontal:
            // Lying flat on the desk or floor, photo up (the user chose this over a standing slab, 2026-10-09).
            root.orientation = simd_quatf(angle: -.pi / 2, axis: SIMD3<Float>(1, 0, 0))
            root.position = SIMD3<Float>(0, depth / 2 + wallGap, 0)
        }
        // The shadow plane is a child of root, so it follows root's -90 degree rotation and lies under the card on a desk too.
        root.findEntity(named: AssetCardEntity.shadowName)?.isEnabled = true
    }

    /// Card-only layout: on a wall the card lies flush (back face at `wallGap`); on a horizontal surface it lies flat
    /// with its front towards +y (rotation of -90 degrees about x), its center `cardOnlyDepth / 2 + wallGap` above the surface.
    private static func poseCardOnly(_ root: Entity, on surface: SlabSurface) {
        switch surface {
        case .wall:
            root.orientation = simd_quatf(angle: 0, axis: SIMD3<Float>(1, 0, 0))
            root.position = SIMD3<Float>(0, 0, cardOnlyDepth / 2 + wallGap)
        case .horizontal:
            root.orientation = simd_quatf(angle: -.pi / 2, axis: SIMD3<Float>(1, 0, 0))
            root.position = SIMD3<Float>(0, cardOnlyDepth / 2 + wallGap, 0)
        }
        root.findEntity(named: AssetCardEntity.shadowName)?.isEnabled = true
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

    private static func matte(_ color: Material.Color, roughness: Float = 0.7) -> PhysicallyBasedMaterial {
        var material = PhysicallyBasedMaterial()
        material.baseColor = .init(tint: color)
        material.roughness = .init(floatLiteral: roughness)
        material.metallic = .init(floatLiteral: 0)
        material.specular = .init(floatLiteral: 0.3)
        return material
    }

    /// Acrylic holder body. Only its sides are ever seen (the photo covers the front, the wall the back), so this is
    /// tuned for the edge: frosted and fairly opaque, so the 6.5 mm thickness reads from an angle and catches light,
    /// without the hard black rim of an opaque body or the vanishing edge of a nearly clear one.
    private static func clearBodyMaterial() -> PhysicallyBasedMaterial {
        var material = PhysicallyBasedMaterial()
        material.baseColor = .init(tint: .init(white: 0.86, alpha: 1))
        material.roughness = .init(floatLiteral: 0.3)
        material.metallic = .init(floatLiteral: 0)
        material.specular = .init(floatLiteral: 0.8)
        material.clearcoat = .init(floatLiteral: 1)
        material.clearcoatRoughness = .init(floatLiteral: 0.15)
        material.blending = .transparent(opacity: .init(floatLiteral: 0.72))
        return material
    }

    /// Reflection-only layer: almost fully transparent, glossy with a clear coat so the environment reflects off it.
    private static func holderMaterial() -> PhysicallyBasedMaterial {
        var material = PhysicallyBasedMaterial()
        material.baseColor = .init(tint: .white)
        material.roughness = .init(floatLiteral: 0.05)
        material.metallic = .init(floatLiteral: 0)
        material.specular = .init(floatLiteral: 1)
        material.clearcoat = .init(floatLiteral: 1)
        material.clearcoatRoughness = .init(floatLiteral: 0.05)
        material.blending = .transparent(opacity: .init(floatLiteral: 0.05))
        return material
    }

    /// Material for the card photo: unlit in both layouts, so the picture keeps the studio brightness it was shot
    /// with and is not dimmed by AR light estimation. A lit PBR variant for the bare card (semi-gloss + clearcoat +
    /// the photo as low emissive) was tried on 2026-10-09 and washed the card out to near white on device.
    private static func pictureMaterial(texture: TextureResource, style: SlabStyle) -> any Material {
        var material = UnlitMaterial(color: .white)
        material.color = .init(tint: .white, texture: .init(texture))
        return material
    }

    /// Contact-shadow material: an alpha-only halo texture (see `makeShadowTexture`) through an unlit material.
    private static func makeShadowMaterial(size: SIMD2<Float>, margin: Float, peak: Float) -> UnlitMaterial {
        do {
            var material = UnlitMaterial(color: .white)
            material.color = .init(tint: .white, texture: .init(try makeShadowTexture(size: size, margin: margin, peak: peak)))
            material.blending = .transparent(opacity: .init(floatLiteral: 1.0))
            return material
        } catch {
            print("[TwinfoldSpatial] failed to build slab shadow texture: \(error) — falling back to a flat shadow")
            var material = UnlitMaterial(color: .black)
            material.blending = .transparent(opacity: .init(floatLiteral: 0.12))
            return material
        }
    }

    /// Black texture whose alpha is strongest just outside the slab's outline and fades to 0 at the plane's edge
    /// (`margin` away). Inside the outline it stays at the peak (hidden behind the slab anyway). The bottom
    /// half is a little darker than the top, as if lit from above.
    private static func makeShadowTexture(size outline: SIMD2<Float>, margin: Float, peak peakAlpha: Float) throws -> TextureResource {
        let size = 256
        let planeWidth = outline.x + 2 * margin
        let planeHeight = outline.y + 2 * margin
        // Half extents of the outline in UV units (0...1 across the plane).
        let halfU = outline.x / 2 / planeWidth
        let halfV = outline.y / 2 / planeHeight
        let marginU = margin / planeWidth
        let marginV = margin / planeHeight
        var pixels = [UInt8](repeating: 0, count: size * size * 4)
        for row in 0..<size {
            let v = Float(row) / Float(size - 1) - 0.5 // -0.5 (top) ... 0.5 (bottom)
            let dy = max(0, abs(v) - halfV) / marginV
            let lightBias: Float = v > 0 ? 1 : 0.7 // bottom half darker
            for col in 0..<size {
                let u = Float(col) / Float(size - 1) - 0.5
                let dx = max(0, abs(u) - halfU) / marginU
                let d = min(1, (dx * dx + dy * dy).squareRoot())
                let falloff = pow(1 - d, 2.2)
                let alpha = peakAlpha * falloff * lightBias
                let index = (row * size + col) * 4
                pixels[index + 3] = UInt8(max(0, min(255, alpha * 255)))
            }
        }
        guard let provider = CGDataProvider(data: Data(pixels) as CFData) else { throw ShadowTextureError.dataProviderFailed }
        guard let cgImage = CGImage(
            width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent
        ) else { throw ShadowTextureError.imageCreationFailed }
        return try TextureResource.generate(from: cgImage, withName: nil, options: .init(semantic: .color))
    }

    private enum ShadowTextureError: Error {
        case dataProviderFailed
        case imageCreationFailed
    }

    /// Corner radius of a loose card (real trading cards are rounded by about 3 mm). Clips the holder's dark corners
    /// that remain in a rectangular crop of the slab photo.
    private static let cardCornerRadius: Float = 0.003
    /// Fraction of the card rectangle trimmed off each edge after `SlabCardCrop.cardRect`, dropping the thin dark rim
    /// of the holder's window that stays inside the rectangle.
    private static let cardCropInset: Double = 0.02

    /// The card cut out of the slab photo with a small inset (see `cardCropInset`), or `nil` when CoreGraphics
    /// cannot crop it.
    private static func cropCard(from image: CGImage, gradingCompany: String?) -> CGImage? {
        let rect = SlabCardCrop.cardRect(in: image, gradingCompany: gradingCompany)
        let inset = rect.insetBy(dx: cardCropInset * rect.width, dy: cardCropInset * rect.height)
        let pixels = CGRect(
            x: inset.minX * Double(image.width), y: inset.minY * Double(image.height),
            width: inset.width * Double(image.width), height: inset.height * Double(image.height)
        ).integral
        return image.cropping(to: pixels)
    }

    /// Largest size with aspect ratio `aspect` (w/h) that fits inside `bounds` without stretching.
    private static func fit(aspect: Float, in bounds: SIMD2<Float>) -> SIMD2<Float> {
        guard aspect > 0, aspect.isFinite else { return bounds }
        if aspect > bounds.x / bounds.y {
            return SIMD2<Float>(bounds.x, bounds.x / aspect)
        }
        return SIMD2<Float>(bounds.y * aspect, bounds.y)
    }

    /// Fetches the slab photo and swaps it onto the photo plane. The slab is usable (and tappable) meanwhile.
    private static func loadPicture(for asset: TwinfoldAsset, into card: ModelEntity, style: SlabStyle = .holder) {
        guard let source = SlabImageLoader.source(for: asset) else { return }
        let gradingCompany = asset.gradingCompany
        Task { @MainActor [weak card] in
            guard let loaded = await SlabImageLoader.shared.image(for: source), let card else { return }
            do {
                // Card-only: cut the card out of the slab photo (the original if the crop fails).
                let image: CGImage
                let bounds: SIMD2<Float>
                switch style {
                case .holder:
                    image = loaded
                    bounds = SIMD2<Float>(dimensions.width, dimensions.height)
                case .cardOnly:
                    image = cropCard(from: loaded, gradingCompany: gradingCompany) ?? loaded
                    bounds = SIMD2<Float>(GradedSlabDimensions.card.width, GradedSlabDimensions.card.height)
                }
                let texture = try TextureResource.generate(from: image, withName: nil, options: .init(semantic: .color))
                let size = fit(
                    aspect: Float(image.width) / Float(max(image.height, 1)),
                    in: bounds
                )
                card.model?.mesh = .generatePlane(
                    width: size.x, height: size.y, cornerRadius: style == .cardOnly ? cardCornerRadius : 0.002
                )
                if style == .cardOnly, let body = card.parent?.findEntity(named: bodyName) as? ModelEntity {
                    // Keep the card stock a hair inside the photo so the rounded corners do not reveal a rim, but let
                    // its white sides show: a bare card with no visible thickness reads as a pasted picture.
                    body.model?.mesh = .generateBox(
                        width: max(0.001, size.x - 0.0004), height: max(0.001, size.y - 0.0004),
                        depth: cardOnlyDepth, cornerRadius: cardCornerRadius
                    )
                }
                card.model?.materials = [pictureMaterial(texture: texture, style: style)]
            } catch {
                print("[TwinfoldSpatial] \(asset.id): could not build slab picture texture: \(error)")
            }
        }
    }
}
