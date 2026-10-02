import XCTest
@testable import TwinfoldCore

final class SessionLinkClientTests: XCTestCase {
    private let baseURL = URL(string: "https://twinfold.test")!
    private let wallet = "21hni5fvVgWm1NVAUBkki5ogTVweYsB7G9uVab9xTLWZ"

    private func urlSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    private func makeClient(store: SessionTokenStore = InMemorySessionStore()) -> SessionLinkClient {
        SessionLinkClient(baseURL: baseURL, session: urlSession(), store: store)
    }

    private func exchangeJSON(token: String = "tfd1.payload.mac") -> String {
        """
        {"token": "\(token)", "wallet": "\(wallet)", "expiresAt": "2099-01-01T00:00:00.000Z"}
        """
    }

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    func testNormalizeCodeAcceptsDashAndLowercase() {
        XCTAssertEqual(SessionLinkClient.normalizeCode("abcd-efgh"), "ABCDEFGH")
        XCTAssertEqual(SessionLinkClient.normalizeCode(" ABCD EFGH "), "ABCDEFGH")
    }

    func testCodeFromLinkURL() {
        XCTAssertEqual(SessionLinkClient.code(fromLinkURL: URL(string: "twinfold://link?code=ABCDEFGH")!), "ABCDEFGH")
        XCTAssertEqual(SessionLinkClient.code(fromLinkURL: URL(string: "twinfold://link?code=abcd-efgh")!), "ABCDEFGH")
        XCTAssertNil(SessionLinkClient.code(fromLinkURL: URL(string: "https://link?code=ABCDEFGH")!))
        XCTAssertNil(SessionLinkClient.code(fromLinkURL: URL(string: "twinfold://other?code=ABCDEFGH")!))
        XCTAssertNil(SessionLinkClient.code(fromLinkURL: URL(string: "twinfold://link")!))
    }

    func testExchangeStoresTokenAndWallet() async throws {
        StubURLProtocol.stub(method: "POST", path: "/api/link/exchange", status: 200, json: exchangeJSON())
        let store = InMemorySessionStore()
        let client = makeClient(store: store)
        XCTAssertNil(client.token)

        let linked = try await client.exchange(code: "abcd-efgh", deviceName: "iPhone")
        XCTAssertEqual(linked.wallet, wallet)
        XCTAssertEqual(client.token, "tfd1.payload.mac")
        XCTAssertEqual(store.load()?.token, "tfd1.payload.mac")
    }

    func testExchangeRejectsMalformedCodeWithoutNetwork() async {
        let client = makeClient()
        do {
            _ = try await client.exchange(code: "ABC", deviceName: "iPhone")
            XCTFail("expected invalidCode")
        } catch {
            XCTAssertEqual(error as? SessionLinkError, .invalidCode)
        }
    }

    func testExchangeMapsServerReasons() async {
        let cases: [(Int, String, SessionLinkError)] = [
            (404, "unknown_code", .unknownCode),
            (410, "expired", .expired),
            (409, "already_used", .alreadyUsed),
            (400, "invalid_code", .invalidCode),
        ]
        for (status, reason, expected) in cases {
            StubURLProtocol.stub(method: "POST", path: "/api/link/exchange", status: status, json: "{\"error\":\"\(reason)\"}")
            let client = makeClient()
            do {
                _ = try await client.exchange(code: "ABCDEFGH", deviceName: "iPhone")
                XCTFail("expected \(expected)")
            } catch {
                XCTAssertEqual(error as? SessionLinkError, expected)
            }
            XCTAssertNil(client.token, "no token stored on failure")
        }
    }

    func testExchangeRateLimitedCarriesRetryAfter() async {
        StubURLProtocol.stub(method: "POST", path: "/api/link/exchange", status: 429, json: "{\"error\":\"rate_limited\"}")
        StubURLProtocol.stubHeaders(method: "POST", path: "/api/link/exchange", headers: ["Retry-After": "120"])
        let client = makeClient()
        do {
            _ = try await client.exchange(code: "ABCDEFGH", deviceName: "iPhone")
            XCTFail("expected rateLimited")
        } catch {
            XCTAssertEqual(error as? SessionLinkError, .rateLimited(retryAfterSeconds: 120))
        }
    }

    func testValidateSendsBearerAndKeepsSession() async throws {
        StubURLProtocol.stub(method: "POST", path: "/api/link/exchange", status: 200, json: exchangeJSON(token: "tok-1"))
        StubURLProtocol.stub(method: "GET", path: "/api/link/session", status: 200, json: "{\"wallet\": \"\(wallet)\", \"expiresAt\": \"2099-01-01T00:00:00.000Z\"}")
        let client = makeClient()
        _ = try await client.exchange(code: "ABCDEFGH", deviceName: "iPhone")

        let session = try await client.validate()
        XCTAssertEqual(session.wallet, wallet)
        XCTAssertEqual(StubURLProtocol.authorization(method: "GET", path: "/api/link/session"), .some("Bearer tok-1"))
        XCTAssertNotNil(client.token)
    }

    func testValidate401ClearsTokenFromStore() async throws {
        StubURLProtocol.stub(method: "POST", path: "/api/link/exchange", status: 200, json: exchangeJSON())
        StubURLProtocol.stub(method: "GET", path: "/api/link/session", status: 401, json: "{\"error\":\"revoked\"}")
        let store = InMemorySessionStore()
        let client = makeClient(store: store)
        _ = try await client.exchange(code: "ABCDEFGH", deviceName: "iPhone")

        do {
            _ = try await client.validate()
            XCTFail("expected unauthorized")
        } catch {
            XCTAssertEqual(error as? SessionLinkError, .unauthorized)
        }
        XCTAssertNil(client.token)
        XCTAssertNil(store.load())
    }

    func testValidateNetworkFailureKeepsToken() async throws {
        StubURLProtocol.stub(method: "POST", path: "/api/link/exchange", status: 200, json: exchangeJSON())
        StubURLProtocol.stubNetworkError(method: "GET", path: "/api/link/session")
        let client = makeClient()
        _ = try await client.exchange(code: "ABCDEFGH", deviceName: "iPhone")

        do {
            _ = try await client.validate()
            XCTFail("expected network error")
        } catch SessionLinkError.network {
            // expected
        }
        XCTAssertNotNil(client.token)
    }

    func testExpiredStoredSessionIsDroppedAtInit() {
        let store = InMemorySessionStore(session: LinkedSession(token: "old", wallet: wallet, expiresAt: Date(timeIntervalSinceNow: -10)))
        let client = makeClient(store: store)
        XCTAssertNil(client.token)
        XCTAssertNil(store.load())
    }

    func testStoredSessionIsRestoredAtInit() {
        let store = InMemorySessionStore(session: LinkedSession(token: "kept", wallet: wallet, expiresAt: Date(timeIntervalSinceNow: 3600)))
        XCTAssertEqual(makeClient(store: store).token, "kept")
    }

    // MARK: - SolanaAssetProvider bearer wiring

    private func linkedProvider(token: String = "tok-1") async throws -> (SolanaAssetProvider, SessionLinkClient) {
        StubURLProtocol.stub(method: "POST", path: "/api/link/exchange", status: 200, json: exchangeJSON(token: token))
        let client = makeClient()
        _ = try await client.exchange(code: "ABCDEFGH", deviceName: "iPhone")
        return (SolanaAssetProvider(baseURL: baseURL, session: urlSession(), sessionLink: client), client)
    }

    func testTransferAndStatusSendBearerWhenLinked() async throws {
        let (provider, _) = try await linkedProvider()
        StubURLProtocol.stub(method: "POST", path: "/api/devnet/transfer", status: 200, json: "{\"requestId\":\"r1\",\"assetId\":\"a\",\"status\":\"pending\"}")
        StubURLProtocol.stub(method: "GET", path: "/api/devnet/transfer/r1", status: 200, json: "{\"requestId\":\"r1\",\"assetId\":\"a\",\"status\":\"pending\"}")

        _ = try await provider.devnetTransfer(requestId: "r1", assetId: "a", from: "owner-a", to: "owner-b")
        _ = try await provider.devnetTransferStatus(requestId: "r1")
        XCTAssertEqual(StubURLProtocol.authorization(method: "POST", path: "/api/devnet/transfer"), .some("Bearer tok-1"))
        XCTAssertEqual(StubURLProtocol.authorization(method: "GET", path: "/api/devnet/transfer/r1"), .some("Bearer tok-1"))
    }

    func testTransferSendsNoAuthorizationWithoutToken() async throws {
        StubURLProtocol.stub(method: "POST", path: "/api/devnet/transfer", status: 401, json: "{\"error\":\"unauthenticated\"}")
        let provider = SolanaAssetProvider(baseURL: baseURL, session: urlSession(), sessionLink: makeClient())
        do {
            _ = try await provider.devnetTransfer(requestId: "r1", assetId: "a", from: "owner-a", to: "owner-b")
            XCTFail("expected 401")
        } catch AssetProviderError.httpError(let status, _) {
            XCTAssertEqual(status, 401)
        }
        XCTAssertEqual(StubURLProtocol.authorization(method: "POST", path: "/api/devnet/transfer"), .some(nil))
    }

    func testReadOnlyCallsDoNotCarryTheToken() async throws {
        let (provider, _) = try await linkedProvider()
        StubURLProtocol.stub(method: "GET", path: "/api/solana/registry", status: 200, json: "{\"assetIds\": []}")
        _ = try await provider.listConfiguredAssetIds()
        XCTAssertEqual(StubURLProtocol.authorization(method: "GET", path: "/api/solana/registry"), .some(nil))
    }

    func testTransfer401ClearsTheToken() async throws {
        let (provider, client) = try await linkedProvider()
        StubURLProtocol.stub(method: "POST", path: "/api/devnet/transfer", status: 401, json: "{\"error\":\"device_session_revoked\"}")
        XCTAssertNotNil(client.token)
        do {
            _ = try await provider.devnetTransfer(requestId: "r1", assetId: "a", from: "owner-a", to: "owner-b")
            XCTFail("expected 401")
        } catch AssetProviderError.httpError(let status, _) {
            XCTAssertEqual(status, 401)
        }
        XCTAssertNil(client.token, "401 must drop the device token")
    }

    func testTransfer403KeepsTheToken() async throws {
        let (provider, client) = try await linkedProvider()
        StubURLProtocol.stub(method: "POST", path: "/api/devnet/transfer", status: 403, json: "{\"error\":\"nope\"}")
        do {
            _ = try await provider.devnetTransfer(requestId: "r1", assetId: "a", from: "owner-a", to: "owner-b")
            XCTFail("expected 403")
        } catch AssetProviderError.httpError(let status, _) {
            XCTAssertEqual(status, 403)
        }
        XCTAssertNotNil(client.token)
    }

    // MARK: - Keychain

    func testKeychainStoreRoundTrip() throws {
        let store = KeychainSessionStore(service: "design.twinfold.tests.\(UUID().uuidString)", account: "t")
        defer { store.clear() }
        let session = LinkedSession(token: "secret-token", wallet: wallet, expiresAt: Date(timeIntervalSince1970: 4_000_000_000))
        do {
            try store.save(session)
        } catch {
            throw XCTSkip("Keychain unavailable in this test host: \(error)")
        }
        XCTAssertEqual(store.load(), session)
        store.clear()
        XCTAssertNil(store.load())
    }
}
