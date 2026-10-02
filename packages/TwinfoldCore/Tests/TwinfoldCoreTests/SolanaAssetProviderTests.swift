import XCTest
@testable import TwinfoldCore

/// Stubs `URLSession` responses by URL/method so `SolanaAssetProviderTests`
/// never touches the network. Register a response with `stub(...)` before
/// each request under test.
final class StubURLProtocol: URLProtocol {
    struct Response {
        let status: Int
        let body: Data
    }

    // `URLProtocol` subclasses are handed to `URLSession` as a type, so the
    // stubbed responses must live on a static/class-level store, keyed by
    // "METHOD path" (not host, since the test baseURL's host/port varies).
    private static let lock = NSLock()
    nonisolated(unsafe) private static var responses: [String: Response] = [:]
    nonisolated(unsafe) private static var networkErrorPaths: Set<String> = []
    /// "METHOD path" -> the `Authorization` header of the last request seen (nil value = none sent).
    nonisolated(unsafe) private static var authorizations: [String: String?] = [:]
    nonisolated(unsafe) private static var extraHeaders: [String: [String: String]] = [:]

    static func reset() {
        lock.lock()
        responses = [:]
        networkErrorPaths = []
        authorizations = [:]
        extraHeaders = [:]
        lock.unlock()
    }

    /// `nil` if the endpoint was never called; `.some(nil)` if called without an Authorization header.
    static func authorization(method: String, path: String) -> String?? {
        lock.lock(); defer { lock.unlock() }
        return authorizations["\(method) \(path)"]
    }

    static func stubHeaders(method: String, path: String, headers: [String: String]) {
        lock.lock()
        extraHeaders["\(method) \(path)"] = headers
        lock.unlock()
    }

    static func stub(method: String, path: String, status: Int, json: String) {
        lock.lock()
        responses["\(method) \(path)"] = Response(status: status, body: Data(json.utf8))
        lock.unlock()
    }

    static func stubNetworkError(method: String, path: String) {
        lock.lock()
        networkErrorPaths.insert("\(method) \(path)")
        lock.unlock()
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let method = request.httpMethod else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        let key = "\(method) \(url.path)"

        Self.lock.lock()
        let response = Self.responses[key]
        let isNetworkError = Self.networkErrorPaths.contains(key)
        Self.authorizations[key] = .some(request.value(forHTTPHeaderField: "Authorization"))
        let headers = Self.extraHeaders[key] ?? [:]
        Self.lock.unlock()

        if isNetworkError {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        guard let response else {
            client?.urlProtocol(self, didFailWithError: URLError(.fileDoesNotExist))
            return
        }
        let httpResponse = HTTPURLResponse(url: url, statusCode: response.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"].merging(headers) { _, new in new })!
        client?.urlProtocol(self, didReceive: httpResponse, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: response.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class SolanaAssetProviderTests: XCTestCase {
    private let baseURL = URL(string: "https://twinfold.test")!

    private func makeProvider() -> SolanaAssetProvider {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return SolanaAssetProvider(baseURL: baseURL, session: URLSession(configuration: configuration))
    }

    private static let assetJSON = """
    {
      "id": "tf-ukiyoe-001",
      "network": "devnet",
      "address": "JDgNS6gpAkKtn5wkvPid8zYh5C65iHxmEjW4vULJ1oKu",
      "standard": "metaplex-core",
      "owner": "21hni5fvVgWm1NVAUBkki5ogTVweYsB7G9uVab9xTLWZ",
      "title": "Hokusai Manga vol.13",
      "display": {"kind": "image", "imageUrl": "/artworks/ukiyoe-hokusai-manga13.png", "placeholder": true, "rightsNote": "note"},
      "spatialRepresentation": {"kind": "card"},
      "provenance": [
        {"id": "e1", "assetId": "tf-ukiyoe-001", "kind": "minted", "occurredAt": "2026-09-26T20:21:11.000Z", "source": "onchain", "status": "confirmed", "transaction": "tx1", "slot": 1, "metadata": {}}
      ]
    }
    """

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    func testGetAssetDecodesSuccessResponse() async throws {
        StubURLProtocol.stub(method: "GET", path: "/api/solana/assets/tf-ukiyoe-001", status: 200, json: Self.assetJSON)
        let provider = makeProvider()
        XCTAssertFalse(provider.isDemoData)

        let asset = try await provider.getAsset(assetId: "tf-ukiyoe-001")
        XCTAssertEqual(asset.id, "tf-ukiyoe-001")
        XCTAssertEqual(asset.owner, "21hni5fvVgWm1NVAUBkki5ogTVweYsB7G9uVab9xTLWZ")
        XCTAssertEqual(asset.provenance.first?.kind, .minted)
    }

    func testGetAssetThrowsHttpErrorOn404() async throws {
        StubURLProtocol.stub(method: "GET", path: "/api/solana/assets/tf-missing", status: 404, json: "{\"error\":\"not configured\"}")
        let provider = makeProvider()

        do {
            _ = try await provider.getAsset(assetId: "tf-missing")
            XCTFail("expected httpError")
        } catch AssetProviderError.httpError(let status, _) {
            XCTAssertEqual(status, 404)
        }
    }

    func testGetAssetThrowsDecodingFailedOnMalformedJSON() async throws {
        StubURLProtocol.stub(method: "GET", path: "/api/solana/assets/tf-ukiyoe-001", status: 200, json: "{ not valid json")
        let provider = makeProvider()

        do {
            _ = try await provider.getAsset(assetId: "tf-ukiyoe-001")
            XCTFail("expected decodingFailed")
        } catch AssetProviderError.decodingFailed {
            // expected
        }
    }

    func testGetAssetThrowsNetworkFailedOnConnectionError() async throws {
        StubURLProtocol.stubNetworkError(method: "GET", path: "/api/solana/assets/tf-ukiyoe-001")
        let provider = makeProvider()

        do {
            _ = try await provider.getAsset(assetId: "tf-ukiyoe-001")
            XCTFail("expected networkFailed")
        } catch AssetProviderError.networkFailed {
            // expected
        }
    }

    func testRefreshOwnershipWithoutWalletThrows() async throws {
        let provider = makeProvider()
        do {
            _ = try await provider.refreshOwnership(assetId: "tf-ukiyoe-001")
            XCTFail("expected unsupportedOperation guidance error")
        } catch AssetProviderError.unsupportedOperation {
            // expected
        }
    }

    func testRefreshOwnershipWithWalletDecodesEntitlement() async throws {
        let json = """
        {"wallet": "21hni5fvVgWm1NVAUBkki5ogTVweYsB7G9uVab9xTLWZ", "assetId": "tf-ukiyoe-001", "canDisplay": true, "reason": "devnet: chain owner matches wallet", "checkedAt": "2026-09-27T00:00:00Z"}
        """
        StubURLProtocol.stub(method: "POST", path: "/api/solana/assets/tf-ukiyoe-001/refresh", status: 200, json: json)
        let provider = makeProvider()

        let entitlement = try await provider.refreshOwnership(assetId: "tf-ukiyoe-001", wallet: "21hni5fvVgWm1NVAUBkki5ogTVweYsB7G9uVab9xTLWZ")
        XCTAssertTrue(entitlement.canDisplay)
    }

    func testListConfiguredAssetIdsDecodesRegistry() async throws {
        StubURLProtocol.stub(method: "GET", path: "/api/solana/registry", status: 200, json: "{\"assetIds\": [\"tf-ukiyoe-001\"]}")
        let provider = makeProvider()

        let ids = try await provider.listConfiguredAssetIds()
        XCTAssertEqual(ids, ["tf-ukiyoe-001"])
    }

    func testBuybackQuoteDecodesResponse() async throws {
        let json = """
        {"assetId": "tf-ukiyoe-001", "basis": {"amount": 350, "currency": "USDC"}, "rate": 0.8, "offerAmount": 280, "currency": "USDC", "eligible": true, "reason": "devnet: eligible", "quoteId": "q1", "expiresAt": "2026-09-30T00:10:00Z"}
        """
        StubURLProtocol.stub(method: "GET", path: "/api/solana/assets/tf-ukiyoe-001/buyback-quote", status: 200, json: json)
        let provider = makeProvider()

        let quote = try await provider.buybackQuote(assetId: "tf-ukiyoe-001", wallet: "21hni5fvVgWm1NVAUBkki5ogTVweYsB7G9uVab9xTLWZ")
        XCTAssertEqual(quote.offerAmount, 280)
        XCTAssertTrue(quote.eligible)
    }

    func testDevnetTransferDecodesResponse() async throws {
        let json = """
        {"requestId": "r1", "assetId": "tf-ukiyoe-001", "status": "confirmed", "signature": "sig123"}
        """
        StubURLProtocol.stub(method: "POST", path: "/api/devnet/transfer", status: 200, json: json)
        let provider = makeProvider()

        let result = try await provider.devnetTransfer(requestId: "r1", assetId: "tf-ukiyoe-001", from: "owner-a", to: "vault")
        XCTAssertEqual(result.status, .confirmed)
        XCTAssertEqual(result.signature, "sig123")
    }

    func testDevnetTransferStatusDecodesResponse() async throws {
        let json = """
        {"requestId": "r1", "assetId": "tf-ukiyoe-001", "status": "pending"}
        """
        StubURLProtocol.stub(method: "GET", path: "/api/devnet/transfer/r1", status: 200, json: json)
        let provider = makeProvider()

        let result = try await provider.devnetTransferStatus(requestId: "r1")
        XCTAssertEqual(result.status, .pending)
    }
}
