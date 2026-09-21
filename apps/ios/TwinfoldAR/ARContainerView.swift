import ARKit
import RealityKit
import SwiftUI

/// Wraps `ARView` for SwiftUI. Owns the only ARKit/UIKit-specific code in
/// the app: session configuration (world tracking with vertical-plane
/// detection, so a `card` asset — a framed print — can be placed flush
/// against a detected wall; falls back to the original camera-relative air
/// placement when no wall is hit) and the tap (place/pull), pan
/// (rotate-in-air / slide-on-wall), and pinch (scale) gestures. All
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
            // Vertical only: walls are where a `card` (framed print) can be
            // placed at true scale (`ARSceneController.handleTap`). No
            // horizontal detection — a `model` (USDZ twin, e.g. the kokeshi)
            // keeps the original camera-relative air placement, which
            // already reads as "resting in front of you" without needing a
            // detected shelf surface.
            configuration.planeDetection = [.vertical]
            // Environment texturing + light estimation: reflections and
            // shading on the placed card/twin pick up the room's real
            // lighting instead of a flat/generic light, so it reads as
            // sitting in the room rather than pasted on top of the camera
            // feed.
            configuration.environmentTexturing = .automatic
            configuration.isLightEstimationEnabled = true

            // LiDAR-only: scene mesh drives occlusion (real furniture in
            // front of the twin hides it) and lets the twin receive
            // shadows/lighting cast by the real room mesh. Non-LiDAR
            // devices skip this; the twin still renders, just without
            // real-world occlusion.
            if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
                configuration.sceneReconstruction = .mesh
                arView.environment.sceneUnderstanding.options.insert(.occlusion)
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

        /// One-finger drag. `ARSceneController.pan` dispatches on how the
        /// card was placed: an air-placed card rotates (horizontal movement
        /// is yaw about the world Y axis, vertical movement is pitch about
        /// the card's own local X axis, tuned so a full screen width of
        /// drag is about 180 degrees); a wall-placed card instead slides
        /// along the wall's own plane. `translation` is reset to zero after
        /// each `.changed` callback, so each call only carries the
        /// incremental movement since the previous one.
        @objc func handlePan(_ recognizer: UIPanGestureRecognizer) {
            guard recognizer.state == .changed, let view = recognizer.view else { return }
            let translation = recognizer.translation(in: view)
            let width = max(Float(view.bounds.width), 1)
            controller.pan(translationX: Float(translation.x), translationY: Float(translation.y), viewWidth: width)
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
