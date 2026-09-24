import SwiftUI
import TwinfoldCore

/// Full-screen list of every asset the active wallet owns, presented as a
/// sheet from `AssetTrayView`'s "全部見る" affordance. Read-only browsing —
/// placement/selection/transfer all happen in `MyRoomView`'s AR scene, not
/// here. Wallet switching lives on the AR screen's overflow menu, not in
/// this sheet.
struct CollectionView: View {
    let assets: [TwinfoldAsset]
    let isDemoData: Bool
    let isPlaced: (String) -> Bool

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if assets.isEmpty {
                        Text("このwalletにAssetはありません")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(assets) { asset in
                        row(for: asset)
                    }
                } header: {
                    demoDataBadge
                }
            }
            .navigationTitle("My Collection")
        }
    }

    private func row(for asset: TwinfoldAsset) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(isPlaced(asset.id) ? Color.green : Color.gray.opacity(0.5))
                .frame(width: 10, height: 10)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 4) {
                Text(asset.title).font(.headline)
                Text(asset.address).font(.caption).foregroundStyle(.secondary)
                if let physical = asset.physical {
                    Text(physical.condition).font(.caption2).foregroundStyle(.secondary)
                }
                Text(isPlaced(asset.id) ? "配置済み" : "未配置")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }

    private var demoDataBadge: some View {
        Text(isDemoData ? "DEMO DATA" : "DEVNET")
            .font(.caption.bold())
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color.orange.opacity(0.85))
            .foregroundStyle(.white)
            .clipShape(Capsule())
            .textCase(nil)
    }
}
