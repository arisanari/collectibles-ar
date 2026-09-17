import SwiftUI
import TwinfoldCore

/// My Collection list. Badge text follows `provider.isDemoData`
/// (docs/architecture.md section 5). Tapping the single stamp pushes into
/// the AR screen for that asset.
struct CollectionView: View {
    let provider: any AssetProvider

    @State private var assets: [TwinfoldAsset] = []
    @State private var errorMessage: String?

    private let wallet = "DEMOwalletA1111111111111111111111111111111"

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(assets) { asset in
                        NavigationLink {
                            ARSceneView(asset: asset, provider: provider)
                        } label: {
                            row(for: asset)
                        }
                    }
                } header: {
                    demoDataBadge
                }
            }
            .navigationTitle("My Collection")
            .task { await loadAssets() }
            .overlay {
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red).padding()
                } else if assets.isEmpty {
                    ProgressView()
                }
            }
        }
    }

    private func row(for asset: TwinfoldAsset) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(asset.title).font(.headline)
            Text(asset.address).font(.caption).foregroundStyle(.secondary)
            if let physical = asset.physical {
                Text(physical.condition).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var demoDataBadge: some View {
        Text(provider.isDemoData ? "DEMO DATA" : "DEVNET")
            .font(.caption.bold())
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color.orange.opacity(0.85))
            .foregroundStyle(.white)
            .clipShape(Capsule())
            .textCase(nil)
    }

    private func loadAssets() async {
        do {
            assets = try await provider.getAssets(wallet: wallet)
        } catch {
            errorMessage = "資産を読み込めませんでした: \(error)"
        }
    }
}
