import ARKit
import RealityKit
import SwiftUI

/// Wraps `ARView` for SwiftUI. Owns the only ARKit/UIKit-specific code in
/// the app: session configuration (world tracking, no plane detection —
/// the card is placed camera-relative, not on a detected surface) and the
/// tap (place/pull), pan (rotate), and pinch (scale) gestures. All
/// Twinfold entity creation and transform math is delegated to
/// `TwinfoldSpatial` / `ARSceneController`.
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
            configuration.planeDetection = []
            arView.session.run(configuration)
        }

        let tapGesture = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap(_:))
        )
        tapGesture.delegate = context.coordinator
        arView.addGestureRecognizer(tapGesture)

        let panGesture = UIPanGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handlePan(_:))
        )
        // One finger only, so a two-finger pinch's centroid drift doesn't
        // also rotate the card.
        panGesture.maximumNumberOfTouches = 1
        panGesture.delegate = context.coordinator
        arView.addGestureRecognizer(panGesture)

        let pinchGesture = UIPinchGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handlePinch(_:))
        )
        pinchGesture.delegate = context.coordinator
        arView.addGestureRecognizer(pinchGesture)

        return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(controller: controller)
    }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        let controller: ARSceneController

        init(controller: ARSceneController) {
            self.controller = controller
        }

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard let arView = recognizer.view as? ARView else { return }
            let point = recognizer.location(in: arView)
            controller.handleTap(at: point)
        }

        /// One-finger drag: horizontal movement rotates the card about the
        /// world Y axis (yaw), vertical movement rotates it about its own
        /// local X axis (pitch). Sensitivity is tuned so a full screen
        /// width of drag is about 180 degrees. `translation` is reset to
        /// zero after each `.changed` callback, so each call only carries
        /// the incremental movement since the previous one.
        @objc func handlePan(_ recognizer: UIPanGestureRecognizer) {
            guard recognizer.state == .changed, let view = recognizer.view else { return }
            let translation = recognizer.translation(in: view)
            let width = max(Float(view.bounds.width), 1)
            let yawDelta = Float(translation.x) / width * .pi
            let pitchDelta = Float(translation.y) / width * .pi
            controller.rotate(yawDelta: yawDelta, pitchDelta: pitchDelta)
            recognizer.setTranslation(.zero, in: view)
        }

        /// Pinch: `recognizer.scale` is the cumulative scale since the
        /// gesture began, so it's passed to the controller as an
        /// incremental factor and then reset to 1 after each `.changed`
        /// callback (the controller keeps its own clamped cumulative
        /// scale).
        @objc func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
            guard recognizer.state == .changed else { return }
            controller.scale(by: Float(recognizer.scale))
            recognizer.scale = 1
        }

        /// Lets pan and pinch run at the same time (e.g. rotating while
        /// pinching), and lets the tap recognizer coexist with both — tap
        /// only fires on a short, stationary touch, so it doesn't compete
        /// with pan's movement threshold or pinch's two-finger requirement.
        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }
    }
}
