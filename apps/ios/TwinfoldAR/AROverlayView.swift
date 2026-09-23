import SwiftUI
import TwinfoldCore
import TwinfoldSpatial

/// AR screen chrome: DEMO DATA/DEVNET badge, a large numbered step line
/// (Place → Pull → transfer) that lets a first-time visitor complete the
/// demo without spoken instructions, and the one primary button for the
/// current state. Contains no ARKit/RealityKit calls; only reads
/// `ARSceneController` state.
struct AROverlayView: View {
    let controller: ARSceneController

    var body: some View {
        VStack {
            HStack {
                demoDataBadge
                Spacer()
                overflowMenu
            }
            .padding()

            Spacer()

            VStack(spacing: 10) {
                // Explicit white on a dark translucent panel: the view
                // behind is a live camera feed (or black in the simulator),
                // so the default label color is unreadable.
                Text(stepText)
                    .font(.title3.bold())
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 16)

                if let footnoteMessage {
                    Text(footnoteMessage)
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.85))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
                }

                primaryButton
            }
            .padding(.bottom, 32)
        }
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

    /// Actions that aren't part of the main Place → Pull → transfer path:
    /// simulating a failed transfer and resetting the demo. Kept out of
    /// the bottom button row so there is always exactly one primary
    /// action to tap.
    private var overflowMenu: some View {
        Menu {
            Button("失敗をシミュレート (demo)") {
                controller.simulateTransfer(outcome: .failed)
            }
            .disabled(controller.placement != .placed || controller.transferState == .pending)

            Button("リセット") {
                controller.reset()
            }
            // Reset while pending would let the in-flight transfer Task
            // re-write provider state after resetDemoState() ran.
            .disabled(controller.transferState == .pending)
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.title2)
                .padding(8)
                .background(.ultraThinMaterial, in: Circle())
        }
    }

    /// Large 1-line step copy, always describing the single next action.
    private var stepText: String {
        switch controller.transferState {
        case .pending:
            return "送信中… 確定を待っています"
        case .failed:
            return "送信に失敗。Retryを押す"
        case .confirmed:
            return "送信完了。作品はこの空間から消えました。← 戻って My Collection の \(controller.destinationLabel) を開くと現れます"
        case .idle:
            if controller.placement == .notPlaced {
                return AssetRepresentationEntity.isTwin(controller.asset)
                    ? "1/3　床や机に向けて画面をタップして作品を置く"
                    : "1/3　壁に向けて画面をタップして作品を掛ける"
            } else if !controller.isProvenancePulled {
                return "2/3　作品をタップして来歴を引き出す"
            } else {
                return "3/3　「\(controller.destinationLabel)へ送る」を押す"
            }
        }
    }

    /// Once placed and idle, always hints at the gestures available for the
    /// current placement (they work regardless of whether provenance has
    /// been Pulled yet). Once Pulled, that hint is combined with
    /// `controller.statusMessage`'s provenance count onto one line rather
    /// than showing two footnotes. Other states (not yet placed, pending,
    /// confirmed) already say everything in `stepText`; `.failed` shows
    /// `controller.statusMessage`'s specific failure reason.
    private var footnoteMessage: String? {
        switch controller.transferState {
        case .idle:
            guard controller.placement == .placed else {
                // Before placement, on a simulator or other non-AR device,
                // note that the tap will use a fixed position rather than
                // tracking the live camera.
                return controller.isARSupported ? nil : "AR非対応のため固定位置に配置します"
            }
            return controller.isProvenancePulled
                ? "\(controller.statusMessage)　\(gestureHint)"
                : gestureHint
        case .failed:
            return controller.statusMessage
        case .pending, .confirmed:
            return nil
        }
    }

    /// Matches `ARSceneController.pan`/`scale(by:)`'s actual behavior for
    /// the current placement: a wall placement only slides (no rotate, no
    /// scale — see `ARSceneController.scale(by:)`'s doc comment); an
    /// air-placed `card` (the no-wall-found fallback) keeps rotate and
    /// scale; an air-placed `model` twin has neither drag nor pinch (see
    /// `ARSceneController.pan`) since it's shown at real-world size and
    /// meant to be walked around instead.
    private var gestureHint: String {
        if controller.isWallPlacement {
            return "ドラッグで壁に沿って動かす"
        } else if AssetRepresentationEntity.isTwin(controller.asset) {
            return "周りを歩いて色々な角度から見る"
        } else {
            return "ドラッグで回転、ピンチで拡大縮小"
        }
    }

    @ViewBuilder
    private var primaryButton: some View {
        switch controller.transferState {
        case .idle:
            Button("\(controller.destinationLabel)へ送る (demo)") {
                controller.simulateTransfer(outcome: .confirmed)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!controller.isProvenancePulled)
        case .pending:
            Button("送信中…") {}
                .buttonStyle(.borderedProminent)
                .disabled(true)
        case .failed:
            Button("Retry") {
                controller.simulateTransfer(outcome: .confirmed)
            }
            .buttonStyle(.borderedProminent)
        case .confirmed:
            Button("リセットしてもう一度") {
                controller.reset()
            }
            .buttonStyle(.borderedProminent)
        }
    }
}
