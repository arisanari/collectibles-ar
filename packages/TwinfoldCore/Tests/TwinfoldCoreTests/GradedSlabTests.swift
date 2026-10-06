import XCTest
@testable import TwinfoldCore

final class GradedSlabTests: XCTestCase {
    func testPsaStandardDimensionsAreTheDocumentedEstimate() {
        let size = GradedSlabDimensions.psaStandard
        XCTAssertEqual(size.width, 0.081, accuracy: 1e-6)
        XCTAssertEqual(size.height, 0.136, accuracy: 1e-6)
        XCTAssertEqual(size.depth, 0.0065, accuracy: 1e-6)
        // The card (63 x 88 mm) fits inside the holder with room for the label band above it.
        XCTAssertLessThan(GradedSlabDimensions.card.width, size.width)
        XCTAssertLessThan(GradedSlabDimensions.card.height, size.height - 0.0225)
    }

    func testUprightStandingPoseSitsOnBottomEdge() {
        let pose = GradedSlabDimensions.standingPose(tilt: 0)
        XCTAssertEqual(pose.y, GradedSlabDimensions.psaStandard.height / 2, accuracy: 1e-6)
        XCTAssertEqual(pose.z, 0, accuracy: 1e-6)
    }

    func testTiltedStandingPoseTouchesTheSurfaceExactlyAtItsLowestCorner() {
        let tilt = GradedSlabDimensions.standingTilt
        let size = GradedSlabDimensions.psaStandard
        let pose = GradedSlabDimensions.standingPose(tilt: tilt)
        // Rotate the 4 side-profile corners by -tilt about x (top leans back), add the pose, find the lowest y.
        var lowest = Float.greatestFiniteMagnitude
        for y in [-size.height / 2, size.height / 2] {
            for z in [-size.depth / 2, size.depth / 2] {
                let rotatedY = y * cos(-tilt) - z * sin(-tilt)
                lowest = min(lowest, rotatedY + pose.y)
            }
        }
        XCTAssertEqual(lowest, 0, accuracy: 1e-6, "the lowest corner must rest on the surface, not float or sink")
        XCTAssertLessThan(pose.z, 0, "center shifts away from the viewer so the bottom edge stays over the placement point")
    }

    func testLabelLinesUseGradeAsGivenAndShortenLongNames() throws {
        let asset = try Self.card(title: "A very long card name that cannot possibly fit in the label band", company: "PSA", grade: "GEM-MT 10")
        let lines = GradedSlabDimensions.labelLines(for: asset)
        XCTAssertEqual(lines.headline, "PSA GEM-MT 10")
        XCTAssertEqual(lines.name.count, 30)
        XCTAssertTrue(lines.name.hasSuffix("\u{2026}"))

        let bare = try Self.card(title: "Short", company: nil, grade: nil)
        XCTAssertEqual(GradedSlabDimensions.labelLines(for: bare).headline, "")
        XCTAssertEqual(GradedSlabDimensions.labelLines(for: bare).name, "Short")
    }

    static func card(title: String, company: String?, grade: String?) throws -> TwinfoldAsset {
        var fields = """
        "id":"tf-card-x","network":"devnet","address":"A","standard":"pnft","owner":null,"title":"\(title)",
        "display":{"kind":"image","imageUrl":"https://example.invalid/i.png","placeholder":false,"rightsNote":"n"},
        "spatialRepresentation":{"kind":"card"},"provenance":[],"category":"card"
        """
        if let company { fields += ",\"gradingCompany\":\"\(company)\"" }
        if let grade { fields += ",\"grade\":\"\(grade)\"" }
        return try JSONDecoder().decode(TwinfoldAsset.self, from: Data("{\(fields)}".utf8))
    }
}
