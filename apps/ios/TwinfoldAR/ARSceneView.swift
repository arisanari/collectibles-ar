import SwiftUI
import TwinfoldCore

/// AR screen for a single asset: `ARContainerView` (ARKit/RealityKit) below
/// `AROverlayView` (SwiftUI chrome), sharing one `ARSceneController`.
struct ARSceneView: View {
    @State private var controller: ARSceneController

    init(asset: TwinfoldAsset, provider: any AssetProvider) {
        _controller = State(initialValue: ARSceneController(asset: asset, provider: provider))
    }

    var body: some View {
        ZStack {
            ARContainerView(controller: controller)
                .ignoresSafeArea()
            AROverlayView(controller: controller)
        }
        .navigationTitle(controller.asset.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
