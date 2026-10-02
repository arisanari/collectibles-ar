import Foundation

// "Twinfoldから取得" (Issue #60). Mirrors `AcquisitionView` in apps/web/lib/contract.ts.
// Devnet only: Twinfold's vault wallet signs the transfer to the linked wallet, no payment
// happens, and `listedPrice` is Twinfold's off-chain display value (demo placeholder).

/// Unknown server values decode to `.unknown` (never silently dropped).
public enum AcquisitionStatus: String, Codable, Sendable, Equatable {
    case pending
    case submitted
    case confirmed
    case failed
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AcquisitionStatus(rawValue: raw) ?? .unknown
    }
}

/// `POST /api/acquisitions` and `GET /api/acquisitions/{id}` response.
public struct AcquisitionInfo: Codable, Sendable, Equatable {
    public struct ListedPrice: Codable, Sendable, Equatable {
        public let amount: Double
        public let currency: String
        public init(amount: Double, currency: String) {
            self.amount = amount
            self.currency = currency
        }
    }

    public let requestId: String
    public let assetId: String
    public let status: AcquisitionStatus
    public let buyerWallet: String?
    public let listedPrice: ListedPrice?
    public let signature: String?
    public let error: String?

    public init(
        requestId: String, assetId: String, status: AcquisitionStatus, buyerWallet: String? = nil,
        listedPrice: ListedPrice? = nil, signature: String? = nil, error: String? = nil
    ) {
        self.requestId = requestId
        self.assetId = assetId
        self.status = status
        self.buyerWallet = buyerWallet
        self.listedPrice = listedPrice
        self.signature = signature
        self.error = error
    }
}
