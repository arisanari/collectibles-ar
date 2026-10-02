import XCTest
@testable import TwinfoldCore

final class TransferRequestClientTests: XCTestCase {
    private let baseURL = URL(string: "https://twinfold.test")!

    private func provider() async throws -> SolanaAssetProvider {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: configuration)
        StubURLProtocol.reset()
        StubURLProtocol.stub(method: "POST", path: "/api/link/exchange", status: 200, json: "{\"token\":\"tok-9\",\"wallet\":\"W\",\"expiresAt\":\"2099-01-01T00:00:00.000Z\"}")
        let link = SessionLinkClient(baseURL: baseURL, session: session, store: InMemorySessionStore())
        _ = try await link.exchange(code: "ABCDEFGH", deviceName: "iPhone")
        return SolanaAssetProvider(baseURL: baseURL, session: session, sessionLink: link)
    }

    func testCreateAndPollSendBearerAndDecode() async throws {
        let p = try await provider()
        let json = "{\"requestId\":\"r-1234567\",\"assetId\":\"a\",\"kind\":\"buyback\",\"status\":\"awaiting_approval\",\"toWallet\":\"V\",\"createdAt\":\"x\",\"expiresAt\":\"y\"}"
        StubURLProtocol.stub(method: "POST", path: "/api/transfer-requests", status: 201, json: json)
        StubURLProtocol.stub(method: "GET", path: "/api/transfer-requests/r-1234567", status: 200, json: json.replacingOccurrences(of: "awaiting_approval", with: "weird_new_status"))

        let created = try await p.createTransferRequest(requestId: "r-1234567", assetId: "a", kind: .buyback)
        XCTAssertEqual(created.status, .awaitingApproval)
        XCTAssertEqual(StubURLProtocol.authorization(method: "POST", path: "/api/transfer-requests"), .some("Bearer tok-9"))
        let polled = try await p.transferRequestStatus(requestId: "r-1234567")
        XCTAssertEqual(polled.status, .unknown, "unknown server status must not be dropped silently")
        XCTAssertEqual(StubURLProtocol.authorization(method: "GET", path: "/api/transfer-requests/r-1234567"), .some("Bearer tok-9"))
    }

    func testCapabilitiesDecodeWithoutToken() async throws {
        let p = try await provider()
        StubURLProtocol.stub(method: "GET", path: "/api/devnet/capabilities", status: 200, json: "{\"serverSignedTestTransfers\":true}")
        let caps = try await p.devnetCapabilities()
        XCTAssertTrue(caps.serverSignedTestTransfers)
        XCTAssertEqual(StubURLProtocol.authorization(method: "GET", path: "/api/devnet/capabilities"), .some(nil))
    }

    func testTestRoomTransferCanSkipToken() async throws {
        let p = try await provider()
        StubURLProtocol.stub(method: "POST", path: "/api/devnet/transfer", status: 200, json: "{\"requestId\":\"r\",\"assetId\":\"a\",\"status\":\"pending\"}")
        _ = try await p.devnetTransfer(requestId: "r", assetId: "a", from: "owner-b", to: "owner-a", useSessionToken: false)
        XCTAssertEqual(StubURLProtocol.authorization(method: "POST", path: "/api/devnet/transfer"), .some(nil))
    }
}
