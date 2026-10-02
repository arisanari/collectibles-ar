import Foundation

// Redeem Physical, dry run (Issues #22/#23/#28/#42). Mirrors `Redemption`, `RedemptionSummary` and
// `RedeemedProvenancePassport` in apps/web/lib/contract.ts. No personal data (name, address, phone) is part
// of any of these. Unknown server values decode to `.unknown` (never silently dropped).

public enum RedemptionStatus: String, Codable, Sendable, Equatable {
    case requested
    case locked
    case shipped
    case received
    case retired
    case cancelled
    case exception
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = RedemptionStatus(rawValue: raw) ?? .unknown
    }
}

public enum RedemptionEventKind: String, Codable, Sendable, Equatable {
    case requested
    case locked
    case shipped
    case received
    case retired
    case cancelled
    case exception
    case returned
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = RedemptionEventKind(rawValue: raw) ?? .unknown
    }
}

/// `TwinfoldAsset.redemption`: whether a redemption is open, so clients stop offering buyback/send.
public struct RedemptionSummary: Codable, Sendable, Equatable {
    public let id: String
    public let status: RedemptionStatus
    public let open: Bool
    public let updatedAt: String

    public init(id: String, status: RedemptionStatus, open: Bool, updatedAt: String) {
        self.id = id
        self.status = status
        self.open = open
        self.updatedAt = updatedAt
    }
}

public struct RedemptionEvent: Codable, Sendable, Equatable {
    public let kind: RedemptionEventKind
    public let at: String
    public let source: ProvenanceSource
    public let signature: String?
    public let dryRun: Bool?
    public let note: String?

    public init(kind: RedemptionEventKind, at: String, source: ProvenanceSource, signature: String? = nil, dryRun: Bool? = nil, note: String? = nil) {
        self.kind = kind
        self.at = at
        self.source = source
        self.signature = signature
        self.dryRun = dryRun
        self.note = note
    }
}

/// `POST /api/redemptions` and `GET /api/redemptions[/{id}]` response.
public struct Redemption: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let assetId: String
    public let assetAddress: String
    public let assetTitle: String?
    public let wallet: String
    public let status: RedemptionStatus
    public let createdAt: String
    public let updatedAt: String
    public let lockSignature: String?
    public let retireSignature: String?
    public let events: [RedemptionEvent]
    public let lockRequestId: String?
    public let exceptionReason: String?
    public let dryRun: Bool?

    public init(
        id: String, assetId: String, assetAddress: String, assetTitle: String? = nil, wallet: String, status: RedemptionStatus,
        createdAt: String, updatedAt: String, lockSignature: String? = nil, retireSignature: String? = nil,
        events: [RedemptionEvent] = [], lockRequestId: String? = nil, exceptionReason: String? = nil, dryRun: Bool? = true
    ) {
        self.id = id
        self.assetId = assetId
        self.assetAddress = assetAddress
        self.assetTitle = assetTitle
        self.wallet = wallet
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lockSignature = lockSignature
        self.retireSignature = retireSignature
        self.events = events
        self.lockRequestId = lockRequestId
        self.exceptionReason = exceptionReason
        self.dryRun = dryRun
    }
}

/// `GET /api/passports/{assetId}` response. Records provenance and the last verified state UP TO Vault exit;
/// it does NOT guarantee the current owner, the current condition, or authenticity (see `limitations`).
public struct RedeemedProvenancePassport: Codable, Sendable, Equatable {
    public struct Onchain: Codable, Sendable, Equatable {
        public let mint: String?
        public let transfers: [String]
        public let lock: String?
        public let retire: String?

        public init(mint: String? = nil, transfers: [String] = [], lock: String? = nil, retire: String? = nil) {
            self.mint = mint
            self.transfers = transfers
            self.lock = lock
            self.retire = retire
        }
    }

    public let assetId: String
    public let sourceAsset: String
    public let physicalId: String
    public let title: String
    public let titleLocalized: LocalizedTitle?
    public let imageUrl: String?
    public let rehearsal: Bool?
    public let redeemedAt: String
    public let lastVerifiedAt: String
    public let lastVerifiedCondition: String
    public let custodyAtExit: String
    public let provenance: [ProvenanceEvent]
    public let onchain: Onchain
    public let limitations: [String]
    public let xrConditions: String
    public let dryRun: Bool?
    public let network: String

    public init(
        assetId: String, sourceAsset: String, physicalId: String, title: String, titleLocalized: LocalizedTitle? = nil,
        imageUrl: String? = nil, rehearsal: Bool? = nil, redeemedAt: String, lastVerifiedAt: String,
        lastVerifiedCondition: String, custodyAtExit: String, provenance: [ProvenanceEvent] = [],
        onchain: Onchain = Onchain(), limitations: [String], xrConditions: String, dryRun: Bool? = true, network: String = "devnet"
    ) {
        self.assetId = assetId
        self.sourceAsset = sourceAsset
        self.physicalId = physicalId
        self.title = title
        self.titleLocalized = titleLocalized
        self.imageUrl = imageUrl
        self.rehearsal = rehearsal
        self.redeemedAt = redeemedAt
        self.lastVerifiedAt = lastVerifiedAt
        self.lastVerifiedCondition = lastVerifiedCondition
        self.custodyAtExit = custodyAtExit
        self.provenance = provenance
        self.onchain = onchain
        self.limitations = limitations
        self.xrConditions = xrConditions
        self.dryRun = dryRun
        self.network = network
    }
}
