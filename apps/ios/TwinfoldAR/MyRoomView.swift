import SwiftUI
import TwinfoldCore

/// The app's single screen: AR scene ("My Room") with a bottom tray to pick
/// which owned asset to place, plus the overlay chrome for
/// selection/transfer. Replaces the old My Collection list -> per-asset AR
/// screen navigation.
struct MyRoomView: View {
    @State private var controller: RoomController
    @State private var showsFullList = false
    /// User-controlled open/closed state of the bottom tray, kept for the
    /// session only (not persisted). Closed = just a handle pill, so most
    /// of the AR view is free for a screenshot of the placed collectibles.
    @State private var isTrayOpen = true
    /// `isTrayOpen` right before a holding preview auto-closed the tray,
    /// so placing/cancelling can restore it instead of always reopening.
    @State private var trayOpenBeforeHolding: Bool?

    init(provider: any AssetProvider) {
        _controller = State(initialValue: RoomController(provider: provider))
    }

    var body: some View {
        ZStack {
            ARContainerView(controller: controller)
                .ignoresSafeArea()
            RoomOverlayView(controller: controller, isTrayOpen: isTrayOpen)
        }
        .safeAreaInset(edge: .bottom) {
            AssetTrayView(controller: controller, showsFullList: $showsFullList, isOpen: $isTrayOpen)
        }
        .task { await controller.start() }
        .onChange(of: controller.holdingAssetId) { oldValue, newValue in
            // Auto-close the tray while a holding preview is being placed
            // (so the preview is easier to see), and restore whatever
            // open/closed state the user had once placement is confirmed
            // or cancelled.
            if oldValue == nil, newValue != nil {
                trayOpenBeforeHolding = isTrayOpen
                isTrayOpen = false
            } else if oldValue != nil, newValue == nil {
                if let trayOpenBeforeHolding {
                    isTrayOpen = trayOpenBeforeHolding
                }
                trayOpenBeforeHolding = nil
            }
        }
        .sheet(isPresented: $showsFullList) {
            CollectionView(
                assets: controller.ownedAssets,
                isDemoData: controller.provider.isDemoData,
                isPlaced: { controller.isPlaced($0) }
            )
        }
        .overlay {
            if let loadErrorMessage = controller.loadErrorMessage {
                Text(loadErrorMessage)
                    .foregroundStyle(.red)
                    .padding()
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .padding()
            }
        }
    }
}
