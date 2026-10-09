import CoreGraphics
import XCTest
@testable import TwinfoldCore

final class SlabCardCropTests: XCTestCase {
    func testBaseRectPerGradingCompany() {
        let psa = SlabCardCrop.baseRect(gradingCompany: "psa")
        XCTAssertEqual(psa.minX, 0.105, accuracy: 1e-9)
        XCTAssertEqual(psa.maxX, 0.895, accuracy: 1e-9)
        XCTAssertEqual(psa.minY, 0.27, accuracy: 1e-9)
        XCTAssertEqual(psa.maxY, 0.93, accuracy: 1e-9)

        let cgc = SlabCardCrop.baseRect(gradingCompany: " CGC ")
        XCTAssertEqual(cgc.minY, 0.278, accuracy: 1e-9)
        XCTAssertEqual(cgc.maxY, 0.955, accuracy: 1e-9)
        XCTAssertEqual(cgc.minX, 0.105, accuracy: 1e-9)
        XCTAssertEqual(cgc.maxX, 0.895, accuracy: 1e-9)

        for other in [nil, "BGS", "", "SGC"] as [String?] {
            let rect = SlabCardCrop.baseRect(gradingCompany: other)
            XCTAssertEqual(rect.minY, 0.275, accuracy: 1e-9)
            XCTAssertEqual(rect.maxY, 0.945, accuracy: 1e-9)
            XCTAssertEqual(rect.minX, 0.105, accuracy: 1e-9)
            XCTAssertEqual(rect.maxX, 0.895, accuracy: 1e-9)
        }
    }

    func testCardRectTrimsBlackMarginTowardsTheBrightCard() throws {
        // Black 400x670 image with a bright card at x 0.20...0.80, y 0.35...0.90.
        let image = try XCTUnwrap(makeImage(width: 400, height: 670, bright: CGRect(x: 0.20, y: 0.35, width: 0.60, height: 0.55)))
        let rect = SlabCardCrop.cardRect(in: image, gradingCompany: "PSA")
        XCTAssertEqual(rect.minX, 0.20, accuracy: 0.01)
        XCTAssertEqual(rect.maxX, 0.80, accuracy: 0.01)
        XCTAssertEqual(rect.minY, 0.35, accuracy: 0.01)
        XCTAssertEqual(rect.maxY, 0.90, accuracy: 0.01)
    }

    func testCardRectKeepsBaseWhenNothingIsDark() throws {
        let image = try XCTUnwrap(makeImage(width: 400, height: 670, bright: CGRect(x: 0, y: 0, width: 1, height: 1)))
        let rect = SlabCardCrop.cardRect(in: image, gradingCompany: "PSA")
        let base = SlabCardCrop.baseRect(gradingCompany: "PSA")
        XCTAssertEqual(rect.minX, base.minX, accuracy: 1e-9)
        XCTAssertEqual(rect.maxX, base.maxX, accuracy: 1e-9)
        XCTAssertEqual(rect.minY, base.minY, accuracy: 1e-9)
        XCTAssertEqual(rect.maxY, base.maxY, accuracy: 1e-9)
    }

    func testCropReturnsTheTrimmedPixels() throws {
        let image = try XCTUnwrap(makeImage(width: 400, height: 670, bright: CGRect(x: 0.20, y: 0.35, width: 0.60, height: 0.55)))
        let cropped = try XCTUnwrap(SlabCardCrop.crop(image, gradingCompany: "PSA"))
        XCTAssertEqual(Double(cropped.width), 400 * 0.60, accuracy: 400 * 0.02)
        XCTAssertEqual(Double(cropped.height), 670 * 0.55, accuracy: 670 * 0.02)
    }

    /// Black image with a white rectangle at `bright` (normalized, origin top left).
    private func makeImage(width: Int, height: Int, bright: CGRect) -> CGImage? {
        guard let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        context.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        // CoreGraphics origin is bottom left: flip y.
        context.fill(CGRect(
            x: bright.minX * Double(width),
            y: (1 - bright.maxY) * Double(height),
            width: bright.width * Double(width),
            height: bright.height * Double(height)
        ))
        return context.makeImage()
    }
}
