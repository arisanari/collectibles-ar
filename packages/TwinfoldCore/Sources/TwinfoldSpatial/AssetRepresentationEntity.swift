import Foundation
import RealityKit
import TwinfoldCore

/// Builds the RealityKit representation for a `TwinfoldAsset`, dispatching
/// on `asset.spatialRepresentation`:
///
/// - `.card` renders the existing `AssetCardEntity` (flat image card).
/// - `.model` loads a real-world-scale USDZ twin — `scale` is left at its
///   default (1), so an Object Capture export placed next to the physical
///   item reads as true-to-size — and tags it with a
///   `GroundingShadowComponent` so it casts a contact shadow like the real
///   object beside it.
///
/// USDZ scans are not part of this repo yet (no rights-cleared scan
/// exists). Drop one at
/// `packages/TwinfoldCore/Sources/TwinfoldCore/Resources/models/<resource>`
/// — the whole `Resources/models` directory is already declared as a
/// package resource in `Package.swift` (currently holding only a
/// `.gitkeep` placeholder) — with a filename matching
/// `spatialRepresentation.resource` in `fixtures/demo/assets.json` (e.g.
/// `kokeshi_demo.usdz`). Until a matching file exists, `make(asset:)` falls
/// back to `AssetCardEntity.makeThinPlate(asset:)` — a single thin image
/// plane with no backing box, using the fixture's `display.imageUrl` PNG —
/// and logs why.
///
/// Both branches tag the returned root `Entity.name` as
/// `AssetCardEntity.entityName`, so callers that find "the placed asset
/// entity" by name (`ARSceneController.handleTap`,
/// `GalleryModel.handleTap`) keep working regardless of which
/// representation was actually built.
@MainActor
public enum AssetRepresentationEntity {
    public static func make(asset: TwinfoldAsset) -> Entity {
        guard case let .model(resource) = asset.spatialRepresentation else {
            let card = AssetCardEntity.make(asset: asset)
            applyGroundingShadow(to: card)
            return card
        }

        guard let twin = loadTwin(resource: resource) else {
            print(
                "[TwinfoldSpatial] \(asset.id): could not load twin resource "
                    + "\"\(resource)\" from TwinfoldCore Resources/models — falling back to "
                    + "a thin image plate"
            )
            return AssetCardEntity.makeThinPlate(asset: asset)
        }

        twin.name = AssetCardEntity.entityName
        // `ARView.entity(at:)` / visionOS tap targeting need collision
        // shapes; a loaded USDZ has none, so generate them from its meshes.
        twin.generateCollisionShapes(recursive: true)
        applyGroundingShadow(to: twin)
        return twin
    }

    /// Same dispatch as `make(asset:)`, except a `card` asset renders as
    /// `AssetCardEntity.makePaper(asset:)` — a flush, essentially
    /// zero-thickness paper sheet — instead of the boxed
    /// `AssetCardEntity.make(asset:)` card. `.model` (twin) assets are
    /// unaffected: they delegate straight to `make(asset:)`, including its
    /// thin-plate fallback.
    ///
    /// Used only by iOS's wall-placement flow (`RoomController`), which
    /// always aims a `card` asset's holding preview at a wall. visionOS
    /// (`ImmersiveGalleryView`) and any other caller should keep calling
    /// `make(asset:)` directly, unchanged.
    public static func makeForWallPlacement(asset: TwinfoldAsset) -> Entity {
        guard case .model = asset.spatialRepresentation else {
            let paper = AssetCardEntity.makePaper(asset: asset)
            applyGroundingShadow(to: paper)
            return paper
        }
        return make(asset: asset)
    }

    /// `true` when `asset` renders as a real-world-scale USDZ twin (rather
    /// than the flat card) — i.e. whether pinch-to-scale should stay
    /// disabled so its size doesn't drift from the physical object's.
    /// Reflects only the fixture's declared representation, not whether a
    /// matching USDZ actually loaded (a fallback-to-card asset still
    /// reports `true` here so it keeps its real-world footprint once a
    /// scan is added later without another code change).
    public static func isTwin(_ asset: TwinfoldAsset) -> Bool {
        if case .model = asset.spatialRepresentation { return true }
        return false
    }

    /// Shifts `entity` (already a child of `anchor`, even if `anchor` isn't
    /// in a scene yet) straight up so its lowest visible point sits at
    /// `anchor`'s own y = 0 rather than the entity's own origin, since
    /// neither a loaded USDZ's origin nor `AssetCardEntity
    /// .makeThinPlate`'s centered fallback plate is guaranteed to be its
    /// base. Returns the settled footprint (width, height) read from
    /// `visualBounds`, so callers can size a provenance column against the
    /// twin's actual mesh. Used both for a final floor placement and for
    /// the holding preview, so the preview already sits on the surface —
    /// not partially embedded in it — instead of only being corrected once
    /// placement is confirmed.
    public static func settleOnAnchor(entity: Entity, anchor: Entity) -> (width: Float, height: Float) {
        let bounds = entity.visualBounds(relativeTo: anchor)
        entity.position.y -= bounds.min.y
        return (bounds.extents.x, bounds.extents.y)
    }

    /// Toggles a translucent "preview" look on an entity built by
    /// `make(asset:)`. A `card`/thin-plate representation has the named
    /// surface/frame nodes `AssetCardEntity.apply(state:)` expects, so this
    /// just reuses that (the `pending` look). A loaded USDZ twin is an
    /// arbitrary Object Capture/Reality Composer scene graph with no such
    /// named nodes — `AssetCardEntity.apply(state:)` would silently no-op
    /// on it — so this falls back to RealityKit's `OpacityComponent`,
    /// which composites the whole entity subtree. `OpacityComponent` needs
    /// iOS 18/visionOS 2; on an older OS the twin preview stays fully
    /// opaque (still correctly positioned by the raycast, just not dimmed).
    public static func setPreviewTranslucent(_ translucent: Bool, on entity: Entity) {
        if entity.findEntity(named: AssetCardEntity.surfaceName) != nil {
            AssetCardEntity.apply(state: translucent ? .pending : .confirmed, to: entity)
            return
        }
        if #available(iOS 18.0, visionOS 2.0, *) {
            entity.components.set(OpacityComponent(opacity: translucent ? 0.5 : 1.0))
        }
    }

    private static func loadTwin(resource: String) -> Entity? {
        let baseName = (resource as NSString).deletingPathExtension
        let ext = (resource as NSString).pathExtension.isEmpty ? "usdz" : (resource as NSString).pathExtension
        guard let url = TwinfoldCoreResources.bundle.url(
            forResource: baseName,
            withExtension: ext,
            subdirectory: "models"
        ) else {
            return nil
        }
        return try? Entity.load(contentsOf: url)
    }

    /// Grounding shadows are rendered per model, so tag every entity in
    /// the USDZ hierarchy that carries a `ModelComponent`.
    private static func applyGroundingShadow(to entity: Entity) {
        if #available(iOS 18.0, visionOS 2.0, *) {
            if entity.components.has(ModelComponent.self) {
                entity.components.set(GroundingShadowComponent(castsShadow: true))
            }
            for child in entity.children {
                applyGroundingShadow(to: child)
            }
        }
    }
}
