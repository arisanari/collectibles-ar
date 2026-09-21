import SwiftUI
import TwinfoldCore

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
            return "送信完了。切手はこの空間から消えました。← 戻って My Collection の \(controller.destinationLabel) を開くと現れます"
        case .idle:
            if controller.placement == .notPlaced {
                return controller.isARSupported
                    ? "1/3　床や机をタップして切手を置く"
                    : "1/3　画面をタップして切手を置く"
            } else if !controller.isProvenancePulled {
                return "2/3　切手をタップして来歴を引き出す"
            } else {
                return "3/3　「\(controller.destinationLabel)へ送る」を押す"
            }
        }
    }

    /// `controller.statusMessage`, shown only when it adds information
    /// beyond `stepText` (e.g. how many provenance events were pulled, or
    /// the specific failure reason). Redundant states (not yet placed,
    /// placed-but-not-pulled, pending, confirmed) already say everything
    /// in `stepText`, so no footnote is shown there.
    private var footnoteMessage: String? {
        switch controller.transferState {
        case .idle:
            return (controller.placement == .placed && controller.isProvenancePulled)
                ? controller.statusMessage
                : nil
        case .failed:
            return controller.statusMessage
        case .pending, .confirmed:
            return nil
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
