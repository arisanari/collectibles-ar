import Foundation
import Security

// Issue #45: hands the Web wallet-auth session to the iPhone with a one-time
// link code (docs/architecture.md section 7 "Web -> iOS AR"). The iPhone
// never sees a private key / seed phrase: it only ever holds an opaque,
// server-revocable device token. A public address typed in alone grants
// nothing — owner-only operations need this token.

/// The device session issued by `POST /api/link/exchange`.
public struct LinkedSession: Codable, Sendable, Equatable {
    public let token: String
    public let wallet: String
    public let expiresAt: Date

    public init(token: String, wallet: String, expiresAt: Date) {
        self.token = token
        self.wallet = wallet
        self.expiresAt = expiresAt
    }
}

public enum SessionLinkError: Error, Equatable, Sendable {
    /// Code is not 8 characters of the unambiguous alphabet (client- or server-detected).
    case invalidCode
    case unknownCode
    case expired
    case alreadyUsed
    case rateLimited(retryAfterSeconds: Int?)
    /// 401 from the API: the device session expired, was revoked, or the Web wallet changed.
    case unauthorized
    case network(String)
    case server(status: Int)
    case decoding(String)
}

/// Where the device token is kept. The production implementation is the Keychain.
public protocol SessionTokenStore: Sendable {
    func load() -> LinkedSession?
    func save(_ session: LinkedSession) throws
    func clear()
}

/// Keychain-backed store (generic password item, this-device-only, readable while unlocked).
/// Never UserDefaults: the token is a bearer credential.
public struct KeychainSessionStore: SessionTokenStore {
    public struct KeychainError: Error, Sendable { public let status: OSStatus }

    private let service: String
    private let account: String

    public init(service: String = "design.twinfold.session-link", account: String = "device-session") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func load() -> LinkedSession? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimitOne as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try? decoder.decode(LinkedSession.self, from: data)
    }

    public func save(_ session: LinkedSession) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        let data = try encoder.encode(session)
        SecItemDelete(baseQuery as CFDictionary)
        var attributes = baseQuery
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    public func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}

/// Test/preview store. Not persistent.
public final class InMemorySessionStore: SessionTokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: LinkedSession?

    public init(session: LinkedSession? = nil) { self.session = session }

    public func load() -> LinkedSession? { lock.withLock { session } }
    public func save(_ session: LinkedSession) throws { lock.withLock { self.session = session } }
    public func clear() { lock.withLock { session = nil } }
}

/// Exchanges a link code for a device session, holds the token, validates it,
/// and forgets it on 401. `SolanaAssetProvider` reads `token` to send
/// `Authorization: Bearer` on devnet transfer/status calls.
public final class SessionLinkClient: @unchecked Sendable {
    private let baseURL: URL
    private let urlSession: URLSession
    private let store: SessionTokenStore
    private let lock = NSLock()
    private var cached: LinkedSession?

    public init(baseURL: URL, session: URLSession = .shared, store: SessionTokenStore = KeychainSessionStore()) {
        self.baseURL = baseURL
        self.urlSession = session
        self.store = store
        if let stored = store.load(), stored.expiresAt > Date() {
            cached = stored
        } else {
            store.clear()
        }
    }

    /// The current linked session, or nil (never linked / expired / dropped after 401).
    public var current: LinkedSession? {
        lock.withLock {
            if let cached, cached.expiresAt <= Date() {
                self.cached = nil
                store.clear()
            }
            return cached
        }
    }

    public var token: String? { current?.token }

    /// Strips spaces/dashes and uppercases, so "abcd-efgh" and "ABCDEFGH" are the same code.
    public static func normalizeCode(_ raw: String) -> String {
        raw.filter { !$0.isWhitespace && $0 != "-" }.uppercased()
    }

    /// Accepts a `twinfold://link?code=XXXXXXXX` URL (QR / Camera) and returns the code, if it is one.
    public static func code(fromLinkURL url: URL) -> String? {
        guard url.scheme == "twinfold", url.host == "link",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let raw = items.first(where: { $0.name == "code" })?.value else { return nil }
        let code = normalizeCode(raw)
        return code.isEmpty ? nil : code
    }

    /// `POST /api/link/exchange { code, deviceName }`. On success the code is burned server-side and the token is stored.
    public func exchange(code rawCode: String, deviceName: String) async throws -> LinkedSession {
        let code = Self.normalizeCode(rawCode)
        guard code.count == 8 else { throw SessionLinkError.invalidCode }

        var request = URLRequest(url: baseURL.appendingPathComponent("api/link/exchange"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10
        request.httpBody = try JSONEncoder().encode(["code": code, "deviceName": deviceName])

        let (data, http) = try await perform(request)
        guard (200..<300).contains(http.statusCode) else { throw Self.mapExchangeFailure(http, data: data) }

        struct Response: Decodable { let token: String; let wallet: String; let expiresAt: String }
        let response: Response
        do { response = try JSONDecoder().decode(Response.self, from: data) } catch {
            throw SessionLinkError.decoding(String(describing: error))
        }
        guard let expiresAt = Self.parseDate(response.expiresAt) else { throw SessionLinkError.decoding("expiresAt: \(response.expiresAt)") }
        let linked = LinkedSession(token: response.token, wallet: response.wallet, expiresAt: expiresAt)
        do { try store.save(linked) } catch {
            throw SessionLinkError.decoding("could not store token in Keychain: \(error)")
        }
        lock.withLock { cached = linked }
        return linked
    }

    /// `GET /api/link/session` with the stored token. 401 -> the token is dropped and `.unauthorized` is thrown.
    /// A network failure throws `.network` and keeps the token (the server could not be asked).
    @discardableResult
    public func validate() async throws -> LinkedSession {
        guard let session = current else { throw SessionLinkError.unauthorized }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/link/session"))
        request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10

        let (data, http) = try await perform(request)
        if http.statusCode == 401 {
            clear()
            throw SessionLinkError.unauthorized
        }
        guard (200..<300).contains(http.statusCode) else { throw SessionLinkError.server(status: http.statusCode) }

        struct Response: Decodable { let wallet: String; let expiresAt: String }
        guard let response = try? JSONDecoder().decode(Response.self, from: data),
              let expiresAt = Self.parseDate(response.expiresAt) else {
            throw SessionLinkError.decoding("session response")
        }
        let refreshed = LinkedSession(token: session.token, wallet: response.wallet, expiresAt: expiresAt)
        if refreshed != session {
            try? store.save(refreshed)
            lock.withLock { cached = refreshed }
        }
        return refreshed
    }

    /// Forgets the device token locally ("連携を解除", and after any 401). The server-side token stays valid
    /// until revoked from the Web or it expires (12h).
    public func clear() {
        lock.withLock { cached = nil }
        store.clear()
    }

    // MARK: - Private

    private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw SessionLinkError.network("no HTTP response") }
            return (data, http)
        } catch let error as SessionLinkError {
            throw error
        } catch {
            throw SessionLinkError.network(String(describing: error))
        }
    }

    private static func mapExchangeFailure(_ http: HTTPURLResponse, data: Data) -> SessionLinkError {
        struct Body: Decodable { let error: String? }
        let reason = (try? JSONDecoder().decode(Body.self, from: data))?.error
        switch (http.statusCode, reason) {
        case (_, "invalid_code"), (_, "invalid_input"): return .invalidCode
        case (_, "unknown_code"): return .unknownCode
        case (_, "expired"): return .expired
        case (_, "already_used"): return .alreadyUsed
        case (429, _):
            return .rateLimited(retryAfterSeconds: http.value(forHTTPHeaderField: "Retry-After").flatMap(Int.init))
        default: return .server(status: http.statusCode)
        }
    }

    private static func parseDate(_ string: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: string) { return date }
        return ISO8601DateFormatter().date(from: string)
    }
}
