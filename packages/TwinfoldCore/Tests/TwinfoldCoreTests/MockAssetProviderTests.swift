import XCTest
@testable import TwinfoldCore

final class MockAssetProviderTests: XCTestCase {
    func testGetAssetsReturnsFixtureForOwningWallet() async throws {
        let provider = try MockAssetProvider()
        XCTAssertTrue(provider.isDemoData)

        let assets = try await provider.getAssets(wallet: "DEMOwalletA1111111111111111111111111111111")
        XCTAssertEqual(assets.count, 1)
        XCTAssertEqual(assets.first?.id, "tf-stamp-001")
    }
}
