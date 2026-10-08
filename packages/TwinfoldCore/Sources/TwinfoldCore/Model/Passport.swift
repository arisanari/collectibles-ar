import Foundation

// Collectibles AR Passport helpers: links and display facts for the three-way split (onchain fact / third-party claims /
// Collectibles AR interpretation). Pure functions, no UI strings, so the SwiftUI panel (apps/ios PassportPanelView) stays
// thin and these stay testable. Nothing here verifies a claim.

public enum PassportLinks {
    /// Collector Crypt's VRF selection check page. The devnet host is used for Pulls made in the app. The Web agent
    /// confirms the real URL; this is the single place to change it.
    public static let vrfVerifyBase = "https://dev-gacha.collectorcrypt.com/verify-selection/"
    public static let psaCertBase = "https://www.psacard.com/cert/"
    public static let explorerBase = "https://explorer.solana.com"

    /// Explorer link for a mint / wallet. `network` is "devnet" or "mainnet" (mainnet has no cluster query). `nil` for
    /// anything that is not a real base58 address (fixture `DEMO-...` values), so DEMO DATA never links out.
    public static func explorerAddress(_ address: String, network: String) -> URL? {
        guard isBase58Identifier(address) else { return nil }
        return URL(string: "\(explorerBase)/address/\(address)\(clusterQuery(network))")
    }

    public static func explorerTransaction(_ signature: String, network: String) -> URL? {
        guard isBase58Identifier(signature) else { return nil }
        return URL(string: "\(explorerBase)/tx/\(signature)\(clusterQuery(network))")
    }

    /// PSA certificate verification page. Only for company "PSA" and a purely numeric certificate number.
    public static func psaCert(company: String?, gradingId: String?) -> URL? {
        guard let company, company.trimmingCharacters(in: .whitespaces).uppercased() == "PSA",
              let id = gradingId?.trimmingCharacters(in: .whitespaces),
              !id.isEmpty, id.allSatisfy(\.isASCII), id.allSatisfy(\.isNumber) else { return nil }
        return URL(string: psaCertBase + id)
    }

    /// VRF verification page for a Pull memo. The memo is percent-encoded as a path segment.
    public static func vrfVerify(memo: String?) -> URL? {
        guard let memo, !memo.isEmpty,
              let encoded = memo.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) else { return nil }
        return URL(string: vrfVerifyBase + encoded)
    }

    /// Base58 (no 0, O, I, l), 32...90 characters: shape of a Solana address or transaction signature.
    public static func isBase58Identifier(_ value: String) -> Bool {
        guard (32...90).contains(value.count) else { return false }
        let alphabet = Set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
        return value.allSatisfy { alphabet.contains($0) }
    }

    private static func clusterQuery(_ network: String) -> String {
        network == "mainnet" ? "" : "?cluster=devnet"
    }
}

public extension TwinfoldAsset {
    /// A graded card (`category == "card"`): shown as a slab, with a Passport.
    var isGradedCard: Bool { category == "card" }

    /// The newest onchain provenance event that carries a transaction signature (confirmed ones win over pending),
    /// i.e. how the current owner got the card. `nil` if the record has none.
    var acquisitionEvent: ProvenanceEvent? {
        let candidates = provenance.filter { $0.source == .onchain && ($0.transaction?.isEmpty == false) }
        let confirmed = candidates.filter { $0.status == .confirmed }
        let pool = confirmed.isEmpty ? candidates : confirmed
        return pool.max { $0.occurredAt < $1.occurredAt }
    }

    /// "$487.50" style text for `insuredValueUsd` (a third-party claim, shown as given). `nil` when absent.
    var insuredValueDisplay: String? {
        guard let value = insuredValueUsd else { return nil }
        let formatted = value.formatted(.number.precision(.fractionLength(0...2)).grouping(.automatic))
        return "$\(formatted) USD"
    }

    /// `true` when the card fields come from a fixture (address is not a real chain address).
    var isDemoChainData: Bool { !PassportLinks.isBase58Identifier(address) }
}
