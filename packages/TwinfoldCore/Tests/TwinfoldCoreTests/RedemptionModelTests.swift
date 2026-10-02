import XCTest
@testable import TwinfoldCore

final class RedemptionModelTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testRedemptionDecodesAndUnknownStatusIsNotDropped() throws {
        let json = """
        {"id":"red-12345678","assetId":"tf-ukiyoe-001-rehearsal-1","assetAddress":"ADDR","wallet":"W","status":"locked",
         "createdAt":"2026-10-02T00:00:00.000Z","updatedAt":"2026-10-02T00:01:00.000Z","lockSignature":"sigLock",
         "events":[{"kind":"requested","at":"2026-10-02T00:00:00.000Z","source":"offchain_evidence"},
                   {"kind":"locked","at":"2026-10-02T00:01:00.000Z","source":"onchain","signature":"sigLock"},
                   {"kind":"teleported","at":"x","source":"onchain"}],"dryRun":true}
        """.data(using: .utf8)!
        let r = try decoder.decode(Redemption.self, from: json)
        XCTAssertEqual(r.status, .locked)
        XCTAssertEqual(r.lockSignature, "sigLock")
        XCTAssertEqual(r.events.map(\.kind), [.requested, .locked, .unknown])
        XCTAssertEqual(r.events[1].source, .onchain)
        XCTAssertNil(r.retireSignature)
        let weird = String(data: json, encoding: .utf8)!.replacingOccurrences(of: "\"status\":\"locked\"", with: "\"status\":\"vaporized\"")
        XCTAssertEqual(try decoder.decode(Redemption.self, from: weird.data(using: .utf8)!).status, .unknown)
    }

    func testAssetWithRedemptionSummaryAndRehearsalFlag() throws {
        let json = """
        {"id":"tf-ukiyoe-001-rehearsal-1","network":"devnet","address":"A","standard":"metaplex-core","owner":null,"title":"T",
         "display":{"kind":"image","imageUrl":"","placeholder":false,"rightsNote":"r"},"spatialRepresentation":{"kind":"card"},
         "provenance":[],"rehearsal":true,
         "redemption":{"id":"red-12345678","status":"retired","open":false,"updatedAt":"2026-10-02T00:02:00.000Z"}}
        """.data(using: .utf8)!
        let asset = try decoder.decode(TwinfoldAsset.self, from: json)
        XCTAssertEqual(asset.rehearsal, true)
        XCTAssertEqual(asset.redemption?.status, .retired)
        XCTAssertEqual(asset.redemption?.open, false)
        // An asset without the new fields still decodes (older server / fixtures).
        let plain = """
        {"id":"x","network":"devnet","address":"A","standard":"s","owner":"o","title":"T",
         "display":{"kind":"image","imageUrl":"","placeholder":false,"rightsNote":"r"},"spatialRepresentation":{"kind":"card"},"provenance":[]}
        """.data(using: .utf8)!
        let p = try decoder.decode(TwinfoldAsset.self, from: plain)
        XCTAssertNil(p.rehearsal)
        XCTAssertNil(p.redemption)
    }

    func testPassportDecodesWithLimitationsAndOnchainSignatures() throws {
        let json = """
        {"assetId":"tf-ukiyoe-001-rehearsal-1","sourceAsset":"ADDR","physicalId":"PHY-DEMO-0001","title":"T","rehearsal":true,
         "redeemedAt":"2026-10-02T00:03:00.000Z","lastVerifiedAt":"2026-09-30T08:30:00Z","lastVerifiedCondition":"c",
         "custodyAtExit":"TWINFOLD","provenance":[],"onchain":{"mint":"m","transfers":["t1"],"lock":"l","retire":"r"},
         "limitations":["保証しません"],"xrConditions":"x","dryRun":true,"network":"devnet"}
        """.data(using: .utf8)!
        let passport = try decoder.decode(RedeemedProvenancePassport.self, from: json)
        XCTAssertEqual(passport.onchain.retire, "r")
        XCTAssertEqual(passport.onchain.transfers, ["t1"])
        XCTAssertEqual(passport.limitations, ["保証しません"])
        XCTAssertEqual(passport.rehearsal, true)
    }

    func testRedeemLockTransferKindDecodes() throws {
        let json = "{\"requestId\":\"r1234567\",\"assetId\":\"a\",\"kind\":\"redeem_lock\",\"status\":\"awaiting_approval\",\"toWallet\":\"E\"}".data(using: .utf8)!
        let info = try decoder.decode(TransferRequestInfo.self, from: json)
        XCTAssertEqual(info.kind, .redeemLock)
        let other = "{\"requestId\":\"r1234567\",\"assetId\":\"a\",\"kind\":\"mystery\",\"status\":\"awaiting_approval\",\"toWallet\":\"E\"}".data(using: .utf8)!
        XCTAssertEqual(try decoder.decode(TransferRequestInfo.self, from: other).kind, .unknown)
    }
}
