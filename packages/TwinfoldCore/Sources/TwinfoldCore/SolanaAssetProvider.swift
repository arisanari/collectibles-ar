import Foundation

/// Implements the shared `AssetProvider` contract by calling the Twinfold
/// Web app's own `/api/solana/*` route handlers (never Helius/RPC/DAS
/// directly — those live server-side in `apps/web/lib/solana/*`, per
/// AGENTS.md section 3 and docs/architecture.md section 3 "Twinfold
/// Backend"). Mirrors `apps/web/lib/providers/solanaAssetProvider.ts`.
/// Screens using this provider must show a "DEVNET" label.
public final class SolanaAssetProvider: AssetProvider, Sendable {
    public let isDemoData = false

    private let baseURL: URL
    private let session: URLSession
    private let sessionLink: SessionLinkClient?

    /// - Parameters:
    ///   - baseURL: Twinfold API origin, e.g. `http://localhost:3000` for
    ///     the iOS Simulator, or the Mac's LAN IP for a physical device
    ///     (see apps/ios `Info.plist`'s `TWINFOLD_API_BASE_URL` and
    ///     `.claude/skills/ios-realitykit-ar/SKILL.md`).
    ///   - session: injectable for tests (URLProtocol stub); defaults to
    ///     `.shared`.
    ///   - sessionLink: when set and holding a device token (Issue #45), devnet
    ///     transfer/status calls send `Authorization: Bearer <token>`; a 401
    ///     response clears the token. Read-only calls (assets, quote, registry)
    ///     are public on-chain data and never carry it.
    public init(baseURL: URL, session: URLSession = .shared, sessionLink: SessionLinkClient? = nil) {
        self.baseURL = baseURL
        self.session = session
        self.sessionLink = sessionLink
    }

    public func getAssets(wallet: String) async throws -> [TwinfoldAsset] {
        guard var components = URLComponents(url: baseURL.appendingPathComponent("api/solana/assets"), resolvingAgainstBaseURL: false) else {
            throw AssetProviderError.decodingFailed("invalid baseURL: \(baseURL)")
        }
        components.queryItems = [URLQueryItem(name: "wallet", value: wallet)]
        guard let url = components.url else {
            throw AssetProviderError.decodingFailed("failed to build getAssets URL")
        }
        return try await get([TwinfoldAsset].self, url: url)
    }

    public func getAsset(assetId: String) async throws -> TwinfoldAsset {
        let url = baseURL.appendingPathComponent("api/solana/assets/\(assetId)")
        return try await get(TwinfoldAsset.self, url: url)
    }

    /// Not part of the `AssetProvider` protocol requirement's calling
    /// convention below (there's no wallet to check chain owner against):
    /// throws directing callers to `refreshOwnership(assetId:wallet:)`
    /// instead, the same shape as
    /// `apps/web/lib/providers/solanaAssetProvider.ts`'s
    /// `refreshOwnership(assetId)` (kept only for `AssetProvider`
    /// conformance) vs. `refreshOwnershipForWallet(assetId, wallet)` (the
    /// one actually called).
    public func refreshOwnership(assetId: String) async throws -> Entitlement {
        throw AssetProviderError.unsupportedOperation(
            "SolanaAssetProvider.refreshOwnership(assetId:) has no wallet to check against; " +
                "call refreshOwnership(assetId:wallet:) instead."
        )
    }

    /// `POST /api/solana/assets/{id}/refresh`, body `{"wallet": wallet}`.
    /// Re-fetches the Asset's current chain owner server-side and
    /// re-evaluates `Entitlement.canDisplay` against `wallet` — this is the
    /// method a transfer/buyback flow should call afterwards to decide
    /// whether the asset should still Appear for this wallet. Use this
    /// instead of the protocol's `refreshOwnership(assetId:)`.
    public func refreshOwnership(assetId: String, wallet: String) async throws -> Entitlement {
        let url = baseURL.appendingPathComponent("api/solana/assets/\(assetId)/refresh")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10
        request.httpBody = try? JSONEncoder().encode(["wallet": wallet])
        return try await send(Entitlement.self, request: request)
    }

    /// `GET /api/solana/registry`: the Twinfold asset ids currently mapped
    /// to a devnet Asset address, so the UI can list Devnet assets without
    /// a hardcoded id. Not part of the `AssetProvider` protocol, mirroring
    /// `SolanaAssetProvider.listConfiguredAssetIds()` in
    /// `apps/web/lib/providers/solanaAssetProvider.ts`.
    public func listConfiguredAssetIds() async throws -> [String] {
        struct RegistryResponse: Decodable { let assetIds: [String] }
        let url = baseURL.appendingPathComponent("api/solana/registry")
        let response = try await get(RegistryResponse.self, url: url)
        return response.assetIds
    }

    /// `GET /api/solana/assets/{id}/buyback-quote?wallet=...`: the
    /// "Twinfoldに売る" offer. Not part of `AssetProvider`; mirrors
    /// `SolanaAssetProvider.buybackQuote` in `apps/web`.
    public func buybackQuote(assetId: String, wallet: String) async throws -> BuybackQuote {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent("api/solana/assets/\(assetId)/buyback-quote"),
            resolvingAgainstBaseURL: false
        ) else {
            throw AssetProviderError.decodingFailed("invalid baseURL: \(baseURL)")
        }
        components.queryItems = [URLQueryItem(name: "wallet", value: wallet)]
        guard let url = components.url else {
            throw AssetProviderError.decodingFailed("failed to build buyback-quote URL")
        }
        return try await get(BuybackQuote.self, url: url)
    }

    /// `POST /api/devnet/transfer` — dev-only server-signing shortcut
    /// (Issue #29; real wallet signing is #19/#45). `from`/`to` are devnet
    /// wallet labels ("owner-a" | "owner-b" | "vault"), not raw pubkeys.
    /// Idempotent server-side by `requestId`. Not part of `AssetProvider`.
    public func devnetTransfer(
        requestId: String,
        assetId: String,
        from: String,
        to: String,
        quoteId: String? = nil,
        useSessionToken: Bool = true
    ) async throws -> DevnetTransferResult {
        let url = baseURL.appendingPathComponent("api/devnet/transfer")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30
        struct Body: Encodable {
            let requestId: String
            let assetId: String
            let from: String
            let to: String
            let quoteId: String?
        }
        request.httpBody = try JSONEncoder().encode(
            Body(requestId: requestId, assetId: assetId, from: from, to: to, quoteId: quoteId)
        )
        return try await send(DevnetTransferResult.self, request: request, authorized: useSessionToken)
    }

    /// `GET /api/devnet/transfer/{requestId}` — polls a transfer started
    /// above. Not part of `AssetProvider`.
    public func devnetTransferStatus(requestId: String) async throws -> DevnetTransferResult {
        let url = baseURL.appendingPathComponent("api/devnet/transfer/\(requestId)")
        return try await get(DevnetTransferResult.self, url: url, authorized: true)
    }

    /// `GET /api/devnet/capabilities`: whether the insecure server-signed test
    /// transfers (Owner A / Owner B rooms) are enabled on this server.
    public func devnetCapabilities() async throws -> DevnetCapabilities {
        try await get(DevnetCapabilities.self, url: baseURL.appendingPathComponent("api/devnet/capabilities"))
    }

    /// `POST /api/transfer-requests` (device Bearer token). Creates an approval
    /// request; the owner approves it on the Web with Phantom. For a buyback the
    /// server resolves the destination (Twinfold vault); `toWallet` is for `send`.
    public func createTransferRequest(
        requestId: String, assetId: String, kind: TransferRequestKind, toWallet: String? = nil
    ) async throws -> TransferRequestInfo {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/transfer-requests"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15
        struct Body: Encodable { let requestId: String; let assetId: String; let kind: TransferRequestKind; let toWallet: String? }
        request.httpBody = try JSONEncoder().encode(Body(requestId: requestId, assetId: assetId, kind: kind, toWallet: toWallet))
        return try await send(TransferRequestInfo.self, request: request, authorized: true)
    }

    /// `GET /api/transfer-requests/{id}` (device Bearer token).
    public func transferRequestStatus(requestId: String) async throws -> TransferRequestInfo {
        try await get(TransferRequestInfo.self, url: baseURL.appendingPathComponent("api/transfer-requests/\(requestId)"), authorized: true)
    }

    // MARK: - Twinfoldから取得 (Issue #60)

    /// `GET /api/vault/assets` (public): Assets Twinfold's vault wallet currently holds and lists
    /// for acquisition, with `commerce`. Advisory: the acquisition re-checks everything server-side.
    public func vaultAssets() async throws -> [TwinfoldAsset] {
        try await get([TwinfoldAsset].self, url: baseURL.appendingPathComponent("api/vault/assets"))
    }

    /// `POST /api/acquisitions` (device Bearer token). The buyer is always the token's wallet; only
    /// Twinfold's vault signs (devnet); no payment. Idempotent server-side by `requestId`.
    public func acquire(requestId: String, assetId: String) async throws -> AcquisitionInfo {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/acquisitions"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30
        struct Body: Encodable { let requestId: String; let assetId: String }
        request.httpBody = try JSONEncoder().encode(Body(requestId: requestId, assetId: assetId))
        return try await send(AcquisitionInfo.self, request: request, authorized: true)
    }

    /// `GET /api/acquisitions/{id}` (device Bearer token).
    public func acquisitionStatus(requestId: String) async throws -> AcquisitionInfo {
        try await get(AcquisitionInfo.self, url: baseURL.appendingPathComponent("api/acquisitions/\(requestId)"), authorized: true)
    }

    // MARK: - Redeem Physical (dry run)

    /// `POST /api/redemptions` (device Bearer token). Creates a `requested` redemption; the owner signs the lock
    /// on the Web with Phantom. No personal data is sent (the dry run records no delivery address).
    public func createRedemption(requestId: String, assetId: String) async throws -> Redemption {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/redemptions"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 20
        struct Body: Encodable { let requestId: String; let assetId: String }
        request.httpBody = try JSONEncoder().encode(Body(requestId: requestId, assetId: assetId))
        return try await send(Redemption.self, request: request, authorized: true)
    }

    /// `GET /api/redemptions/{id}` (device Bearer token).
    public func redemptionStatus(id: String) async throws -> Redemption {
        try await get(Redemption.self, url: baseURL.appendingPathComponent("api/redemptions/\(id)"), authorized: true)
    }

    // MARK: - Private

    private func get<T: Decodable>(_ type: T.Type, url: URL, authorized: Bool = false) async throws -> T {
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        return try await send(type, request: request, authorized: authorized)
    }

    private func send<T: Decodable>(_ type: T.Type, request: URLRequest, authorized: Bool = false) async throws -> T {
        var request = request
        var sentToken: String?
        if authorized, let token = sessionLink?.token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            sentToken = token
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AssetProviderError.networkFailed(String(describing: error))
        }

        guard let http = response as? HTTPURLResponse else {
            throw AssetProviderError.networkFailed("no HTTP response for \(request.url?.absoluteString ?? "unknown URL")")
        }
        if http.statusCode == 401, let sentToken, sessionLink?.token == sentToken {
            // Expired / revoked / Web wallet switched: forget the device token (view-only from here).
            sessionLink?.clear()
        }
        guard (200..<300).contains(http.statusCode) else {
            throw AssetProviderError.httpError(status: http.statusCode, url: request.url?.absoluteString ?? "unknown URL")
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw AssetProviderError.decodingFailed(String(describing: error))
        }
    }
}
