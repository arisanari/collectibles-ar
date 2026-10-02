import XCTest
@testable import TwinfoldCore

final class RedemptionClientTests: XCTestCase {
    private let baseURL = URL(string: "https://twinfold.test")!
    private let json = "{\"id\":\"red-12345678\",\"assetId\":\"tf-ukiyoe-001-rehearsal-1\",\"assetAddress\":\"A\",\"wallet\":\"W\",\"status\":\"requested\",\"createdAt\":\"x\",\"updatedAt\":\"y\",\"events\":[],\"dryRun\":true}"

    func testCreateAndStatusUseBearer() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: configuration)
        StubURLProtocol.reset()
        let link = SessionLinkClient(baseURL: baseURL, session: session, store: InMemorySessionStore())
        StubURLProtocol.stub(method: "POST", path: "/api/link/exchange", status: 200, json: "{\"token\":\"tok-r\",\"wallet\":\"W\",\"expiresAt\":\"2099-01-01T00:00:00.000Z\"}")
        _ = try await link.exchange(code: "ABCDEFGH", deviceName: "iPhone")
        let p = SolanaAssetProvider(baseURL: baseURL, session: session, sessionLink: link)
        StubURLProtocol.stub(method: "POST", path: "/api/redemptions", status: 201, json: json)
        let r = try await p.createRedemption(requestId: "red-12345678", assetId: "tf-ukiyoe-001-rehearsal-1")
        XCTAssertEqual(r.status, .requested)
        XCTAssertEqual(StubURLProtocol.authorization(method: "POST", path: "/api/redemptions"), .some("Bearer tok-r"))
        StubURLProtocol.stub(method: "GET", path: "/api/redemptions/red-12345678", status: 200, json: json.replacingOccurrences(of: "requested", with: "locked"))
        let s = try await p.redemptionStatus(id: "red-12345678")
        XCTAssertEqual(s.status, .locked)
    }
}
