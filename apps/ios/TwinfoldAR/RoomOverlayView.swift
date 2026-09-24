import SwiftUI
import TwinfoldCore

/// AR screen chrome above the tray: DEMO DATA/DEVNET badge, the active
/// wallet chip, overflow menu (wallet switch, simulate-failure, reset), a
/// 1-line hint describing the current state, the holding-preview cancel
/// control, the selected-asset operation card, and the post-transfer
/// toast. Contains no ARKit/RealityKit calls; only reads `RoomController`
/// state.
struct RoomOverlayView: View {
    let controller: RoomController
    /// Whether the bottom tray is open. When closed, the plain hint line
    /// is hidden too (for a clean screenshot); the operation card and
    /// transfer toast still show regardless, since those reflect an
    /// explicit selection/action rather than idle guidance.
    let isTrayOpen: Bool

    var body: some View {
        VStack {
            HStack {
                demoDataBadge
                walletChip
                Spacer()
                overflowMenu
            }
            .padding()

            Spacer()

            VStack(spacing: 10) {
                if let toast = controller.toast {
                    toastView(toast)
                } else if controller.holdingAssetId != nil {
                    hintBar
                    Button("キャンセル") { controller.cancelHolding() }
                        .buttonStyle(.bordered)
                } else if let selectedAssetId = controller.selectedAssetId,
                          let asset = controller.ownedAssets.first(where: { $0.id == selectedAssetId }) {
                    // No separate hint bar while the operation card is
                    // showing — the card's own title/buttons already say
                    // what's selected and what can be done, and a hint
                    // line above it just piles up / repeats that.
                    operationCard(for: asset)
                } else if isTrayOpen {
                    // Idle guidance only — hidden with the tray so a
                    // closed tray gives a clean, uncluttered screenshot.
                    hintBar
                }
            }
            .padding(.bottom, 16)
        }
    }

    private var hintBar: some View {
        Text(controller.hintText)
            .font(.subheadline.bold())
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
    }

    private var demoDataBadge: some View {
        Text(controller.provider.isDemoData ? "DEMO DATA" : "DEVNET")
            .font(.caption.bold())
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color.orange.opacity(0.9))
            .foregroundStyle(.white)
            .clipShape(Capsule())
    }

    /// Always-visible label for which demo wallet's room is currently
    /// shown — otherwise there's no on-screen way to tell Owner A's room
    /// from Owner B's after switching.
    private var walletChip: some View {
        Text("\(controller.activeWallet.label)の部屋")
            .font(.caption.bold())
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color.black.opacity(0.55))
            .foregroundStyle(.white)
            .clipShape(Capsule())
    }

    private var overflowMenu: some View {
        Menu {
            Menu("Wallet: \(controller.activeWallet.label)") {
                ForEach(DemoWallet.all) { wallet in
                    Button(wallet.label) { controller.switchWallet(to: wallet) }
                }
            }

            Button("失敗をシミュレート (demo)") {
                controller.simulateFailureForSelected()
            }
            .disabled(controller.selectedAssetId == nil || controller.transferState(for: controller.selectedAssetId ?? "") == .pending)

            Button("リセット") {
                controller.reset()
            }
            .disabled(controller.transferStatesContainPending)
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.title2)
                .padding(8)
                .background(.ultraThinMaterial, in: Circle())
        }
    }

    private func operationCard(for asset: TwinfoldAsset) -> some View {
        let state = controller.transferState(for: asset.id)
        return VStack(spacing: 8) {
            VStack(spacing: 2) {
                Text(asset.title)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                if let physical = asset.physical {
                    Text("custody: \(physical.custody.status) / \(physical.custody.vault)")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.75))
                }
                Text(controller.provider.isDemoData ? "DEMO DATA" : "DEVNET")
                    .font(.caption2.bold())
                    .foregroundStyle(.orange)
            }

            switch state {
            case .idle:
                HStack(spacing: 8) {
                    Button("来歴") { controller.pullProvenanceForSelected() }
                        .buttonStyle(.bordered)
                    Button("外す") { controller.removeSelected() }
                        .buttonStyle(.bordered)
                    Spacer(minLength: 8)
                    // "送る" lives in this secondary menu (not a primary
                    // button) so it isn't the first thing tapped by
                    // accident, but it's still inside the card — not only
                    // in the top-right overflow — so a first-time user
                    // still finds it while looking at the selected asset.
                    Menu {
                        Button("\(controller.destinationLabelForSelected)へ送る (demo)") {
                            controller.sendSelected()
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.title3)
                            .foregroundStyle(.white)
                            .padding(6)
                    }
                }
            case .pending:
                Button("送信中…") {}
                    .buttonStyle(.borderedProminent)
                    .disabled(true)
            case .failed:
                Button("Retry") { controller.sendSelected() }
                    .buttonStyle(.borderedProminent)
            case .confirmed:
                EmptyView()
            }
        }
        .padding(12)
        // Explicit dark background (not `.ultraThinMaterial`, which
        // follows the system light/dark setting and paired badly with
        // `.primary`-colored text): guarantees the white text above stays
        // readable over the live camera feed regardless of the device's
        // appearance setting.
        .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal, 16)
    }

    private func toastView(_ toast: TransferToast) -> some View {
        VStack(spacing: 8) {
            Text("送信完了（confirmed）／「\(toast.assetTitle)」は\(toast.destinationLabel)の部屋に現れます。他の作品はそのまま")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.white)
            HStack(spacing: 12) {
                Button("\(toast.destinationLabel)の部屋を見る") { controller.viewDestinationRoom() }
                    .buttonStyle(.borderedProminent)
                Button("閉じる") { controller.dismissToast() }
                    .buttonStyle(.bordered)
            }
        }
        .padding(12)
        .background(Color.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal, 16)
    }
}
