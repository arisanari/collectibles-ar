import CoreGraphics
import Foundation

/// Finds the card inside a photo of a graded slab, so the card alone can be shown without its holder.
///
/// Collector Crypt's `imageUrl` is a photo of the whole slab (label, holder and card). The card sits at a roughly fixed
/// place per grading company; `baseRect` is that place. `cardRect` then trims each edge inward while the strip along
/// it is dark (the holder's black inner margin that shows around a small card). All rectangles are normalized to
/// 0...1 with the origin at the top left and y pointing down. CoreGraphics only: no RealityKit, UIKit or ARKit.
public enum SlabCardCrop {
    /// Fixed starting rectangle per grading company (case-insensitive, surrounding whitespace ignored):
    /// Measured on Collector Crypt photos (2026-10-09): x 0.105...0.895 for both; PSA y 0.27...0.93, CGC y 0.278...0.955;
    /// anything else (BGS, nil, ...) y 0.275...0.945.
    public static func baseRect(gradingCompany: String?) -> CGRect {
        let company = gradingCompany?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let (top, bottom): (CGFloat, CGFloat)
        switch company {
        case "psa": (top, bottom) = (0.27, 0.93)
        case "cgc": (top, bottom) = (0.278, 0.955)
        default: (top, bottom) = (0.275, 0.945)
        }
        return CGRect(x: 0.105, y: top, width: 0.895 - 0.105, height: bottom - top)
    }

    /// Mean luminance (0...255) below which an edge strip counts as the holder's dark margin. Measured: the margin
    /// around a small card is 50...65 (dark gray, not black); card borders are 90+.
    static let darkThreshold: Double = 75
    /// Most an edge may move inward, as a fraction of the base rectangle's length across that edge.
    static let maxTrimFraction: Double = 0.13
    /// Width the image is scaled to before scanning (performance only).
    static let scanWidth = 256
    /// Thickness of the strip tested along an edge, in scan pixels. 4 px (about 1.5% of the width) so a thin bright
    /// line (the holder's inner lip) inside the dark margin does not stop the trim early.
    static let bandThickness = 4

    /// `baseRect` with each of the four edges moved inward (by up to 13% of the length across it) while the
    /// 4 px strip along that edge, taken over the middle 60% of the rectangle's other dimension, has a mean
    /// luminance (0.299 R + 0.587 G + 0.114 B) under `darkThreshold`. Returns normalized coordinates.
    public static func cardRect(in image: CGImage, gradingCompany: String?) -> CGRect {
        let base = baseRect(gradingCompany: gradingCompany)
        guard image.width > 0, image.height > 0,
              let scan = scanLuminance(of: image) else { return base }
        let width = scan.width
        let height = scan.height

        let baseLeft = Int((base.minX * Double(width)).rounded())
        let baseRight = Int((base.maxX * Double(width)).rounded())
        let baseTop = Int((base.minY * Double(height)).rounded())
        let baseBottom = Int((base.maxY * Double(height)).rounded())
        let maxTrimX = Int((maxTrimFraction * base.width * Double(width)).rounded(.down))
        let maxTrimY = Int((maxTrimFraction * base.height * Double(height)).rounded(.down))

        var left = baseLeft, right = baseRight, top = baseTop, bottom = baseBottom
        let band = bandThickness

        // Left: the strip [left, left + band) over the middle 60% of the rows between top and bottom.
        func rowSpan() -> Range<Int> { middle(from: top, to: bottom) }
        func columnSpan() -> Range<Int> { middle(from: left, to: right) }

        while left - baseLeft < maxTrimX, right - left > 2 * band,
              scan.meanLuminance(columns: left..<(left + band), rows: rowSpan()) < darkThreshold {
            left += 1
        }
        while baseRight - right < maxTrimX, right - left > 2 * band,
              scan.meanLuminance(columns: (right - band)..<right, rows: rowSpan()) < darkThreshold {
            right -= 1
        }
        while top - baseTop < maxTrimY, bottom - top > 2 * band,
              scan.meanLuminance(columns: columnSpan(), rows: top..<(top + band)) < darkThreshold {
            top += 1
        }
        while baseBottom - bottom < maxTrimY, bottom - top > 2 * band,
              scan.meanLuminance(columns: columnSpan(), rows: (bottom - band)..<bottom) < darkThreshold {
            bottom -= 1
        }

        // Untouched edges keep the exact base value (no rounding to the scan grid).
        let x0 = base.minX + Double(left - baseLeft) / Double(width)
        let x1 = base.maxX - Double(baseRight - right) / Double(width)
        let y0 = base.minY + Double(top - baseTop) / Double(height)
        let y1 = base.maxY - Double(baseBottom - bottom) / Double(height)
        return CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
    }

    /// The card region of `image` as a new image, or `nil` if CoreGraphics cannot crop it.
    public static func crop(_ image: CGImage, gradingCompany: String?) -> CGImage? {
        let rect = cardRect(in: image, gradingCompany: gradingCompany)
        let pixels = CGRect(
            x: rect.minX * Double(image.width), y: rect.minY * Double(image.height),
            width: rect.width * Double(image.width), height: rect.height * Double(image.height)
        ).integral
        return image.cropping(to: pixels)
    }

    // MARK: - Private

    /// The middle 60% of `from..<to`.
    private static func middle(from: Int, to: Int) -> Range<Int> {
        let length = to - from
        let start = from + Int((Double(length) * 0.2).rounded())
        let end = from + Int((Double(length) * 0.8).rounded())
        return start..<max(start + 1, end)
    }

    private struct LuminanceScan {
        let width: Int
        let height: Int
        /// Row-major (top row first), 0...255.
        let values: [Float]

        func meanLuminance(columns: Range<Int>, rows: Range<Int>) -> Double {
            let cols = columns.clamped(to: 0..<width)
            let rws = rows.clamped(to: 0..<height)
            guard !cols.isEmpty, !rws.isEmpty else { return 255 } // nothing to measure: never trim
            var sum: Double = 0
            for row in rws {
                let offset = row * width
                for col in cols { sum += Double(values[offset + col]) }
            }
            return sum / Double(cols.count * rws.count)
        }
    }

    /// Redraws `image` as RGBA8 at `scanWidth` pixels wide (never upscaled) and returns per-pixel luminance, so the
    /// result does not depend on the source image's pixel format.
    private static func scanLuminance(of image: CGImage) -> LuminanceScan? {
        let width = min(scanWidth, image.width)
        let height = max(1, Int((Double(image.height) * Double(width) / Double(image.width)).rounded()))
        var data = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = data.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            context.interpolationQuality = .medium
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }
        var values = [Float](repeating: 0, count: width * height)
        for index in 0..<(width * height) {
            let r = Float(data[index * 4]), g = Float(data[index * 4 + 1]), b = Float(data[index * 4 + 2])
            values[index] = 0.299 * r + 0.587 * g + 0.114 * b
        }
        return LuminanceScan(width: width, height: height, values: values)
    }
}
