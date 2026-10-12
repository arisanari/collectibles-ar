import ARKit
import Combine
import RealityKit
import SwiftUI

/// Wraps `ARView` for SwiftUI. Owns the only ARKit/UIKit-specific code in
/// the app: session configuration (world tracking with both vertical- and
/// horizontal-plane detection — vertical so a `card` asset, a framed print,
/// can be placed flush against a detected wall; horizontal so a `model`
/// twin can be stood on a detected floor/table/shelf), the per-frame
/// holding-preview update, and the tap (select / confirm placement)
/// gesture. All Twinfold entity creation and transform math is delegated
/// to `TwinfoldSpatial` / `RoomController`.
struct ARContainerView: UIViewRepresentable {
    let controller: RoomController

    func makeUIView(context: Context) -> ARView {
        let arView = ARView(
            frame: .zero,
            cameraMode: controller.isARSupported ? .ar : .nonAR,
            automaticallyConfigureSession: false
        )
        controller.arView = arView

        if controller.isARSupported {
            let configuration = ARWorldTrackingConfiguration()
            configuration.planeDetection = [.vertical, .horizontal]
            configuration.environmentTexturing = .automatic
            configuration.isLightEstimationEnabled = true

            if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
                configuration.sceneReconstruction = .mesh
                // occlusion は外す（2026-10-09）。LiDAR mesh が壁や机の面から数 mm〜1 cm 揺れ、壁に貼った薄いカードや影の板を食って点滅した。手やモノによる遮蔽は失うが、デモの撮り方では困らない。
                arView.environment.sceneUnderstanding.options.insert(.receivesLighting)
            }

            arView.session.run(configuration)
        }

        let tapGesture = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap(_:))
        )
        tapGesture.delegate = context.coordinator
        arView.addGestureRecognizer(tapGesture)

        // Drives the holding-preview raycast every frame so the
        // translucent preview tracks the wall/floor under the screen
        // center while the user walks around before tapping to confirm.
        context.coordinator.updateSubscription = arView.scene.subscribe(to: SceneEvents.Update.self) { [weak controller] _ in
            controller?.updateHoldingPreview()
            controller?.processPendingAppears()
        }

        return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(controller: controller)
    }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        let controller: RoomController
        var updateSubscription: Cancellable?

        init(controller: RoomController) {
            self.controller = controller
        }

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard let arView = recognizer.view as? ARView else { return }
            let point = recognizer.location(in: arView)
            controller.handleTap(at: point)
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }
    }
}
