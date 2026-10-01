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

    /// - Parameters:
    ///   - baseURL: Twinfold API origin, e.g. `http://localhost:3000` for
    ///     the iOS Simulator, or the Mac's LAN IP for a physical device
    ///     (see apps/ios `Info.plist`'s `TWINFOLD_API_BASE_URL` and
    ///     `.claude/skills/ios-realitykit-ar/SKILL.md`).
    ///   - session: injectable for tests (URLProtocol stub); defaults to
    ///     `.shared`.
    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
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
        quoteId: String? = nil
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
        return try await send(DevnetTransferResult.self, request: request)
    }

    /// `GET /api/devnet/transfer/{requestId}` — polls a transfer started
    /// above. Not part of `AssetProvider`.
    public func devnetTransferStatus(requestId: String) async throws -> DevnetTransferResult {
        let url = baseURL.appendingPathComponent("api/devnet/transfer/\(requestId)")
        return try await get(DevnetTransferResult.self, url: url)
    }

    // MARK: - Private

    private func get<T: Decodable>(_ type: T.Type, url: URL) async throws -> T {
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        return try await send(type, request: request)
    }

    private func send<T: Decodable>(_ type: T.Type, request: URLRequest) async throws -> T {
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
