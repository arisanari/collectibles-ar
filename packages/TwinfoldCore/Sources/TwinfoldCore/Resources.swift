import Foundation

/// Exposes this target's resource bundle to other targets in the package
/// (namely `TwinfoldSpatial`, which loads USDZ twins from
/// `Resources/models` — see `AssetRepresentationEntity`). `Bundle.module`
/// is generated per-target by SwiftPM and isn't visible outside
/// `TwinfoldCore` on its own, so this wraps it in a public accessor.
public enum TwinfoldCoreResources {
    public static var bundle: Bundle { Bundle.module }
}
