import RealityKit

public extension Entity {
    /// Walks up the entity hierarchy looking for a name match. Useful when a
    /// hit-test (ARKit `ARView.entity(at:)` on iOS, or a visionOS
    /// `SpatialTapGesture` on `RealityView` content) returns a child entity
    /// (e.g. the title text mesh) rather than the named root entity such as
    /// `AssetCardEntity.entityName`.
    func selfOrAncestor(named name: String) -> Entity? {
        var current: Entity? = self
        while let entity = current {
            if entity.name == name { return entity }
            current = entity.parent
        }
        return nil
    }
}
