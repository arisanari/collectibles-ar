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
/// `kokeshi_demo.usdz`). Until a matching file exists, `make(asset:)`
/// falls back to `AssetCardEntity` and logs why.
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
                    + "\"\(resource)\" from TwinfoldCore Resources/models — falling back to card"
            )
            return AssetCardEntity.make(asset: asset)
        }

        twin.name = AssetCardEntity.entityName
        // `ARView.entity(at:)` / visionOS tap targeting need collision
        // shapes; a loaded USDZ has none, so generate them from its meshes.
        twin.generateCollisionShapes(recursive: true)
        applyGroundingShadow(to: twin)
        return twin
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
