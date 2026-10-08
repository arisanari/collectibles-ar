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
        public let status: String // "vaulted" | "released" | "exception" | "pending_intake"

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

/// Off-chain Twinfold interpretation, not an onchain fact: Twinfold's own
/// listed price for this Asset and the buyback terms derived from it.
/// Mirrors `Commerce` in `apps/web/lib/contract.ts`. `twinfoldPrice` values
/// in fixtures/demo/assets.json are DEMO PLACEHOLDERS (see `priceNote`), not
/// real listed prices. `buybackEligible` is a snapshot computed when the
/// record was materialized; callers needing a live answer should call
/// `AssetProvider`'s buyback quote instead of trusting this field alone.
public struct Commerce: Codable, Sendable, Equatable {
    public struct Price: Codable, Sendable, Equatable {
        public let amount: Double
        public let currency: String // "USDC" (display unit; no payment on devnet)

        public init(amount: Double, currency: String) {
            self.amount = amount
            self.currency = currency
        }
    }

    public let twinfoldPrice: Price
    public let buybackRate: Double
    public let buybackEligible: Bool
    public let priceNote: String?

    public init(twinfoldPrice: Price, buybackRate: Double, buybackEligible: Bool, priceNote: String? = nil) {
        self.twinfoldPrice = twinfoldPrice
        self.buybackRate = buybackRate
        self.buybackEligible = buybackEligible
        self.priceNote = priceNote
    }
}

public struct LocalizedTitle: Codable, Sendable, Equatable {
    public let ja: String?
    public let en: String?

    public init(ja: String? = nil, en: String? = nil) {
        self.ja = ja
        self.en = en
    }
}

public struct TwinfoldAsset: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let network: String // "devnet" | "mainnet" (mainnet = read-only display, no Pull/buyback/transfer in the app)
    public let address: String
    public let standard: String
    public let owner: String?
    public let title: String
    /// Twinfold off-chain record. `title` stays the on-chain name for Devnet.
    public let titleLocalized: LocalizedTitle?
    public let display: DisplayDescriptor
    public let spatialRepresentation: SpatialRepresentation
    public let provenance: [ProvenanceEvent]
    public let physical: PhysicalDescriptor?
    public let commerce: Commerce?
    // ---- Graded card assets (Collectibles AR). Mirrors the card fields of `TwinfoldAsset` in apps/web/lib/contract.ts.
    // All optional so the dormant ukiyo-e / kokeshi fixtures still decode. `grade` ... `vaultId` are THIRD-PARTY
    // claims (PSA grade, Collector Crypt insured value / Vault record) copied from NFT metadata, not onchain facts.
    /// "card" for graded card assets.
    public let category: String?
    /// attribute "The Grade", e.g. "GEM-MT 10".
    public let grade: String?
    /// attribute "Grading Company", e.g. "PSA".
    public let gradingCompany: String?
    /// attribute "Grading ID" (certificate number).
    public let gradingId: String?
    /// attribute "Insured Value" in USD; only present when it parsed as a number.
    public let insuredValueUsd: Double?
    /// attribute "Vault", e.g. "PSA Vault", "OmniVault".
    public let vault: String?
    /// attribute "Vault ID".
    public let vaultId: String?
    /// "collectorCrypt" when the asset was recognized as Collector Crypt issued.
    public let source: String?
    /// `true` = `source` is "collectorCrypt" (the card came out of our openPack call, or its collection is a configured
    /// Collector Crypt collection). `false` = listed as a card by metadata shape only: clients show `UNVERIFIED SOURCE`.
    /// `nil` = the server did not evaluate it (dormant fixtures, assets not from the card list).
    public let sourceVerified: Bool?
    /// Collector Crypt Pull memo; only for assets opened through the Pull flow.
    public let gachaMemo: String?
    /// Image URL from the NFT metadata, read at runtime (never bundled). `display.imageUrl` carries the same URL.
    public let imageUrl: String?
    /// Rehearsal token for the redeem dry run (id `<baseId>-rehearsal-<n>`): same physical item as the base
    /// Asset, NOT an additional claim and NOT a Reference Asset. Clients show a REHEARSAL badge.
    public let rehearsal: Bool?
    /// Redemption state overlaid by the backend. While `open` is true, clients offer neither buyback nor send.
    public let redemption: RedemptionSummary?

    public init(
        id: String,
        network: String,
        address: String,
        standard: String,
        owner: String?,
        title: String,
        titleLocalized: LocalizedTitle? = nil,
        display: DisplayDescriptor,
        spatialRepresentation: SpatialRepresentation,
        provenance: [ProvenanceEvent],
        physical: PhysicalDescriptor? = nil,
        commerce: Commerce? = nil,
        category: String? = nil,
        grade: String? = nil,
        gradingCompany: String? = nil,
        gradingId: String? = nil,
        insuredValueUsd: Double? = nil,
        vault: String? = nil,
        vaultId: String? = nil,
        source: String? = nil,
        sourceVerified: Bool? = nil,
        gachaMemo: String? = nil,
        imageUrl: String? = nil,
        rehearsal: Bool? = nil,
        redemption: RedemptionSummary? = nil
    ) {
        self.id = id
        self.network = network
        self.address = address
        self.standard = standard
        self.owner = owner
        self.title = title
        self.titleLocalized = titleLocalized
        self.display = display
        self.spatialRepresentation = spatialRepresentation
        self.provenance = provenance
        self.physical = physical
        self.commerce = commerce
        self.category = category
        self.grade = grade
        self.gradingCompany = gradingCompany
        self.gradingId = gradingId
        self.insuredValueUsd = insuredValueUsd
        self.vault = vault
        self.vaultId = vaultId
        self.source = source
        self.sourceVerified = sourceVerified
        self.gachaMemo = gachaMemo
        self.imageUrl = imageUrl
        self.rehearsal = rehearsal
        self.redemption = redemption
    }

    /// ja if the locale's language is Japanese and a ja title exists, else en
    /// if it exists, else `title`.
    public func displayTitle(for locale: Locale = .current) -> String {
        let isJa = locale.language.languageCode?.identifier == "ja"
        if isJa, let ja = titleLocalized?.ja, !ja.isEmpty { return ja }
        if let en = titleLocalized?.en, !en.isEmpty { return en }
        return title
    }
}

/// `GET /api/solana/assets/{id}/buyback-quote?wallet=...` response. Mirrors
/// `BuybackQuote` in `apps/web/lib/contract.ts`. A quote is a snapshot with
/// an expiry, not a binding price.
public struct BuybackQuote: Codable, Sendable, Equatable {
    public struct Basis: Codable, Sendable, Equatable {
        public let amount: Double
        public let currency: String

        public init(amount: Double, currency: String) {
            self.amount = amount
            self.currency = currency
        }
    }

    public let assetId: String
    public let basis: Basis
    public let rate: Double
    public let offerAmount: Double
    public let currency: String
    public let eligible: Bool
    public let reason: String
    public let quoteId: String
    public let expiresAt: String

    public init(
        assetId: String,
        basis: Basis,
        rate: Double,
        offerAmount: Double,
        currency: String,
        eligible: Bool,
        reason: String,
        quoteId: String,
        expiresAt: String
    ) {
        self.assetId = assetId
        self.basis = basis
        self.rate = rate
        self.offerAmount = offerAmount
        self.currency = currency
        self.eligible = eligible
        self.reason = reason
        self.quoteId = quoteId
        self.expiresAt = expiresAt
    }
}

public enum DevnetTransferStatus: String, Codable, Sendable {
    case pending
    case confirmed
    case failed
}

/// `POST /api/devnet/transfer` and `GET /api/devnet/transfer/{requestId}`
/// response. Mirrors `DevnetTransferResult` in `apps/web/lib/contract.ts`.
public struct DevnetTransferResult: Codable, Sendable, Equatable {
    public let requestId: String
    public let assetId: String
    public let status: DevnetTransferStatus
    public let signature: String?
    public let error: String?

    public init(requestId: String, assetId: String, status: DevnetTransferStatus, signature: String? = nil, error: String? = nil) {
        self.requestId = requestId
        self.assetId = assetId
        self.status = status
        self.signature = signature
        self.error = error
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
