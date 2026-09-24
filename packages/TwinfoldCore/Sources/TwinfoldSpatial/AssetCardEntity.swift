import CoreGraphics
import Foundation
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
    static let shadowName = "twinfold.assetCard.shadow"

    /// Default footprint, used when `asset.physical?.dimensions` is absent
    /// (e.g. no real-world size is known yet).
    public static let width: Float = 0.12
    static let height: Float = 0.16
    /// Default card body thickness. Small enough to read as a flat card,
    /// thick enough that the box's back face is a visible plain-white back
    /// side when the user rotates the card 180 degrees.
    static let depth: Float = 0.002

    /// Distance (meters) `makePaper(asset:)`'s anchor sits off the wall
    /// surface. With the warped paper mesh (see `paperWarpPositions`), this
    /// is the offset of the sheet's *top edge* — the point where the paper
    /// is meant to read as touching the wall — not a stand-in for real
    /// paper thickness (paper has none here). Small enough to avoid
    /// z-fighting with the wall's own geometry while still reading as
    /// "almost touching". Used directly by iOS's wall-placement math
    /// (`RoomController.wallTransform`) instead of `size(for:).depth`,
    /// since a paper sheet's position off the wall shouldn't depend on the
    /// fixture's (framed-card-era) `depthCm`.
    public static let paperWallOffset: Float = 0.0006
    /// How far behind `makePaper`'s paper (i.e. closer to the wall) the
    /// selection/failed frame sits, so it reads as an outline peeking out
    /// from behind the sheet. Must stay less than `paperWallOffset` so the
    /// frame itself never touches the wall, and must clear the paper's
    /// warped top edge (its z-minimum) by enough to avoid z-fighting there.
    static let paperFrameOffset: Float = 0.00035
    /// How far behind the paper the contact shadow sits — closer to the
    /// wall than the frame, so the two never z-fight each other. The
    /// shadow's own soft-edged texture (see `makeShadowTexture`) does the
    /// visual work, not this offset.
    static let paperShadowOffset: Float = 0.0005
    /// How much larger than the paper (per side) the contact shadow plane
    /// is, so its soft falloff has room to fade out before the plane's own
    /// edge.
    static let paperShadowPadding: Float = 0.01

    // MARK: - Paper warp tuning (`makePaper`)
    //
    // The paper is modeled as a subdivided grid, not a flat plane: the top
    // edge sits (via `paperWallOffset`) almost flush with the wall, and the
    // sheet curls gently away from the wall toward the bottom, like a thin
    // sheet resting against a vertical surface under its own weight/curl
    // rather than a rigid board or screen. All amounts below are *local*
    // z-displacement (meters), added on top of `paperWallOffset`.

    /// Grid resolution (quads) the paper mesh is built from: wide enough
    /// (16 columns x 24 rows) for the curl and gentle wave below to read as
    /// a smooth curve rather than faceted segments, without generating an
    /// excessive vertex count for a handful of on-screen sheets.
    private static let paperWarpSegmentsX = 16
    private static let paperWarpSegmentsY = 24
    /// How far the bottom-center of the sheet lifts off the wall.
    private static let paperWarpCenterBottomLift: Float = 0.0015
    /// How far the bottom corners lift off the wall — more than the
    /// center, so the bottom edge reads as a shallow curve rather than a
    /// straight hinge, the way a real sheet's corners curl first.
    private static let paperWarpCornerBottomLift: Float = 0.0035
    /// Exponent applied to the top-to-bottom progress (0 at the touching
    /// top edge, 1 at the bottom) before scaling by the lift above: > 1
    /// keeps the area near the top edge close to flush with the wall and
    /// concentrates the curl in the lower half, rather than curling evenly
    /// from the top edge down.
    private static let paperWarpVerticalExponent: Float = 1.6
    /// Amplitude of a very gentle side-to-side ripple ("cockling") layered
    /// on top of the main curl, so the sheet doesn't read as a perfectly
    /// smooth/rigid curve either. Stays under the 1mm ceiling from the
    /// design brief.
    private static let paperWarpWaveAmplitude: Float = 0.0006
    /// Number of ripple half-cycles across the sheet's width.
    private static let paperWarpWavePeriod: Float = 1.5

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

    /// Used by iOS's wall-placement flow (`RoomController`, via
    /// `AssetRepresentationEntity.makeForWallPlacement(asset:)`) instead of
    /// `make(asset:)`'s boxed card: a flat, essentially-zero-thickness
    /// sheet of paper flush against the wall, at real size, square corners
    /// — no frame border, mat, or title showing at the edges, matching how
    /// a ukiyo-e print actually hangs rather than a thick framed card.
    ///
    /// Adds one extra child beyond `make(asset:)`/`makeThinPlate(asset:)`'s
    /// `frameName`/`surfaceName`: a subtle always-on contact shadow plane
    /// (`shadowName`) between the frame and the wall, so the paper doesn't
    /// look like it's floating off the wall. `apply(state:)` and
    /// `setHighlighted` don't need to know about it — it never toggles.
    ///
    /// Not used for visionOS (`make(asset:)` stays the boxed card there)
    /// or for the floor-placed twin fallback (`makeThinPlate(asset:)`
    /// stays unchanged).
    public static func makePaper(asset: TwinfoldAsset) -> Entity {
        let root = Entity()
        root.name = entityName

        let cardSize = size(for: asset)

        // Soft-edged contact shadow: a black plane whose alpha fades out
        // toward the top and sides, strongest along the bottom edge where
        // the paper actually rests against the wall, rather than a
        // uniform-alpha rectangle (which reads as a hard-edged border/mat,
        // not a shadow). See `makeShadowTexture`.
        let shadowMesh = MeshResource.generatePlane(
            width: cardSize.width + paperShadowPadding,
            height: cardSize.height + paperShadowPadding
        )
        let shadow = ModelEntity(mesh: shadowMesh, materials: [makeShadowMaterial()])
        shadow.name = shadowName
        shadow.position.z = -paperShadowOffset
        root.addChild(shadow)

        // Selection (blue) / failed-transfer (red) outline, same frame
        // nodes `apply(state:)`/`setHighlighted` already know how to
        // toggle — just a flat plane here instead of `make(asset:)`'s thin
        // box, positioned between the paper and the shadow/wall. Flat
        // (unwarped) is fine: it only needs to stay behind the paper's
        // z-minimum (its touching top edge), which it does since
        // `paperFrameOffset` < `paperWallOffset`.
        let frameMesh = MeshResource.generatePlane(
            width: cardSize.width + 0.012,
            height: cardSize.height + 0.012
        )
        let frame = ModelEntity(
            mesh: frameMesh,
            materials: [SimpleMaterial(color: .red, roughness: 1, isMetallic: false)]
        )
        frame.name = frameName
        frame.position.z = -paperFrameOffset
        frame.isEnabled = false
        root.addChild(frame)

        // No white-card/title fallback here (unlike `make(asset:)`): a
        // paper sheet with no artwork image would just be a plain white
        // sheet, not a card with a title printed on it. Matte
        // (PhysicallyBasedMaterial, roughness ~1, low specular) rather
        // than `makeArtworkMaterial`'s SimpleMaterial, so it reads as
        // paper rather than a glossy card — see `makePaperMaterial`.
        let material = makePaperMaterial(for: asset)
        let paperMesh = makePaperWarpMesh(width: cardSize.width, height: cardSize.height)
        let paper = ModelEntity(mesh: paperMesh, materials: [material])
        paper.name = surfaceName
        // Same iOS 17 vs. visionOS tap-picking split as `make(asset:)`'s
        // `card` box: see the comment there. (visionOS never calls this
        // function, but the guard is harmless to keep symmetric.)
        if #available(iOS 18.0, *) {
            paper.components.set(InputTargetComponent())
            paper.generateCollisionShapes(recursive: false)
        }
        root.addChild(paper)

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

    /// `makePaper`'s matte, paper-like material: reuses
    /// `makeArtworkMaterial`'s texture lookup (so both stay in sync about
    /// which asset has a bundled PNG) but wraps it in a
    /// `PhysicallyBasedMaterial` with roughness ~1 and low specular instead
    /// of `makeArtworkMaterial`'s glossier `SimpleMaterial`, since paper
    /// shouldn't read as a glossy printed card. Kept separate from
    /// `makeArtworkMaterial` rather than changing that function, since it's
    /// shared with `make(asset:)` (visionOS) and `makeThinPlate(asset:)`
    /// (the twin fallback), which this task must not change.
    ///
    /// Left at the default `.opaque` blending — `apply(state:)` drives
    /// pending/confirmed/failed alpha via `OpacityComponent` instead of
    /// this material's own `.transparent` blending (see `setTintAlpha`):
    /// `.transparent(opacity:)` blending on this material rendered the
    /// holding preview fully invisible when its anchor sat at a
    /// near-zero-distance identity transform (the AR-unsupported/simulator
    /// fallback, before `updateHoldingPreview` ever repositions it) — a
    /// transparent-object depth-sort edge case at that degenerate
    /// distance. `OpacityComponent` composites the whole entity after
    /// rendering instead, sidestepping that path, and keeps the confirmed
    /// (opaque) placement on the plain, robust opaque pipeline throughout.
    private static func makePaperMaterial(for asset: TwinfoldAsset) -> PhysicallyBasedMaterial {
        var material = PhysicallyBasedMaterial()
        if let artwork = makeArtworkMaterial(for: asset) {
            material.baseColor = .init(tint: .white, texture: artwork.color.texture)
        } else {
            material.baseColor = .init(tint: .white, texture: nil)
        }
        material.roughness = .init(floatLiteral: 1.0)
        material.metallic = .init(floatLiteral: 0.0)
        material.specular = .init(floatLiteral: 0.15)
        return material
    }

    /// Builds `makePaper`'s warped paper mesh: a `paperWarpSegmentsX` x
    /// `paperWarpSegmentsY` grid (not a flat plane) whose top row sits at
    /// local z = 0 (i.e. exactly `paperWallOffset` off the wall — see that
    /// constant's doc comment) and whose z rises smoothly toward the
    /// bottom row per `paperWarpCenterBottomLift`/`paperWarpCornerBottomLift`,
    /// plus a very gentle side-to-side wave, so the sheet reads as curling
    /// gently off the wall rather than a rigid flat board. Per-vertex
    /// normals follow the warp (finite differences over the grid) so
    /// environment lighting shades the curve. UVs match
    /// `MeshResource.generatePlane`'s convention (u: 0 at left/-width/2 to
    /// 1 at right/+width/2; v: 0 at bottom/-height/2 to 1 at top/+height/2)
    /// so the artwork texture isn't flipped or stretched differently than
    /// before. Falls back to a flat plane (logging why) if mesh generation
    /// throws.
    private static func makePaperWarpMesh(width: Float, height: Float) -> MeshResource {
        let segmentsX = paperWarpSegmentsX
        let segmentsY = paperWarpSegmentsY
        let colsCount = segmentsX + 1
        let rowsCount = segmentsY + 1

        func vertexIndex(row: Int, col: Int) -> Int { row * colsCount + col }

        func zDisplacement(t: Float, xNorm: Float) -> Float {
            let verticalCurve = pow(max(0, t), paperWarpVerticalExponent)
            let bottomShape = paperWarpCenterBottomLift
                + (paperWarpCornerBottomLift - paperWarpCenterBottomLift) * xNorm * xNorm
            let wave = paperWarpWaveAmplitude
                * sin(xNorm * paperWarpWavePeriod * .pi)
                * t
            return max(0, verticalCurve * bottomShape + wave)
        }

        var positions: [SIMD3<Float>] = []
        positions.reserveCapacity(rowsCount * colsCount)
        for row in 0..<rowsCount {
            let t = Float(row) / Float(segmentsY) // 0 at the touching top edge, 1 at the bottom
            let y = height / 2 - t * height
            for col in 0..<colsCount {
                let xNorm = Float(col) / Float(segmentsX) * 2 - 1 // -1 (left) ... 1 (right)
                let x = xNorm * width / 2
                let z = zDisplacement(t: t, xNorm: xNorm)
                positions.append(SIMD3<Float>(x, y, z))
            }
        }

        var normals: [SIMD3<Float>] = []
        normals.reserveCapacity(positions.count)
        for row in 0..<rowsCount {
            for col in 0..<colsCount {
                let center = positions[vertexIndex(row: row, col: col)]
                let left = positions[vertexIndex(row: row, col: max(0, col - 1))]
                let right = positions[vertexIndex(row: row, col: min(colsCount - 1, col + 1))]
                let up = positions[vertexIndex(row: max(0, row - 1), col: col)]
                let down = positions[vertexIndex(row: min(rowsCount - 1, row + 1), col: col)]
                let tangentU = right - (col == 0 ? center : left)
                let tangentV = down - (row == 0 ? center : up)
                let cross = SIMD3<Float>(
                    tangentV.y * tangentU.z - tangentV.z * tangentU.y,
                    tangentV.z * tangentU.x - tangentV.x * tangentU.z,
                    tangentV.x * tangentU.y - tangentV.y * tangentU.x
                )
                let length = simd_length(cross)
                normals.append(length > .ulpOfOne ? cross / length : SIMD3<Float>(0, 0, 1))
            }
        }

        var uvs: [SIMD2<Float>] = []
        uvs.reserveCapacity(positions.count)
        for row in 0..<rowsCount {
            let v = 1 - Float(row) / Float(segmentsY)
            for col in 0..<colsCount {
                let u = Float(col) / Float(segmentsX)
                uvs.append(SIMD2<Float>(u, v))
            }
        }

        var indices: [UInt32] = []
        indices.reserveCapacity(segmentsX * segmentsY * 6)
        for row in 0..<segmentsY {
            for col in 0..<segmentsX {
                let topLeft = UInt32(vertexIndex(row: row, col: col))
                let topRight = UInt32(vertexIndex(row: row, col: col + 1))
                let bottomLeft = UInt32(vertexIndex(row: row + 1, col: col))
                let bottomRight = UInt32(vertexIndex(row: row + 1, col: col + 1))
                indices.append(contentsOf: [topLeft, bottomLeft, bottomRight])
                indices.append(contentsOf: [topLeft, bottomRight, topRight])
            }
        }

        var descriptor = MeshDescriptor(name: "twinfold.paperWarp")
        descriptor.positions = MeshBuffers.Positions(positions)
        descriptor.normals = MeshBuffers.Normals(normals)
        descriptor.textureCoordinates = MeshBuffers.TextureCoordinates(uvs)
        descriptor.primitives = .triangles(indices)

        do {
            return try MeshResource.generate(from: [descriptor])
        } catch {
            print("[TwinfoldSpatial] failed to build warped paper mesh: \(error) — falling back to a flat plane")
            return MeshResource.generatePlane(width: width, height: height)
        }
    }

    /// Builds the soft-edged contact-shadow material for `makePaper`: a
    /// small procedural alpha-only texture (see `makeShadowTexture`) driven
    /// through an `UnlitMaterial`'s color-alpha + `.transparent` blending,
    /// rather than a single flat opacity value, so the shadow fades out
    /// toward the top/sides instead of reading as a uniform dark rectangle.
    /// Falls back to the old flat low-alpha black plane (logging why) if
    /// texture generation fails.
    private static func makeShadowMaterial() -> UnlitMaterial {
        do {
            let texture = try makeShadowTexture()
            var material = UnlitMaterial(color: .white)
            material.color = .init(tint: .white, texture: .init(texture))
            material.blending = .transparent(opacity: .init(floatLiteral: 1.0))
            return material
        } catch {
            print("[TwinfoldSpatial] failed to build soft shadow texture: \(error) — falling back to a flat shadow")
            var material = UnlitMaterial(color: .black)
            material.blending = .transparent(opacity: .init(floatLiteral: 0.15))
            return material
        }
    }

    /// Renders a small black, alpha-varying texture used as the contact
    /// shadow's opacity mask: alpha is near 0 along the top edge (row 0),
    /// rising toward the bottom edge (last row), and fading out toward the
    /// left/right edges — an analytic soft falloff (built directly as a
    /// pixel buffer, not a drawn-then-blurred rectangle) rather than a
    /// hard-edged shape, so it reads as a soft contact shadow rather than a
    /// dark border/frame. Row 0 of the pixel buffer is the top of the
    /// resulting image, matching how `TextureResource` already renders
    /// bundled artwork PNGs right-side-up (row 0 = top), so this lines up
    /// with the plane's v=1-at-top UV convention without needing a
    /// separate flip.
    private static func makeShadowTexture() throws -> TextureResource {
        let size = 128
        let peakAlpha: Float = 0.22
        var pixels = [UInt8](repeating: 0, count: size * size * 4)

        for row in 0..<size {
            // 0 at the top row (touching edge — nearly invisible), 1 at the
            // bottom row (resting edge — strongest).
            let vFromBottom = 1 - Float(row) / Float(size - 1)
            let verticalFactor = pow(vFromBottom, 1.6)
            for col in 0..<size {
                let uNorm = Float(col) / Float(size - 1) * 2 - 1 // -1...1
                let edgeDistance = 1 - min(1, max(0, (abs(uNorm) - 0.55) / 0.45))
                let alpha = peakAlpha * verticalFactor * edgeDistance
                let index = (row * size + col) * 4
                pixels[index + 0] = 0
                pixels[index + 1] = 0
                pixels[index + 2] = 0
                pixels[index + 3] = UInt8(max(0, min(255, alpha * 255)))
            }
        }

        guard let provider = CGDataProvider(data: Data(pixels) as CFData) else {
            throw ShadowTextureError.dataProviderFailed
        }
        guard let cgImage = CGImage(
            width: size,
            height: size,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: size * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: true,
            intent: .defaultIntent
        ) else {
            throw ShadowTextureError.imageCreationFailed
        }

        // `TextureResource.generate(from:withName:options:)`, not the
        // `init(image:withName:options:)` convenience initializer, since
        // the latter needs iOS 18+ and this must stay on the iOS 17
        // deployment target (see `makeArtworkMaterial`'s equivalent note
        // about `TextureResource.load(contentsOf:)` vs. its async init).
        return try TextureResource.generate(from: cgImage, withName: nil, options: .init(semantic: .color))
    }

    private enum ShadowTextureError: Error {
        case dataProviderFailed
        case imageCreationFailed
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
            setFrameColor(.red, on: frame)
            frame?.isEnabled = true
        }
    }

    /// Toggles a blue selection outline on a card built by `make(asset:)`
    /// or `makeThinPlate(asset:)`, reusing the frame node that `apply(state:)`
    /// shows in red for `failed`. Callers should only call this while the
    /// entity's transfer state is `.idle`/`.confirmed` — `apply(state:)`
    /// already owns the frame while `.pending`/`.failed`.
    public static func setHighlighted(_ highlighted: Bool, on entity: Entity) {
        guard let frame = entity.findEntity(named: frameName) else { return }
        if highlighted { setFrameColor(.systemBlue, on: frame) }
        frame.isEnabled = highlighted
    }

    private static func setFrameColor(_ color: SimpleMaterial.Color, on frame: Entity?) {
        guard let model = frame as? ModelEntity else { return }
        model.model?.materials = [SimpleMaterial(color: color, roughness: 1, isMetallic: false)]
    }

    /// Sets tint alpha on `artwork` (the image plane) when present,
    /// otherwise on `card` (the plain white box, or — for `makePaper` — the
    /// paper sheet itself, since it has no separate `artworkName` child).
    /// Keeps whatever texture is already on the material, so this only
    /// ever changes opacity, not what's drawn. Handles both material types
    /// `AssetCardEntity` hands out: `SimpleMaterial` (`make(asset:)`,
    /// `makeThinPlate(asset:)`) via its color's tint alpha, and
    /// `PhysicallyBasedMaterial` (`makePaper(asset:)`'s matte paper — see
    /// `makePaperMaterial`) via an `OpacityComponent` on `target`, not the
    /// material's own `.transparent` blending — see `makePaperMaterial`'s
    /// doc comment for why (it made the holding preview invisible at the
    /// simulator fallback's near-zero-distance identity transform).
    /// `OpacityComponent` needs iOS 18/visionOS 2 (same gap
    /// `AssetRepresentationEntity.setPreviewTranslucent` already documents
    /// for twins); below that, the paper stays fully opaque rather than
    /// risk it going invisible again.
    private static func setTintAlpha(_ alpha: CGFloat, on artwork: ModelEntity?, fallback card: ModelEntity) {
        let target = artwork ?? card
        guard let material = target.model?.materials.first else { return }
        if var simple = material as? SimpleMaterial {
            simple.color = .init(tint: Material.Color.white.withAlphaComponent(alpha), texture: simple.color.texture)
            target.model?.materials = [simple]
        } else if material is PhysicallyBasedMaterial {
            if #available(iOS 18.0, visionOS 2.0, *) {
                target.components.set(OpacityComponent(opacity: Float(alpha)))
            }
        }
    }
}
