import XCTest
@testable import TwinfoldCore

/// Confirms every fixture asset's `display.imageUrl` PNG is actually
/// bundled under `Resources/artworks` (synced from
/// `fixtures/demo/artworks/*.png` by `scripts/sync-fixtures.sh`), so
/// `AssetCardEntity`/`AssetRepresentationEntity` in `TwinfoldSpatial` never
/// silently fall back to the plain-card/thin-plate placeholder for an
/// asset that's supposed to have reference art.
final class TwinfoldCoreResourcesTests: XCTestCase {
    func testAllFixtureAssetsHaveBundledArtworkPNG() async throws {
        let provider = try MockAssetProvider()
        let assets = try await provider.getAssets(wallet: "DEMOwalletA1111111111111111111111111111111")
        XCTAssertFalse(assets.isEmpty)

        for asset in assets {
            let url = TwinfoldCoreResources.artworkURL(forImageUrl: asset.display.imageUrl)
            XCTAssertNotNil(
                url,
                "\(asset.id): no bundled artwork PNG resolved for \"\(asset.display.imageUrl)\""
            )
        }
    }
}
