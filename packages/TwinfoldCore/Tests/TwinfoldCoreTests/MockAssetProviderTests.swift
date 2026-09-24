import XCTest
@testable import TwinfoldCore

final class MockAssetProviderTests: XCTestCase {
    private let walletA = "DEMOwalletA1111111111111111111111111111111"
    private let walletB = "DEMOwalletB2222222222222222222222222222222"
    private let assetId = "tf-ukiyoe-001"

    /// Owner A's fixture wallet owns six assets: five ukiyo-e prints
    /// (`card` representation, real-world sized via `physical.dimensions`
    /// for wall placement, `assetId` is the first of the five) and a
    /// kokeshi twin (`model` representation), the shelf-collectible
    /// extension example.
    func testGetAssetsReturnsFixtureForOwningWallet() async throws {
        let provider = try MockAssetProvider()
        XCTAssertTrue(provider.isDemoData)

        let assets = try await provider.getAssets(wallet: walletA)
        XCTAssertEqual(assets.count, 6)
        XCTAssertTrue(assets.contains { $0.id == assetId })
        XCTAssertTrue(assets.contains { $0.id == "tf-ukiyoe-002" })
        XCTAssertTrue(assets.contains { $0.id == "tf-ukiyoe-003" })
        XCTAssertTrue(assets.contains { $0.id == "tf-ukiyoe-004" })
        XCTAssertTrue(assets.contains { $0.id == "tf-ukiyoe-005" })
        XCTAssertTrue(assets.contains { $0.id == "tf-kokeshi-001" })
    }

    /// (a) transfer後にOwner Aの getAssets が空、Owner Bに1件になる。
    func testSimulateTransferMovesAssetBetweenWallets() async throws {
        let provider = try MockAssetProvider()

        let event = try await provider.simulateTransfer(assetId: assetId, to: walletB, requestId: "req-transfer-1")
        XCTAssertEqual(event.kind, .transferred)
        XCTAssertEqual(event.status, .confirmed)
        XCTAssertEqual(event.source, .onchain)
        XCTAssertEqual(event.transaction, "DEMO-TX-TRANSFER-req-transfer-1")

        // walletA still owns the other four ukiyo-e prints and the kokeshi
        // twin (untouched by this transfer).
        let assetsForA = try await provider.getAssets(wallet: walletA)
        XCTAssertEqual(assetsForA.count, 5)
        XCTAssertFalse(assetsForA.contains { $0.id == assetId })

        let assetsForB = try await provider.getAssets(wallet: walletB)
        XCTAssertEqual(assetsForB.count, 1)
        XCTAssertEqual(assetsForB.first?.owner, walletB)
        XCTAssertEqual(assetsForB.first?.provenance.last?.kind, .transferred)
    }

    /// (b) refreshOwnership がconnect中のwalletに応じて canDisplay を切り替える。
    func testRefreshOwnershipTracksConnectedWallet() async throws {
        let provider = try MockAssetProvider()
        await provider.connect(wallet: walletA)

        let beforeTransfer = try await provider.refreshOwnership(assetId: assetId)
        XCTAssertTrue(beforeTransfer.canDisplay)

        _ = try await provider.simulateTransfer(assetId: assetId, to: walletB, requestId: "req-transfer-2")

        // Still connected as walletA: ownership moved, entitlement should
        // now be lost (old owner Disappears).
        let afterTransfer = try await provider.refreshOwnership(assetId: assetId)
        XCTAssertFalse(afterTransfer.canDisplay)

        await provider.connect(wallet: walletB)
        let asNewOwner = try await provider.refreshOwnership(assetId: assetId)
        XCTAssertTrue(asNewOwner.canDisplay)
    }

    /// (c) 同じrequestIdの二重呼び出しが同じtransactionを返す（冪等化）。
    func testSimulateTransferIsIdempotentPerRequestId() async throws {
        let provider = try MockAssetProvider()

        let first = try await provider.simulateTransfer(assetId: assetId, to: walletB, requestId: "req-transfer-3")
        let second = try await provider.simulateTransfer(assetId: assetId, to: walletB, requestId: "req-transfer-3")

        XCTAssertEqual(first.id, second.id)
        XCTAssertEqual(first.transaction, second.transaction)

        let assetsForB = try await provider.getAssets(wallet: walletB)
        XCTAssertEqual(assetsForB.first?.provenance.filter { $0.kind == .transferred }.count, 1)
    }

    /// (d) resetDemoStateで元に戻る。
    func testResetDemoStateRestoresFixtureOwnership() async throws {
        let provider = try MockAssetProvider()
        let originalCount = try await provider.getAsset(assetId: assetId).provenance.count

        _ = try await provider.simulateTransfer(assetId: assetId, to: walletB, requestId: "req-transfer-4")
        var assetsForA = try await provider.getAssets(wallet: walletA)
        XCTAssertEqual(assetsForA.count, 5)
        XCTAssertFalse(assetsForA.contains { $0.id == assetId })

        await provider.resetDemoState()

        assetsForA = try await provider.getAssets(wallet: walletA)
        XCTAssertEqual(assetsForA.count, 6)
        XCTAssertEqual(assetsForA.first { $0.id == assetId }?.provenance.count, originalCount)
    }
}
