import XCTest
@testable import TwinfoldCore

final class AcquisitionClientTests: XCTestCase {
    private let baseURL = URL(string: "https://twinfold.test")!

    private func provider(linked: Bool = true) async throws -> (SolanaAssetProvider, SessionLinkClient) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: configuration)
        StubURLProtocol.reset()
        let link = SessionLinkClient(baseURL: baseURL, session: session, store: InMemorySessionStore())
        if linked {
            StubURLProtocol.stub(method: "POST", path: "/api/link/exchange", status: 200, json: "{\"token\":\"tok-acq\",\"wallet\":\"W\",\"expiresAt\":\"2099-01-01T00:00:00.000Z\"}")
            _ = try await link.exchange(code: "ABCDEFGH", deviceName: "iPhone")
        }
        return (SolanaAssetProvider(baseURL: baseURL, session: session, sessionLink: link), link)
    }

    private let acqJSON = "{\"requestId\":\"acq-1234567\",\"assetId\":\"tf-ukiyoe-001\",\"assetTitle\":\"T\",\"status\":\"submitted\",\"buyerWallet\":\"W\",\"listedPrice\":{\"amount\":350,\"currency\":\"USDC\"},\"paymentMade\":false,\"signature\":\"sig1\",\"createdAt\":\"x\",\"updatedAt\":\"y\"}"

    func testAcquireSendsBearerAndBodyAndDecodesPriceOnlyView() async throws {
        let (p, _) = try await provider()
        StubURLProtocol.stub(method: "POST", path: "/api/acquisitions", status: 201, json: acqJSON)
        let info = try await p.acquire(requestId: "acq-1234567", assetId: "tf-ukiyoe-001")
        XCTAssertEqual(info.status, .submitted)
        XCTAssertEqual(info.listedPrice, AcquisitionInfo.ListedPrice(amount: 350, currency: "USDC"))
        XCTAssertEqual(info.signature, "sig1")
        XCTAssertEqual(StubURLProtocol.authorization(method: "POST", path: "/api/acquisitions"), .some("Bearer tok-acq"))
    }

    func testStatusPollUsesBearerAndUnknownStatusIsNotDropped() async throws {
        let (p, _) = try await provider()
        StubURLProtocol.stub(method: "GET", path: "/api/acquisitions/acq-1234567", status: 200, json: acqJSON.replacingOccurrences(of: "submitted", with: "teleported"))
        let info = try await p.acquisitionStatus(requestId: "acq-1234567")
        XCTAssertEqual(info.status, .unknown)
        XCTAssertEqual(StubURLProtocol.authorization(method: "GET", path: "/api/acquisitions/acq-1234567"), .some("Bearer tok-acq"))
    }

    func testRefusalIsAnHTTPErrorAndA401DropsTheDeviceToken() async throws {
        let (p, link) = try await provider()
        StubURLProtocol.stub(method: "POST", path: "/api/acquisitions", status: 409, json: "{\"error\":\"この作品は現在取得できません\"}")
        do {
            _ = try await p.acquire(requestId: "acq-1234567", assetId: "tf-ukiyoe-001")
            XCTFail("expected an error")
        } catch AssetProviderError.httpError(let status, _) {
            XCTAssertEqual(status, 409)
        }
        XCTAssertNotNil(link.token, "a 409 must not drop the link")

        StubURLProtocol.stub(method: "POST", path: "/api/acquisitions", status: 401, json: "{\"error\":\"device_session_revoked\"}")
        do {
            _ = try await p.acquire(requestId: "acq-7654321", assetId: "tf-ukiyoe-001")
            XCTFail("expected an error")
        } catch AssetProviderError.httpError(let status, _) {
            XCTAssertEqual(status, 401)
        }
        XCTAssertNil(link.token, "a 401 (e.g. the Web signed in as another wallet) clears the device token")
    }

    func testVaultAssetsIsPublicAndCarriesNoToken() async throws {
        let (p, _) = try await provider()
        StubURLProtocol.stub(method: "GET", path: "/api/vault/assets", status: 200, json: "[]")
        let assets = try await p.vaultAssets()
        XCTAssertTrue(assets.isEmpty)
        XCTAssertEqual(StubURLProtocol.authorization(method: "GET", path: "/api/vault/assets"), .some(nil))
    }

    func testTransferRequestRetryableFailureDecodes() throws {
        let json = "{\"requestId\":\"r\",\"assetId\":\"a\",\"kind\":\"send\",\"status\":\"failed\",\"toWallet\":\"V\",\"error\":\"expired\",\"retryable\":true}"
        let info = try JSONDecoder().decode(TransferRequestInfo.self, from: Data(json.utf8))
        XCTAssertEqual(info.status, .failed)
        XCTAssertEqual(info.retryable, true)
    }
}
