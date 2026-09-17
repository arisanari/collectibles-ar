import Foundation

// Swift copy of the Twinfold common model. This file mirrors
// `apps/web/lib/contract.ts`, which is the source of truth described in
// docs/architecture.md section 4-5. Field names and JSON keys must match
// exactly. Do not diverge from the TypeScript contract; update there first.

public enum ProvenanceKind: String, Codable, Sendable {
    case minted
    case transferred
    case rwaVerified = "rwa_verified"
    case vaulted
    case redeemed
}

public enum ProvenanceSource: String, Codable, Sendable {
    case onchain
    case offchainEvidence = "offchain_evidence"
    case twinfoldInterpretation = "twinfold_interpretation"
}

public enum ProvenanceStatus: String, Codable, Sendable {
    case pending
    case confirmed
    case failed
}

public struct DisplayDescriptor: Codable, Sendable, Equatable {
    public let kind: String
    public let imageUrl: String
    public let placeholder: Bool
    public let rightsNote: String

    public init(kind: String, imageUrl: String, placeholder: Bool, rightsNote: String) {
        self.kind = kind
        self.imageUrl = imageUrl
        self.placeholder = placeholder
        self.rightsNote = rightsNote
    }
}

public struct PhysicalDescriptor: Codable, Sendable, Equatable {
    public struct Custody: Codable, Sendable, Equatable {
        public let vault: String
        public let status: String // "vaulted" | "released" | "exception"

        public init(vault: String, status: String) {
            self.vault = vault
            self.status = status
        }
    }

    public let physicalId: String
    public let condition: String
    public let rights: String
    public let custody: Custody
    public let lastVerifiedAt: String

    public init(
        physicalId: String,
        condition: String,
        rights: String,
        custody: Custody,
        lastVerifiedAt: String
    ) {
        self.physicalId = physicalId
        self.condition = condition
        self.rights = rights
        self.custody = custody
        self.lastVerifiedAt = lastVerifiedAt
    }
}

public struct ProvenanceEvent: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let assetId: String
    public let kind: ProvenanceKind
    public let occurredAt: String
    public let source: ProvenanceSource
    public let status: ProvenanceStatus
    public let transaction: String?
    public let slot: Int?
    public let evidenceHash: String?
    public let metadata: [String: JSONValue]

    public init(
        id: String,
        assetId: String,
        kind: ProvenanceKind,
        occurredAt: String,
        source: ProvenanceSource,
        status: ProvenanceStatus,
        transaction: String? = nil,
        slot: Int? = nil,
        evidenceHash: String? = nil,
        metadata: [String: JSONValue] = [:]
    ) {
        self.id = id
        self.assetId = assetId
        self.kind = kind
        self.occurredAt = occurredAt
        self.source = source
        self.status = status
        self.transaction = transaction
        self.slot = slot
        self.evidenceHash = evidenceHash
        self.metadata = metadata
    }
}

public struct TwinfoldAsset: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let network: String // "devnet"
    public let address: String
    public let standard: String
    public let owner: String?
    public let title: String
    public let display: DisplayDescriptor
    public let provenance: [ProvenanceEvent]
    public let physical: PhysicalDescriptor?

    public init(
        id: String,
        network: String,
        address: String,
        standard: String,
        owner: String?,
        title: String,
        display: DisplayDescriptor,
        provenance: [ProvenanceEvent],
        physical: PhysicalDescriptor? = nil
    ) {
        self.id = id
        self.network = network
        self.address = address
        self.standard = standard
        self.owner = owner
        self.title = title
        self.display = display
        self.provenance = provenance
        self.physical = physical
    }
}

public struct Entitlement: Codable, Sendable, Equatable {
    public let wallet: String
    public let assetId: String
    public let canDisplay: Bool
    public let reason: String
    public let checkedAt: String

    public init(wallet: String, assetId: String, canDisplay: Bool, reason: String, checkedAt: String) {
        self.wallet = wallet
        self.assetId = assetId
        self.canDisplay = canDisplay
        self.reason = reason
        self.checkedAt = checkedAt
    }
}

public struct RedeemedProvenancePassport: Codable, Sendable, Equatable {
    public let sourceAsset: String
    public let redeemedAt: String
    public let lastVerifiedAt: String
    public let limitations: [String]

    public init(sourceAsset: String, redeemedAt: String, lastVerifiedAt: String, limitations: [String]) {
        self.sourceAsset = sourceAsset
        self.redeemedAt = redeemedAt
        self.lastVerifiedAt = lastVerifiedAt
        self.limitations = limitations
    }
}
