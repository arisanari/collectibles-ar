import Foundation

/// Real-world size of a graded-card holder ("slab"), in meters, plus the pure geometry the RealityKit entity
/// (`GradedSlabEntity` in TwinfoldSpatial) is built from. Kept in TwinfoldCore (no RealityKit) so it can be unit
/// tested on any host and shared by iOS and visionOS.
public enum GradedSlabDimensions {
    /// Outer size of a PSA-style slab: 81 mm wide, 136 mm tall, 6.5 mm deep. The entity is built at exactly this
    /// size and its `scale` is never changed, so it reads at true size next to a physical slab.
    ///
    /// ESTIMATE, not a published spec: PSA does not publish an official dimension sheet for its holder. These
    /// numbers are rounded from several independent measurements (about 81 x 136 x 6.5 mm; holder generations differ
    /// by roughly +/-0.2 mm). Re-measure a real slab before claiming millimetre accuracy.
    ///
    /// Other graders' holders (BGS, CGC, the DEMO fixture) are NOT measured: they use the same numbers for now.
    public static let psaStandard: (width: Float, height: Float, depth: Float) = (width: 0.081, height: 0.136, depth: 0.0065)

    /// The card inside the holder: 63 x 88 mm (the common trading-card size).
    public static let card: (width: Float, height: Float) = (width: 0.063, height: 0.088)

    /// How far a slab standing on a desk or floor leans back (rotation about its bottom edge), in radians (10 degrees).
    public static let standingTilt: Float = 10 * .pi / 180

    /// Pose of the slab's center for a slab standing on a horizontal surface, tilted back by `tilt` radians, so that
    /// its lowest corner touches the surface (y = 0) and the bottom edge's midpoint sits over the placement point.
    /// `y` is the center height above the surface; `z` the center's offset along the facing direction (negative =
    /// away from the viewer). With `tilt == 0` this is `(height / 2, 0)`.
    public static func standingPose(
        tilt: Float = standingTilt,
        dimensions: (width: Float, height: Float, depth: Float) = psaStandard
    ) -> (y: Float, z: Float) {
        let halfHeight = dimensions.height / 2
        let halfDepth = dimensions.depth / 2
        let y = halfHeight * cos(tilt) + halfDepth * sin(tilt)
        let z = -halfHeight * sin(tilt)
        return (y, z)
    }

    /// Text for the label band at the top of the slab: grade line ("PSA GEM-MT 10") and a shortened name. Both are
    /// copied third-party claims / the on-chain name, shown as given (never rewritten into a different grade).
    public static func labelLines(for asset: TwinfoldAsset, maxNameLength: Int = 30) -> (headline: String, name: String) {
        let headline = [asset.gradingCompany, asset.grade]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return (headline, shortened(asset.displayTitle(), to: maxNameLength))
    }

    static func shortened(_ text: String, to limit: Int) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > limit, limit > 1 else { return trimmed }
        return String(trimmed.prefix(limit - 1)) + "\u{2026}"
    }
}
