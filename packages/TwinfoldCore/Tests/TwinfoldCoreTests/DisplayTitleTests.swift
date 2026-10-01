import XCTest
@testable import TwinfoldCore

final class DisplayTitleTests: XCTestCase {
    private let ja = Locale(identifier: "ja_JP")
    private let en = Locale(identifier: "en_US")
    private let fr = Locale(identifier: "fr_FR")

    private func fixtureAsset() async throws -> TwinfoldAsset {
        try await MockAssetProvider().getAsset(assetId: "tf-ukiyoe-001")
    }

    func testJapaneseLocalePicksJa() async throws {
        let asset = try await fixtureAsset()
        XCTAssertEqual(asset.displayTitle(for: ja), asset.titleLocalized?.ja)
        XCTAssertEqual(asset.displayTitle(for: ja), asset.title)
    }

    func testNonJapaneseLocalePicksEn() async throws {
        let asset = try await fixtureAsset()
        XCTAssertEqual(asset.displayTitle(for: en), "Hokusai Manga vol.13 (attribution unconfirmed) - 2 leaves")
        XCTAssertEqual(asset.displayTitle(for: fr), asset.titleLocalized?.en)
    }

    func testFallsBackToTitleWithoutLocalizedRecord() async throws {
        let base = try await fixtureAsset()
        let bare = TwinfoldAsset(
            id: base.id, network: base.network, address: base.address, standard: base.standard,
            owner: base.owner, title: "On-chain name", display: base.display,
            spatialRepresentation: base.spatialRepresentation, provenance: base.provenance
        )
        XCTAssertEqual(bare.displayTitle(for: ja), "On-chain name")
        XCTAssertEqual(bare.displayTitle(for: en), "On-chain name")
    }

    func testJapaneseLocaleFallsBackToEnWhenJaMissing() async throws {
        let base = try await fixtureAsset()
        let enOnly = TwinfoldAsset(
            id: base.id, network: base.network, address: base.address, standard: base.standard,
            owner: base.owner, title: "On-chain name", titleLocalized: LocalizedTitle(en: "English"),
            display: base.display, spatialRepresentation: base.spatialRepresentation, provenance: base.provenance
        )
        XCTAssertEqual(enOnly.displayTitle(for: ja), "English")
    }
}
