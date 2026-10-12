import ARKit
import Foundation
import Observation
import RealityKit
import TwinfoldCore
import TwinfoldSpatial

/// One of the demo (fixtures/demo/wallets.json) or devnet public keys this
/// app can act as. Hardcoded here (not loaded from the fixture bundle) to
/// avoid exposing wallets.json through TwinfoldCore's public API. Keep in
/// sync with the JSON file / Issue #14's devnet test wallets by hand per
/// docs/architecture.md section 5 (core-contract skill). Only the *public*
/// key is ever hardcoded — no secret key material lives in this repo.
struct DemoWallet: Identifiable, Hashable {
    let id: String // wallet address
    let label: String

    /// Owner of the three self-made demo cards (`fixtures/demo/wallets.json` walletC). The default Demo room.
    static let cardCollectorDemo = DemoWallet(id: MockAssetProvider.cardCollectorWallet, label: "Card collector (demo)")
    /// Placeholder room for Mainnet (read-only) while no Web wallet is linked: there is nothing to read yet.
    static let noWallet = DemoWallet(id: "", label: "Not linked")
    static let ownerA = DemoWallet(id: "DEMOwalletA1111111111111111111111111111111", label: "Owner A (demo)")
    static let ownerB = DemoWallet(id: "DEMOwalletB2222222222222222222222222222222", label: "Owner B (demo)")
    static let all: [DemoWallet] = [cardCollectorDemo, ownerA, ownerB]

    /// devnet owner-a / owner-b public keys (Issue #14). Devnet mode's
    /// wallet switch uses these instead of the DEMOwallet* pairs above.
    static let ownerADevnet = DemoWallet(id: "21hni5fvVgWm1NVAUBkki5ogTVweYsB7G9uVab9xTLWZ", label: "Owner A (devnet)")
    static let ownerBDevnet = DemoWallet(id: "6PWqBp82LwA15yrthuN83qJowaqNCmYBMWK5nUNJBLcn", label: "Owner B (devnet)")
    static let allDevnet: [DemoWallet] = [ownerADevnet, ownerBDevnet]

    static func wallets(for mode: DataMode) -> [DemoWallet] {
        switch mode {
        case .demo: return all
        case .devnet: return allDevnet
        case .mainnet: return [] // only the linked Web wallet (see `RoomController.walletOptions`)
        }
    }

    static func label(forWallet wallet: String) -> String {
        if wallet == MockAssetProvider.vaultWallet || wallet == "vault" {
            return "Twinfold Vault (legacy demo)"
        }
        return (all + allDevnet).first(where: { $0.id == wallet })?.label ?? wallet
    }

    /// The devnet server-signing shortcut's wallet label ("owner-a" /
    /// "owner-b") for this demo/devnet wallet, used by
    /// `SolanaAssetProvider.devnetTransfer(from:to:)`. Not meaningful for
    /// "vault" (Twinfold has no `DemoWallet` — it's addressed directly by
    /// the "vault" label).
    var devnetLabel: String {
        if id == DemoWallet.ownerA.id || id == DemoWallet.ownerADevnet.id { return "owner-a" }
        if id == DemoWallet.ownerB.id || id == DemoWallet.ownerBDevnet.id { return "owner-b" }
        // A linked Web wallet that is not a devnet test wallet: the server
        // rejects this (403, needs Phantom signing) before reading the label.
        return "linked"
    }

    /// "4abc...wxyz" for display.
    var shortAddress: String {
        id.count > 10 ? "\(id.prefix(4))...\(id.suffix(4))" : id
    }
}

/// Which `AssetProvider` backs the room: bundled fixture (always available)
/// or the Twinfold API's devnet-backed routes (may fail if the API isn't
/// reachable — see `RoomController.loadErrorMessage`). Mirrors
/// `AssetProvider.isDemoData`'s DEMO DATA / DEVNET label split.
enum DataMode: String, CaseIterable, Identifiable, Sendable {
    case demo
    case devnet
    /// READ-ONLY: the linked wallet's real Collector Crypt cards, shown and placed, never operated on.
    case mainnet

    var id: String { rawValue }
    var label: String {
        switch self {
        case .demo: return "Demo data"
        case .devnet: return "Devnet"
        case .mainnet: return "Mainnet (read-only)"
        }
    }
    /// The always-visible data-source badge text.
    var badge: String {
        switch self {
        case .demo: return "DEMO DATA"
        case .devnet: return "DEVNET"
        case .mainnet: return "MAINNET (read-only)"
        }
    }
    var isReadOnly: Bool { self == .mainnet }
}

enum TransferState: Sendable, Equatable {
    case idle
    case pending
    case confirmed
    case failed
}

/// Which operation a pending/failed `TransferState` belongs to, so "Retry"
/// re-attempts the right thing (P2P send vs. "Twinfoldに売る" buyback)
/// instead of always assuming a P2P send.
enum TransferOperationKind: Sendable {
    case send
    case buyback
}

/// Shown after a transfer confirms, offering a shortcut to switch to the
/// receiving wallet so the Appear can be observed immediately.
struct TransferToast: Identifiable {
    let id = UUID()
    let assetTitle: String
    let destinationWallet: String
    /// Set only for a "Twinfoldに売る" buyback: the offer amount shown in the
    /// sheet (display only — no payment happens in Demo or Devnet mode).
    var buybackOfferText: String? = nil
    var destinationLabel: String { DemoWallet.label(forWallet: destinationWallet) }
    /// True for a "Twinfoldに売る" buyback: there's no "相手の部屋を見る"
    /// shortcut for Twinfold's vault (it isn't one of this app's demo
    /// wallets), so `RoomOverlayView` hides that button.
    var isVaultDestination: Bool { destinationWallet == MockAssetProvider.vaultWallet }
}

/// Everything materialized in the scene for one placed asset. Present only
/// while that asset is both placed (has a `PlacementCoord`) and owned by
/// `activeWallet` — `syncEntities()` adds/removes these as ownership or
/// wallet changes.
private struct LiveEntity {
    var anchor: AnchorEntity
    /// ARKit anchor registered with the session (nil in the simulator fallback). ARKit corrects its pose on map
    /// relocalization, which keeps the entity from drifting.
    var arAnchor: ARAnchor?
    var cardEntity: Entity
    var provenanceColumn: Entity?
    var twinFootprint: (width: Float, height: Float)?
}

/// Session-only placement (world transform + how it was placed) for one
/// asset. Kept independently of `LiveEntity`/wallet: placement is a
/// property of the room, not of who currently owns the asset, so a
/// transferred asset reappears at the same spot once its new owner's
/// wallet is active.
private struct PlacementCoord {
    var transform: simd_float4x4
    var isWallPlacement: Bool
    var isFloorPlacement: Bool
    /// Wall: the card's real-world height (for top-edge snapping). Floor
    /// twin: the settled footprint height. Unused for an air placement.
    var footprintHeight: Float
    /// How a graded slab (`category == "card"`) is posed: flat on a wall (also used for an upright air placement) or
    /// standing on a desk or floor. Ignored for other representations.
    var slabSurface: SlabSurface = .wall
}

/// Owns placement, selection, holding-preview and simulated-transfer state
/// for every asset in "My Room" (multiple assets at once, replacing the
/// old one-asset-per-screen `ARSceneController`). `ARContainerView` drives
/// this from ARKit tap/per-frame events; this type only touches RealityKit
/// entities, the `TwinfoldSpatial` factories, and
/// `ARWorldTrackingConfiguration.isSupported` for the simulator fallback.
/// Repositioning an already-placed asset is "外す" (remove) + re-place from
/// the tray — there's no drag/move mode, since the holding preview already
/// makes picking a new spot easy.
@MainActor
@Observable
final class RoomController {
    private let mockProvider: MockAssetProvider
    private let devnetProvider: SolanaAssetProvider
    private(set) var dataMode: DataMode = .demo
    /// The currently-active `AssetProvider` for `dataMode`. Read-only from
    /// the outside (screens/tests use this, never `mockProvider`/
    /// `devnetProvider` directly) so `isDemoData`-driven UI (DEMO
    /// DATA/DEVNET badges, transfer disabling) always matches `dataMode`.
    var provider: any AssetProvider { dataMode == .demo ? mockProvider : devnetProvider }
    let isARSupported = ARWorldTrackingConfiguration.isSupported

    weak var arView: ARView?

    private(set) var activeWallet: DemoWallet = .cardCollectorDemo
    /// Assets `provider.getAssets(activeWallet)` currently returns. The
    /// tray lists these; only these (intersected with placement) ever get
    /// a live entity in the scene.
    private(set) var ownedAssets: [TwinfoldAsset] = []
    private(set) var loadErrorMessage: String?

    private(set) var holdingAssetId: String?
    private(set) var selectedAssetId: String?
    private(set) var transferStates: [String: TransferState] = [:]
    private var transferOperationKinds: [String: TransferOperationKind] = [:]
    private(set) var toast: TransferToast?

    /// The asset a "Twinfoldに売る" offer sheet is currently showing for,
    /// if any. `buybackQuote`/`buybackQuoteError`/`buybackQuoteLoading`
    /// describe that fetch's state; `RoomOverlayView` reads these to render
    /// the sheet.
    private(set) var buybackAssetId: String?
    private(set) var buybackQuote: BuybackQuote?
    private(set) var buybackQuoteError: String?
    private(set) var buybackQuoteLoading = false
    /// Offer amount confirmed per asset, kept until the sale's toast shows it.
    private var buybackOfferTexts: [String: String] = [:]
    /// `true` once the current frame's raycast (during holding) found a
    /// matching wall/surface for the held asset's representation. Drives
    /// `hintText`'s "壁に向けてください" vs "タップして壁に掛ける" (and the
    /// floor/desk equivalents).
    private(set) var isPreviewDetected = false

    private var placementCoords: [String: PlacementCoord] = [:]
    private var liveEntities: [String: LiveEntity] = [:]
    /// Graded cards shown out of their holder ("ケースから出す": the card alone, 63 x 88 mm). Session-only, like
    /// `placementCoords`; the default for every card is the slab in its holder.
    private(set) var cardOnlyAssetIds: Set<String> = []

    func isCardOnly(_ assetId: String) -> Bool { cardOnlyAssetIds.contains(assetId) }

    // MARK: Appear (Pull feed), Disappear (ownership refresh), Passport state

    /// Cards that came in through Appear, kept while DAS may still lag (see `mergeAppeared`).
    private var appearedAssets: [String: (asset: TwinfoldAsset, at: Date)] = [:]
    private static let appearGrace: TimeInterval = 120
    /// When `ownedAssets` was last read successfully (shown in the Passport as the fetch time).
    private(set) var lastFetchedAt: Date?
    /// The asset whose Passport sheet is open.
    var passportAssetId: String?

    private struct PendingAppear {
        let memo: String
        let asset: TwinfoldAsset
        let deadline: Date
    }
    /// Opened Pulls waiting for a plane under the screen center (or the fallback after `appearWaitForPlane`).
    private var pendingAppears: [PendingAppear] = []
    private static let appearWaitForPlane: TimeInterval = 6
    private let shownMemos = ShownPackMemos()
    /// `since` for the pack feed: fixed for the session (start - 10 minutes); the server keeps records changed at or
    /// after it, the memo set dedupes, so a late-opened older Pull still comes through.
    private var packFeedSince: Date?
    private static let packFeedLookback: TimeInterval = 10 * 60
    private static let packPollInterval: TimeInterval = 3
    private static let ownershipRefreshInterval: TimeInterval = 30
    private var isRoomActive = false
    private var packPollTask: Task<Void, Never>?
    private var ownershipRefreshTask: Task<Void, Never>?

    private var previewAnchor: AnchorEntity?
    /// The held asset's entity under `previewAnchor` (a slab is re-posed on it every frame: wall vs. standing).
    private var previewEntity: Entity?
    private var pendingPreviewTransform: simd_float4x4?
    private var pendingPreviewIsWall = false
    /// Hysteresis for the slab preview's wall/horizontal decision: the raycast classification wobbles frame to frame
    /// while the phone is held, so a change is adopted only after `previewSurfaceSwitchFrames` consecutive frames.
    private var previewSurfaceCandidate: Bool?
    private var previewSurfaceCandidateFrames = 0
    private var previewSurfaceSettled = false
    private static let previewSurfaceSwitchFrames = 8
    private var pendingPreviewCardHeight: Float = 0
    private var pendingPreviewSlabSurface: SlabSurface = .wall

    /// Data-source badge text for the current mode: `DEMO DATA`, `DEVNET` or `MAINNET (read-only)`.
    var networkBadge: String { dataMode.badge }
    /// Mainnet is display and Place only: no Pull, buyback, transfer or redeem UI is offered.
    var isReadOnlyMode: Bool { dataMode.isReadOnly }

    private static let placementDistance: Float = 0.4
    /// Top-edge height difference (meters) below which a newly-placed wall
    /// card snaps flush with an already-placed one.
    private static let wallSnapTolerance: Float = 0.03

    // MARK: - Web wallet link (Issue #45)

    /// Owns the Keychain-held device token. Shared with `devnetProvider`,
    /// which sends it as `Authorization: Bearer` on transfer/status calls.
    private let sessionLink: SessionLinkClient
    /// Non-nil while a device session issued by the Web (one-time link code)
    /// is held. Owner-only operations (送る / Twinfoldに売る) in Devnet mode are
    /// enabled only when the active room is this wallet.
    private(set) var linkedSession: LinkedSession?
    /// One-shot banner after the link is dropped (401 / 解除).
    private(set) var linkNotice: String?
    private(set) var isLinking = false
    private(set) var linkErrorMessage: String?
    /// Presented by the ⋯ menu or by a `twinfold://link?code=` URL.
    var showsLinkSheet = false
    /// Code from a `twinfold://link` URL, consumed (prefilled, never auto-submitted) by the sheet.
    var pendingLinkCode: String?

    static let linkRequiredMessage = "This action requires linking your wallet on the Web"
    private static let linkedRoomLabel = "Your wallet"

    /// Public URL of the Web app, opened by the 「Phantomで連携」 button (`TWINFOLD_WEB_URL`).
    let webBaseURL: URL

    init(mockProvider: MockAssetProvider, devnetProvider: SolanaAssetProvider, sessionLink: SessionLinkClient, webBaseURL: URL) {
        self.webBaseURL = webBaseURL
        self.mockProvider = mockProvider
        self.devnetProvider = devnetProvider
        self.sessionLink = sessionLink
        self.linkedSession = sessionLink.current
    }

    /// The linked Web wallet as a room ("あなたのwallet").
    private var linkedWallet: DemoWallet? {
        linkedSession.map { DemoWallet(id: $0.wallet, label: Self.linkedRoomLabel) }
    }

    /// True while the server reports the insecure local flag (Owner A / Owner B test-room signing).
    private(set) var serverSignedTestTransfers = false
    /// Per-asset text while a transfer request waits on the Web ("Webで承認待ち" etc.).
    private(set) var approvalMessages: [String: String] = [:]

    /// Devnet room whose wallet is the linked Web wallet: actions go through Web approval.
    var isLinkedRoom: Bool {
        guard dataMode == .devnet, let linked = sessionLink.current else { return false }
        return linked.wallet == activeWallet.id
    }

    /// Demo mode: always true (simulated). Devnet mode: the linked wallet's room
    /// (Web approval), or an Owner A/B test room only while the server's insecure
    /// dev flag is on. Other rooms are public on-chain data and stay view-only.
    var canOperateOnActiveWallet: Bool {
        if dataMode == .demo { return true }
        if isLinkedRoom { return true }
        return serverSignedTestTransfers && DemoWallet.allDevnet.contains { $0.id == activeWallet.id }
    }

    func refreshCapabilities() async {
        serverSignedTestTransfers = (try? await devnetProvider.devnetCapabilities().serverSignedTestTransfers) ?? false
    }

    /// 送る / Twinfoldに売る for the linked wallet: create a request, show 「Webで承認待ち」,
    /// poll every 3s; on confirmed, wait for the owner change as for any transfer, then Disappear.
    private func runApprovalFlow(assetId: String, asset: TwinfoldAsset, requestId: String, kind: TransferRequestKind, toWallet: String?) async {
        let opLabel = kind == .buyback ? "Sale to Twinfold (legacy demo)" : "Send"
        let destination = kind == .buyback ? MockAssetProvider.vaultWallet : (toWallet ?? "")
        approvalMessages[assetId] = "Awaiting approval on Web / approve in My collection on the Web"
        defer { approvalMessages[assetId] = nil }
        do {
            var info = try await devnetProvider.createTransferRequest(requestId: requestId, assetId: assetId, kind: kind, toWallet: toWallet)
            while true {
                switch info.status {
                case .awaitingApproval, .unknown:
                    approvalMessages[assetId] = "Awaiting approval on Web / approve in My collection on the Web"
                case .submitted:
                    approvalMessages[assetId] = "Approved. Waiting for confirmation on devnet…"
                case .confirmed:
                    break
                case .rejected:
                    failTransfer(assetId: assetId, message: "Cancelled (rejected on the Web). Retry creates a new request")
                    return
                case .expired:
                    failTransfer(assetId: assetId, message: "Expired (10 minutes). Retry creates a new request")
                    return
                case .failed:
                    if info.retryable == true {
                        // Same as the Web: a retryable failure can be re-approved there, so keep polling.
                        approvalMessages[assetId] = "Approval did not complete (\(info.error ?? "you can retry")). You can approve again on the Web"
                    } else {
                        failTransfer(assetId: assetId, message: "\(opLabel) failed: \(info.error ?? "unknown error")")
                        return
                    }
                }
                if info.status == .confirmed { break }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                // Stop if the user left this operation (mode/wallet switch, reset, link drop).
                guard transferStates[assetId] == .pending, isLinkedRoom else { return }
                info = try await devnetProvider.transferRequestStatus(requestId: requestId)
            }
        } catch {
            failTransfer(assetId: assetId, message: transferFailureMessage(error, opLabel: opLabel))
            return
        }

        approvalMessages[assetId] = "Confirmed. Waiting for the owner update…"
        let owner = activeWallet.id
        let deadline = Date().addingTimeInterval(300)
        while Date() < deadline {
            if let refreshed = try? await devnetProvider.getAsset(assetId: assetId), refreshed.owner != owner {
                confirmTransfer(assetId: assetId, asset: asset, destination: destination)
                return
            }
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
        failTransfer(assetId: assetId, message: "\(opLabel) is confirmed on devnet, but the owner update is still pending (DAS indexing lag). Retry checks again")
    }

    /// Re-reads the Keychain-backed client; if the token expired locally, drops the link.
    private func refreshLinkState() {
        if linkedSession != nil, sessionLink.current == nil {
            dropLink(notice: "The link was lost. You are now view-only. Link again on the Web")
        }
    }

    /// Asks the server whether the token still works (expired / revoked / Web wallet switched -> 401).
    /// A network failure keeps the link: the server simply could not be asked.
    func validateLink() async {
        guard linkedSession != nil else { return }
        do {
            let session = try await sessionLink.validate()
            linkedSession = session
        } catch SessionLinkError.unauthorized {
            dropLink(notice: "The link was lost. You are now view-only. Link again on the Web")
        } catch {
            print("validateLink: \(error)")
        }
    }

    func linkWithCode(_ rawCode: String) async {
        guard !isLinking else { return }
        isLinking = true
        linkErrorMessage = nil
        defer { isLinking = false }
        do {
            let session = try await sessionLink.exchange(code: rawCode, deviceName: UIDevice.current.name)
            linkedSession = session
            linkNotice = nil
            pendingLinkCode = nil
            showsLinkSheet = false
            activateLinkedRoom()
        } catch let error as SessionLinkError {
            linkErrorMessage = Self.message(for: error)
        } catch {
            linkErrorMessage = "Linking failed: \(error)"
        }
    }

    /// 「連携を解除」: forgets the token on this iPhone. (Web 側の「連携を解除」で、発行済みの全端末tokenが失効します)
    func unlink() {
        guard linkedSession != nil else { return }
        dropLink(notice: nil)
    }

    func handleLinkURL(_ url: URL) {
        guard let code = SessionLinkClient.code(fromLinkURL: url) else { return }
        pendingLinkCode = code
        linkErrorMessage = nil
        showsLinkSheet = true
    }

    /// Back to view-only: forgets the token, drops the linked room, and falls
    /// back to a test wallet room if the active room was the linked one.
    private func dropLink(notice: String?) {
        sessionLink.clear()
        let formerWallet = linkedSession?.wallet
        linkedSession = nil
        linkNotice = notice
        if dataMode == .mainnet, activeWallet.id == formerWallet {
            // Nothing left to read on mainnet without a linked wallet.
            activeWallet = .noWallet
            ownedAssets = []
            appearedAssets.removeAll()
            selectedAssetId = nil
            cancelHolding()
            syncEntities()
            return
        }
        guard dataMode == .devnet, activeWallet.id == formerWallet else { return }
        if let testRoom = DemoWallet.allDevnet.first(where: { $0.id == formerWallet }) {
            activeWallet = testRoom // same wallet, original label; assets stay
        } else {
            switchWallet(to: DemoWallet.allDevnet.first ?? .ownerADevnet)
        }
    }

    func dismissLinkNotice() { linkNotice = nil }

    private func activateLinkedRoom() {
        guard let linked = linkedWallet else { return }
        // Demoから連携したら、自分のwalletの本物のカード（read-only）をすぐ出す。Devnetのときはそのまま
        if dataMode == .demo {
            switchDataMode(to: .mainnet) // selects the first room; fixed up below
        }
        if activeWallet.id == linked.id {
            activeWallet = linked
        } else {
            switchWallet(to: linked)
        }
    }

    private static func message(for error: SessionLinkError) -> String {
        switch error {
        case .invalidCode: return "The code format is invalid (8 characters)"
        case .unknownCode: return "This code was not found. Issue a new code on the Web"
        case .expired: return "This code has expired (2 minutes). Issue a new code on the Web"
        case .alreadyUsed: return "This code has already been used. Issue a new code on the Web"
        case .rateLimited(let seconds):
            return "Too many attempts. Try again " + (seconds.map { "in about \(max(1, $0 / 60)) min" } ?? "later") + "."
        case .unauthorized: return "The link was lost"
        case .network: return "Could not reach the Collectibles AR API. Check that you are on the same Wi-Fi"
        case .server(let status): return "Server error (\(status))"
        case .decoding: return "Could not read the response"
        }
    }

    /// Turns a failed devnet transfer call into on-screen text; a 401 also drops the link.
    private func transferFailureMessage(_ error: Error, opLabel: String) -> String {
        if case AssetProviderError.httpError(let status, _) = error {
            if status == 401 {
                dropLink(notice: "The link was lost. You are now view-only. Link again on the Web")
                return "\(opLabel) failed: the link was lost"
            }
            if status == 403 {
                let isTestWallet = DemoWallet.allDevnet.contains { $0.id == activeWallet.id }
                return "Cannot complete \(opLabel): " + (isTestWallet
                    ? "This wallet does not match the wallet signed in on the Web"
                    : "Signing for this wallet requires Phantom (not supported yet)")
            }
        }
        return "\(opLabel) failed: \(error)"
    }

    // MARK: - 現物を引き取る (Redeem Physical, dry run)

    /// The Asset the redeem explanation sheet is showing, and its busy / error state.
    private(set) var redeemAssetId: String?
    private(set) var redeemWorking = false
    private(set) var redeemError: String?
    /// One-shot toast after the Asset was locked on chain (it Disappears from the wall).
    private(set) var redeemToast: String?
    private var redeemPollTask: Task<Void, Never>?
    private var redeemRequestId = UUID().uuidString
    static let redeemPendingMessage = "Redemption in progress — approve in My collection on the Web"
    static let redeemLockedToast = "Circulation was stopped. Continue the redemption on the Web"

    /// True while a redemption is open for the asset (server overlay), so buyback / send are not offered.
    func isInRedemption(_ asset: TwinfoldAsset) -> Bool { asset.redemption?.open == true }

    func presentRedeem() {
        refreshLinkState()
        guard isLinkedRoom, !redeemWorking, let id = selectedAssetId else { return }
        redeemAssetId = id
        redeemError = nil
        redeemRequestId = UUID().uuidString
    }

    func dismissRedeem() {
        guard !redeemWorking else { return }
        redeemAssetId = nil
        redeemError = nil
    }

    func dismissRedeemToast() { redeemToast = nil }

    /// Creates the redemption (Bearer). The lock itself is approved in Phantom on the Web; here we only poll until it is locked.
    func confirmRedeem() {
        guard isLinkedRoom, let assetId = redeemAssetId, !redeemWorking else { return }
        redeemWorking = true
        redeemError = nil
        let requestId = redeemRequestId
        Task {
            defer { redeemWorking = false }
            do {
                let redemption = try await devnetProvider.createRedemption(requestId: requestId, assetId: assetId)
                redeemAssetId = nil
                if redemption.status == .requested || redemption.status == .locked {
                    await loadOwnedAssets()
                    startRedeemPolling(redemptionId: redemption.id, assetId: assetId)
                }
            } catch {
                redeemError = redeemFailureMessage(error)
            }
        }
    }

    /// Polls every 4s. Locked on chain -> reload (the Asset leaves this wallet and Disappears) and show the toast.
    /// A thrown poll error keeps polling; cancelled / retired / exception end it.
    private func startRedeemPolling(redemptionId: String, assetId: String) {
        redeemPollTask?.cancel()
        redeemPollTask = Task {
            let deadline = Date().addingTimeInterval(30 * 60)
            while !Task.isCancelled, Date() < deadline {
                if let info = try? await devnetProvider.redemptionStatus(id: redemptionId) {
                    switch info.status {
                    case .locked, .shipped, .received, .retired:
                        if selectedAssetId == assetId { selectedAssetId = nil }
                        await loadOwnedAssets()
                        redeemToast = Self.redeemLockedToast
                        return
                    case .cancelled, .exception:
                        await loadOwnedAssets()
                        return
                    case .requested, .unknown:
                        break
                    }
                }
                try? await Task.sleep(nanoseconds: 4_000_000_000)
            }
        }
    }

    private func cancelRedeemPolling() {
        redeemPollTask?.cancel()
        redeemPollTask = nil
    }

    private func redeemFailureMessage(_ error: Error) -> String {
        if case AssetProviderError.httpError(let status, _) = error {
            switch status {
            case 401:
                dropLink(notice: "The link was lost. You are now view-only. Link again on the Web")
                return "The link was lost"
            case 403: return "Cannot submit (you are not the owner, or it is disabled on the server)"
            case 409: return "This item is already being redeemed or is not eligible"
            case 429: return "The request limit was reached. Try again later"
            case 503: return "Cannot process this right now (Collectibles AR configuration). Try again later"
            default: return "Request failed (\(status))"
            }
        }
        return "Could not reach the Collectibles AR API. Check that you are on the same Wi-Fi"
    }

    // MARK: - Twinfoldから取得 (acquire, Issue #60)

    enum AcquisitionPhase: Equatable {
        case idle
        case working(String)
        case done
        case failed(String)
    }

    static let acquisitionLinkRequiredMessage = "Acquiring requires linking your wallet on the Web"

    /// Assets Twinfold's vault wallet holds on devnet (Devnet mode only; empty in Demo mode, which is unchanged).
    private(set) var vaultAssets: [TwinfoldAsset] = []
    /// The vault Asset an acquisition sheet is currently showing, and that sheet's state.
    private(set) var acquisitionAssetId: String?
    private(set) var acquisitionPhase: AcquisitionPhase = .idle
    /// Reused for retries of the same sheet so the server stays idempotent.
    private var acquisitionRequestId = UUID().uuidString
    private var acquisitionTask: Task<Void, Never>?

    private func cancelAcquisitionTask() {
        acquisitionTask?.cancel()
        acquisitionTask = nil
    }

    var acquisitionAsset: TwinfoldAsset? { vaultAssets.first { $0.id == acquisitionAssetId } ?? lastAcquiredAsset }
    private var lastAcquiredAsset: TwinfoldAsset?
    var isAcquisitionLinked: Bool { dataMode == .devnet && sessionLink.current != nil }
    var isAcquisitionWorking: Bool { if case .working = acquisitionPhase { return true } else { return false } }

    /// Advisory list; a failure just hides the group (the acquisition itself is re-checked server-side).
    func loadVaultAssets() async {
        guard dataMode == .devnet else {
            vaultAssets = []
            return
        }
        do {
            let assets = try await devnetProvider.vaultAssets()
            if dataMode == .devnet { vaultAssets = assets.filter { $0.commerce != nil } }
        } catch {
            print("loadVaultAssets failed: \(error)")
            if dataMode == .devnet { vaultAssets = [] }
        }
    }

    func presentAcquisition(assetId: String) {
        refreshLinkState()
        guard dataMode == .devnet, !isAcquisitionWorking else { return }
        acquisitionAssetId = assetId
        acquisitionPhase = isAcquisitionLinked ? .idle : .failed(Self.acquisitionLinkRequiredMessage)
        acquisitionRequestId = UUID().uuidString
        lastAcquiredAsset = nil
    }

    func dismissAcquisition() {
        guard !isAcquisitionWorking else { return }
        acquisitionAssetId = nil
        acquisitionPhase = .idle
        lastAcquiredAsset = nil
    }

    /// 取得する: the server (Twinfold vault signs, no payment) transfers the Asset to the linked wallet.
    /// Poll pending/submitted; once confirmed, wait until the on-chain owner equals the linked wallet, then
    /// show the room of that wallet where it is a normal owned Asset (Place → Appear).
    func confirmAcquisition() {
        refreshLinkState()
        guard isAcquisitionLinked, let linked = sessionLink.current, let assetId = acquisitionAssetId, !isAcquisitionWorking else {
            if acquisitionAssetId != nil, !isAcquisitionLinked { acquisitionPhase = .failed(Self.acquisitionLinkRequiredMessage) }
            return
        }
        lastAcquiredAsset = vaultAssets.first { $0.id == assetId }
        let requestId = acquisitionRequestId
        acquisitionPhase = .working("Sending…")
        acquisitionTask = Task {
            do {
                var info = try await devnetProvider.acquire(requestId: requestId, assetId: assetId)
                var pollErrors = 0
                while info.status != .confirmed {
                    if Task.isCancelled { return }
                    switch info.status {
                    case .failed:
                        // A server-side `failed` is final for this id: the next attempt must use a NEW requestId.
                        acquisitionRequestId = UUID().uuidString
                        acquisitionPhase = .failed(info.error ?? "Acquisition failed")
                        return
                    case .submitted:
                        acquisitionPhase = .working("Sent. Waiting for confirmation on devnet…")
                    case .pending, .unknown, .confirmed:
                        acquisitionPhase = .working("Sending…")
                    }
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    if Task.isCancelled { return }
                    do {
                        info = try await devnetProvider.acquisitionStatus(requestId: requestId)
                        pollErrors = 0
                    } catch {
                        // A thrown poll error (network blip) is NOT a failure: the transfer may have landed.
                        if case AssetProviderError.httpError(let status, _) = error, status == 401 { throw error }
                        pollErrors += 1
                        if pollErrors > 40 { throw error }
                        acquisitionPhase = .working("Checking…")
                    }
                }
            } catch {
                // Keep the same requestId only for network-error retries; any server answer means a new id next time.
                if case AssetProviderError.httpError = error { acquisitionRequestId = UUID().uuidString }
                acquisitionPhase = .failed(acquisitionFailureMessage(error))
                return
            }

            // The status is never proof of ownership: wait for the on-chain owner to equal the linked wallet.
            acquisitionPhase = .working("Confirmed. Waiting for the owner update…")
            let deadline = Date().addingTimeInterval(180)
            while Date() < deadline, !Task.isCancelled {
                if let refreshed = try? await devnetProvider.getAsset(assetId: assetId), refreshed.owner == linked.wallet {
                    if activeWallet.id != linked.wallet, let room = linkedWallet {
                        switchWallet(to: room, fromAcquisition: true)
                    } else {
                        await loadOwnedAssets()
                    }
                    await loadVaultAssets()
                    acquisitionPhase = .done
                    return
                }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
            acquisitionPhase = .failed("Confirmed on devnet, but the owner update is still pending (DAS indexing lag). Reopen the collection in a moment")
        }
    }

    private func acquisitionFailureMessage(_ error: Error) -> String {
        if case AssetProviderError.httpError(let status, _) = error {
            switch status {
            case 401:
                dropLink(notice: "The link was lost. You are now view-only. Link again on the Web")
                return "The link was lost"
            case 403: return "Acquisition is disabled on the server (dev setting)"
            case 404: return "The acquisition record was not found. Try again"
            case 409: return "This item cannot be acquired right now"
            case 429: return "The acquisition limit was reached. Try again later"
            case 503: return "Cannot process this right now (for example, Collectibles AR devnet SOL balance). Try again later"
            default: return "Acquisition failed (\(status))"
            }
        }
        return "Could not reach the Collectibles AR API. Check that you are on the same Wi-Fi"
    }

    // MARK: - Wallet / ownership

    var placedCount: Int { placementCoords.count }
    var unplacedCount: Int { trayAssets.filter { placementCoords[$0.id] == nil }.count }

    /// What the tray offers for placing. A card whose issuer the server could not match (`sourceVerified == false`,
    /// listed by metadata shape only) stays in the Collection list with an UNVERIFIED SOURCE badge but is kept out of
    /// the AR list, as the Web contract requires (`apps/web/lib/contract.ts`, `sourceVerified`).
    var trayAssets: [TwinfoldAsset] { ownedAssets.filter { $0.sourceVerified != false } }

    /// Shown instead of an empty tray on Mainnet (read-only) before a Web wallet is linked.
    var mainnetNeedsLink: Bool { dataMode == .mainnet && linkedSession == nil }

    func isPlaced(_ assetId: String) -> Bool { placementCoords[assetId] != nil }
    func transferState(for assetId: String) -> TransferState { transferStates[assetId] ?? .idle }

    /// Devnet rooms: Owner A / Owner B (public on-chain data, view-only unless
    /// linked as that wallet) plus the linked Web wallet as "あなたのwallet"
    /// (replacing the test wallet's own entry when it is the same address).
    var walletOptions: [DemoWallet] {
        // Mainnet (read-only) shows only the linked wallet's own cards: no public test rooms exist there.
        if dataMode == .mainnet { return linkedWallet.map { [$0] } ?? [] }
        guard dataMode == .devnet, let linked = linkedWallet else { return DemoWallet.wallets(for: dataMode) }
        var options = DemoWallet.allDevnet.map { $0.id == linked.id ? linked : $0 }
        if !options.contains(where: { $0.id == linked.id }) { options.append(linked) }
        return options
    }

    func start() async {
        async let validation: Void = validateLink()
        await loadOwnedAssets()
        await validation
        await refreshCapabilities()
    }

    func switchWallet(to wallet: DemoWallet, fromAcquisition: Bool = false) {
        guard wallet.id != activeWallet.id else { return }
        if !fromAcquisition { cancelAcquisitionTask() }
        cancelRedeemPolling()
        activeWallet = wallet
        appearedAssets.removeAll()
        pendingAppears.removeAll()
        selectedAssetId = nil
        holdingAssetId = nil
        // A `.confirmed` state belongs to the previous owner's transfer; the
        // new owner must see the same Asset as idle (来歴・送る available).
        transferStates = transferStates.filter { $0.value != .confirmed }
        cancelHolding()
        Task { await loadOwnedAssets() }
    }

    /// Switches between the bundled fixture (`DEMO DATA`) and the Twinfold
    /// API's devnet routes (`DEVNET`), clearing every placed
    /// entity/selection/pending-transfer first — the two modes' assets and
    /// wallets are unrelated, so nothing carries over. Defaults are the
    /// active mode's first wallet (Owner A). Defaults to Demo data at app
    /// launch; the user must explicitly switch to Devnet each session.
    func switchDataMode(to mode: DataMode) {
        guard mode != dataMode else { return }

        for live in liveEntities.values {
            removeLiveAnchor(live)
        }
        liveEntities.removeAll()
        placementCoords.removeAll()
        transferStates.removeAll()
        transferOperationKinds.removeAll()
        selectedAssetId = nil
        passportAssetId = nil
        appearedAssets.removeAll()
        pendingAppears.removeAll()
        cancelHolding()
        toast = nil
        dismissBuybackOffer()
        vaultAssets = []
        cancelAcquisitionTask()
        cancelRedeemPolling()
        redeemAssetId = nil
        redeemToast = nil
        acquisitionAssetId = nil
        acquisitionPhase = .idle

        dataMode = mode
        activeWallet = walletOptions.first ?? (mode == .mainnet ? .noWallet : .ownerA)
        ownedAssets = []
        loadErrorMessage = nil
        Task {
            await loadOwnedAssets()
            if mode != .demo {
                await validateLink()
            }
            if mode == .devnet {
                await refreshCapabilities()
                await loadVaultAssets()
            }
        }
    }

    private func loadOwnedAssets() async {
        let mode = dataMode
        let wallet = activeWallet.id
        do {
            let fetched = try await fetchAssets(mode: mode, wallet: wallet)
            // A wallet / mode switch while the request was in flight: this answer is for a room no longer shown.
            guard mode == dataMode, wallet == activeWallet.id else { return }
            ownedAssets = mergeAppeared(into: fetched)
            lastFetchedAt = Date()
            loadErrorMessage = nil
        } catch {
            guard mode == dataMode, wallet == activeWallet.id else { return }
            // Full error goes to the console only; the on-screen text stays
            // short enough to read (and to appear in a demo recording).
            print("loadOwnedAssets failed: \(error)")
            loadErrorMessage = dataMode == .demo
                ? "Could not load the items"
                : "Could not reach the Collectibles AR API. Check that you are on the same Wi-Fi and that Collectibles AR is allowed under Local Network in Settings"
        }
        syncEntities()
    }

    /// One read of the active room's assets through the mode's provider (never the chain directly). The lists never
    /// mix networks: Mainnet keeps only `network == "mainnet"`, the other modes drop it.
    private func fetchAssets(mode: DataMode, wallet: String) async throws -> [TwinfoldAsset] {
        switch mode {
        case .demo:
            await mockProvider.connect(wallet: wallet)
            return try await mockProvider.getAssets(wallet: wallet)
        case .devnet:
            return try await devnetProvider.getAssets(wallet: wallet).filter { $0.network != "mainnet" }
        case .mainnet:
            guard !wallet.isEmpty else { return [] }
            return try await devnetProvider.getAssets(wallet: wallet, network: .mainnet).filter { $0.network == "mainnet" }
        }
    }

    /// Cards that Appeared from a Pull may not be in the DAS list for a while. Keep them for `appearGrace` so the next
    /// refresh does not make them Disappear while indexing catches up, and keep their Pull `gachaMemo` (the DAS copy
    /// has none) while both exist.
    private func mergeAppeared(into fetched: [TwinfoldAsset]) -> [TwinfoldAsset] {
        let now = Date()
        let fetchedIds = Set(fetched.map(\.id))
        appearedAssets = appearedAssets.filter { fetchedIds.contains($0.key) || now.timeIntervalSince($0.value.at) < Self.appearGrace }
        var merged = fetched.map { appearedAssets[$0.id]?.asset ?? $0 }
        for (id, entry) in appearedAssets where !fetchedIds.contains(id) { merged.append(entry.asset) }
        return merged
    }

    /// Adds/removes scene entities so only assets that are both placed
    /// (`placementCoords`) and owned by `activeWallet` (`ownedAssets`) are
    /// visible — the Appear/Disappear mechanism for both wallet switches
    /// and transfer confirmation.
    private func syncEntities() {
        let ownedIds = Set(ownedAssets.map(\.id))

        for (assetId, live) in liveEntities where !ownedIds.contains(assetId) {
            retire(live) // Disappear: fade out, then remove
            liveEntities[assetId] = nil
            if selectedAssetId == assetId { selectedAssetId = nil }
            if passportAssetId == assetId { passportAssetId = nil }
        }

        for asset in ownedAssets {
            guard liveEntities[asset.id] == nil, let coord = placementCoords[asset.id] else { continue }
            materialize(
                assetId: asset.id, asset: asset, transform: coord.transform, isWall: coord.isWallPlacement,
                slabSurface: coord.slabSurface
            )
        }
    }

    /// Removes a live entity's RealityKit anchor and, if present, its ARKit anchor from the session.
    private func removeLiveAnchor(_ live: LiveEntity) {
        arView?.scene.removeAnchor(live.anchor)
        if let arAnchor = live.arAnchor {
            arView?.session.remove(anchor: arAnchor)
        }
    }

    /// Disappear: fades the entity out (scale untouched), then removes its anchor. The provenance column goes at once.
    private func retire(_ live: LiveEntity) {
        live.provenanceColumn?.removeFromParent()
        guard let arView else { return }
        let entity = live.cardEntity
        Task { [weak self] in
            await PresenceAnimation.disappear(entity)
            self?.removeLiveAnchor(live)
        }
    }

    // MARK: - Tray

    /// Tapping a tray thumbnail: an unplaced asset starts a holding
    /// preview; an already-placed one just selects it (same as tapping its
    /// entity in the scene).
    func trayTap(assetId: String) {
        if placementCoords[assetId] != nil {
            select(assetId)
        } else {
            startHolding(assetId: assetId)
        }
    }

    // MARK: - Holding (placement preview)

    func startHolding(assetId: String) {
        guard let asset = trayAssets.first(where: { $0.id == assetId }), let arView else { return }
        removePreviewOnly()
        selectedAssetId = nil
        holdingAssetId = assetId
        pendingPreviewTransform = nil
        isPreviewDetected = false

        let entity = AssetRepresentationEntity.makeForWallPlacement(asset: asset)
        let anchor = AnchorEntity(world: matrix_identity_float4x4)
        anchor.addChild(entity)
        previewEntity = entity
        pendingPreviewSlabSurface = .wall
        previewSurfaceCandidate = nil
        previewSurfaceCandidateFrames = 0
        previewSurfaceSettled = false
        // A twin's own mesh origin isn't guaranteed to be its base (see
        // `AssetRepresentationEntity.settleOnAnchor`); settle it here too,
        // before the anchor even has a real position, so the preview
        // already rests on whatever surface the anchor is moved to each
        // frame instead of floating or clipping into it until confirmed.
        // Rotation-invariant since only yaw is ever applied to the anchor.
        if AssetRepresentationEntity.isTwin(asset) {
            _ = AssetRepresentationEntity.settleOnAnchor(entity: entity, anchor: anchor)
        }
        AssetRepresentationEntity.setPreviewTranslucent(true, on: entity)
        arView.scene.addAnchor(anchor)
        previewAnchor = anchor
    }

    func cancelHolding() {
        removePreviewOnly()
        holdingAssetId = nil
        pendingPreviewTransform = nil
        isPreviewDetected = false
    }

    /// Called every frame (via `ARContainerView`'s scene-update
    /// subscription) while holding, so the preview follows the raycast
    /// from the center of the screen.
    func updateHoldingPreview() {
        guard let holdingAssetId,
              let arView,
              let asset = ownedAssets.first(where: { $0.id == holdingAssetId }),
              let previewAnchor,
              isARSupported else {
            isPreviewDetected = false
            return
        }

        let point = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)
        let isTwin = AssetRepresentationEntity.isTwin(asset)

        if AssetRepresentationEntity.isSlab(asset) {
            // A slab goes on whichever plane is under the screen center: hung flat on a wall, stood on a desk or floor.
            guard let (hit, isVertical) = slabRaycast(in: arView, at: point),
                  let cameraTransform = arView.session.currentFrame?.camera.transform else {
                isPreviewDetected = false
                return
            }
            if !previewSurfaceSettled {
                // First hit since holding started: adopt it immediately.
                pendingPreviewIsWall = isVertical
                previewSurfaceCandidate = nil
                previewSurfaceCandidateFrames = 0
                previewSurfaceSettled = true
            } else if isVertical == pendingPreviewIsWall {
                previewSurfaceCandidate = nil
                previewSurfaceCandidateFrames = 0
            } else {
                if previewSurfaceCandidate == isVertical {
                    previewSurfaceCandidateFrames += 1
                } else {
                    previewSurfaceCandidate = isVertical
                    previewSurfaceCandidateFrames = 1
                }
                if previewSurfaceCandidateFrames >= Self.previewSurfaceSwitchFrames {
                    pendingPreviewIsWall = isVertical
                    previewSurfaceCandidate = nil
                    previewSurfaceCandidateFrames = 0
                }
            }
            let useWall = pendingPreviewIsWall
            let transform = useWall ? wallTransform(hit: hit) : floorTransform(hit: hit, cameraTransform: cameraTransform)
            previewAnchor.transform = Transform(matrix: transform)
            if let previewEntity {
                GradedSlabEntity.pose(previewEntity, on: useWall ? .wall : .horizontal)
            }
            pendingPreviewTransform = transform
            pendingPreviewSlabSurface = useWall ? .wall : .horizontal
            pendingPreviewCardHeight = GradedSlabDimensions.psaStandard.height
            isPreviewDetected = true
        } else if isTwin {
            // `.existingPlaneGeometry` first: once ARKit has committed to a
            // plane (typically after the user has looked at the floor/desk
            // for a moment) it's far more stable than the estimate: falling
            // straight to `.estimatedPlane` every frame produced a preview
            // that never settled, which — combined with occlusion from the
            // scene mesh — read as "no preview at all" on device.
            // `.estimatedPlane` stays as the fallback for the first moment
            // before a plane is registered.
            guard let hit = arView.raycast(from: point, allowing: .existingPlaneGeometry, alignment: .horizontal).first
                ?? arView.raycast(from: point, allowing: .estimatedPlane, alignment: .horizontal).first,
                let cameraTransform = arView.session.currentFrame?.camera.transform else {
                isPreviewDetected = false
                return
            }
            let transform = floorTransform(hit: hit, cameraTransform: cameraTransform)
            previewAnchor.transform = Transform(matrix: transform)
            pendingPreviewTransform = transform
            pendingPreviewIsWall = false
            isPreviewDetected = true
        } else {
            guard let hit = arView.raycast(from: point, allowing: .estimatedPlane, alignment: .vertical).first else {
                isPreviewDetected = false
                return
            }
            let transform = wallTransform(hit: hit)
            previewAnchor.transform = Transform(matrix: transform)
            pendingPreviewTransform = transform
            pendingPreviewIsWall = true
            pendingPreviewCardHeight = AssetCardEntity.size(for: asset).height
            isPreviewDetected = true
        }
    }

    /// Finalizes the held asset's placement: uses the last raycast-derived
    /// transform if there is one, otherwise falls back to a camera-facing
    /// air placement, then (AR unsupported, e.g. simulator) a fixed
    /// position offset per already-placed asset so multiple fallback
    /// placements don't overlap.
    func confirmHolding() {
        guard let holdingId = holdingAssetId,
              let asset = ownedAssets.first(where: { $0.id == holdingId }),
              let arView else { return }

        var transform: simd_float4x4
        var isWall = false
        var cardHeight: Float = 0
        // A slab with no plane found is put upright in the air (flat pose), never tilted.
        var slabSurface: SlabSurface = .wall

        if let pendingPreviewTransform {
            transform = pendingPreviewTransform
            isWall = pendingPreviewIsWall
            cardHeight = pendingPreviewCardHeight
            slabSurface = pendingPreviewSlabSurface
        } else if isARSupported, let cameraTransform = arView.session.currentFrame?.camera.transform {
            transform = airTransform(cameraTransform: cameraTransform)
        } else {
            transform = fallbackTransform(index: placementCoords.count)
        }

        if isWall {
            if cardHeight == 0 { cardHeight = AssetRepresentationEntity.footprint(for: asset).height }
            transform.columns.3.y = snappedWallY(candidateY: transform.columns.3.y, candidateHeight: cardHeight, excludingAssetId: holdingId)
        }

        removePreviewOnly()
        holdingAssetId = nil
        pendingPreviewTransform = nil
        isPreviewDetected = false
        materialize(
            assetId: holdingId, asset: asset, transform: transform, isWall: isWall,
            cardHeightOverride: cardHeight, slabSurface: slabSurface
        )
        selectedAssetId = holdingId
    }

    private func removePreviewOnly() {
        if let previewAnchor {
            arView?.scene.removeAnchor(previewAnchor)
        }
        previewAnchor = nil
        previewEntity = nil
    }

    // MARK: - Selection / tap dispatch

    /// Called by `ARContainerView`'s tap gesture with a point in the
    /// `ARView`'s coordinate space.
    func handleTap(at point: CGPoint) {
        guard let arView else { return }

        if holdingAssetId != nil {
            confirmHolding()
            return
        }
        if let hitEntity = arView.entity(at: point), let assetId = ownerAssetId(for: hitEntity) {
            select(assetId)
            // Tapping a placed card opens its Passport (the three-way split); other representations keep 来歴 / 送る.
            if ownedAssets.first(where: { $0.id == assetId }).map(AssetRepresentationEntity.isSlab) == true {
                passportAssetId = assetId
            }
        } else {
            deselect()
        }
    }

    private func ownerAssetId(for hitEntity: Entity) -> String? {
        for (assetId, live) in liveEntities {
            var current: Entity? = hitEntity
            while let entity = current {
                if entity === live.cardEntity { return assetId }
                current = entity.parent
            }
        }
        return nil
    }

    func select(_ assetId: String) {
        guard liveEntities[assetId] != nil else { return }
        selectedAssetId = assetId
        applyHighlights()
    }

    func deselect() {
        selectedAssetId = nil
        applyHighlights()
    }

    private func applyHighlights() {
        for (assetId, live) in liveEntities {
            // Pending/failed styling already sets its own frame state;
            // only touch idle cards here so it isn't overridden.
            guard transferState(for: assetId) == .idle else { continue }
            AssetCardEntity.setHighlighted(assetId == selectedAssetId, on: live.cardEntity)
        }
    }

    // MARK: - Provenance ("来歴")

    func pullProvenanceForSelected() {
        guard let assetId = selectedAssetId,
              var live = liveEntities[assetId],
              let asset = ownedAssets.first(where: { $0.id == assetId }) else { return }
        closeAllProvenanceColumns(except: assetId)
        guard live.provenanceColumn == nil else { return }

        let column = ProvenanceNodeEntity.makeColumn(events: asset.provenance)
        column.position = SIMD3<Float>(
            provenanceColumnX(for: asset, live: live),
            provenanceColumnY(for: live),
            0
        )
        live.anchor.addChild(column)
        live.provenanceColumn = column
        liveEntities[assetId] = live
    }

    var isProvenancePulledForSelected: Bool {
        guard let selectedAssetId else { return false }
        return liveEntities[selectedAssetId]?.provenanceColumn != nil
    }

    private func closeAllProvenanceColumns(except keepId: String?) {
        for (assetId, live) in liveEntities where assetId != keepId {
            guard let column = live.provenanceColumn else { continue }
            column.removeFromParent()
            liveEntities[assetId]?.provenanceColumn = nil
        }
    }

    // MARK: - Case / card only ("ケースから出す")

    /// Flips the selected graded card between the slab in its holder and the card alone. If it is placed, it is
    /// removed and materialized again at the same world transform and surface; selection is kept.
    func toggleCardOnlyForSelected() {
        guard let assetId = selectedAssetId,
              let asset = ownedAssets.first(where: { $0.id == assetId }),
              AssetRepresentationEntity.isSlab(asset) else { return }
        if cardOnlyAssetIds.contains(assetId) {
            cardOnlyAssetIds.remove(assetId)
        } else {
            cardOnlyAssetIds.insert(assetId)
        }
        guard let live = liveEntities[assetId], let coord = placementCoords[assetId] else { return }
        removeLiveAnchor(live)
        liveEntities[assetId] = nil
        let footprintHeight = AssetRepresentationEntity.footprint(
            for: asset, style: cardOnlyAssetIds.contains(assetId) ? .cardOnly : .holder
        ).height
        materialize(
            assetId: assetId, asset: asset, transform: coord.transform, isWall: coord.isWallPlacement,
            cardHeightOverride: coord.isWallPlacement ? footprintHeight : 0, slabSurface: coord.slabSurface
        )
    }

    // MARK: - Remove ("外す")

    func removeSelected() {
        guard let assetId = selectedAssetId, let live = liveEntities[assetId] else { return }
        removeLiveAnchor(live)
        liveEntities[assetId] = nil
        placementCoords[assetId] = nil
        transferStates[assetId] = nil
        transferOperationKinds[assetId] = nil
        selectedAssetId = nil
        if passportAssetId == assetId { passportAssetId = nil }
    }

    // MARK: - Transfer ("送る")

    func destinationWallet(for asset: TwinfoldAsset) -> String {
        let (a, b) = dataMode == .demo ? (DemoWallet.ownerA, DemoWallet.ownerB) : (DemoWallet.ownerADevnet, DemoWallet.ownerBDevnet)
        return asset.owner == a.id ? b.id : a.id
    }

    var destinationLabelForSelected: String {
        guard let selectedAssetId, let asset = ownedAssets.first(where: { $0.id == selectedAssetId }) else { return "" }
        return DemoWallet.label(forWallet: destinationWallet(for: asset))
    }

    var transferStatesContainPending: Bool {
        transferStates.values.contains(.pending)
    }

    /// Demo mode: simulated P2P transfer via `MockAssetProvider`. Devnet
    /// mode (Issue #29): a real devnet transfer via
    /// `/api/devnet/transfer`'s dev-only server-signing shortcut, to the
    /// other devnet test wallet.
    func sendSelected() {
        refreshLinkState()
        guard canOperateOnActiveWallet else { return }
        guard let assetId = selectedAssetId,
              let live = liveEntities[assetId],
              let asset = ownedAssets.first(where: { $0.id == assetId }) else { return }
        let state = transferState(for: assetId)
        guard state == .idle || state == .failed else { return }

        transferStates[assetId] = .pending
        transferOperationKinds[assetId] = .send
        AssetCardEntity.apply(state: .pending, to: live.cardEntity)
        let requestId = UUID().uuidString

        if dataMode == .demo {
            let destination = destinationWallet(for: asset)
            Task { await runTransfer(assetId: assetId, asset: asset, destination: destination, requestId: requestId) }
        } else if isLinkedRoom {
            // Owner's own wallet: Web approval (Phantom signs), never server signing.
            let destination = destinationWallet(for: asset)
            Task { await runApprovalFlow(assetId: assetId, asset: asset, requestId: requestId, kind: .send, toWallet: destination) }
        } else {
            let toLabel = activeWallet.devnetLabel == "owner-a" ? "owner-b" : "owner-a"
            let destinationWalletId = (toLabel == "owner-a" ? DemoWallet.ownerADevnet : DemoWallet.ownerBDevnet).id
            Task { await runDevnetTransfer(assetId: assetId, asset: asset, requestId: requestId, toLabel: toLabel, destinationWalletId: destinationWalletId, quoteId: nil) }
        }
    }

    /// "外す" isn't available while a "送る"/"Twinfoldに売る" is
    /// pending/failed — `RoomOverlayView`'s Retry button reads this to
    /// decide what to retry.
    func retrySelected() {
        guard let assetId = selectedAssetId else { return }
        switch transferOperationKinds[assetId] ?? .send {
        case .send:
            sendSelected()
        case .buyback:
            // Re-open the offer sheet rather than blindly resending: the
            // quote's eligibility/price may be stale after a failure, and
            // the server re-derives eligibility at send time regardless.
            presentBuybackOffer(assetId: assetId)
        }
    }

    // MARK: - Twinfoldに売る (buyback)

    /// Fetches a fresh buyback offer for `assetId` (defaults to the
    /// selected asset) and opens the offer sheet. DEMO DATA in Demo mode,
    /// a real devnet-derived offer in Devnet mode — no real payment either
    /// way; see `AGENTS.md` section 3 and the buyback-quote route's
    /// comments.
    func presentBuybackOffer(assetId: String? = nil) {
        refreshLinkState()
        guard canOperateOnActiveWallet else { return }
        guard let assetId = assetId ?? selectedAssetId else { return }
        buybackAssetId = assetId
        buybackQuote = nil
        buybackQuoteError = nil
        buybackQuoteLoading = true

        Task {
            do {
                let quote: BuybackQuote
                if let mock = provider as? MockAssetProvider {
                    quote = try await mock.buybackQuote(assetId: assetId, wallet: activeWallet.id)
                } else if let solana = provider as? SolanaAssetProvider {
                    quote = try await solana.buybackQuote(assetId: assetId, wallet: activeWallet.id)
                } else {
                    throw AssetProviderError.unsupportedOperation("no AssetProvider backing found for buyback quote")
                }
                await MainActor.run {
                    self.buybackQuote = quote
                    self.buybackQuoteLoading = false
                }
            } catch {
                await MainActor.run {
                    self.buybackQuoteError = "Could not fetch the offer: \(error)"
                    self.buybackQuoteLoading = false
                }
            }
        }
    }

    func dismissBuybackOffer() {
        buybackAssetId = nil
        buybackQuote = nil
        buybackQuoteError = nil
        buybackQuoteLoading = false
    }

    /// Confirms the currently-shown offer: transfers the asset to
    /// Twinfold's vault wallet. Demo mode simulates this exactly like a
    /// P2P transfer (`MockAssetProvider.vaultWallet` as the destination);
    /// Devnet mode sends a real devnet transfer to the vault wallet via the
    /// same `/api/devnet/transfer` shortcut used for P2P sends.
    func confirmBuyback() {
        refreshLinkState()
        guard canOperateOnActiveWallet else { return }
        guard let assetId = buybackAssetId,
              let quote = buybackQuote, quote.eligible,
              let asset = ownedAssets.first(where: { $0.id == assetId }) else { return }
        dismissBuybackOffer()

        transferStates[assetId] = .pending
        transferOperationKinds[assetId] = .buyback
        buybackOfferTexts[assetId] = "\(Int(quote.offerAmount).formatted(.number.grouping(.automatic))) \(quote.currency)"
        if let live = liveEntities[assetId] {
            AssetCardEntity.apply(state: .pending, to: live.cardEntity)
        }
        let requestId = UUID().uuidString

        if dataMode == .demo {
            Task { await runBuybackDemo(assetId: assetId, asset: asset, requestId: requestId) }
        } else if isLinkedRoom {
            Task {
                await runApprovalFlow(assetId: assetId, asset: asset, requestId: requestId, kind: .buyback, toWallet: nil)
            }
        } else {
            Task {
                await runDevnetTransfer(
                    assetId: assetId, asset: asset, requestId: requestId,
                    toLabel: "vault", destinationWalletId: MockAssetProvider.vaultWallet, quoteId: quote.quoteId
                )
            }
        }
    }

    private func runBuybackDemo(assetId: String, asset: TwinfoldAsset, requestId: String) async {
        guard let mock = provider as? MockAssetProvider else { return }
        do {
            _ = try await mock.simulateTransfer(assetId: assetId, to: MockAssetProvider.vaultWallet, requestId: requestId)
        } catch {
            await MainActor.run { self.failTransfer(assetId: assetId, message: "Sale to Twinfold (legacy demo) failed: \(error)") }
            return
        }
        do {
            let entitlement = try await provider.refreshOwnership(assetId: assetId)
            await MainActor.run {
                if entitlement.canDisplay {
                    self.failTransfer(assetId: assetId, message: "Confirmed, but this wallet still holds the entitlement: \(entitlement.reason)")
                } else {
                    self.confirmTransfer(assetId: assetId, asset: asset, destination: MockAssetProvider.vaultWallet)
                }
            }
        } catch {
            await MainActor.run { self.failTransfer(assetId: assetId, message: "Entitlement check failed: \(error)") }
        }
    }

    /// Devnet path shared by P2P send and buyback: sends
    /// `/api/devnet/transfer`, then polls (up to 5 minutes, every 5s) until
    /// DAS reflects the new owner — Helius's indexer can lag behind the
    /// devnet RPC confirmation the transfer route itself waits for.
    private func runDevnetTransfer(
        assetId: String, asset: TwinfoldAsset, requestId: String,
        toLabel: String, destinationWalletId: String, quoteId: String?
    ) async {
        guard let solana = provider as? SolanaAssetProvider else { return }
        let opLabel = toLabel == "vault" ? "Sale to Twinfold (legacy demo)" : "Send"
        do {
            // Test rooms only (server-signed, insecure dev flag): never attach the linked wallet's token.
            let result = try await solana.devnetTransfer(
                requestId: requestId, assetId: assetId, from: activeWallet.devnetLabel, to: toLabel, quoteId: quoteId,
                useSessionToken: false
            )
            if result.status == .failed {
                await MainActor.run { self.failTransfer(assetId: assetId, message: "\(opLabel) failed: \(result.error ?? "unknown error")") }
                return
            }
        } catch {
            await MainActor.run { self.failTransfer(assetId: assetId, message: self.transferFailureMessage(error, opLabel: opLabel)) }
            return
        }

        let deadline = Date().addingTimeInterval(300)
        while Date() < deadline {
            if let refreshed = try? await solana.getAsset(assetId: assetId), refreshed.owner != activeWallet.id {
                await MainActor.run { self.confirmTransfer(assetId: assetId, asset: asset, destination: destinationWalletId) }
                return
            }
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
        await MainActor.run {
            self.failTransfer(
                assetId: assetId,
                message: "\(opLabel) is confirmed on devnet, but the owner update is still pending (DAS indexing lag). Retry checks again"
            )
        }
    }

    /// Overflow menu "失敗をシミュレート (demo)" for the selected asset.
    func simulateFailureForSelected() {
        guard dataMode == .demo else { return }
        guard let assetId = selectedAssetId,
              let live = liveEntities[assetId],
              transferState(for: assetId) != .pending else { return }
        transferStates[assetId] = .pending
        AssetCardEntity.apply(state: .pending, to: live.cardEntity)
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            await MainActor.run { self.failTransfer(assetId: assetId, message: "Transfer failed. Press Retry") }
        }
    }

    private func runTransfer(assetId: String, asset: TwinfoldAsset, destination: String, requestId: String) async {
        if let mock = provider as? MockAssetProvider {
            do {
                _ = try await mock.simulateTransfer(assetId: assetId, to: destination, requestId: requestId)
            } catch {
                await MainActor.run { self.failTransfer(assetId: assetId, message: "transfer failed: \(error)") }
                return
            }
        } else {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }

        do {
            let entitlement = try await provider.refreshOwnership(assetId: assetId)
            await MainActor.run {
                if entitlement.canDisplay {
                    self.failTransfer(assetId: assetId, message: "Transfer confirmed, but this wallet still holds the entitlement: \(entitlement.reason)")
                } else {
                    self.confirmTransfer(assetId: assetId, asset: asset, destination: destination)
                }
            }
        } catch {
            await MainActor.run { self.failTransfer(assetId: assetId, message: "Entitlement check failed: \(error)") }
        }
    }

    /// The card/twin Disappears via the next `loadOwnedAssets` ->
    /// `syncEntities` pass (this session's wallet no longer owns it), not
    /// removed directly here, so other placed assets are untouched.
    private func confirmTransfer(assetId: String, asset: TwinfoldAsset, destination: String) {
        transferStates[assetId] = .confirmed
        if selectedAssetId == assetId { selectedAssetId = nil }
        toast = TransferToast(
            assetTitle: asset.displayTitle(), destinationWallet: destination,
            buybackOfferText: destination == MockAssetProvider.vaultWallet ? buybackOfferTexts[assetId] : nil
        )
        Task { await loadOwnedAssets() }
    }

    /// Keeps the card in place (still placed) and shows a red frame, so
    /// the operation card can offer Retry.
    private func failTransfer(assetId: String, message: String) {
        transferStates[assetId] = .failed
        if let live = liveEntities[assetId] {
            AssetCardEntity.apply(state: .failed, to: live.cardEntity)
        }
        loadErrorMessage = message
    }

    func dismissToast() {
        toast = nil
    }

    /// "〈相手〉の部屋を見る" — switches to the destination wallet so the
    /// just-transferred asset Appears at the same spot.
    func viewDestinationRoom() {
        guard let toast, !toast.isVaultDestination else { return }
        let match = (DemoWallet.all + DemoWallet.allDevnet).first(where: { $0.id == toast.destinationWallet })
        switchWallet(to: match ?? .ownerB)
        self.toast = nil
    }

    // MARK: - Appear (a Pull the Web just finished) and Disappear (ownership refresh)

    /// Called from the scene phase: while the room is on screen and the app is active, the Pull feed is polled every 3
    /// seconds and the owned list is re-read every 30 seconds. Both stop in the background.
    func setRoomActive(_ active: Bool) {
        guard active != isRoomActive else { return }
        isRoomActive = active
        packPollTask?.cancel()
        ownershipRefreshTask?.cancel()
        packPollTask = nil
        ownershipRefreshTask = nil
        guard active else { return }
        if packFeedSince == nil { packFeedSince = Date().addingTimeInterval(-Self.packFeedLookback) }
        packPollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let extraDelay = await self.pollPacksOnce()
                try? await Task.sleep(nanoseconds: UInt64((Self.packPollInterval + extraDelay) * 1_000_000_000))
            }
        }
        ownershipRefreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(Self.ownershipRefreshInterval * 1_000_000_000))
                guard let self, !Task.isCancelled else { return }
                await self.refreshOwnedAssetsQuietly()
            }
        }
    }

    /// One poll of the Pull feed. Demo: the mock's simulated Pulls. Devnet: the linked wallet's feed (device token),
    /// only while the linked wallet's room is shown. Mainnet: never (read-only). Returns extra seconds to wait before
    /// the next poll (rate limit back-off).
    @discardableResult
    func pollPacksOnce() async -> TimeInterval {
        let mode = dataMode
        let feed: GachaPacksResponse
        do {
            switch mode {
            case .mainnet:
                return 0
            case .demo:
                feed = try await mockProvider.getRecentPacks(since: packFeedSince)
            case .devnet:
                refreshLinkState()
                guard isLinkedRoom else { return 0 }
                feed = try await devnetProvider.getRecentPacks(since: packFeedSince)
            }
        } catch AssetProviderError.linkRequired {
            return 0
        } catch AssetProviderError.httpError(let status, _) {
            if status == 401 { refreshLinkState() }
            // 429: the feed is capped per wallet per hour; back off instead of hammering.
            return status == 429 ? 30 : 5
        } catch {
            print("pollPacksOnce failed: \(error)")
            return 0
        }
        // The answer is for the room that was shown when asked, and only a feed of the shown wallet may Appear here.
        guard mode == dataMode, feed.wallet == activeWallet.id else { return 0 }

        let queued = Set(pendingAppears.map(\.memo))
        let fresh = GachaPackDiff.newlyOpened(feed.packs, shown: shownMemos.set.union(queued), since: packFeedSince)
        for pack in fresh {
            guard let asset = pack.asset else { continue }
            pendingAppears.append(PendingAppear(memo: pack.memo, asset: asset, deadline: Date().addingTimeInterval(Self.appearWaitForPlane)))
        }
        processPendingAppears()
        return 0
    }

    /// Places queued Appears: on the plane under the screen center (wall: hung flat, desk / floor: stood), or after
    /// `appearWaitForPlane` (or at once without ARKit, i.e. the simulator) at the fixed fallback position. Called every
    /// frame from the AR view and right after a poll. One slab per call, so several Pulls come out one after another.
    func processPendingAppears() {
        guard !pendingAppears.isEmpty, let arView, holdingAssetId == nil else { return }
        let pending = pendingAppears[0]

        var transform: simd_float4x4?
        var isWall = false
        var surface: SlabSurface = .wall
        let height = GradedSlabDimensions.psaStandard.height

        if isARSupported {
            let point = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)
            if let (hit, isVertical) = slabRaycast(in: arView, at: point),
               let cameraTransform = arView.session.currentFrame?.camera.transform {
                transform = isVertical ? wallTransform(hit: hit) : floorTransform(hit: hit, cameraTransform: cameraTransform)
                isWall = isVertical
                surface = isVertical ? .wall : .horizontal
            } else if Date() >= pending.deadline, let cameraTransform = arView.session.currentFrame?.camera.transform {
                transform = airTransform(cameraTransform: cameraTransform) // no plane found: upright in the air
            }
        } else {
            transform = fallbackTransform(index: placementCoords.count)
        }
        guard var placed = transform else { return } // keep waiting for a plane

        pendingAppears.removeFirst()
        shownMemos.insert(pending.memo) // this memo Appears once, also across launches
        let asset = pending.asset

        if liveEntities[asset.id] != nil || placementCoords[asset.id] != nil {
            return // already in the room (e.g. the same demo card pulled again): nothing to place twice
        }
        if isWall {
            placed.columns.3.y = snappedWallY(candidateY: placed.columns.3.y, candidateHeight: height, excludingAssetId: asset.id)
        }
        placed = nudgedClear(of: placed)

        appearedAssets[asset.id] = (asset, Date())
        if !ownedAssets.contains(where: { $0.id == asset.id }) { ownedAssets.append(asset) }
        materialize(
            assetId: asset.id, asset: asset, transform: placed, isWall: isWall,
            cardHeightOverride: isWall ? height : 0, slabSurface: surface, animateAppear: true
        )
        selectedAssetId = nil
    }

    /// Moves `transform` sideways (along the slab's own x axis) until it no longer overlaps an already placed slab,
    /// so Pulls that land on the same spot stand side by side.
    private func nudgedClear(of transform: simd_float4x4) -> simd_float4x4 {
        let step = GradedSlabDimensions.psaStandard.width + 0.012
        let right = SIMD3<Float>(transform.columns.0.x, transform.columns.0.y, transform.columns.0.z)
        var result = transform
        for _ in 0..<8 {
            let position = SIMD3<Float>(result.columns.3.x, result.columns.3.y, result.columns.3.z)
            let overlaps = placementCoords.values.contains { coord in
                let other = SIMD3<Float>(coord.transform.columns.3.x, coord.transform.columns.3.y, coord.transform.columns.3.z)
                return simd_distance(other, position) < step - 0.004
            }
            guard overlaps else { break }
            result.columns.3 = SIMD4<Float>(position + right * step, 1)
        }
        return result
    }

    /// Re-reads the owned list (Devnet / Mainnet) without touching the on-screen error text, and lets a placed card
    /// whose mint is gone from the wallet (e.g. sold back to Collector Crypt) Disappear. A failed read changes nothing.
    func refreshOwnedAssetsQuietly() async {
        let mode = dataMode
        let wallet = activeWallet.id
        guard mode != .demo, !wallet.isEmpty else { return }
        guard let fetched = try? await fetchAssets(mode: mode, wallet: wallet) else { return }
        guard mode == dataMode, wallet == activeWallet.id else { return }
        ownedAssets = mergeAppeared(into: fetched)
        lastFetchedAt = Date()
        syncEntities()
    }

    // MARK: - Demo: simulated Pull and buyback (recording helpers, DEMO DATA only)

    /// "Simulate pull (DEMO DATA)": the mock opens the next demo card as a Pull; the same feed -> Appear path as a real
    /// Pull then runs. Never a real transaction.
    func simulatePull() {
        guard dataMode == .demo else { return }
        if activeWallet.id != MockAssetProvider.cardCollectorWallet { switchWallet(to: .cardCollectorDemo) }
        Task {
            await loadOwnedAssets()
            do {
                _ = try await mockProvider.simulatePull()
            } catch {
                print("simulatePull failed: \(error)")
                return
            }
            await pollPacksOnce()
        }
    }

    /// "Simulate buyback (DEMO DATA)" for the selected card: the demo owner changes to the vault, the next read no
    /// longer lists it, and it Disappears (the same sync as a real sell-back seen by the ownership refresh).
    func simulateBuybackForSelected() {
        guard dataMode == .demo, let assetId = selectedAssetId,
              ownedAssets.first(where: { $0.id == assetId }).map(AssetRepresentationEntity.isSlab) == true else { return }
        let requestId = UUID().uuidString
        Task {
            _ = try? await mockProvider.simulateTransfer(assetId: assetId, to: MockAssetProvider.vaultWallet, requestId: requestId)
            await loadOwnedAssets()
        }
    }

    // MARK: - Passport

    var passportAsset: TwinfoldAsset? { ownedAssets.first { $0.id == passportAssetId } }

    func presentPassportForSelected() {
        guard let selectedAssetId, ownedAssets.first(where: { $0.id == selectedAssetId }).map(AssetRepresentationEntity.isSlab) == true else { return }
        passportAssetId = selectedAssetId
    }

    func dismissPassport() { passportAssetId = nil }

    // MARK: - Reset

    func reset() {
        guard !transferStates.values.contains(.pending) else { return }
        for live in liveEntities.values {
            removeLiveAnchor(live)
        }
        liveEntities.removeAll()
        placementCoords.removeAll()
        cardOnlyAssetIds.removeAll()
        transferStates.removeAll()
        transferOperationKinds.removeAll()
        selectedAssetId = nil
        passportAssetId = nil
        appearedAssets.removeAll()
        pendingAppears.removeAll()
        cancelHolding()
        toast = nil
        dismissBuybackOffer()
        activeWallet = walletOptions.first ?? (dataMode == .mainnet ? .noWallet : .ownerA)

        if let mock = provider as? MockAssetProvider {
            Task {
                await mock.resetDemoState()
                await loadOwnedAssets()
            }
        } else {
            Task { await loadOwnedAssets() }
        }
    }

    // MARK: - Hint text

    var hintText: String {
        if let selectedAssetId, transferState(for: selectedAssetId) == .pending {
            return "Sending… waiting for confirmation"
        }
        if let selectedAssetId, transferState(for: selectedAssetId) == .failed {
            return "Send failed. Press Retry"
        }
        if let holdingAssetId {
            guard isARSupported else {
                return "AR is not supported here. Tap to place at a fixed position"
            }
            let heldAsset = ownedAssets.first(where: { $0.id == holdingAssetId })
            if heldAsset.map(AssetRepresentationEntity.isSlab) == true {
                return isPreviewDetected ? "Tap to place (hangs on walls, stands on desks and floors)" : "Point at a wall, desk, or floor"
            }
            let isTwin = heldAsset.map(AssetRepresentationEntity.isTwin) ?? false
            if isTwin {
                return isPreviewDetected ? "Tap to place on a desk or floor" : "Point at a desk or floor"
            } else {
                return isPreviewDetected ? "Tap to hang on the wall" : "Point at a wall"
            }
        }
        if mainnetNeedsLink {
            return "Mainnet (read-only): link a wallet from the top right to show the cards in your wallet (read-only)"
        }
        if selectedAssetId != nil {
            return isReadOnlyMode ? "Tap a card to open its Passport" : "Tap an item to see its provenance and send options"
        }
        if unplacedCount == 0 {
            return "Tap an item to see its provenance"
        }
        return "Pick an item below, then point at a wall, desk, or floor"
    }

    // MARK: - Placement math

    private func materialize(
        assetId: String,
        asset: TwinfoldAsset,
        transform: simd_float4x4,
        isWall: Bool,
        cardHeightOverride: Float = 0,
        slabSurface: SlabSurface = .wall,
        animateAppear: Bool = false
    ) {
        guard let arView else { return }
        // Register an ARAnchor so ARKit corrects its pose on map relocalization; the simulator fallback keeps a plain world anchor.
        var arAnchor: ARAnchor?
        let anchor: AnchorEntity
        if isARSupported {
            let registered = ARAnchor(name: "twinfold.asset.\(assetId)", transform: transform)
            arView.session.add(anchor: registered)
            arAnchor = registered
            anchor = AnchorEntity(anchor: registered)
        } else {
            anchor = AnchorEntity(world: transform)
        }
        let style: SlabStyle = cardOnlyAssetIds.contains(assetId) ? .cardOnly : .holder
        let entity = AssetRepresentationEntity.makeForWallPlacement(asset: asset, style: style)
        anchor.addChild(entity)
        let isSlab = AssetRepresentationEntity.isSlab(asset)
        if isSlab { GradedSlabEntity.pose(entity, on: slabSurface) }
        arView.scene.addAnchor(anchor)
        if animateAppear {
            // Appear: fade in and rise a few centimetres. Scale is never touched.
            Task { await PresenceAnimation.appear(entity) }
        }

        var twinFootprint: (width: Float, height: Float)?
        let isTwin = AssetRepresentationEntity.isTwin(asset)
        if isTwin {
            twinFootprint = AssetRepresentationEntity.settleOnAnchor(entity: entity, anchor: anchor)
        } else if isSlab, slabSurface == .horizontal {
            // Lying flat on the surface (card or slab): as wide as the object, almost no height.
            twinFootprint = (
                style == .cardOnly ? GradedSlabDimensions.card.width : GradedSlabDimensions.psaStandard.width,
                0.001
            )
        }

        liveEntities[assetId] = LiveEntity(anchor: anchor, arAnchor: arAnchor, cardEntity: entity, provenanceColumn: nil, twinFootprint: twinFootprint)
        // Store the exact `transform` parameter, not a read-back of
        // `anchor.transform` — re-materializing the same asset later (a
        // wallet switch, or Appear after a transfer) always passes
        // `coord.transform` straight back into this function, so any
        // read-back here would compound rounding drift across repeated
        // Disappear/Appear cycles instead of reproducing the exact
        // placement.
        placementCoords[assetId] = PlacementCoord(
            transform: transform,
            isWallPlacement: isWall,
            isFloorPlacement: isTwin || (isSlab && slabSurface == .horizontal),
            footprintHeight: isWall ? cardHeightOverride : (twinFootprint?.height ?? 0),
            slabSurface: slabSurface
        )
        applyHighlights()
    }

    /// Raycast for a slab: the plane under the screen center, vertical (wall) or horizontal (desk, floor). Detected
    /// planes first, then ARKit's estimate.
    private func slabRaycast(in arView: ARView, at point: CGPoint) -> (hit: ARRaycastResult, isVertical: Bool)? {
        let hit = arView.raycast(from: point, allowing: .existingPlaneGeometry, alignment: .any).first
            ?? arView.raycast(from: point, allowing: .estimatedPlane, alignment: .any).first
        guard let hit else { return nil }
        // The hit's y axis is the plane normal: near-horizontal normal = wall, near-vertical = desk / floor.
        let isVertical = abs(hit.worldTransform.columns.1.y) < 0.5
        return (hit, isVertical)
    }

    private static func yawFacingCamera(cameraTransform: simd_float4x4) -> Float {
        let cameraForward = -SIMD3<Float>(
            cameraTransform.columns.2.x,
            cameraTransform.columns.2.y,
            cameraTransform.columns.2.z
        )
        let headingXZ = SIMD3<Float>(cameraForward.x, 0, cameraForward.z)
        let facing = length(headingXZ) > .ulpOfOne ? -normalize(headingXZ) : SIMD3<Float>(0, 0, 1)
        return atan2(facing.x, facing.z)
    }

    private func airTransform(cameraTransform: simd_float4x4) -> simd_float4x4 {
        let cameraPosition = SIMD3<Float>(
            cameraTransform.columns.3.x,
            cameraTransform.columns.3.y,
            cameraTransform.columns.3.z
        )
        let cameraForward = -SIMD3<Float>(
            cameraTransform.columns.2.x,
            cameraTransform.columns.2.y,
            cameraTransform.columns.2.z
        )
        let position = cameraPosition + cameraForward * Self.placementDistance
        let rotation = simd_quatf(angle: Self.yawFacingCamera(cameraTransform: cameraTransform), axis: SIMD3<Float>(0, 1, 0))
        var transform = simd_float4x4(rotation)
        transform.columns.3 = SIMD4<Float>(position, 1)
        return transform
    }

    /// Fixed positions for the AR-unsupported (simulator) fallback,
    /// offset by `index` (the number of assets already placed) so
    /// multiple fallback placements don't overlap.
    private func fallbackTransform(index: Int) -> simd_float4x4 {
        var transform = matrix_identity_float4x4
        let xOffset = Float(index) * 0.3 - 0.15
        transform.columns.3 = SIMD4<Float>(xOffset, -0.05, -0.4, 1)
        return transform
    }

    /// Positions a wall-placed asset flush against the wall (offset only by
    /// `AssetCardEntity.paperWallOffset`, not by the fixture's `depthCm`) —
    /// wall placement on iOS always renders as
    /// `AssetCardEntity.makePaper(asset:)`, a paper sheet with essentially
    /// no thickness, so the gap doesn't depend on the asset's own size.
    private func wallTransform(hit: ARRaycastResult) -> simd_float4x4 {
        let hitTransform = hit.worldTransform
        let rawNormal = SIMD3<Float>(hitTransform.columns.1.x, hitTransform.columns.1.y, hitTransform.columns.1.z)
        let flattenedNormal = SIMD3<Float>(rawNormal.x, 0, rawNormal.z)
        let forward = length(flattenedNormal) > .ulpOfOne ? normalize(flattenedNormal) : SIMD3<Float>(0, 0, 1)
        let worldUp = SIMD3<Float>(0, 1, 0)
        let right = normalize(cross(worldUp, forward))
        let up = cross(forward, right)

        let hitPosition = SIMD3<Float>(hitTransform.columns.3.x, hitTransform.columns.3.y, hitTransform.columns.3.z)
        let position = hitPosition + forward * AssetCardEntity.paperWallOffset

        var transform = matrix_identity_float4x4
        transform.columns.0 = SIMD4<Float>(right, 0)
        transform.columns.1 = SIMD4<Float>(up, 0)
        transform.columns.2 = SIMD4<Float>(forward, 0)
        transform.columns.3 = SIMD4<Float>(position, 1)
        return transform
    }

    private func floorTransform(hit: ARRaycastResult, cameraTransform: simd_float4x4) -> simd_float4x4 {
        let hitTransform = hit.worldTransform
        let hitPosition = SIMD3<Float>(hitTransform.columns.3.x, hitTransform.columns.3.y, hitTransform.columns.3.z)
        let rotation = simd_quatf(angle: Self.yawFacingCamera(cameraTransform: cameraTransform), axis: SIMD3<Float>(0, 1, 0))
        var transform = simd_float4x4(rotation)
        transform.columns.3 = SIMD4<Float>(hitPosition, 1)
        return transform
    }

    /// If an already-placed wall card's top edge is within
    /// `wallSnapTolerance` of the candidate's top edge, nudge the
    /// candidate's y so the two tops align exactly.
    private func snappedWallY(candidateY: Float, candidateHeight: Float, excludingAssetId: String) -> Float {
        let candidateTop = candidateY + candidateHeight / 2
        for (assetId, coord) in placementCoords where assetId != excludingAssetId && coord.isWallPlacement {
            let existingTop = coord.transform.columns.3.y + coord.footprintHeight / 2
            if abs(existingTop - candidateTop) < Self.wallSnapTolerance {
                return existingTop - candidateHeight / 2
            }
        }
        return candidateY
    }

    private func provenanceColumnX(for asset: TwinfoldAsset, live: LiveEntity) -> Float {
        if let twinFootprint = live.twinFootprint {
            return twinFootprint.width / 2 + 0.02 + ProvenanceNodeEntity.width / 2
        }
        let footprint = AssetRepresentationEntity.footprint(
            for: asset, style: cardOnlyAssetIds.contains(asset.id) ? .cardOnly : .holder
        )
        return footprint.width / 2 + 0.02 + ProvenanceNodeEntity.width / 2
    }

    private func provenanceColumnY(for live: LiveEntity) -> Float {
        guard let twinFootprint = live.twinFootprint else { return 0 }
        return twinFootprint.height / 2
    }
}
