import ARKit
import RealityKit
import SwiftUI

/// Wraps `ARView` for SwiftUI. Owns the only ARKit-specific code in the
/// app: session configuration, horizontal plane detection, and the tap ->
/// raycast -> place/pull gesture. All Twinfold entity creation is
/// delegated to `TwinfoldSpatial` via `ARSceneController`.
struct ARContainerView: UIViewRepresentable {
    let controller: ARSceneController

    func makeUIView(context: Context) -> ARView {
        let arView = ARView(
            frame: .zero,
            cameraMode: controller.isARSupported ? .ar : .nonAR,
            automaticallyConfigureSession: false
        )
        controller.arView = arView

        if controller.isARSupported {
            let configuration = ARWorldTrackingConfiguration()
            configuration.planeDetection = [.horizontal]
            arView.session.run(configuration)
        }

        let tapGesture = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap(_:))
        )
        arView.addGestureRecognizer(tapGesture)

        return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(controller: controller)
    }

    @MainActor
    final class Coordinator: NSObject {
        let controller: ARSceneController

        init(controller: ARSceneController) {
            self.controller = controller
        }

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard let arView = recognizer.view as? ARView else { return }
            let point = recognizer.location(in: arView)
            controller.handleTap(at: point)
        }
    }
}
