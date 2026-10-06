import XCTest
@testable import TwinfoldCore

final class PassportLinksTests: XCTestCase {
    private let mint = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"

    func testExplorerLinksSwitchClusterAndSkipFixtureAddresses() {
        XCTAssertEqual(PassportLinks.explorerAddress(mint, network: "devnet")?.absoluteString,
                       "https://explorer.solana.com/address/\(mint)?cluster=devnet")
        XCTAssertEqual(PassportLinks.explorerAddress(mint, network: "mainnet")?.absoluteString,
                       "https://explorer.solana.com/address/\(mint)")
        XCTAssertNil(PassportLinks.explorerAddress("DEMO-1-CARD", network: "devnet"), "DEMO DATA never links out")
        XCTAssertNil(PassportLinks.explorerTransaction("DEMO-TX-PULL-1", network: "devnet"))
    }

    func testPsaCertLinkOnlyForPsaWithNumericCertificate() {
        XCTAssertEqual(PassportLinks.psaCert(company: "PSA", gradingId: "12345678")?.absoluteString, "https://www.psacard.com/cert/12345678")
        XCTAssertEqual(PassportLinks.psaCert(company: " psa ", gradingId: "12345678")?.absoluteString, "https://www.psacard.com/cert/12345678")
        XCTAssertNil(PassportLinks.psaCert(company: "BGS", gradingId: "12345678"))
        XCTAssertNil(PassportLinks.psaCert(company: "DEMO", gradingId: "DEMO-CERT-0001"))
        XCTAssertNil(PassportLinks.psaCert(company: "PSA", gradingId: "../evil"))
        XCTAssertNil(PassportLinks.psaCert(company: "PSA", gradingId: nil))
    }

    func testVrfLinkEncodesMemoAsOnePathSegment() {
        XCTAssertEqual(PassportLinks.vrfVerify(memo: "abc123")?.absoluteString, PassportLinks.vrfVerifyBase + "abc123")
        XCTAssertEqual(PassportLinks.vrfVerify(memo: "a/b c")?.absoluteString, PassportLinks.vrfVerifyBase + "a%2Fb%20c")
        XCTAssertNil(PassportLinks.vrfVerify(memo: ""))
        XCTAssertNil(PassportLinks.vrfVerify(memo: nil))
    }

    func testAcquisitionEventPrefersConfirmedNewestOnchainSignature() throws {
        let json = """
        {"id":"x","network":"devnet","address":"\(mint)","standard":"pnft","owner":"W","title":"T",
         "display":{"kind":"image","imageUrl":"u","placeholder":false,"rightsNote":"n"},"spatialRepresentation":{"kind":"card"},
         "provenance":[
          {"id":"e1","assetId":"x","kind":"transferred","occurredAt":"2026-10-06T10:00:00Z","source":"onchain","status":"confirmed","transaction":"SIG-OLD","metadata":{}},
          {"id":"e2","assetId":"x","kind":"transferred","occurredAt":"2026-10-06T12:00:00Z","source":"onchain","status":"confirmed","transaction":"SIG-NEW","metadata":{}},
          {"id":"e3","assetId":"x","kind":"transferred","occurredAt":"2026-10-06T13:00:00Z","source":"onchain","status":"pending","transaction":"SIG-PENDING","metadata":{}},
          {"id":"e4","assetId":"x","kind":"vaulted","occurredAt":"2026-10-06T14:00:00Z","source":"offchain_evidence","status":"confirmed","metadata":{}}],
         "category":"card","insuredValueUsd":487.5}
        """
        let asset = try JSONDecoder().decode(TwinfoldAsset.self, from: Data(json.utf8))
        XCTAssertEqual(asset.acquisitionEvent?.transaction, "SIG-NEW")
        XCTAssertEqual(asset.insuredValueDisplay, "$487.5 USD")
        XCTAssertFalse(asset.isDemoChainData)
    }
}
