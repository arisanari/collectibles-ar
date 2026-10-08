import SwiftUI
import TwinfoldCore

/// The app's single screen: AR scene ("My Room") with a bottom tray to pick
/// which owned asset to place, plus the overlay chrome for
/// selection/transfer. Replaces the old My Collection list -> per-asset AR
/// screen navigation.
struct MyRoomView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var controller: RoomController
    @State private var showsFullList = false
    /// User-controlled open/closed state of the bottom tray, kept for the
    /// session only (not persisted). Closed = just a handle pill, so most
    /// of the AR view is free for a screenshot of the placed collectibles.
    @State private var isTrayOpen = true
    /// `isTrayOpen` right before a holding preview auto-closed the tray,
    /// so placing/cancelling can restore it instead of always reopening.
    @State private var trayOpenBeforeHolding: Bool?

    init(mockProvider: MockAssetProvider, devnetProvider: SolanaAssetProvider, sessionLink: SessionLinkClient) {
        _controller = State(initialValue: RoomController(mockProvider: mockProvider, devnetProvider: devnetProvider, sessionLink: sessionLink))
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
        #if DEBUG
        .task { await DebugLaunchActions.run(controller) }
        #endif
        // Pull-feed polling (3 s) and ownership refresh (30 s) run only while the app is active.
        .onChange(of: scenePhase, initial: true) { _, phase in
            controller.setRoomActive(phase == .active)
        }
        // `twinfold://link?code=XXXXXXXX` (Web QR scanned with the Camera app): opens the link sheet prefilled.
        .onOpenURL { controller.handleLinkURL($0) }
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
                dataMode: controller.dataMode,
                needsWalletLink: controller.mainnetNeedsLink,
                isPlaced: { controller.isPlaced($0) },
                onSelectMode: { controller.switchDataMode(to: $0) }
            )
        }
        .overlay {
            if let loadErrorMessage = controller.loadErrorMessage {
                VStack(spacing: 8) {
                    Text(loadErrorMessage)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                    // Devnet-only: the API may simply not be running
                    // (see TWINFOLD_API_BASE_URL in project.yml) — give an
                    // explicit way back to the always-available fixture
                    // instead of leaving the room stuck on an error.
                    if controller.dataMode == .devnet {
                        Button("Demo dataに戻る") { controller.switchDataMode(to: .demo) }
                            .buttonStyle(.bordered)
                    }
                }
                .padding()
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                .padding()
            }
        }
    }
}
