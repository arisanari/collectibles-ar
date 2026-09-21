import SwiftUI
import TwinfoldCore

/// One of the two demo wallets from fixtures/demo/wallets.json. Hardcoded
/// here (not loaded from the fixture bundle) to avoid exposing
/// wallets.json through TwinfoldCore's public API. This is the single
/// place those addresses are hardcoded for the app target; `ARSceneController`
/// reads `DemoWallet.ownerA`/`.ownerB` directly instead of duplicating the
/// addresses. Keep in sync with the JSON file by hand per
/// docs/architecture.md section 5 (core-contract skill).
struct DemoWallet: Identifiable, Hashable {
    let id: String // wallet address, used as the Picker tag
    let label: String

    static let ownerA = DemoWallet(id: "DEMOwalletA1111111111111111111111111111111", label: "Owner A (demo)")
    static let ownerB = DemoWallet(id: "DEMOwalletB2222222222222222222222222222222", label: "Owner B (demo)")
    static let all: [DemoWallet] = [ownerA, ownerB]
}

/// My Collection list. Badge text follows `provider.isDemoData`
/// (docs/architecture.md section 5). Tapping a stamp pushes into the AR
/// screen for that asset. A toolbar Picker switches between the two demo
/// wallets, so a transfer's old-owner Disappear / new-owner Appear can be
/// verified by re-listing the collection under each wallet.
struct CollectionView: View {
    let provider: any AssetProvider

    @State private var activeWallet = DemoWallet.ownerA
    @State private var assets: [TwinfoldAsset] = []
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if assets.isEmpty, errorMessage == nil {
                        Text("このwalletにAssetはありません。上の Owner を切り替えると届いた切手が見えます（DEMO DATA）")
                            .foregroundStyle(.secondary)
                    }
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
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("Wallet", selection: $activeWallet) {
                        ForEach(DemoWallet.all) { wallet in
                            Text(wallet.label).tag(wallet)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }
            .task(id: activeWallet) { await loadAssets() }
            .onAppear { Task { await loadAssets() } }
            .overlay {
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red).padding()
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
            Text("タップしてARで置く").font(.caption2).foregroundStyle(.tertiary)
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
        // MockAssetProvider only: keep the actor's session wallet in sync
        // with the picker so `refreshOwnership` (used by
        // `ARSceneController`'s simulated transfer) reflects whichever
        // wallet is active here.
        if let mock = provider as? MockAssetProvider {
            await mock.connect(wallet: activeWallet.id)
        }
        do {
            assets = try await provider.getAssets(wallet: activeWallet.id)
            errorMessage = nil
        } catch {
            errorMessage = "資産を読み込めませんでした: \(error)"
        }
    }
}
