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

/// Spatial表現の種別。`apps/web/lib/contract.ts`の`SpatialRepresentation`の写し。
/// `.card`は既存の画像付きカード（`AssetCardEntity`）、`.model`は実寸USDZ
/// twin（`resource`はPackageのResources/models配下のファイル名。例:
/// "kokeshi_demo.usdz"）。JSONは`{"kind":"card"}`または
/// `{"kind":"model","resource":"..."}`の形（discriminated union）。未知の
/// `kind`はdecode失敗として明示的にthrowする（黙って読み飛ばさない）。
public enum SpatialRepresentation: Codable, Sendable, Equatable {
    case card
    case model(resource: String)

    private enum CodingKeys: String, CodingKey {
        case kind
        case resource
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        switch kind {
        case "card":
            self = .card
        case "model":
            let resource = try container.decode(String.self, forKey: .resource)
            self = .model(resource: resource)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .kind,
                in: container,
                debugDescription: "Unknown SpatialRepresentation.kind: \(kind)"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .card:
            try container.encode("card", forKey: .kind)
        case .model(let resource):
            try container.encode("model", forKey: .kind)
            try container.encode(resource, forKey: .resource)
        }
    }
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

    /// Real-world outer dimensions of a framed `card` asset, so
    /// `AssetCardEntity` can build the RealityKit mesh at true scale for
    /// wall placement. Mirrors `PhysicalDescriptor["dimensions"]` in
    /// `apps/web/lib/contract.ts`. `model` (USDZ twin) assets don't carry
    /// this — the scan itself is already real-world scale.
    public struct Dimensions: Codable, Sendable, Equatable {
        public let widthCm: Double
        public let heightCm: Double
        public let depthCm: Double?
        public let label: String

        public init(widthCm: Double, heightCm: Double, depthCm: Double? = nil, label: String) {
            self.widthCm = widthCm
            self.heightCm = heightCm
            self.depthCm = depthCm
            self.label = label
        }
    }

    public let physicalId: String
    public let condition: String
    public let rights: String
    public let custody: Custody
    public let lastVerifiedAt: String
    public let dimensions: Dimensions?

    public init(
        physicalId: String,
        condition: String,
        rights: String,
        custody: Custody,
        lastVerifiedAt: String,
        dimensions: Dimensions? = nil
    ) {
        self.physicalId = physicalId
        self.condition = condition
        self.rights = rights
        self.custody = custody
        self.lastVerifiedAt = lastVerifiedAt
        self.dimensions = dimensions
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
    public let spatialRepresentation: SpatialRepresentation
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
        spatialRepresentation: SpatialRepresentation,
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
        self.spatialRepresentation = spatialRepresentation
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
