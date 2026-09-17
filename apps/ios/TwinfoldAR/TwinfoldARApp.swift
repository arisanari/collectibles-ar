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

/// Owns the single `MockAssetProvider` instance for the app lifetime and
/// surfaces a load error if the bundled fixture cannot be read.
struct CollectionRootView: View {
    @State private var provider: (any AssetProvider)?
    @State private var loadError: String?

    var body: some View {
        Group {
            if let provider {
                CollectionView(provider: provider)
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
                provider = try MockAssetProvider()
            } catch {
                loadError = String(describing: error)
            }
        }
    }
}
