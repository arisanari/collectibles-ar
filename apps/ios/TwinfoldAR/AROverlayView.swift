import SwiftUI
import TwinfoldCore

/// AR screen chrome: DEMO DATA/DEVNET badge, status line, Reset and
/// Transfer buttons. Contains no ARKit/RealityKit calls; only reads
/// `ARSceneController` state.
struct AROverlayView: View {
    let controller: ARSceneController

    var body: some View {
        VStack {
            HStack {
                demoDataBadge
                Spacer()
            }
            .padding()

            Spacer()

            VStack(spacing: 10) {
                Text(controller.statusMessage)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))

                HStack(spacing: 16) {
                    Button("Reset") {
                        controller.reset()
                    }
                    .buttonStyle(.bordered)

                    transferControls
                }
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

    @ViewBuilder
    private var transferControls: some View {
        switch controller.transferState {
        case .idle:
            Button("Transfer (demo)") {
                controller.simulateTransfer(outcome: .confirmed)
            }
            .buttonStyle(.borderedProminent)
            .disabled(controller.placement != .placed)

            Button("Transfer fail (demo)") {
                controller.simulateTransfer(outcome: .failed)
            }
            .buttonStyle(.bordered)
            .disabled(controller.placement != .placed)
        case .pending:
            Button("Pending…") {}
                .buttonStyle(.borderedProminent)
                .disabled(true)
        case .failed:
            Button("Retry") {
                controller.simulateTransfer(outcome: .confirmed)
            }
            .buttonStyle(.borderedProminent)
        case .confirmed:
            Button("Confirmed") {}
                .buttonStyle(.borderedProminent)
                .disabled(true)
        }
    }
}
