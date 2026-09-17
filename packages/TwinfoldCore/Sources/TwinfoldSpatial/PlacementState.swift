import Foundation

/// Visual state of a placed `AssetCardEntity`. Maps to the
/// pending/confirmed/failed provenance status described in
/// docs/architecture.md section 8.
public enum PlacementState: String, Sendable {
    case pending
    case confirmed
    case failed
}
