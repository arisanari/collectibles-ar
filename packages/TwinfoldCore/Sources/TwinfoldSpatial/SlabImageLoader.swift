import CoreGraphics
import Foundation
import ImageIO
import TwinfoldCore

/// Loads the card picture shown inside a `GradedSlabEntity`. Real card images come from the NFT metadata host at
/// runtime (https only) and are never bundled or saved; fixture (DEMO DATA) images resolve to the self-made PNGs in
/// the package bundle. Decoded images are cached in memory for the session so the preview, the placed slab and a
/// re-materialized slab do not fetch twice.
actor SlabImageLoader {
    static let shared = SlabImageLoader()

    /// Longest side kept after decoding; bounds memory for large card scans.
    private static let maxPixelSize = 2048
    /// Refuse bodies larger than this (bytes).
    private static let maxBytes = 12 * 1024 * 1024

    private var cache: [URL: CGImage] = [:]
    private var failed: Set<URL> = []

    /// Where `asset`'s card picture lives, or `nil` when it has none we can read.
    nonisolated static func source(for asset: TwinfoldAsset) -> URL? {
        let reference = asset.imageUrl ?? asset.display.imageUrl
        if let url = URL(string: reference), url.scheme?.lowercased() == "https" { return url }
        return TwinfoldCoreResources.artworkURL(forImageUrl: reference)
    }

    func image(for url: URL) async -> CGImage? {
        if let cached = cache[url] { return cached }
        if failed.contains(url) { return nil }
        let data: Data
        do {
            if url.isFileURL {
                data = try Data(contentsOf: url)
            } else {
                let (body, response) = try await URLSession.shared.data(from: url)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    failed.insert(url)
                    return nil
                }
                data = body
            }
        } catch {
            print("[TwinfoldSpatial] slab image load failed: \(url.lastPathComponent): \(error)")
            // Network errors may be transient: do not remember them.
            return nil
        }
        guard data.count <= Self.maxBytes, let image = Self.decode(data) else {
            failed.insert(url)
            return nil
        }
        cache[url] = image
        return image
    }

    private static func decode(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }
}
