import Foundation

// Owner-approved transfer requests (Issue #45). Mirrors `TransferRequestView`
// in apps/web/lib/contract.ts.

/// Unknown server values decode to `.unknown` (never silently dropped).
public enum TransferRequestKind: String, Codable, Sendable, Equatable {
    case buyback
    case send
    case redeemLock = "redeem_lock"
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = TransferRequestKind(rawValue: raw) ?? .unknown
    }
}

/// Unknown server values decode to `.unknown` (never silently dropped).
public enum TransferRequestStatus: String, Codable, Sendable, Equatable {
    case awaitingApproval = "awaiting_approval"
    case submitted
    case confirmed
    case failed
    case rejected
    case expired
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = TransferRequestStatus(rawValue: raw) ?? .unknown
    }
}

/// `POST/GET /api/transfer-requests[/{id}]` response.
public struct TransferRequestInfo: Codable, Sendable, Equatable {
    public let requestId: String
    public let assetId: String
    public let kind: TransferRequestKind
    public let status: TransferRequestStatus
    public let toWallet: String
    public let signature: String?
    public let error: String?
    /// `failed` with `retryable == true` (e.g. expired blockhash) is NOT terminal: the owner can re-approve on the Web.
    public let retryable: Bool?

    public init(requestId: String, assetId: String, kind: TransferRequestKind, status: TransferRequestStatus, toWallet: String, signature: String? = nil, error: String? = nil, retryable: Bool? = nil) {
        self.requestId = requestId
        self.assetId = assetId
        self.kind = kind
        self.status = status
        self.toWallet = toWallet
        self.signature = signature
        self.error = error
        self.retryable = retryable
    }
}

/// `GET /api/devnet/capabilities`.
public struct DevnetCapabilities: Codable, Sendable, Equatable {
    public let serverSignedTestTransfers: Bool
    public init(serverSignedTestTransfers: Bool) { self.serverSignedTestTransfers = serverSignedTestTransfers }
}
