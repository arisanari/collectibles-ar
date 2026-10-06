import XCTest
@testable import TwinfoldCore

/// Card fields on `TwinfoldAsset` (SlabAR). Mirrors the fixture cards in fixtures/demo/assets.json
/// ("SlabAR Demo Card #1-#3", owner walletC, DEMO DATA).
final class CardAssetModelTests: XCTestCase {
    private let walletC = "DEMOwalletC3333333333333333333333333333333"

    func testFixtureCardsDecodeWithCardFields() async throws {
        let provider = try MockAssetProvider()
        let cards = try await provider.getAssets(wallet: walletC)
        XCTAssertEqual(cards.count, 3)
        for card in cards {
            XCTAssertEqual(card.category, "card")
            XCTAssertEqual(card.source, "collectorCrypt")
            XCTAssertEqual(card.network, "devnet")
            XCTAssertNotNil(card.grade)
            XCTAssertNotNil(card.gradingCompany)
            XCTAssertNotNil(card.gradingId)
            XCTAssertNotNil(card.insuredValueUsd)
            XCTAssertNotNil(card.vault)
            XCTAssertNotNil(card.vaultId)
            XCTAssertNotNil(card.gachaMemo)
            XCTAssertEqual(card.imageUrl, card.display.imageUrl)
        }
        XCTAssertEqual(cards.first { $0.id == "tf-card-DEMO-1-C" }?.title, "SlabAR Demo Card #1")
    }

    func testDormantFixturesStillDecodeWithoutCardFields() async throws {
        let provider = try MockAssetProvider()
        let asset = try await provider.getAsset(assetId: "tf-ukiyoe-001")
        XCTAssertNil(asset.category)
        XCTAssertNil(asset.grade)
        XCTAssertNil(asset.imageUrl)
    }

    func testMainnetNetworkValueAndInsuredValueDecode() throws {
        let json = """
        {"id":"tf-card-x","network":"mainnet","address":"A","standard":"pnft","owner":null,"title":"T",
         "display":{"kind":"image","imageUrl":"https://example.invalid/i.png","placeholder":false,"rightsNote":"n"},
         "spatialRepresentation":{"kind":"card"},"provenance":[],
         "category":"card","grade":"GEM-MT 10","gradingCompany":"PSA","gradingId":"1","insuredValueUsd":487.5,
         "vault":"V","vaultId":"VID","source":"collectorCrypt","imageUrl":"https://example.invalid/i.png"}
        """
        let asset = try JSONDecoder().decode(TwinfoldAsset.self, from: Data(json.utf8))
        XCTAssertEqual(asset.network, "mainnet")
        XCTAssertEqual(asset.insuredValueUsd, 487.5)
        XCTAssertNil(asset.gachaMemo)
    }
}
