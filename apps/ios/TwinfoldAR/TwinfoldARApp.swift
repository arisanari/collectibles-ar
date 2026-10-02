import SwiftUI
import TwinfoldCore

@main
struct TwinfoldARApp: App {
    var body: some Scene {
        WindowGroup {
            CollectionRootView()
        }
    }
}

/// Owns the app's two `AssetProvider` instances for the app lifetime
/// (bundled `MockAssetProvider` for Demo data, `SolanaAssetProvider` for
/// Devnet — see `RoomController.switchDataMode`) and surfaces a load error
/// if the bundled fixture cannot be read.
struct CollectionRootView: View {
    @State private var mockProvider: MockAssetProvider?
    @State private var loadError: String?
    /// Keychain-backed device session (Issue #45), shared by the devnet
    /// provider (Bearer on transfer/status) and the room controller.
    @State private var sessionLink: SessionLinkClient
    @State private var devnetProvider: SolanaAssetProvider

    init() {
        let link = SessionLinkClient(baseURL: Self.apiBaseURL)
        _sessionLink = State(initialValue: link)
        _devnetProvider = State(initialValue: SolanaAssetProvider(baseURL: Self.apiBaseURL, sessionLink: link))
    }

    var body: some View {
        Group {
            if let mockProvider {
                MyRoomView(mockProvider: mockProvider, devnetProvider: devnetProvider, sessionLink: sessionLink)
            } else if let loadError {
                Text("fixtureの読み込みに失敗しました: \(loadError)")
                    .multilineTextAlignment(.center)
                    .padding()
            } else {
                ProgressView()
            }
        }
        .task {
            do {
                mockProvider = try MockAssetProvider()
            } catch {
                loadError = String(describing: error)
            }
        }
    }

    /// `TWINFOLD_API_BASE_URL` (Info.plist, see `apps/ios/project.yml`),
    /// falling back to `http://localhost:3000` (the iOS Simulator's route
    /// to a `next dev` server on the same Mac). On a physical device this
    /// must be the Mac's LAN IP instead (localhost on-device means the
    /// device itself) — see `.claude/skills/ios-realitykit-ar/SKILL.md`.
    private static var apiBaseURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "TWINFOLD_API_BASE_URL") as? String,
           let url = URL(string: raw) {
            return url
        }
        return URL(string: "http://localhost:3000")!
    }
}
