import Foundation

/// Exposes this target's resource bundle to other targets in the package
/// (namely `TwinfoldSpatial`, which loads USDZ twins from
/// `Resources/models` — see `AssetRepresentationEntity`). `Bundle.module`
/// is generated per-target by SwiftPM and isn't visible outside
/// `TwinfoldCore` on its own, so this wraps it in a public accessor.
public enum TwinfoldCoreResources {
    public static var bundle: Bundle { Bundle.module }

    /// Resolves a `DisplayDescriptor.imageUrl` (e.g.
    /// `"/artworks/ukiyoe-placeholder.png"`, the Web `public/` path) to the
    /// matching file under this package's `Resources/artworks` — synced
    /// from `fixtures/demo/artworks/*.png` by `scripts/sync-fixtures.sh`.
    /// Only the basename is used, so both Web-style absolute paths and a
    /// bare filename work. Returns `nil` if no PNG with that name is
    /// bundled (e.g. an asset that doesn't have reference art yet).
    public static func artworkURL(forImageUrl imageUrl: String) -> URL? {
        let filename = (imageUrl as NSString).lastPathComponent
        let baseName = (filename as NSString).deletingPathExtension
        let ext = (filename as NSString).pathExtension.isEmpty ? "png" : (filename as NSString).pathExtension
        return bundle.url(forResource: baseName, withExtension: ext, subdirectory: "artworks")
    }
}
