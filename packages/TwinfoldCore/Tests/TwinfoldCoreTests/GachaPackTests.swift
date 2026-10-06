import XCTest
@testable import TwinfoldCore

final class GachaPackTests: XCTestCase {
    private static let cardJSON = """
    {"id":"tf-card-abcd1234","network":"devnet","address":"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU","standard":"pnft",
     "owner":"W","title":"Test Card","display":{"kind":"image","imageUrl":"https://example.invalid/i.png","placeholder":false,"rightsNote":"n"},
     "spatialRepresentation":{"kind":"card"},"provenance":[],"category":"card","grade":"GEM-MT 10","gradingCompany":"PSA",
     "gradingId":"12345678","source":"collectorCrypt","sourceVerified":true,"gachaMemo":"m-opened","imageUrl":"https://example.invalid/i.png"}
    """

    private static let feedJSON = """
    {"wallet":"W","packs":[
      {"memo":"m-opened","packType":"pokemon_25","state":"opened","createdAt":"2026-10-06T14:00:00.000Z","openedAt":"2026-10-06T14:00:20.000Z","nftAddress":"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU","asset":\(cardJSON)},
      {"memo":"m-submitted","packType":"pokemon_25","state":"submitted","createdAt":"2026-10-06T14:01:00.000Z","openedAt":null,"nftAddress":null,"asset":null},
      {"memo":"m-new-state","packType":"pokemon_25","state":"refunded","createdAt":"2026-10-06T14:02:00.000Z","openedAt":null,"nftAddress":null,"asset":null}
    ]}
    """

    private func decodeFeed() throws -> GachaPacksResponse {
        try JSONDecoder().decode(GachaPacksResponse.self, from: Data(Self.feedJSON.utf8))
    }

    func testDecodesFeedWithCardAssetAndNulls() throws {
        let feed = try decodeFeed()
        XCTAssertEqual(feed.wallet, "W")
        XCTAssertEqual(feed.packs.count, 3)
        let opened = feed.packs[0]
        XCTAssertEqual(opened.state, .opened)
        XCTAssertEqual(opened.asset?.gradingId, "12345678")
        XCTAssertEqual(opened.asset?.sourceVerified, true)
        XCTAssertEqual(opened.openedDate, GachaDates.parse("2026-10-06T14:00:20Z"))
        XCTAssertNil(feed.packs[1].openedAt)
        XCTAssertNil(feed.packs[1].asset)
    }

    func testUnknownStateDecodesToUnknownInsteadOfFailingOrPretendingToBeOpened() throws {
        XCTAssertEqual(try decodeFeed().packs[2].state, .unknown)
    }

    func testNewlyOpenedReturnsOnlyOpenedWithCardAndNotShown() throws {
        let packs = try decodeFeed().packs
        XCTAssertEqual(GachaPackDiff.newlyOpened(packs, shown: []).map(\.memo), ["m-opened"])
        XCTAssertEqual(GachaPackDiff.newlyOpened(packs, shown: ["m-opened"]).map(\.memo), [], "a memo Appears once")
    }

    func testNewlyOpenedIsOldestFirstAndDeduplicatedAndSkipsOpenedWithoutCard() throws {
        let asset = try JSONDecoder().decode(TwinfoldAsset.self, from: Data(Self.cardJSON.utf8))
        func opened(_ memo: String, at time: String, asset: TwinfoldAsset?) -> GachaPackRecord {
            GachaPackRecord(memo: memo, packType: "p", state: .opened, createdAt: time, openedAt: time, asset: asset)
        }
        // Feed order is newest first, like the server's.
        let packs = [
            opened("c", at: "2026-10-06T14:03:00.000Z", asset: asset),
            opened("b-no-card-yet", at: "2026-10-06T14:02:00.000Z", asset: nil),
            opened("a", at: "2026-10-06T14:01:00.000Z", asset: asset),
            opened("a", at: "2026-10-06T14:01:00.000Z", asset: asset),
        ]
        XCTAssertEqual(GachaPackDiff.newlyOpened(packs, shown: []).map(\.memo), ["a", "c"])
        // The card-less record is not "shown": once the card is attached the next poll returns it.
        let later = packs + [opened("b-no-card-yet", at: "2026-10-06T14:02:00.000Z", asset: asset)]
        XCTAssertTrue(GachaPackDiff.newlyOpened(later, shown: ["a", "c"]).contains { $0.memo == "b-no-card-yet" })
    }

    func testNewlyOpenedHonorsSince() throws {
        let packs = try decodeFeed().packs
        let after = GachaDates.parse("2026-10-06T14:00:21Z")
        XCTAssertEqual(GachaPackDiff.newlyOpened(packs, shown: [], since: after).count, 0)
        let before = GachaDates.parse("2026-10-06T14:00:19Z")
        XCTAssertEqual(GachaPackDiff.newlyOpened(packs, shown: [], since: before).count, 1)
    }

    func testShownMemosPersistAndAreCapped() throws {
        let suite = "twinfold.tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = ShownPackMemos(defaults: defaults, key: "k", limit: 3)
        XCTAssertFalse(store.contains("m1"))
        store.insert("m1"); store.insert("m1"); store.insert("m2"); store.insert("m3"); store.insert("m4")
        XCTAssertEqual(store.all, ["m2", "m3", "m4"], "oldest dropped past the limit; duplicates ignored")
        // A fresh instance over the same defaults sees them (survives relaunch).
        XCTAssertTrue(ShownPackMemos(defaults: defaults, key: "k", limit: 3).contains("m4"))
    }

    func testSinceFormatIsUTCMillisecondsWithoutPlus() {
        let date = GachaDates.parse("2026-10-06T23:30:00+09:00")!
        XCTAssertEqual(GachaDates.format(date), "2026-10-06T14:30:00.000Z")
    }

    func testMockSimulatePullFeedsTheSameDiffPath() async throws {
        let mock = try MockAssetProvider()
        var feed = try await mock.getRecentPacks(since: nil)
        XCTAssertTrue(feed.packs.isEmpty)
        let first = try await mock.simulatePull()
        let second = try await mock.simulatePull()
        XCTAssertNotEqual(first.memo, second.memo)
        feed = try await mock.getRecentPacks(since: nil)
        XCTAssertEqual(feed.wallet, MockAssetProvider.cardCollectorWallet)
        XCTAssertEqual(feed.packs.count, 2)
        XCTAssertEqual(feed.packs.first?.asset?.gachaMemo, feed.packs.first?.memo)
        XCTAssertEqual(GachaPackDiff.newlyOpened(feed.packs, shown: [first.memo]).map(\.memo), [second.memo])
        // Three demo cards, so the fourth pull cycles back to the first card.
        _ = try await mock.simulatePull()
        let fourth = try await mock.simulatePull()
        XCTAssertEqual(fourth.asset?.id, first.asset?.id)
        await mock.resetDemoState()
        let cleared = try await mock.getRecentPacks(since: nil)
        XCTAssertTrue(cleared.packs.isEmpty)
    }
}
