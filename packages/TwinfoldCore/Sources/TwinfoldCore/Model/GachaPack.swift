import Foundation

// Collectibles AR Pull feed. Mirrors the `GET /api/gacha/packs` response of apps/web (app/api/gacha/packs/route.ts,
// lib/gacha/packFeed.ts). The Web finishes the Pull (Phantom signs there); the linked iPhone only polls this feed and
// shows the card that came out. Nothing here signs or pays.

/// Pull state in the feed. An unknown value from a newer server decodes to `.unknown` (never silently dropped as
/// "opened"), per core-contract.
public enum GachaPackState: String, Codable, Sendable, Equatable {
    case generated
    case submitted
    case opened
    case failed
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = GachaPackState(rawValue: raw) ?? .unknown
    }
}

/// One Pull record. `asset` is the card `/api/gacha/open` returned for `memo` (only when `state == .opened`).
/// Dates are ISO 8601 strings as sent; use `openedDate` / `createdDate` to compare.
public struct GachaPackRecord: Codable, Sendable, Equatable, Identifiable {
    public let memo: String
    public let packType: String
    public let state: GachaPackState
    public let createdAt: String
    public let openedAt: String?
    public let nftAddress: String?
    public let asset: TwinfoldAsset?

    public var id: String { memo }

    public init(
        memo: String,
        packType: String,
        state: GachaPackState,
        createdAt: String,
        openedAt: String? = nil,
        nftAddress: String? = nil,
        asset: TwinfoldAsset? = nil
    ) {
        self.memo = memo
        self.packType = packType
        self.state = state
        self.createdAt = createdAt
        self.openedAt = openedAt
        self.nftAddress = nftAddress
        self.asset = asset
    }

    public var createdDate: Date? { GachaDates.parse(createdAt) }
    public var openedDate: Date? { openedAt.flatMap(GachaDates.parse) }
}

/// `GET /api/gacha/packs` body: the signed-in wallet's own Pull records, newest `openedAt` first, at most 20.
public struct GachaPacksResponse: Codable, Sendable, Equatable {
    public let wallet: String
    public let packs: [GachaPackRecord]

    public init(wallet: String, packs: [GachaPackRecord]) {
        self.wallet = wallet
        self.packs = packs
    }
}

public enum GachaDates {
    /// Parses `2026-10-06T14:30:00.000Z` and `2026-10-06T14:30:00Z`.
    public static func parse(_ string: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: string) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: string)
    }

    /// The `since` query value: UTC with milliseconds, e.g. `2026-10-06T14:30:00.000Z` (no `+`, so no escaping trouble).
    public static func format(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

/// Decides which feed records are new Appear candidates. Pure, so it can be tested without a network.
public enum GachaPackDiff {
    /// Records that are `opened`, carry a card, were not shown before (`shown` holds memos) and, when `since` is
    /// given, were opened at or after it. Oldest `openedAt` first, so several Pulls Appear in the order they came
    /// out. A record with no card yet (the Web has not attached it) is NOT returned and must not be marked shown:
    /// the next poll sees it again. Duplicate memos in one response are returned once.
    public static func newlyOpened(
        _ packs: [GachaPackRecord],
        shown: Set<String>,
        since: Date? = nil
    ) -> [GachaPackRecord] {
        var seen = Set<String>()
        var result: [GachaPackRecord] = []
        for pack in packs {
            guard pack.state == .opened, pack.asset != nil else { continue }
            guard !shown.contains(pack.memo), seen.insert(pack.memo).inserted else { continue }
            if let since, let opened = pack.openedDate, opened < since { continue }
            result.append(pack)
        }
        return result.sorted { ($0.openedDate ?? .distantPast) < ($1.openedDate ?? .distantPast) }
    }
}

/// Remembers which Pull memos already Appeared, so one memo Appears once (also across app launches). Backed by
/// `UserDefaults`; the memo is not a secret. Keeps the most recent `limit` memos.
public struct ShownPackMemos {
    public static let defaultKey = "twinfold.shownPackMemos"

    private let defaults: UserDefaults
    private let key: String
    private let limit: Int

    public init(defaults: UserDefaults = .standard, key: String = ShownPackMemos.defaultKey, limit: Int = 200) {
        self.defaults = defaults
        self.key = key
        self.limit = limit
    }

    public var all: [String] { defaults.stringArray(forKey: key) ?? [] }
    public var set: Set<String> { Set(all) }

    public func contains(_ memo: String) -> Bool { all.contains(memo) }

    public func insert(_ memo: String) {
        var memos = all
        guard !memos.contains(memo) else { return }
        memos.append(memo)
        if memos.count > limit { memos.removeFirst(memos.count - limit) }
        defaults.set(memos, forKey: key)
    }
}
