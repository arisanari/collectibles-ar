import SwiftUI
import TwinfoldCore

/// Full-screen list of every asset the active wallet owns, presented as a
/// sheet from `AssetTrayView`'s "全部見る" affordance. Read-only browsing —
/// placement/selection/transfer all happen in `MyRoomView`'s AR scene, not
/// here. A segmented control at the top switches the data source (Demo /
/// Devnet / Mainnet read-only); wallet switching lives on the AR screen's
/// overflow menu, not in this sheet.
struct CollectionView: View {
    let assets: [TwinfoldAsset]
    let dataMode: DataMode
    /// Mainnet (read-only) with no linked Web wallet yet: nothing to read.
    let needsWalletLink: Bool
    let isPlaced: (String) -> Bool
    let onSelectMode: (DataMode) -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Data source", selection: Binding(get: { dataMode }, set: { onSelectMode($0) })) {
                        Text("Demo").tag(DataMode.demo)
                        Text("Devnet").tag(DataMode.devnet)
                        Text("Mainnet (read-only)").tag(DataMode.mainnet)
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    if needsWalletLink {
                        Text("Link a wallet from the top right to show the Mainnet cards in your wallet (read-only)")
                            .foregroundStyle(.secondary)
                    } else if assets.isEmpty {
                        Text("This wallet has no assets")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(assets) { asset in
                        row(for: asset)
                    }
                } header: {
                    dataBadge
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
                Text(asset.displayTitle()).font(.headline)
                if asset.isGradedCard {
                    let lines = GradedSlabDimensions.labelLines(for: asset)
                    if !lines.headline.isEmpty {
                        Text(lines.headline).font(.caption.bold())
                    }
                }
                Text(asset.address).font(.caption).foregroundStyle(.secondary)
                if let physical = asset.physical {
                    Text(physical.condition).font(.caption2).foregroundStyle(.secondary)
                }
                HStack(spacing: 6) {
                    if asset.network == "mainnet" {
                        Text(DataMode.mainnet.badge).font(.caption2.bold()).foregroundStyle(.purple)
                    }
                    if asset.sourceVerified == false {
                        Text("UNVERIFIED SOURCE").font(.caption2.bold()).foregroundStyle(.red)
                    }
                }
                if asset.sourceVerified == false {
                    Text("Not confirmed as issued by Collector Crypt. It cannot be placed in AR")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Text(isPlaced(asset.id) ? "Placed" : "Not placed")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }

    private var dataBadge: some View {
        Text(dataMode.badge)
            .font(.caption.bold())
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background((dataMode == .mainnet ? Color.purple : Color.orange).opacity(0.85))
            .foregroundStyle(.white)
            .clipShape(Capsule())
            .textCase(nil)
    }
}
